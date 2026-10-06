import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { TASK_KINDS, type TaskKind } from "../shared/actions";
import { gh, repoInfo } from "./gh";
import { type GhCheck, toChecks } from "./stack";
import { type TaskTarget, taskPrompt, taskTitle } from "./task-prompts";

type PaseoApi = PluginHandlerContext["paseo"];

const LABEL = {
  pr: "factory.pr",
  kind: "factory.task",
  head: "factory.head",
  trigger: "factory.trigger",
} as const;

const AGENT_CONFIG = {
  provider: "claude/claude-opus-5-5",
  modeId: "auto",
  thinkingOptionId: "high",
};
const ACTIVE_STATUSES = new Set(["initializing", "running"]);

export type Trigger = "auto" | "manual";

export interface TaskAgent {
  agentId: string;
  workspaceId: string;
  status: string;
  kind: TaskKind;
  /** PR head commit the task was started for. */
  headOid: string;
  trigger: Trigger;
  createdAt: string;
}

export function taskKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

export function isActive(task: TaskAgent | undefined): boolean {
  return task !== undefined && ACTIVE_STATUSES.has(task.status);
}

function isTaskKind(value: string | undefined): value is TaskKind {
  return (TASK_KINDS as readonly string[]).includes(value ?? "");
}

/** Every factory task agent for this repository's PRs, newest first, keyed by `taskKey`. */
export async function findTasks(paseo: PaseoApi, repo: string): Promise<Map<string, TaskAgent[]>> {
  const { entries } = await paseo.agents.list();
  const tasks = new Map<string, TaskAgent[]>();
  for (const { agent } of entries) {
    const labels = agent.labels ?? {};
    const key = labels[LABEL.pr];
    const kind = labels[LABEL.kind];
    if (!key?.startsWith(`${repo}#`) || !isTaskKind(kind)) continue;
    tasks.set(key, [
      ...(tasks.get(key) ?? []),
      {
        agentId: agent.id,
        workspaceId: agent.workspaceId ?? "",
        status: agent.status,
        kind,
        headOid: labels[LABEL.head] ?? "",
        trigger: labels[LABEL.trigger] === "auto" ? "auto" : "manual",
        createdAt: agent.createdAt,
      },
    ]);
  }
  for (const list of tasks.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return tasks;
}

export async function startTask(
  paseo: PaseoApi,
  directory: string,
  kind: TaskKind,
  target: TaskTarget,
  extraPrompt: string,
  trigger: Trigger,
): Promise<{ agentId: string; workspaceId: string; reused: boolean }> {
  const key = taskKey(target.repo, target.number);
  // One task per PR: two agents pushing to the same branch would race.
  const running = (await findTasks(paseo, target.repo)).get(key)?.find(isActive);
  if (running) return { agentId: running.agentId, workspaceId: running.workspaceId, reused: true };

  const workspace = await paseo.workspaces.create({
    title: taskTitle(kind, target.number).replace("[Factory] ", ""),
    source: { kind: "worktree", cwd: directory, action: "checkout", refName: target.head },
  });
  const agent = await workspace.agents.create({
    config: AGENT_CONFIG,
    title: taskTitle(kind, target.number),
    prompt: taskPrompt(kind, target, extraPrompt),
    labels: {
      [LABEL.pr]: key,
      [LABEL.kind]: kind,
      [LABEL.head]: target.headOid,
      [LABEL.trigger]: trigger,
    },
  });
  return { agentId: agent.id, workspaceId: workspace.id, reused: false };
}

export async function taskTarget(directory: string, number: number): Promise<TaskTarget> {
  const [{ nameWithOwner }, view] = await Promise.all([
    repoInfo(directory),
    gh(directory, [
      "pr",
      "view",
      String(number),
      "--json",
      "title,url,headRefName,headRefOid,baseRefName,isCrossRepository,statusCheckRollup",
    ]),
  ]);
  const pr = JSON.parse(view) as {
    title: string;
    url: string;
    headRefName: string;
    headRefOid: string;
    baseRefName: string;
    isCrossRepository: boolean;
    statusCheckRollup: GhCheck[] | null;
  };
  if (pr.isCrossRepository) throw new Error(`#${number} comes from a fork; fix it by hand`);
  return {
    repo: nameWithOwner,
    number,
    title: pr.title,
    url: pr.url,
    head: pr.headRefName,
    headOid: pr.headRefOid,
    base: pr.baseRefName,
    failingChecks: toChecks(pr.statusCheckRollup)
      .filter((check) => check.state === "fail")
      .map(({ name, url }) => ({ name, url })),
  };
}
