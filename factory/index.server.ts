import type { PluginServerContext } from "@getpaseo/plugin/server";
import { resolveConflicts, updateBranch } from "./server/actions";
import { createAutoResolver } from "./server/auto-resolve";
import { listPrStack } from "./server/pr-stack";
import { factorySettings, resolveConflictsRpc, updateBranchRpc } from "./shared/actions";
import { prStackRpc } from "./shared/pr-stack";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(factorySettings);
  const autoResolver = createAutoResolver(settings, (message) => console.log(message));
  server.on("agent.turn_ended", (_event, { paseo }) => autoResolver.attach(paseo));
  server.handle(prStackRpc, (input, { paseo }) => {
    autoResolver.attach(paseo);
    return listPrStack(input, paseo);
  });
  server.handle(updateBranchRpc, updateBranch);
  server.handle(resolveConflictsRpc, (input, { paseo }) => resolveConflicts(input, paseo));
  return () => autoResolver.stop();
}
