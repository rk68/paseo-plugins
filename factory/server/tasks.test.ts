import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { describe, expect, it } from "vitest";
import type { TaskTarget } from "./task-prompts";
import { archiveTasks, findTasks, releaseTaskBases, startTask as startWithFetch } from "./tasks";

const pins: { ref: string; oid: string }[] = [];
const unpins: { root: string; ref: string }[] = [];
const fakeGit = (head: string) => ({
  fetchHead: async () => head,
  pinRef: async (_directory: string, ref: string, oid: string) => pins.push({ ref, oid }),
  unpinRef: async (root: string, ref: string) => unpins.push({ root, ref }),
  mainCheckout: async () => "/main",
});
const startTask = (...args: Parameters<typeof startWithFetch>) =>
  startWithFetch(args[0], args[1], args[2], args[3], args[4], args[5], fakeGit("h7"));

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
const sources: string[] = [];
const archivedWorkspaces: string[] = [];

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
          entries: matching
            .slice(start, end)
            .map((agent) => ({ agent: { ...agent, archivedAt: agent.archived ? "t" : null } })),
          pageInfo: {
            hasMore: end < matching.length,
            nextCursor: end < matching.length ? String(end) : null,
            prevCursor: null,
          },
        };
      },
      ref(id: string) {
        return {
          async archive() {
            const agent = agents.find((candidate) => candidate.id === id);
            if (agent) agent.archived = true;
            return { archivedAt: "t" };
          },
        };
      },
    },
    workspaces: {
      async archive(id: string) {
        archivedWorkspaces.push(id);
        return { requestId: "r", workspaceId: id, archivedAt: "t", error: null };
      },
      async create(options: { source: { refName?: string } }) {
        sources.push(options.source.refName ?? "");
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
      "factory.repo": "github.com/o/r",
      "factory.pr": `github.com/o/r#${number}`,
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
  host: "github.com",
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
    const tasks = await findTasks(fakePaseo(agents, 2), "github.com/o/r");
    expect(tasks.get("github.com/o/r#7")?.[0]?.status).toBe("running");
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

describe("fetched head", () => {
  it("judges limits by the fetched head and records it on the agent", async () => {
    const movedTo = fakeGit("h2");
    const tried = [taskAgent("a1", 7, {}, { "factory.head": "h2" })];
    const declined = await startWithFetch(
      fakePaseo(tried),
      "/repo",
      "ci",
      target,
      "",
      "auto",
      movedTo,
    );
    expect(declined).toBeNull();

    const agents: FakeAgent[] = [];
    await startWithFetch(fakePaseo(agents), "/repo", "ci", target, "", "manual", movedTo);
    expect(agents[0]?.labels["factory.head"]).toBe("h2");
  });
});

describe("task identity and start commit", () => {
  it("keeps tasks on the same owner/repo apart across forge hosts", async () => {
    const enterprise = taskAgent(
      "a1",
      7,
      { status: "running" },
      {
        "factory.repo": "ghe.example.com/o/r",
        "factory.pr": "ghe.example.com/o/r#7",
      },
    );
    const started = await startTask(fakePaseo([enterprise]), "/repo", "ci", target, "", "manual");
    expect(started?.reused).toBe(false);
  });

  it("bases the worktree on a kept local branch at the fetched commit, released on archive", async () => {
    pins.length = 0;
    unpins.length = 0;
    sources.length = 0;
    const agents: FakeAgent[] = [];
    const paseo = fakePaseo(agents);
    await startTask(paseo, "/repo", "ci", target, "", "manual");

    // Paseo resolves a workspace's diff base only under refs/heads or refs/remotes.
    expect(sources[0]).toMatch(/^refs\/heads\/factory\/base\/pr-7-ci-/);
    expect(pins).toEqual([{ ref: sources[0], oid: "h7" }]);
    expect(unpins).toEqual([]);
    const labels = agents[0]?.labels ?? {};
    expect(`refs/heads/${labels["factory.base"]}`).toBe(sources[0]);
    expect(labels["factory.root"]).toBe("/main");

    await releaseTaskBases(paseo, labels["factory.workspace"] ?? "", fakeGit("h7"));
    expect(unpins).toEqual([{ root: "/main", ref: sources[0] }]);
  });
});

describe("archiveTasks", () => {
  it("archives the finished tasks of one PR and each of their workspaces once", async () => {
    archivedWorkspaces.length = 0;
    const agents = [
      taskAgent("a1", 7, { workspaceId: "w1" }),
      taskAgent("a22", 7, { workspaceId: "w1", status: "error" }),
      taskAgent("a333", 7, { workspaceId: "w2", archived: true }),
      taskAgent("a4444", 8, { workspaceId: "w3" }),
    ];
    expect(await archiveTasks(fakePaseo(agents), "github.com/o/r", 7)).toBe(2);
    expect(agents.map((agent) => agent.archived)).toEqual([true, true, true, false]);
    expect(archivedWorkspaces).toEqual(["w1"]);
  });

  it("refuses while a task on the PR runs", async () => {
    archivedWorkspaces.length = 0;
    const agents = [taskAgent("a1", 7), taskAgent("a22", 7, { status: "running" })];
    await expect(archiveTasks(fakePaseo(agents), "github.com/o/r", 7)).rejects.toThrow(
      "A task is still running on #7",
    );
    expect(agents.some((agent) => agent.archived)).toBe(false);
    expect(archivedWorkspaces).toEqual([]);
  });
});
