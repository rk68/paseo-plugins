import type { RpcInput } from "@getpaseo/plugin";
import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import type { factorySettings, startTaskRpc, updateBranchRpc } from "../shared/actions";
import { gh } from "./gh";
import { startTask, taskTarget } from "./tasks";

type PaseoApi = PluginHandlerContext["paseo"];
type Settings = PluginSettings<typeof factorySettings.schema>;

export async function updateBranch({ directory, number }: RpcInput<typeof updateBranchRpc>) {
  const output = await gh(directory, ["pr", "update-branch", String(number)]);
  return { message: output.trim() || `Updated #${number}` };
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
