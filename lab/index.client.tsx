import type { PluginClientContext } from "@getpaseo/plugin/client";
import { ClusterJobsPanel } from "./client/cluster-jobs-panel";

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
  return () => {};
}
