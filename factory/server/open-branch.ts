import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { openBranchRpc } from "../shared/actions";
import { gh } from "./gh";
import { fastForward, listWorktrees } from "./worktrees";

type PaseoApi = PluginHandlerContext["paseo"];

/** Opens the worktree that has the PR branch, or creates one, so the user can work on the PR. */
export async function openBranch(
  { directory, number }: RpcInput<typeof openBranchRpc>,
  paseo: PaseoApi,
): Promise<{ workspaceId: string; created: boolean }> {
  const pr = JSON.parse(
    await gh(directory, [
      "pr",
      "view",
      String(number),
      "--json",
      "title,headRefName,isCrossRepository",
    ]),
  ) as { title: string; headRefName: string; isCrossRepository: boolean };

  const existing = (await listWorktrees(directory)).get(pr.headRefName);
  const workspace = existing
    ? await paseo.workspaces.open({ cwd: existing })
    : await paseo.workspaces.create({
        title: `#${number} ${pr.title}`,
        source: pr.isCrossRepository
          ? {
              kind: "worktree",
              cwd: directory,
              action: "checkout",
              checkoutSource: { kind: "change_request", forge: "github", number },
            }
          : { kind: "worktree", cwd: directory, action: "checkout", refName: pr.headRefName },
      });

  const path = existing ?? workspace.directory;
  if (path && !pr.isCrossRepository) {
    await fastForward(path, pr.headRefName).catch(() => undefined);
  }
  return { workspaceId: workspace.id, created: !existing };
}
