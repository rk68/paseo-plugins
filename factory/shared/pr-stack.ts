import { defineRpc, type RpcOutput } from "@getpaseo/plugin";
import { z } from "zod";
import { TASK_KINDS } from "./actions";

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
  headOid: z.string(),
  base: z.string(),
  createdAt: z.string(),
  draft: z.boolean(),
  checks: z.array(CheckSchema),
  ci: z.enum(["pass", "fail", "pending", "none"]),
  review: z.enum(["approved", "changes_requested", "review_required", "none"]),
  merge: z.enum(["ready", "conflicts", "behind", "blocked", "unknown"]),
  depth: z.number(),
  /** The viewer may squash-merge this PR, and it targets trunk without being built on another PR. */
  canSquash: z.boolean(),
  /** Set when the branch is built on this PR's branch, but the PR targets another base. */
  builtOn: z.number().nullable(),
  /** Path of the local worktree that has the PR branch checked out. */
  worktree: z.string().nullable(),
  /** Unresolved review threads that are not outdated. */
  threads: z.number(),
  /** The newest agent task for this PR, running or finished. */
  task: z
    .object({
      kind: z.enum(TASK_KINDS),
      agentId: z.string(),
      workspaceId: z.string(),
      status: z.string(),
    })
    .nullable(),
});

const PrGroupSchema = z.object({
  kind: z.enum(["wrong_base", "stack", "independent"]),
  prs: z.array(PrSchema),
});

export const prStackRpc = defineRpc({
  name: "factory.pr-stack.list",
  input: z.object({ directory: z.string(), scope: z.enum(["branch", "all"]) }),
  output: z.object({
    trunk: z.string(),
    /** The workspace's checked-out branch; null on trunk or a detached HEAD. */
    branch: z.string().nullable(),
    /** True when the list holds only the PRs related to `branch`. */
    filtered: z.boolean(),
    /** True when `branch` has no related PRs, so the list falls back to all PRs. */
    fallback: z.boolean(),
    groups: z.array(PrGroupSchema),
    warnings: z.array(z.string()),
  }),
});

export type PrStack = RpcOutput<typeof prStackRpc>;
export type PrGroup = PrStack["groups"][number];
export type Pr = PrGroup["prs"][number];
export type Check = Pr["checks"][number];
