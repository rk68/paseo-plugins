import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { TASK_KINDS, type TaskKind } from "../shared/actions";
import { gh, mainCheckout, repoId, repoInfo } from "./gh";
import { fetchPrHead } from "./checkout";
import { git } from "./worktrees";
import { requireRemote } from "./remote";
import { type GhCheck, toChecks } from "./stack";
import { type TaskTarget, taskPrompt, taskTitle } from "./task-prompts";

type PaseoApi = PluginHandlerContext["paseo"];

const LABEL = {
  repo: "factory.repo",
  pr: "factory.pr",
  kind: "factory.task",
  head: "factory.head",
  trigger: "factory.trigger",
  workspace: "factory.workspace",
  base: "factory.base",
  root: "factory.root",
} as const;

const AGENT_CONFIG = {
  provider: "claude/claude-opus-5-5",
  modeId: "auto",
  thinkingOptionId: "high",
};
const ACTIVE_STATUSES = new Set(["initializing", "running"]);
const AGENT_PAGE_SIZE = 200;
export const MAX_ACTIVE_TASKS_PER_REPO = 2;
/** Caps automatic retries when each fix pushes a new head that fails the same way. */
export const MAX_AUTO_ATTEMPTS_PER_TASK = 3;

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
  archived: boolean;
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

export function activeTaskCount(tasks: Map<string, TaskAgent[]>): number {
  return [...tasks.values()].flat().filter((task) => isActive(task)).length;
}

/**
 * Whether an automatic task of `kind` may start on a PR, given its task history (archived agents
 * included): one task per PR at a time, one attempt per kind and head commit, and a bounded
 * number of automatic attempts per kind.
 */
export function mayStartAuto(history: TaskAgent[], kind: TaskKind, headOid: string): boolean {
  if (history.some((task) => isActive(task))) return false;
  if (history.some((task) => task.kind === kind && task.headOid === headOid)) return false;
  const autoAttempts = history.filter((task) => task.kind === kind && task.trigger === "auto");
  return autoAttempts.length < MAX_AUTO_ATTEMPTS_PER_TASK;
}

/** Every factory task agent for this repository's PRs, newest first, keyed by `taskKey`. */
export async function findTasks(paseo: PaseoApi, repo: string): Promise<Map<string, TaskAgent[]>> {
  const tasks = new Map<string, TaskAgent[]>();
  let cursor: string | undefined;
  do {
    const { entries, pageInfo } = await paseo.agents.list({
      // Archived attempts still count towards the retry limits.
      filter: { labels: { [LABEL.repo]: repo }, includeArchived: true },
      page: { limit: AGENT_PAGE_SIZE, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of entries) {
      const labels = agent.labels ?? {};
      const key = labels[LABEL.pr];
      const kind = labels[LABEL.kind];
      if (!key || !isTaskKind(kind)) continue;
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
          archived: Boolean(agent.archivedAt),
        },
      ]);
    }
    cursor = pageInfo.hasMore ? (pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  for (const list of tasks.values()) list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return tasks;
}

const repoLocks = new Map<string, Promise<unknown>>();

/** Runs `work` after every earlier call for the same repository has settled. */
export function withRepoLock<Result>(repo: string, work: () => Promise<Result>): Promise<Result> {
  const previous = repoLocks.get(repo) ?? Promise.resolve();
  const next = previous.then(work, work);
  repoLocks.set(
    repo,
    next.catch(() => undefined),
  );
  return next;
}

/** The git steps of a task start, injectable so tests need no repository. */
export interface TaskGit {
  fetchHead: typeof fetchPrHead;
  pinRef(directory: string, ref: string, oid: string): Promise<unknown>;
  unpinRef(directory: string, ref: string): Promise<unknown>;
  mainCheckout(directory: string): Promise<string>;
}

const ZERO_OID = "0000000000000000000000000000000000000000";

const repositoryGit: TaskGit = {
  fetchHead: fetchPrHead,
  // The zero old value makes this create-only, so an existing branch is never moved.
  pinRef: (directory, ref, oid) => git(directory, ["update-ref", ref, oid, ZERO_OID]),
  unpinRef: (directory, ref) => git(directory, ["update-ref", "-d", ref]),
  mainCheckout,
};

export interface StartedTask {
  agentId: string;
  workspaceId: string;
  reused: boolean;
}

/**
 * Starts a task agent in a new worktree. The check for a running task and the creation share one
 * per-repository lock, so concurrent manual and automatic starts cannot put two agents on one PR.
 * Automatic starts also recheck their limits inside the lock and return null when one is reached.
 */
export function startTask(
  paseo: PaseoApi,
  directory: string,
  kind: TaskKind,
  target: TaskTarget,
  extraPrompt: string,
  trigger: Trigger,
  io: TaskGit = repositoryGit,
): Promise<StartedTask | null> {
  const repo = repoId({ host: target.host, nameWithOwner: target.repo });
  return withRepoLock(repo, async () => {
    const key = taskKey(repo, target.number);
    // The head GitHub reported can move before the fetch; limits and history use the fetched one.
    const pr = { number: target.number, head: target.head, isCrossRepository: false };
    const headOid = await io.fetchHead(directory, target.remote, pr);
    const tasks = await findTasks(paseo, repo);
    const history = tasks.get(key) ?? [];
    const running = history.find((task) => isActive(task));
    if (running) {
      return { agentId: running.agentId, workspaceId: running.workspaceId, reused: true };
    }
    if (
      trigger === "auto" &&
      (activeTaskCount(tasks) >= MAX_ACTIVE_TASKS_PER_REPO || !mayStartAuto(history, kind, headOid))
    ) {
      return null;
    }

    // A new branch from the fetched PR head: the user's local branch may hold unpushed commits
    // that a task must never publish, and it is never moved.
    // The tracking ref can move under another fetch, so a local base branch pins the checked
    // commit. Paseo keeps it as the workspace's diff base and only resolves refs/heads and
    // refs/remotes there, so it lives under refs/heads until the workspace is archived.
    const suffix = `pr-${target.number}-${kind}-${Date.now().toString(36)}`;
    const branchName = `factory/${suffix}`;
    const baseBranch = `factory/base/${suffix}`;
    const pinned = `refs/heads/${baseBranch}`;
    const root = await io.mainCheckout(directory);
    await io.pinRef(directory, pinned, headOid);
    const release = () => io.unpinRef(root, pinned).catch(() => undefined);
    const workspace = await paseo.workspaces
      .create({
        title: taskTitle(kind, target.number).replace("[Factory] ", ""),
        source: {
          kind: "worktree",
          cwd: directory,
          action: "branch-off",
          refName: pinned,
          branchName,
        },
      })
      .catch(async (error: unknown) => {
        await release();
        throw error;
      });
    const agent = await workspace.agents.create({
      config: AGENT_CONFIG,
      title: taskTitle(kind, target.number),
      prompt: taskPrompt(kind, target, extraPrompt),
      labels: {
        [LABEL.repo]: repo,
        [LABEL.pr]: key,
        [LABEL.kind]: kind,
        [LABEL.head]: headOid,
        [LABEL.trigger]: trigger,
        [LABEL.workspace]: workspace.id,
        [LABEL.base]: baseBranch,
        [LABEL.root]: root,
      },
    });
    return { agentId: agent.id, workspaceId: workspace.id, reused: false };
  });
}

/**
 * Archives the agents and workspaces of a PR's finished tasks. Each task runs in a workspace that
 * `startTask` created for it, so no workspace of the user's is touched.
 */
export function archiveTasks(paseo: PaseoApi, repo: string, number: number): Promise<number> {
  return withRepoLock(repo, async () => {
    const history = (await findTasks(paseo, repo)).get(taskKey(repo, number)) ?? [];
    if (history.some((task) => isActive(task))) {
      throw new Error(`A task is still running on #${number}`);
    }
    const open = history.filter((task) => !task.archived);
    // Archives the agents first: a workspace archive is not known to archive its agents.
    for (const task of open) await paseo.agents.ref(task.agentId).archive();
    for (const workspaceId of new Set(open.map((task) => task.workspaceId).filter(Boolean))) {
      const { error } = await paseo.workspaces.archive(workspaceId);
      if (error) throw new Error(error);
    }
    return open.length;
  });
}

/** Deletes the base branches of the tasks in an archived workspace. */
export async function releaseTaskBases(
  paseo: PaseoApi,
  workspaceId: string,
  io: Pick<TaskGit, "unpinRef"> = repositoryGit,
): Promise<void> {
  const { entries } = await paseo.agents.list({
    filter: { labels: { [LABEL.workspace]: workspaceId }, includeArchived: true },
  });
  for (const { agent } of entries) {
    const base = agent.labels?.[LABEL.base];
    const root = agent.labels?.[LABEL.root];
    if (base?.startsWith("factory/base/") && root) {
      await io.unpinRef(root, `refs/heads/${base}`).catch(() => undefined);
    }
  }
}

export async function taskTarget(directory: string, number: number): Promise<TaskTarget> {
  const repo = await repoInfo(directory);
  const { nameWithOwner } = repo;
  const [view, remote] = await Promise.all([
    gh(directory, [
      "pr",
      "view",
      String(number),
      "--repo",
      repoId(repo),
      "--json",
      "title,url,headRefName,headRefOid,baseRefName,isCrossRepository,statusCheckRollup",
    ]),
    requireRemote(directory, repo),
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
    host: repo.host,
    number,
    title: pr.title,
    url: pr.url,
    head: pr.headRefName,
    headOid: pr.headRefOid,
    base: pr.baseRefName,
    remote,
    failingChecks: toChecks(pr.statusCheckRollup)
      .filter((check) => check.state === "fail")
      .map(({ name, url }) => ({ name, url })),
  };
}
