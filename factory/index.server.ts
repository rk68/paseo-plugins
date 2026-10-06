import type { PluginServerContext } from "@getpaseo/plugin/server";
import { startTaskFromPanel, updateBranch } from "./server/actions";
import { createAutomation } from "./server/automation";
import { openBranch } from "./server/open-branch";
import { listPrStack } from "./server/pr-stack";
import { releaseTaskBases } from "./server/tasks";
import { factorySettings, openBranchRpc, startTaskRpc, updateBranchRpc } from "./shared/actions";
import { prStackRpc } from "./shared/pr-stack";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(factorySettings);
  const automation = createAutomation(settings, (message) => console.log(message));
  server.on("agent.turn_ended", (_event, { paseo }) => automation.attach(paseo));
  server.on("workspace.archived", (event, { paseo }) =>
    releaseTaskBases(paseo, event.workspace.id),
  );
  server.handle(prStackRpc, (input, { paseo }) => {
    automation.attach(paseo);
    return listPrStack(input, paseo);
  });
  server.handle(updateBranchRpc, updateBranch);
  server.handle(openBranchRpc, (input, { paseo }) => openBranch(input, paseo));
  server.handle(startTaskRpc, (input, { paseo }) => startTaskFromPanel(input, paseo, settings));
  return () => automation.stop();
}
