import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import {
  type Automation,
  type factorySettings,
  NO_AUTOMATION,
  TASK_KINDS,
  type TaskKind,
} from "../shared/actions";
import { mainCheckout, repoInfo } from "./gh";
import { listOpenPrs } from "./pr-stack";
import { type GhPr, toChecks } from "./stack";
import type { TaskTarget } from "./task-prompts";
import { remoteFor } from "./remote";
import {
  activeTaskCount,
  findTasks,
  MAX_ACTIVE_TASKS_PER_REPO,
  mayStartAuto,
  startTask,
  type TaskAgent,
  taskKey,
} from "./tasks";
import { unresolvedThreads } from "./threads";

type PaseoApi = PluginHandlerContext["paseo"];
type Settings = PluginSettings<typeof factorySettings.schema>;

const POLL_MS = 5 * 60_000;

export interface PrState {
  pr: GhPr;
  threads: number;
}

function failingChecks(pr: GhPr, ignored: ReadonlySet<string>) {
  const checks = toChecks(pr.statusCheckRollup);
  return {
    failing: checks.filter((c) => c.state === "fail" && !ignored.has(c.name)),
    running: checks.some((c) => c.state === "pending"),
  };
}

function needs(kind: TaskKind, { pr, threads }: PrState, ignored: ReadonlySet<string>): boolean {
  switch (kind) {
    case "conflicts":
      return pr.mergeable === "CONFLICTING";
    case "ci": {
      // Waiting for running checks avoids fixing half a picture.
      const { failing, running } = failingChecks(pr, ignored);
      return failing.length > 0 && !running;
    }
    case "comments":
      // Threads only: the agent resolves them, so a summary-only "changes requested" cannot loop.
      return threads > 0;
  }
}

/**
 * The automatic tasks to start now, at most one per PR, most urgent kind first. A PR gets one
 * attempt per kind and head commit, and a bounded number of automatic attempts per kind.
 */
export function nextTasks(
  states: PrState[],
  repo: string,
  tasks: Map<string, TaskAgent[]>,
  enabled: Automation,
  ignored: ReadonlySet<string>,
  attempted: ReadonlySet<string>,
): { state: PrState; kind: TaskKind }[] {
  let slots = MAX_ACTIVE_TASKS_PER_REPO - activeTaskCount(tasks);
  const picked: { state: PrState; kind: TaskKind }[] = [];
  for (const state of [...states].sort((a, b) => a.pr.number - b.pr.number)) {
    if (slots <= 0) break;
    if (state.pr.isCrossRepository) continue;
    const key = taskKey(repo, state.pr.number);
    const history = tasks.get(key) ?? [];
    const kind = TASK_KINDS.find(
      (candidate) =>
        enabled[candidate] &&
        needs(candidate, state, ignored) &&
        mayStartAuto(history, candidate, state.pr.headRefOid) &&
        !attempted.has(`${key}:${candidate}@${state.pr.headRefOid}`),
    );
    if (!kind) continue;
    picked.push({ state, kind });
    slots -= 1;
  }
  return picked;
}

export function targetFromPr(
  repo: string,
  remote: string,
  pr: GhPr,
  ignored: ReadonlySet<string>,
): TaskTarget {
  return {
    repo,
    number: pr.number,
    title: pr.title,
    url: pr.url,
    head: pr.headRefName,
    headOid: pr.headRefOid,
    base: pr.baseRefName,
    remote,
    failingChecks: failingChecks(pr, ignored).failing.map(({ name, url }) => ({ name, url })),
  };
}

/**
 * Records an automatic attempt once it ran or failed. A start declined for capacity is not an
 * attempt, so a later tick tries it again.
 */
export async function runAttempt<Result>(
  attempted: Set<string>,
  attempt: string,
  start: () => Promise<Result | null>,
): Promise<Result | null> {
  try {
    const started = await start();
    if (started !== null) attempted.add(attempt);
    return started;
  } catch (error) {
    attempted.add(attempt);
    throw error;
  }
}

export interface AutomationRunner {
  /** The plugin's daemon session only reaches handlers and hooks, so the watcher borrows it from them. */
  attach(paseo: PaseoApi): void;
  stop(): void;
}

export function createAutomation(
  settings: Settings,
  log: (message: string) => void,
): AutomationRunner {
  let paseo: PaseoApi | null = null;
  let running = false;
  const attempted = new Set<string>();

  async function runDirectory(
    api: PaseoApi,
    directory: string,
    enabled: Automation,
    prompts: Record<TaskKind, string>,
    ignored: ReadonlySet<string>,
  ) {
    const [{ nameWithOwner }, prs] = await Promise.all([
      repoInfo(directory),
      listOpenPrs(directory),
    ]);
    const threads = enabled.comments
      ? await unresolvedThreads(directory, nameWithOwner)
      : new Map<number, number>();
    const states = prs.map((pr) => ({ pr, threads: threads.get(pr.number) ?? 0 }));
    const remote = await remoteFor(directory, nameWithOwner);
    if (!remote) throw new Error(`no git remote points to ${nameWithOwner}`);
    const tasks = await findTasks(api, nameWithOwner);
    for (const { state, kind } of nextTasks(
      states,
      nameWithOwner,
      tasks,
      enabled,
      ignored,
      attempted,
    )) {
      const key = taskKey(nameWithOwner, state.pr.number);
      const target = targetFromPr(nameWithOwner, remote, state.pr, ignored);
      const started = await runAttempt(attempted, `${key}:${kind}@${state.pr.headRefOid}`, () =>
        startTask(api, directory, kind, target, prompts[kind], "auto"),
      );
      if (started && !started.reused) {
        log(`Automation started ${kind} agent ${started.agentId} for ${key}`);
      }
    }
  }

  async function tick() {
    if (!paseo || running) return;
    running = true;
    try {
      const state = await settings.read();
      if (state.status !== "ready") return;
      const { automation, prompts, ignoredChecks } = state.values;
      const ignored = new Set(ignoredChecks);
      for (const [directory, enabled] of Object.entries(automation)) {
        if (!TASK_KINDS.some((kind) => (enabled ?? NO_AUTOMATION)[kind])) continue;
        // The UI keys automation by project root; a worktree key from an older version is inert.
        if ((await mainCheckout(directory)) !== directory) {
          log(`Automation ignores ${directory}: not a project's main checkout`);
          continue;
        }
        await runDirectory(paseo, directory, enabled, prompts, ignored).catch((error: unknown) =>
          log(`Automation skipped ${directory}: ${error instanceof Error ? error.message : error}`),
        );
      }
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), POLL_MS);
  const unsubscribe = settings.subscribe(() => void tick());
  return {
    attach(api) {
      const first = paseo === null;
      paseo = api;
      if (first) void tick();
    },
    stop() {
      clearInterval(timer);
      unsubscribe();
    },
  };
}
