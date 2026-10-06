import { defineRpc, type RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";

const CheckSchema = z.object({
  name: z.string(),
  state: z.enum(["fail", "pending", "pass", "skipped"]),
  url: z.string().nullable(),
});

const PrSchema = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  head: z.string(),
  base: z.string(),
  draft: z.boolean(),
  checks: z.array(CheckSchema),
  ci: z.enum(["pass", "fail", "pending", "none"]),
  review: z.enum(["approved", "changes_requested", "review_required", "none"]),
  merge: z.enum(["ready", "conflicts", "behind", "blocked", "unknown"]),
  depth: z.number(),
  /** Set when the branch is built on this PR's branch, but the PR targets another base. */
  builtOn: z.number().nullable(),
  resolver: z
    .object({ agentId: z.string(), workspaceId: z.string(), status: z.string() })
    .nullable(),
});

const PrGroupSchema = z.object({
  kind: z.enum(["wrong_base", "stack", "independent"]),
  prs: z.array(PrSchema),
});

export const prStackRpc = defineRpc({
  name: "factory.pr-stack.list",
  input: z.object({ directory: z.string() }),
  output: z.object({
    trunk: z.string(),
    groups: z.array(PrGroupSchema),
    warnings: z.array(z.string()),
  }),
});

export type PrStack = RpcOutput<typeof prStackRpc>;
export type PrGroup = PrStack["groups"][number];
export type Pr = PrGroup["prs"][number];
export type Check = Pr["checks"][number];
