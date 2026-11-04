import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { describe, expect, it } from "vitest";
import { listAgents } from "./runs";
import type { AgentInput } from "./runs-model";

type Paseo = PluginHandlerContext["paseo"];

interface FakeAgent {
  id: string;
  title: string | null;
  provider: string;
  status: string;
  requiresAttention?: boolean;
  attentionReason?: string | null;
  cwd: string;
  updatedAt: string;
  labels: Record<string, string>;
}

/** An in-memory Paseo API with the same cursor-page shape the real one answers. */
function fakePaseo(agents: FakeAgent[], pageSize = 2) {
  const api = {
    agents: {
      async list(options: { page?: { limit: number; cursor?: string } }) {
        const start = Number(options.page?.cursor ?? 0);
        const limit = Math.min(options.page?.limit ?? 200, pageSize);
        const end = start + limit;
        return {
          entries: agents.slice(start, end).map((agent) => ({ agent })),
          pageInfo: {
            hasMore: end < agents.length,
            nextCursor: end < agents.length ? String(end) : null,
            prevCursor: null,
          },
        };
      },
    },
  };
  return api as unknown as Paseo;
}

function agentNo(id: string, page: number, extra: Partial<FakeAgent> = {}): FakeAgent {
  return {
    id,
    title: `t${id}`,
    provider: "opencode/test",
    status: "idle",
    cwd: `/w${page}`,
    updatedAt: `2026-01-0${page}T00:00:00Z`,
    labels: {},
    ...extra,
  };
}

describe("listAgents", () => {
  it("follows every page, so an agent behind older inert ones still appears", async () => {
    const agents = [
      agentNo("a1", 5),
      agentNo("a2", 5),
      agentNo("a3", 4),
      agentNo("a4", 4, { status: "running" }),
    ];
    const runs = await listAgents(fakePaseo(agents));
    expect(runs.map((run: AgentInput) => run.id)).toEqual(["a1", "a2", "a3", "a4"]);
    expect(runs[3]?.status).toBe("running");
  });

  it("reads the attention flags, with an absent flag as no attention", async () => {
    const agents = [
      agentNo("a1", 2, { requiresAttention: true, attentionReason: "permission" }),
      agentNo("a2", 2),
    ];
    const runs = await listAgents(fakePaseo(agents, 10));
    expect(runs.map((run) => `${run.requiresAttention}:${run.attentionReason}`)).toEqual([
      "true:permission",
      "false:null",
    ]);
  });
});
