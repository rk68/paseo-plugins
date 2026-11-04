import { basename } from "node:path";
import type { AgentTimelineItem, ToolCallTimelineItem } from "@getpaseo/protocol/agent-types";
import type { AgentRun, ProgressFile, Subagent } from "../shared/runs";

export const PARENT_LABEL = "paseo.parent-agent-id";
const LIVE_PROGRESS_MS = 10 * 60_000;
const FINISHED_WINDOW_MS = 2 * 60 * 60_000;
const PROGRESS_MAX_AGE_MS = 24 * 60 * 60_000;
const FINISHED_SUBAGENTS = 3;

export interface AgentInput {
  id: string;
  title: string | null;
  provider: string;
  status: AgentRun["status"];
  requiresAttention: boolean;
  attentionReason: AgentRun["attention"];
  cwd: string;
  updatedAt: string;
  labels: Readonly<Record<string, string>>;
}

export interface AgentProgress extends ProgressFile {
  agentId: string;
  name: string;
  updatedAt: string;
}

export interface RunsInput {
  agents: readonly AgentInput[];
  timelines: ReadonlyMap<string, readonly AgentTimelineItem[]>;
  progress: readonly AgentProgress[];
  /** Subagent descriptions by call ID; see `rememberSubagentNames`. */
  subagentNames: ReadonlyMap<string, string>;
  nowMs: number;
}

/** Agents that are working or need the user, each followed by its delegated agents. */
export function buildRuns({
  agents,
  timelines,
  progress,
  subagentNames,
  nowMs,
}: RunsInput): AgentRun[] {
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  const parentOf = (agent: AgentInput) => {
    const parent = agent.labels[PARENT_LABEL];
    return parent && parent !== agent.id && byId.has(parent) ? parent : undefined;
  };
  const progressOf = groupProgress(progress, nowMs);
  const isLive = (agent: AgentInput) =>
    agent.status === "running" ||
    agent.status === "initializing" ||
    agent.status === "error" ||
    needsUser(agent, nowMs) ||
    (progressOf.get(agent.id) ?? []).some((entry) => isLiveProgress(entry, nowMs));

  const shown = new Set<string>();
  for (const agent of agents.filter(isLive)) {
    // Ancestors stay visible so a delegated agent keeps its place in the tree.
    for (let id: string | undefined = agent.id; id && !shown.has(id); ) {
      shown.add(id);
      const current = byId.get(id);
      id = current ? parentOf(current) : undefined;
    }
  }

  const children = new Map<string | undefined, AgentInput[]>();
  for (const agent of agents) {
    if (!shown.has(agent.id)) continue;
    const parent = parentOf(agent);
    children.set(parent, [...(children.get(parent) ?? []), agent]);
  }
  const visited = new Set<string>();
  const walk = (agent: AgentInput, depth: number): AgentRun[] => {
    if (visited.has(agent.id)) return [];
    visited.add(agent.id);
    const run = toRun(agent, depth, {
      timeline: timelines.get(agent.id) ?? [],
      progress: progressOf.get(agent.id) ?? [],
      subagentNames,
      nowMs,
    });
    const below = sortRuns(children.get(agent.id) ?? []).flatMap((child) => walk(child, depth + 1));
    return [run, ...below];
  };
  const tree = sortRuns(children.get(undefined) ?? []).flatMap((root) => walk(root, 0));
  // Agents in a parent cycle have no root; list them flat so none disappear.
  const cycle = sortRuns(agents.filter((agent) => shown.has(agent.id) && !visited.has(agent.id)));
  return [...tree, ...cycle.flatMap((agent) => walk(agent, 0))];
}

/** Unread "finished" flags pile up on agents nobody opens, so only recent ones count. */
function needsUser(agent: AgentInput, nowMs: number): boolean {
  if (!agent.requiresAttention || agent.status === "closed") return false;
  if (agent.attentionReason !== "finished") return true;
  return nowMs - Date.parse(agent.updatedAt) <= FINISHED_WINDOW_MS;
}

function rank(agent: AgentInput): number {
  if (agent.attentionReason === "permission" || agent.status === "error") return 0;
  if (agent.status === "running" || agent.status === "initializing") return 1;
  return 2;
}

function sortRuns(agents: AgentInput[]): AgentInput[] {
  return [...agents].sort(
    (a, b) => rank(a) - rank(b) || Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
  );
}

function groupProgress(
  progress: readonly AgentProgress[],
  nowMs: number,
): Map<string, AgentProgress[]> {
  const grouped = new Map<string, AgentProgress[]>();
  for (const entry of progress) {
    if (nowMs - Date.parse(entry.updatedAt) > PROGRESS_MAX_AGE_MS) continue;
    grouped.set(entry.agentId, [...(grouped.get(entry.agentId) ?? []), entry]);
  }
  return grouped;
}

/** Unfinished and written recently; a script that died stops counting after a few minutes. */
function isLiveProgress(entry: ProgressFile & { updatedAt: string }, nowMs: number): boolean {
  const unfinished = entry.total === undefined || entry.done < entry.total;
  return unfinished && nowMs - Date.parse(entry.updatedAt) <= LIVE_PROGRESS_MS;
}

function toRun(
  agent: AgentInput,
  depth: number,
  {
    timeline,
    progress,
    subagentNames,
    nowMs,
  }: Pick<RunsInput, "subagentNames" | "nowMs"> & {
    timeline: readonly AgentTimelineItem[];
    progress: readonly AgentProgress[];
  },
): AgentRun {
  const toolCalls = timeline.filter(
    (item): item is ToolCallTimelineItem => item.type === "tool_call",
  );
  const running = agent.status === "running";
  const current = running ? toolCalls.findLast((call) => call.status === "running") : undefined;
  return {
    id: agent.id,
    title: agent.title ?? "Untitled agent",
    provider: agent.provider,
    status: agent.status,
    attention: agent.requiresAttention ? agent.attentionReason : null,
    depth,
    cwd: agent.cwd,
    updatedAt: agent.updatedAt,
    currentTool: current ? toolSummary(current) : null,
    progress: progress.map(({ agentId: _, ...entry }) => ({
      ...entry,
      live: isLiveProgress(entry, nowMs),
    })),
    subagents: subagents(toolCalls, subagentNames),
  };
}

/** Provider subagents, such as Claude Code tasks, live inside their parent's timeline. */
function subagents(
  toolCalls: readonly ToolCallTimelineItem[],
  names: ReadonlyMap<string, string>,
): Subagent[] {
  const all = toolCalls.flatMap((call): Subagent[] => {
    const { detail } = call;
    if (detail.type !== "sub_agent") return [];
    const actions = subagentActions(detail);
    return [
      {
        id: call.callId,
        description:
          detail.description ?? names.get(call.callId) ?? detail.subAgentType ?? "Subagent",
        status: call.status,
        actions: actions.length,
        lastAction: actions.at(-1) ?? null,
      },
    ];
  });
  const finished = new Set(
    all.filter((agent) => agent.status !== "running").slice(-FINISHED_SUBAGENTS),
  );
  return all.filter((agent) => agent.status === "running" || finished.has(agent));
}

type SubagentDetail = Extract<ToolCallTimelineItem["detail"], { type: "sub_agent" }>;

/** Claude Code reports steps only as `[Tool] summary` lines in the log, with no `actions`. */
function subagentActions(detail: SubagentDetail): string[] {
  if (detail.actions?.length) {
    return detail.actions.map((action) => action.summary ?? action.toolName);
  }
  return detail.log
    .split("\n")
    .map((line) => /^\[([^\]]+)\]\s*(.*)$/.exec(line))
    .filter((match) => match !== null)
    .map(([, tool = "", summary]) => (summary ? `${tool} ${summary}` : tool));
}

const SUBAGENT_NAME_LIMIT = 500;

/** Later updates of a subagent call drop its description, so the first one seen is kept. */
export function rememberSubagentNames(
  timelines: Iterable<readonly AgentTimelineItem[]>,
  names: Map<string, string>,
): void {
  for (const timeline of timelines) {
    for (const item of timeline) {
      if (item.type !== "tool_call" || item.detail.type !== "sub_agent") continue;
      if (item.detail.description) names.set(item.callId, item.detail.description);
    }
  }
  for (const id of names.keys()) {
    if (names.size <= SUBAGENT_NAME_LIMIT) break;
    names.delete(id);
  }
}

export function toolSummary(call: ToolCallTimelineItem): string {
  const { detail } = call;
  switch (detail.type) {
    case "shell":
      return detail.command;
    case "read":
    case "edit":
    case "write":
      return `${call.name} ${basename(detail.filePath)}`;
    case "search":
      return `${call.name} ${detail.query}`;
    case "fetch":
      return detail.url;
    case "sub_agent":
      return detail.description ?? detail.subAgentType ?? call.name;
    default:
      return call.name;
  }
}
