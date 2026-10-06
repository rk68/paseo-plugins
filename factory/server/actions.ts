import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import type { resolveConflictsRpc, updateBranchRpc } from "../shared/actions";
import { gh } from "./gh";
import { resolverTarget, startResolver } from "./resolver";

type PaseoApi = PluginHandlerContext["paseo"];

export async function updateBranch({ directory, number }: RpcInput<typeof updateBranchRpc>) {
  const output = await gh(directory, ["pr", "update-branch", String(number)]);
  return { message: output.trim() || `Updated #${number}` };
}

export async function resolveConflicts(
  { directory, number }: RpcInput<typeof resolveConflictsRpc>,
  paseo: PaseoApi,
) {
  return startResolver(paseo, directory, await resolverTarget(directory, number));
}
