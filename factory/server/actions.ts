import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import type {
  factorySettings,
  markReadyRpc,
  retargetToTrunkRpc,
  squashMergeRpc,
  startTaskRpc,
  updateBranchRpc,
} from "../shared/actions";
import { gh, repoInfo } from "./gh";
import { startTask, taskTarget } from "./tasks";

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
