import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import type { Pr, PrStack, prStackRpc } from "../shared/pr-stack";
import { gh, repoId, repoInfo } from "./gh";
import { findGitStack } from "./git-stack";
import { reusableWorktree } from "./checkout";
import { remoteFor } from "./remote";
import { checkedOutBranch, relatedPrs, scopeGroups } from "./scope";
import { findTasks, taskKey } from "./tasks";
import { unresolvedThreads } from "./threads";
import { listWorktrees } from "./worktrees";
import { buildPrGroups, type GhPr } from "./stack";

type PaseoApi = PluginHandlerContext["paseo"];

const PR_FIELDS = [
  "number",
  "title",
  "url",
  "headRefName",
  "headRefOid",
  "baseRefName",
  "createdAt",
  "isCrossRepository",
  "isDraft",
  "mergeable",
  "mergeStateStatus",
  "reviewDecision",
  "statusCheckRollup",
].join(",");

export async function listOpenPrs(directory: string): Promise<GhPr[]> {
  const list = await gh(directory, [
    "pr",
    "list",
    "--author",
    "@me",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    PR_FIELDS,
  ]);
  return JSON.parse(list) as GhPr[];
}

const PR_STATE = { OPEN: "open", CLOSED: "closed", MERGED: "merged" } as const;

/** The newest same-repository PR from `branch`; a fork can use the same branch name. */
async function newestPrFrom(directory: string, branch: string): Promise<Pr["basePr"]> {
  const list = JSON.parse(
    await gh(directory, [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "10",
      "--json",
      "number,state,isCrossRepository",
    ]),
  ) as { number: number; state: keyof typeof PR_STATE; isCrossRepository: boolean }[];
  const pr = list.find((candidate) => !candidate.isCrossRepository);
  return pr ? { number: pr.number, state: PR_STATE[pr.state] } : null;
}

export async function listPrStack(
  { directory, scope }: RpcInput<typeof prStackRpc>,
  paseo: PaseoApi,
): Promise<PrStack> {
  const [repo, prs] = await Promise.all([repoInfo(directory), listOpenPrs(directory)]);
  const { trunk } = repo;
  const warnings: string[] = [];
  const [{ parents, uniqueCommits, trunkOid, warning }, tasks, threads, worktrees] =
    await Promise.all([
      remoteFor(directory, repo).then((remote) => findGitStack(directory, prs, trunk, remote)),
      findTasks(paseo, repoId(repo)),
      unresolvedThreads(directory, repo).catch((error: unknown) => {
        warnings.push(
          `Review comments unavailable: ${error instanceof Error ? error.message : error}`,
        );
        return new Map<number, number>();
      }),
      listWorktrees(directory).catch(() => new Map<string, string>()),
    ]);
  if (warning) warnings.push(warning);
  const branch = await checkedOutBranch(directory, trunk, trunkOid);
  const allGroups = buildPrGroups(prs, trunk, parents);
  const crossRepository = new Set(prs.filter((pr) => pr.isCrossRepository).map((pr) => pr.number));
  const related = scope === "branch" && branch ? relatedPrs(prs, branch, uniqueCommits) : null;
  const fallback = related !== null && related.size === 0;
  const filtered = related !== null && !fallback;
  const groups = filtered ? scopeGroups(allGroups, related) : allGroups;
  const shown = groups.flatMap((group) => group.prs);
  await Promise.all(
    shown
      .filter((pr) => pr.retargetTo !== null)
      .map(async (pr) => {
        pr.basePr = await newestPrFrom(directory, pr.base).catch(() => null);
      }),
  );
  for (const pr of shown) {
    pr.threads = threads.get(pr.number) ?? 0;
    pr.canSquash = repo.canSquash && pr.base === trunk && pr.builtOn === null;
    pr.worktree =
      reusableWorktree(worktrees, {
        number: pr.number,
        head: pr.head,
        isCrossRepository: crossRepository.has(pr.number),
      }) ?? null;
    const [latest] = tasks.get(taskKey(repoId(repo), pr.number)) ?? [];
    pr.task = latest
      ? {
          kind: latest.kind,
          agentId: latest.agentId,
          workspaceId: latest.workspaceId,
          status: latest.status,
        }
      : null;
  }
  return { trunk, branch: branch?.name ?? null, filtered, fallback, groups, warnings };
}
