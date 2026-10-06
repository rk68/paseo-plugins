import { type GhPr, gitStackParents } from "./stack";
import { git } from "./worktrees";

const MAX_PARALLEL_GIT = 8;
const MAX_BRANCH_COMMITS = "500";

interface StackPrInput extends Pick<GhPr, "number" | "headRefOid"> {}

export interface GitStack {
  parents: Map<number, number>;
  /** Each PR's commits that are not on trunk. */
  uniqueCommits: Map<number, Set<string>>;
  /** `<remote>/<trunk>`, or null when the ref is missing locally. */
  trunkOid: string | null;
  warning: string | null;
}

const cacheByDirectory = new Map<string, { key: string; stack: GitStack }>();

async function mapLimit<Item, Result>(
  items: Item[],
  limit: number,
  fn: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  for (let start = 0; start < items.length; start += limit) {
    results.push(...(await Promise.all(items.slice(start, start + limit).map(fn))));
  }
  return results;
}

async function hasCommit(directory: string, oid: string): Promise<boolean> {
  return git(directory, ["cat-file", "-e", `${oid}^{commit}`]).then(
    () => true,
    () => false,
  );
}

export async function commitsNotOn(directory: string, ref: string, trunkOid: string) {
  const list = await git(directory, [
    "rev-list",
    `--max-count=${MAX_BRANCH_COMMITS}`,
    ref,
    `^${trunkOid}`,
  ]).catch(() => "");
  return new Set(list.split("\n").filter(Boolean));
}

/** Maps each PR to the open PR its branch was built on, from commit ancestry rather than the PR base. */
export async function findGitStack(
  directory: string,
  prs: StackPrInput[],
  trunk: string,
  remote: string | null,
): Promise<GitStack> {
  if (!remote) {
    return {
      parents: new Map(),
      uniqueCommits: new Map(),
      trunkOid: null,
      warning: "No git remote points to this repository, so stacks use PR bases only.",
    };
  }
  const trunkRef = `${remote}/${trunk}`;
  const trunkOid =
    (await git(directory, ["rev-parse", "--verify", "-q", trunkRef]).catch(() => "")).trim() ||
    null;
  if (!trunkOid) {
    return {
      parents: new Map(),
      uniqueCommits: new Map(),
      trunkOid,
      warning: `Stacks from git ancestry need ${trunkRef}. Run git fetch.`,
    };
  }

  const key = [trunkOid, ...prs.map((pr) => `${pr.number}:${pr.headRefOid}`).sort()].join(",");
  const cached = cacheByDirectory.get(directory);
  if (cached?.key === key) return cached.stack;

  const present = await mapLimit(prs, MAX_PARALLEL_GIT, (pr) =>
    hasCommit(directory, pr.headRefOid),
  );
  const missing = prs.filter((_, index) => !present[index]);
  let warning: string | null = null;
  if (missing.length) {
    // Fetching into FETCH_HEAD only adds objects; no local branch or ref changes.
    await git(
      directory,
      ["fetch", "--no-tags", "--quiet", remote, ...missing.map((pr) => `pull/${pr.number}/head`)],
      60_000,
    ).catch(() => {
      warning = `Could not fetch ${missing.length} PR branch(es); their stacks may be missing.`;
    });
  }

  const commitSets = await mapLimit(prs, MAX_PARALLEL_GIT, (pr) =>
    commitsNotOn(directory, pr.headRefOid, trunkOid),
  );
  const uniqueCommits = new Map(prs.map((pr, index) => [pr.number, commitSets[index]]));
  const stack = { parents: gitStackParents(prs, uniqueCommits), uniqueCommits, trunkOid, warning };
  if (!warning) cacheByDirectory.set(directory, { key, stack });
  return stack;
}
