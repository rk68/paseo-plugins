import { defineRpc, type RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";

/** What an agent or one of its scripts writes to report progress on countable work. */
export const ProgressFileSchema = z.object({
  task: z.string().optional(),
  done: z.number().nonnegative(),
  total: z.number().positive().optional(),
  phase: z.string().optional(),
  note: z.string().optional(),
});

const ProgressSchema = ProgressFileSchema.extend({
  name: z.string(),
  updatedAt: z.string(),
  /** Unfinished and written in the last few minutes. */
  live: z.boolean(),
});

const SubagentSchema = z.object({
  id: z.string(),
  description: z.string(),
  status: z.enum(["running", "completed", "failed", "canceled"]),
  actions: z.number(),
  lastAction: z.string().nullable(),
});

const AgentRunSchema = z.object({
  id: z.string(),
  title: z.string(),
  provider: z.string(),
  status: z.enum(["initializing", "idle", "running", "error", "closed"]),
  attention: z.enum(["finished", "error", "permission"]).nullable(),
  depth: z.number(),
  cwd: z.string(),
  updatedAt: z.string(),
  currentTool: z.string().nullable(),
  progress: z.array(ProgressSchema),
  subagents: z.array(SubagentSchema),
});

export const listRunsRpc = defineRpc({
  name: "lab.runs.list",
  input: z.object({}),
  output: z.object({ agents: z.array(AgentRunSchema) }),
});

export type AgentRun = RpcOutput<typeof listRunsRpc>["agents"][number];
export type ProgressFile = z.infer<typeof ProgressFileSchema>;
export type Progress = AgentRun["progress"][number];
export type Subagent = AgentRun["subagents"][number];
