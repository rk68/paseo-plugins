import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import type {
  archiveTasksRpc,
  closePrRpc,
  disableAutoMergeRpc,
  enableAutoMergeRpc,
  factorySettings,
  markReadyRpc,
  retargetToTrunkRpc,
  squashMergeRpc,
  startTaskRpc,
  updateBranchRpc,
} from "../shared/actions";
import { gh, repoId, repoInfo } from "./gh";
import { archiveTasks, startTask, taskTarget } from "./tasks";

type PaseoApi = PluginHandlerContext["paseo"];
type Settings = PluginSettings<typeof factorySettings.schema>;

export async function updateBranch({ directory, number }: RpcInput<typeof updateBranchRpc>) {
  const output = await gh(directory, ["pr", "update-branch", String(number)]);
  return { message: output.trim() || `Updated #${number}` };
}

export async function markReady({ directory, number }: RpcInput<typeof markReadyRpc>) {
  const output = await gh(directory, ["pr", "ready", String(number)]);
  return { message: output.trim() || `Marked #${number} ready for review` };
}

export async function retargetToTrunk({ directory, number }: RpcInput<typeof retargetToTrunkRpc>) {
  const { trunk } = await repoInfo(directory);
  await gh(directory, ["pr", "edit", String(number), "--base", trunk]);
  return { message: `Moved #${number} to ${trunk}` };
}

// No --delete-branch: a worktree can hold the local branch, and a stacked PR can target it.
export async function closePr({ directory, number }: RpcInput<typeof closePrRpc>) {
  const output = await gh(directory, ["pr", "close", String(number)]);
  return { message: output.trim() || `Closed #${number}` };
}

// No --delete-branch: gh would also delete the local branch, which a worktree can hold.
export async function squashMerge({ directory, number, headOid }: RpcInput<typeof squashMergeRpc>) {
  const output = await gh(directory, [
    "pr",
    "merge",
    String(number),
    "--squash",
    "--match-head-commit",
    headOid,
  ]);
  return { message: output.trim() || `Merged #${number}` };
}

const ENABLE_AUTO_MERGE = `mutation($id: ID!, $head: GitObjectID!) {
  enablePullRequestAutoMerge(input: { pullRequestId: $id, mergeMethod: SQUASH, expectedHeadOid: $head }) {
    clientMutationId
  }
}`;

// Not `gh pr merge --auto`: gh merges at once when the PR is already mergeable, even with a
// failing check that is not required. The API refuses that case, so nothing merges early.
export async function enableAutoMerge({
  directory,
  number,
  headOid,
}: RpcInput<typeof enableAutoMergeRpc>) {
  const [{ host }, id] = await Promise.all([
    repoInfo(directory),
    gh(directory, ["pr", "view", String(number), "--json", "id", "--jq", ".id"]),
  ]);
  await gh(directory, [
    "api",
    "graphql",
    "--hostname",
    host,
    "-f",
    `query=${ENABLE_AUTO_MERGE}`,
    "-f",
    `id=${id.trim()}`,
    "-f",
    `head=${headOid}`,
  ]);
  return { message: `Auto-merge on for #${number}` };
}

export async function disableAutoMerge({
  directory,
  number,
}: RpcInput<typeof disableAutoMergeRpc>) {
  const output = await gh(directory, ["pr", "merge", String(number), "--disable-auto"]);
  return { message: output.trim() || `Auto-merge off for #${number}` };
}

export async function archiveTasksFromPanel(
  { directory, number }: RpcInput<typeof archiveTasksRpc>,
  paseo: PaseoApi,
) {
  const repo = await repoInfo(directory);
  return { archived: await archiveTasks(paseo, repoId(repo), number) };
}

export async function startTaskFromPanel(
  { directory, number, kind }: RpcInput<typeof startTaskRpc>,
  paseo: PaseoApi,
  settings: Settings,
) {
  const [target, state] = await Promise.all([taskTarget(directory, number), settings.read()]);
  const extra = state.status === "ready" ? state.values.prompts[kind] : "";
  const started = await startTask(paseo, directory, kind, target, extra, "manual");
  // Only automatic starts can be declined; a manual start always runs or reuses a task.
  if (!started) throw new Error(`Could not start ${kind} for #${number}`);
  return started;
}
