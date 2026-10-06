import type { PluginClientContext } from "@getpaseo/plugin/client";
import { PrStackPanel } from "./client/pr-stack-panel";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "pr-stack",
    title: "PR stack",
    icon: "GitPullRequest",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: PrStackPanel,
  });
  client.addCommandCenterItem({
    id: "open-pr-stack",
    title: "Open PR stack",
    icon: "GitPullRequest",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("pr-stack", { location: "explorer" });
    },
  });
  return () => {};
}
