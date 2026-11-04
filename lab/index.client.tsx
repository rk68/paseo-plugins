import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ClusterJobsPanel } from "./client/cluster-jobs-panel";
import { RunsScreen } from "./client/runs-screen";

export default function contribute(client: PluginClientContext) {
  client.addWorkspacePanel({
    id: "cluster-jobs",
    title: "Cluster",
    icon: "Cpu",
    context: "workspace",
    locations: ["explorer", "workspace"],
    Component: ClusterJobsPanel,
  });
  client.addCommandCenterItem({
    id: "open-cluster-jobs",
    title: "Open cluster jobs",
    icon: "Cpu",
    context: "workspace",
    onSelect({ openPanel }) {
      openPanel("cluster-jobs", { location: "explorer" });
    },
  });
  client.addSurface("runs", RunsScreen);
  client.addSidebarItem({ id: "runs", title: "Runs", icon: "Activity", surface: "runs" });
  client.addCommandCenterItem({
    id: "open-runs",
    title: "Open runs",
    icon: "Activity",
    context: "global",
    keywords: ["agents", "subagents", "progress", "monitor"],
    onSelect({ openSurface }) {
      openSurface("runs");
    },
  });
  return () => {};
}
