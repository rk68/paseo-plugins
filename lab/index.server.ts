import type { PluginServerContext } from "@getpaseo/plugin/server";
import { listJobs, readJobLog } from "./server/cluster";
import { listRuns } from "./server/runs";
import { clusterSettings, jobLogRpc, listJobsRpc } from "./shared/cluster";
import { listRunsRpc } from "./shared/runs";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(clusterSettings);
  server.handle(listJobsRpc, listJobs);
  server.handle(jobLogRpc, readJobLog);
  server.handle(listRunsRpc, listRuns);
  return () => {};
}
