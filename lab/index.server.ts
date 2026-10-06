import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listJobs, readJobLog } from "./server/cluster";
import { clusterSettings, jobLogRpc, listJobsRpc } from "./shared/cluster";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(clusterSettings);
  server.handle(listJobsRpc, listJobs);
  server.handle(jobLogRpc, readJobLog);
  return () => {};
}
