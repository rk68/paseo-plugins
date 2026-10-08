import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const TASK_KINDS = ["conflicts", "ci", "comments"] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

const PerTask = <Value extends z.ZodType>(value: Value) =>
  z.object({ conflicts: value, ci: value, comments: value });

const AutomationSchema = PerTask(z.boolean().default(false));

export const factorySettings = defineSettings({
  id: "factory",
  scope: "host",
  version: 2,
  schema: z.object({
    /** Automatic tasks per workspace directory. */
    automation: z.record(z.string(), AutomationSchema).default({}),
    /** Extra instructions appended to each task's agent briefing. */
    prompts: PerTask(z.string().default("")).default({ conflicts: "", ci: "", comments: "" }),
    /** Failing checks with these names never start an automatic CI fix. */
    ignoredChecks: z.array(z.string()).default([]),
    sort: z.enum(["urgency", "newest"]).default("urgency"),
  }),
  // Version 1 keyed auto-resolve by workspace folder, which can be a worktree the UI no longer
  // shows; an automation that cannot be turned off is worse than one that is off.
  migrate: (values, fromVersion) => (fromVersion === 1 ? {} : values),
});

export type Automation = z.infer<typeof AutomationSchema>;
export type FactorySettings = z.infer<typeof factorySettings.schema>;
export const NO_AUTOMATION: Automation = { conflicts: false, ci: false, comments: false };

const PrTargetSchema = z.object({ directory: z.string(), number: z.number().int().positive() });

export const updateBranchRpc = defineRpc({
  name: "factory.pr.update-branch",
  input: PrTargetSchema,
  output: z.object({ message: z.string() }),
});

export const markReadyRpc = defineRpc({
  name: "factory.pr.mark-ready",
  input: PrTargetSchema,
  output: z.object({ message: z.string() }),
});

export const squashMergeRpc = defineRpc({
  name: "factory.pr.squash-merge",
  /** `headOid` is the head the user saw: a newer push makes the merge fail instead. */
  input: PrTargetSchema.extend({ headOid: z.string() }),
  output: z.object({ message: z.string() }),
});

/** Moves a PR to trunk; the server reads trunk itself, so this cannot set any other base. */
export const retargetToTrunkRpc = defineRpc({
  name: "factory.pr.retarget-to-trunk",
  input: PrTargetSchema,
  output: z.object({ message: z.string() }),
});

export const closePrRpc = defineRpc({
  name: "factory.pr.close",
  input: PrTargetSchema,
  output: z.object({ message: z.string() }),
});

export const archiveTasksRpc = defineRpc({
  name: "factory.pr.archive-tasks",
  input: PrTargetSchema,
  output: z.object({ archived: z.number() }),
});

export const openBranchRpc = defineRpc({
  name: "factory.pr.open-branch",
  input: PrTargetSchema,
  output: z.object({ workspaceId: z.string(), created: z.boolean() }),
});

export const startTaskRpc = defineRpc({
  name: "factory.pr.start-task",
  input: PrTargetSchema.extend({ kind: z.enum(TASK_KINDS) }),
  output: z.object({ agentId: z.string(), workspaceId: z.string(), reused: z.boolean() }),
});
