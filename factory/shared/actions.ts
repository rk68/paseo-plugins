import { defineRpc, defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const factorySettings = defineSettings({
  id: "factory",
  scope: "host",
  version: 1,
  schema: z.object({
    /** Workspace directories whose conflicting PRs get a resolver agent without a click. */
    autoResolveDirectories: z.array(z.string()).default([]),
  }),
});

const PrTargetSchema = z.object({ directory: z.string(), number: z.number().int().positive() });

export const updateBranchRpc = defineRpc({
  name: "factory.pr.update-branch",
  input: PrTargetSchema,
  output: z.object({ message: z.string() }),
});

export const resolveConflictsRpc = defineRpc({
  name: "factory.pr.resolve-conflicts",
  input: PrTargetSchema,
  output: z.object({ agentId: z.string(), workspaceId: z.string(), reused: z.boolean() }),
});
