import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { describe, expect, it } from "vitest";
import {
  type AgentInput,
  type AgentProgress,
  buildRuns,
  PARENT_LABEL,
  rememberSubagentNames,
} from "./runs-model";

const NOW = Date.parse("2026-10-07T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function agent(id: string, overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    id,
    title: id,
    provider: "claude",
    status: "idle",
    requiresAttention: false,
    attentionReason: null,
    cwd: "/repo",
    updatedAt: minutesAgo(5),
    labels: {},
    ...overrides,
  };
}

function progress(agentId: string, overrides: Partial<AgentProgress> = {}): AgentProgress {
  return {
    agentId,
    name: "labelling",
    done: 10,
    total: 100,
    updatedAt: minutesAgo(1),
    ...overrides,
  };
}

function runs(
  agents: AgentInput[],
  extra: { progress?: AgentProgress[]; timelines?: Map<string, AgentTimelineItem[]> } = {},
) {
  const timelines = extra.timelines ?? new Map();
  const subagentNames = new Map<string, string>();
  rememberSubagentNames(timelines.values(), subagentNames);
  return buildRuns({
    agents,
    timelines,
    progress: extra.progress ?? [],
    subagentNames,
    nowMs: NOW,
  });
}

const ids = (list: { id: string; depth: number }[]) =>
  list.map(({ id, depth }) => `${depth}:${id}`);

describe("buildRuns", () => {
  it("hides idle agents that need nothing from the user", () => {
    expect(
      runs([agent("quiet"), agent("busy", { status: "running" })]).map((run) => run.id),
    ).toEqual(["busy"]);
  });

  it("keeps an idle parent so its running child stays in the tree", () => {
    const list = runs([
      agent("child", { status: "running", labels: { [PARENT_LABEL]: "parent" } }),
      agent("parent"),
    ]);
    expect(ids(list)).toEqual(["0:parent", "1:child"]);
  });

  it("treats a parent that is not listed as a root", () => {
    const list = runs([agent("orphan", { status: "running", labels: { [PARENT_LABEL]: "gone" } })]);
    expect(ids(list)).toEqual(["0:orphan"]);
  });

  it("hides finished agents after a while and closed agents at once", () => {
    const finished = { requiresAttention: true, attentionReason: "finished" as const };
    const list = runs([
      agent("recent", { ...finished, updatedAt: minutesAgo(30) }),
      agent("stale", { ...finished, updatedAt: minutesAgo(3 * 60) }),
      agent("closed", { ...finished, status: "closed", updatedAt: minutesAgo(1) }),
    ]);
    expect(list.map((run) => run.id)).toEqual(["recent"]);
  });

  it("puts agents that wait for permission before running ones", () => {
    const list = runs([
      agent("running", { status: "running", updatedAt: minutesAgo(0) }),
      agent("blocked", { requiresAttention: true, attentionReason: "permission" }),
    ]);
    expect(list.map((run) => run.id)).toEqual(["blocked", "running"]);
  });

  it("shows an idle agent whose background script still reports progress", () => {
    const list = runs([agent("labeller")], { progress: [progress("labeller")] });
    expect(list.map((run) => run.id)).toEqual(["labeller"]);
    expect(list[0]?.progress).toEqual([
      { name: "labelling", done: 10, total: 100, updatedAt: minutesAgo(1), live: true },
    ]);
  });

  it("stops showing an idle agent when its script went silent", () => {
    const list = runs([agent("labeller")], {
      progress: [progress("labeller", { updatedAt: minutesAgo(30) })],
    });
    expect(list).toEqual([]);
  });

  it("stops showing an idle agent when its script finished", () => {
    const list = runs([agent("labeller")], { progress: [progress("labeller", { done: 100 })] });
    expect(list).toEqual([]);
  });

  it("drops progress older than a day", () => {
    const list = runs([agent("busy", { status: "running" })], {
      progress: [progress("busy", { updatedAt: minutesAgo(25 * 60) })],
    });
    expect(list[0]?.progress).toEqual([]);
  });

  it("lists agents in a parent cycle instead of hiding them", () => {
    const list = runs([
      agent("a", { status: "running", labels: { [PARENT_LABEL]: "b" } }),
      agent("b", { status: "running", labels: { [PARENT_LABEL]: "a" } }),
    ]);
    expect(list.map((run) => run.id).sort()).toEqual(["a", "b"]);
  });
});

function toolCall(
  callId: string,
  status: "running" | "completed",
  detail: Extract<AgentTimelineItem, { type: "tool_call" }>["detail"],
): AgentTimelineItem {
  return { type: "tool_call", callId, name: "Task", status, error: null, detail };
}

describe("buildRuns timeline", () => {
  it("reports the running tool call and the subagents of a running agent", () => {
    const timeline = [
      toolCall("old", "completed", { type: "sub_agent", description: "Old", log: "" }),
      toolCall("label", "running", {
        type: "sub_agent",
        description: "Label batch 3",
        log: "",
        actions: [
          { index: 0, toolName: "Read" },
          { index: 1, toolName: "Bash", summary: "python label.py" },
        ],
      }),
    ];
    const [run] = runs([agent("main", { status: "running" })], {
      timelines: new Map([["main", timeline]]),
    });
    expect(run?.currentTool).toBe("Label batch 3");
    expect(run?.subagents).toEqual([
      { id: "old", description: "Old", status: "completed", actions: 0, lastAction: null },
      {
        id: "label",
        description: "Label batch 3",
        status: "running",
        actions: 2,
        lastAction: "python label.py",
      },
    ]);
  });

  it("keeps only the last three finished subagents", () => {
    const timeline = ["a", "b", "c", "d"].map((id) =>
      toolCall(id, "completed", { type: "sub_agent", description: id, log: "" }),
    );
    const [run] = runs([agent("main", { status: "running" })], {
      timelines: new Map([["main", timeline]]),
    });
    expect(run?.subagents.map((sub) => sub.id)).toEqual(["b", "c", "d"]);
  });

  it("reads Claude Code subagent steps from the log", () => {
    const timeline = [
      toolCall("task", "running", {
        type: "sub_agent",
        log: "[Bash] ls -la\n[Read] label.py\nplain output",
        actions: [],
      }),
    ];
    const [run] = runs([agent("main", { status: "running" })], {
      timelines: new Map([["main", timeline]]),
    });
    expect(run?.subagents[0]).toMatchObject({ actions: 2, lastAction: "Read label.py" });
  });
});

describe("rememberSubagentNames", () => {
  it("keeps a description that a later update dropped", () => {
    const names = new Map<string, string>();
    const first = toolCall("task", "running", { type: "sub_agent", description: "Label", log: "" });
    const later = toolCall("task", "running", { type: "sub_agent", log: "" });
    rememberSubagentNames([[first]], names);
    rememberSubagentNames([[later]], names);
    const [run] = buildRuns({
      agents: [agent("main", { status: "running" })],
      timelines: new Map([["main", [later]]]),
      progress: [],
      subagentNames: names,
      nowMs: NOW,
    });
    expect(run?.subagents[0]?.description).toBe("Label");
  });
});
