import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import type { PrStack, prStackRpc } from "../shared/pr-stack";
import { gh, repoInfo } from "./gh";
import { findGitParents } from "./git-stack";
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

export async function listPrStack(
  { directory }: RpcInput<typeof prStackRpc>,
  paseo: PaseoApi,
): Promise<PrStack> {
  const [{ nameWithOwner, trunk }, prs] = await Promise.all([
    repoInfo(directory),
    listOpenPrs(directory),
  ]);
  const warnings: string[] = [];
  const [{ parents, warning }, tasks, threads, worktrees] = await Promise.all([
    findGitParents(directory, prs, trunk),
    findTasks(paseo, nameWithOwner),
    unresolvedThreads(directory, nameWithOwner).catch((error: unknown) => {
      warnings.push(
        `Review comments unavailable: ${error instanceof Error ? error.message : error}`,
      );
      return new Map<number, number>();
    }),
    listWorktrees(directory).catch(() => new Map<string, string>()),
  ]);
  if (warning) warnings.push(warning);
  const groups = buildPrGroups(prs, trunk, parents);
  for (const pr of groups.flatMap((group) => group.prs)) {
    pr.threads = threads.get(pr.number) ?? 0;
    pr.worktree = worktrees.get(pr.head) ?? null;
    const [latest] = tasks.get(taskKey(nameWithOwner, pr.number)) ?? [];
    pr.task = latest
      ? {
          kind: latest.kind,
          agentId: latest.agentId,
          workspaceId: latest.workspaceId,
          status: latest.status,
        }
      : null;
  }
  return { trunk, groups, warnings };
}
