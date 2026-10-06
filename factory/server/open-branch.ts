import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { openBranchRpc } from "../shared/actions";
import { gh, repoId, repoInfo } from "./gh";
import { ensureLocalBranch, fetchPrHead, remotePrRef, reusableWorktree } from "./checkout";
import { requireRemote } from "./remote";
import { fastForward, listWorktrees } from "./worktrees";

type PaseoApi = PluginHandlerContext["paseo"];

/** Opens the worktree that has the PR branch, or creates one, so the user can work on the PR. */
export async function openBranch(
  { directory, number }: RpcInput<typeof openBranchRpc>,
  paseo: PaseoApi,
): Promise<{ workspaceId: string; created: boolean }> {
  const repo = await repoInfo(directory);

  const pr = JSON.parse(
    await gh(directory, [
      "pr",
      "view",
      String(number),
      "--repo",
      repoId(repo),
      "--json",
      "title,headRefName,isCrossRepository",
    ]),
  ) as { title: string; headRefName: string; isCrossRepository: boolean };

  const target = { number, head: pr.headRefName, isCrossRepository: pr.isCrossRepository };
  const [worktrees, remote] = await Promise.all([
    listWorktrees(directory),
    requireRemote(directory, repo),
  ]);
  await fetchPrHead(directory, remote, target);
  const existing = reusableWorktree(worktrees, target);
  const workspace = existing
    ? await paseo.workspaces.open({ cwd: existing })
    : await paseo.workspaces.create({
        title: `#${number} ${pr.title}`,
        source: {
          kind: "worktree",
          cwd: directory,
          action: "checkout",
          refName: await ensureLocalBranch(directory, remote, target),
        },
      });

  const path = existing ?? workspace.directory;
  if (path) await fastForward(path, remotePrRef(remote, target)).catch(() => undefined);
  return { workspaceId: workspace.id, created: !existing };
}
