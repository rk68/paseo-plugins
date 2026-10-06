import { defineRpc, defineSettings, type RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";

export const clusterSettings = defineSettings({
  id: "cluster",
  scope: "host",
  version: 1,
  schema: z.object({
    sshHost: z.string().trim().default(""),
    logPattern: z.string().trim().default(""),
  }),
});

const QueuedJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  state: z.string(),
  reason: z.string(),
  node: z.string(),
  gpu: z.boolean(),
  elapsedSec: z.number(),
  limitSec: z.number().nullable(),
  after: z.array(z.number()),
  lastLine: z.string().nullable(),
  hasLog: z.boolean(),
});

const FinishedJobSchema = z.object({
  id: z.number(),
  name: z.string(),
  state: z.string(),
  elapsed: z.string(),
  exitCode: z.string(),
  end: z.string(),
  hasLog: z.boolean(),
});

export const listJobsRpc = defineRpc({
  name: "lab.jobs.list",
  input: z.object({ sshHost: z.string(), logPattern: z.string() }),
  output: z.object({ queued: z.array(QueuedJobSchema), finished: z.array(FinishedJobSchema) }),
});

export const jobLogRpc = defineRpc({
  name: "lab.jobs.log",
  input: z.object({
    sshHost: z.string(),
    logPattern: z.string(),
    jobId: z.number(),
    name: z.string(),
  }),
  output: z.object({ path: z.string(), lines: z.array(z.string()) }),
});

export type JobList = RpcOutput<typeof listJobsRpc>;
export type QueuedJob = JobList["queued"][number];
export type FinishedJob = JobList["finished"][number];
