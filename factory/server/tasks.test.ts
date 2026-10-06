import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { describe, expect, it } from "vitest";
import type { TaskTarget } from "./task-prompts";
import { findTasks, startTask } from "./tasks";

type PaseoApi = PluginHandlerContext["paseo"];

interface FakeAgent {
  id: string;
  workspaceId: string;
  status: string;
  createdAt: string;
  archived: boolean;
  labels: Record<string, string>;
}

/** An in-memory Paseo API: label filter, archived filter, cursor pages and a slow create. */
function fakePaseo(agents: FakeAgent[], pageSize = 2) {
  let created = 0;
  const api = {
    agents: {
      async list(options: {
        filter?: { labels?: Record<string, string>; includeArchived?: boolean };
        page?: { limit: number; cursor?: string };
      }) {
        const { labels = {}, includeArchived = false } = options.filter ?? {};
        const matching = agents.filter(
          (agent) =>
            (includeArchived || !agent.archived) &&
            Object.entries(labels).every(([key, value]) => agent.labels[key] === value),
        );
        const start = Number(options.page?.cursor ?? 0);
        const limit = Math.min(options.page?.limit ?? 200, pageSize);
        const end = start + limit;
        return {
          entries: matching.slice(start, end).map((agent) => ({ agent })),
          pageInfo: {
            hasMore: end < matching.length,
            nextCursor: end < matching.length ? String(end) : null,
            prevCursor: null,
          },
        };
      },
    },
    workspaces: {
      async create() {
        const workspaceId = `w${++created}`;
        return {
          id: workspaceId,
          agents: {
            async create({ labels }: { labels: Record<string, string> }) {
              await new Promise((resolve) => setTimeout(resolve, 10));
              const id = `a${agents.length + 1}`;
              agents.push({
                id,
                workspaceId,
                status: "running",
                createdAt: new Date().toISOString(),
                archived: false,
                labels,
              });
              return { id };
            },
          },
        };
      },
    },
  };
  return api as unknown as PaseoApi;
}

function taskAgent(
  id: string,
  number: number,
  extra: Partial<FakeAgent> = {},
  labels = {},
): FakeAgent {
  return {
    id,
    workspaceId: "w",
    status: "idle",
    createdAt: `2026-01-0${id.length}`,
    archived: false,
    labels: {
      "factory.repo": "o/r",
      "factory.pr": `o/r#${number}`,
      "factory.task": "ci",
      "factory.head": "h",
      "factory.trigger": "auto",
      ...labels,
    },
    ...extra,
  };
}

const target: TaskTarget = {
  repo: "o/r",
  number: 7,
  title: "t",
  url: "u",
  head: "feat",
  headOid: "h7",
  base: "main",
  remote: "origin",
  failingChecks: [],
};

describe("startTask", () => {
  it("puts one agent on a PR when two starts race", async () => {
    const agents: FakeAgent[] = [];
    const paseo = fakePaseo(agents);
    const [first, second] = await Promise.all([
      startTask(paseo, "/repo", "ci", target, "", "auto"),
      startTask(paseo, "/repo", "comments", target, "", "manual"),
    ]);
    expect(agents).toHaveLength(1);
    expect([first?.reused, second?.reused]).toEqual([false, true]);
    expect(second?.agentId).toBe(first?.agentId);
  });

  it("declines an automatic start once the repository is at capacity", async () => {
    const agents = [
      taskAgent("a1", 1, { status: "running" }),
      taskAgent("a2", 2, { status: "running" }),
    ];
    expect(await startTask(fakePaseo(agents), "/repo", "ci", target, "", "auto")).toBeNull();
    const manual = await startTask(fakePaseo(agents), "/repo", "ci", target, "", "manual");
    expect(manual?.reused).toBe(false);
  });
});

describe("findTasks", () => {
  it("follows every page, so an active task on a later page still blocks a second start", async () => {
    const agents = [
      taskAgent("a1", 1),
      taskAgent("a2", 2),
      taskAgent("a3", 3),
      taskAgent("a4", 7, { status: "running" }),
    ];
    const tasks = await findTasks(fakePaseo(agents, 2), "o/r");
    expect(tasks.get("o/r#7")?.[0]?.status).toBe("running");
    const started = await startTask(fakePaseo(agents, 2), "/repo", "ci", target, "", "manual");
    expect(started).toEqual({ agentId: "a4", workspaceId: "w", reused: true });
  });

  it("counts archived attempts towards the automatic retry limit", async () => {
    const agents = ["x1", "x2", "x3"].map((head, index) =>
      taskAgent(`a${index + 1}`, 7, { archived: true }, { "factory.head": head }),
    );
    expect(await startTask(fakePaseo(agents), "/repo", "ci", target, "", "auto")).toBeNull();
  });
});
