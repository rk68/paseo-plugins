import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { AgentTimelineItem } from "@getpaseo/protocol/agent-types";
import { ProgressFileSchema } from "../shared/runs";
import {
  type AgentInput,
  type AgentProgress,
  buildRuns,
  rememberSubagentNames,
} from "./runs-model";

type Paseo = PluginHandlerContext["paseo"];

const AGENT_PAGE = 200;
const TIMELINE_TAIL = 60;

const subagentNames = new Map<string, string>();

/** Agents write `<root>/$PASEO_AGENT_ID/<name>.json`; scripts they start inherit both variables. */
export function progressRoot(): string {
  return join(process.env.PASEO_HOME ?? join(homedir(), ".paseo"), "lab", "progress");
}

export async function listRuns(_input: unknown, { paseo }: PluginHandlerContext) {
  const [agents, progress] = await Promise.all([listAgents(paseo), readProgress(progressRoot())]);
  const running = agents.filter((agent) => agent.status === "running");
  const timelines = new Map(
    await Promise.all(
      running.map(async (agent) => [agent.id, await timelineTail(paseo, agent.id)] as const),
    ),
  );
  rememberSubagentNames(timelines.values(), subagentNames);
  return {
    agents: buildRuns({ agents, timelines, progress, subagentNames, nowMs: Date.now() }),
  };
}

export async function listAgents(paseo: Paseo): Promise<AgentInput[]> {
  const agents: AgentInput[] = [];
  let cursor: string | undefined;
  do {
    const { entries, pageInfo } = await paseo.agents.list({
      filter: { includeArchived: false },
      sort: [{ key: "updated_at", direction: "desc" }],
      page: { limit: AGENT_PAGE, ...(cursor ? { cursor } : {}) },
    });
    for (const { agent } of entries) {
      agents.push({
        id: agent.id,
        title: agent.title,
        provider: agent.provider,
        status: agent.status,
        requiresAttention: agent.requiresAttention ?? false,
        attentionReason: agent.attentionReason ?? null,
        cwd: agent.cwd,
        updatedAt: agent.updatedAt,
        labels: agent.labels,
      });
    }
    cursor = pageInfo.hasMore ? (pageInfo.nextCursor ?? undefined) : undefined;
  } while (cursor);
  return agents;
}

async function timelineTail(paseo: Paseo, agentId: string): Promise<AgentTimelineItem[]> {
  try {
    const page = await paseo.agents
      .ref(agentId)
      .timeline.refetch({ direction: "tail", limit: TIMELINE_TAIL });
    return page.entries.map((entry) => entry.item);
  } catch (error) {
    // One unreadable timeline must not hide every other agent.
    console.error(`lab: timeline of ${agentId} unavailable`, error);
    return [];
  }
}

export async function readProgress(root: string): Promise<AgentProgress[]> {
  const agentDirs = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files = await Promise.all(
    agentDirs
      .filter((entry) => entry.isDirectory())
      .map(async ({ name: agentId }) => {
        const names = await readdir(join(root, agentId)).catch(() => []);
        return names
          .filter((name) => name.endsWith(".json"))
          .map((name) => ({ agentId, path: join(root, agentId, name) }));
      }),
  );
  const progress = await Promise.all(files.flat().map(readProgressFile));
  return progress.filter((entry) => entry !== null);
}

async function readProgressFile({
  agentId,
  path,
}: {
  agentId: string;
  path: string;
}): Promise<AgentProgress | null> {
  try {
    const [text, info] = await Promise.all([readFile(path, "utf8"), stat(path)]);
    // A writer may be midway through the file; the next poll reads the whole file.
    const parsed = ProgressFileSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return null;
    return {
      ...parsed.data,
      agentId,
      name: basename(path, ".json"),
      updatedAt: info.mtime.toISOString(),
    };
  } catch {
    return null;
  }
}
