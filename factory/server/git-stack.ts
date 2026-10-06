import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type GhPr, gitStackParents } from "./stack";

const run = promisify(execFile);

const MAX_PARALLEL_GIT = 8;
const MAX_BRANCH_COMMITS = "500";

interface StackPrInput extends Pick<GhPr, "number" | "headRefOid"> {}

interface CachedParents {
  key: string;
  parents: Map<number, number>;
}

const cacheByDirectory = new Map<string, CachedParents>();

function git(directory: string, args: string[], timeout = 20_000): Promise<string> {
  return run("git", args, {
    cwd: directory,
    env: { ...process.env, PWD: directory, GIT_TERMINAL_PROMPT: "0" },
    timeout,
    maxBuffer: 16 << 20,
  }).then(({ stdout }) => stdout);
}

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

/** Maps each PR to the open PR its branch was built on, from commit ancestry rather than the PR base. */
export async function findGitParents(
  directory: string,
  prs: StackPrInput[],
  trunk: string,
): Promise<{ parents: Map<number, number>; warning: string | null }> {
  const trunkRef = `origin/${trunk}`;
  const trunkOid = (
    await git(directory, ["rev-parse", "--verify", "-q", trunkRef]).catch(() => "")
  ).trim();
  if (!trunkOid) {
    return {
      parents: new Map(),
      warning: `Stacks from git ancestry need ${trunkRef}. Run git fetch.`,
    };
  }

  const key = [trunkOid, ...prs.map((pr) => `${pr.number}:${pr.headRefOid}`).sort()].join(",");
  const cached = cacheByDirectory.get(directory);
  if (cached?.key === key) return { parents: cached.parents, warning: null };

  const present = await mapLimit(prs, MAX_PARALLEL_GIT, (pr) =>
    hasCommit(directory, pr.headRefOid),
  );
  const missing = prs.filter((_, index) => !present[index]);
  let warning: string | null = null;
  if (missing.length) {
    // Fetching into FETCH_HEAD only adds objects; no local branch or ref changes.
    await git(
      directory,
      ["fetch", "--no-tags", "--quiet", "origin", ...missing.map((pr) => `pull/${pr.number}/head`)],
      60_000,
    ).catch(() => {
      warning = `Could not fetch ${missing.length} PR branch(es); their stacks may be missing.`;
    });
  }

  const commitLists = await mapLimit(prs, MAX_PARALLEL_GIT, (pr) =>
    git(directory, [
      "rev-list",
      `--max-count=${MAX_BRANCH_COMMITS}`,
      pr.headRefOid,
      `^${trunkOid}`,
    ]).catch(() => ""),
  );
  const uniqueCommits = new Map(
    prs.map((pr, index) => [pr.number, new Set(commitLists[index].split("\n").filter(Boolean))]),
  );
  const parents = gitStackParents(prs, uniqueCommits);
  if (!warning) cacheByDirectory.set(directory, { key, parents });
  return { parents, warning };
}
