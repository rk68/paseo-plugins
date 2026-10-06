import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { gh, repoInfo } from "./gh";

type PaseoApi = PluginHandlerContext["paseo"];

export const RESOLVER_LABEL = "factory.resolves";
export const RESOLVER_HEAD_LABEL = "factory.head";

const RESOLVER_CONFIG = {
  provider: "claude/claude-opus-5-5",
  modeId: "auto",
  thinkingOptionId: "high",
};
const ACTIVE_STATUSES = new Set(["initializing", "running"]);

export interface ResolverTarget {
  repo: string;
  number: number;
  title: string;
  url: string;
  head: string;
  headOid: string;
  base: string;
}

export function resolverKey(repo: string, number: number): string {
  return `${repo}#${number}`;
}

/** A briefing the agent can act on with zero context, as the paseo-handoff skill requires. */
export function resolverPrompt(target: ResolverTarget): string {
  const { number, url, head, base, repo, title } = target;
  return `## Task
Resolve the merge conflicts in pull request #${number} so that it can merge into \`${base}\`.

## Context
- Repository: ${repo}. Pull request: ${url} ("${title}").
- GitHub reports that the branch \`${head}\` conflicts with \`${base}\`.
- This worktree was created for this task from \`${head}\`. Its local branch name can be different from \`${head}\`.

## Steps
1. Run \`git fetch origin\`.
2. Bring the local branch to the remote branch: \`git merge --ff-only origin/${head}\`. If this fails, stop and report that the local and remote branches diverged.
3. Merge the base branch: \`git merge origin/${base}\`.
4. Resolve every conflict. Keep the intent of both sides. Read the PR (\`gh pr view ${number}\`) and the commits on both sides before you choose a resolution.
5. Run the fast checks that apply to the changed files, as the repository documents them (format, lint, tests). Fix what the merge broke.
6. Commit the merge with the default merge message.
7. Push: \`git push origin HEAD:refs/heads/${head}\`.
8. Report each conflicting file and how you resolved it.

## Constraints
- Do not rebase. Do not force-push. Do not change the base of the PR. Do not merge the PR.
- If a conflict needs a product decision, stop and explain the options. Do not guess.`;
}

export interface ResolverAgent {
  agentId: string;
  workspaceId: string;
  status: string;
  /** PR head commit the resolver was started for; one attempt per head commit. */
  headOid: string;
}

/** Newest resolver agent for each PR of this repository, keyed by `resolverKey`. */
export async function findResolvers(
  paseo: PaseoApi,
  repo: string,
): Promise<Map<string, ResolverAgent>> {
  const { entries } = await paseo.agents.list();
  const resolvers = new Map<string, ResolverAgent & { createdAt: string }>();
  for (const { agent } of entries) {
    const key = agent.labels?.[RESOLVER_LABEL];
    if (!key?.startsWith(`${repo}#`)) continue;
    const current = resolvers.get(key);
    if (current && current.createdAt >= agent.createdAt) continue;
    resolvers.set(key, {
      agentId: agent.id,
      workspaceId: agent.workspaceId ?? "",
      status: agent.status,
      headOid: agent.labels?.[RESOLVER_HEAD_LABEL] ?? "",
      createdAt: agent.createdAt,
    });
  }
  return new Map([...resolvers].map(([key, { createdAt: _, ...resolver }]) => [key, resolver]));
}

export function isActive(resolver: ResolverAgent | undefined): boolean {
  return resolver !== undefined && ACTIVE_STATUSES.has(resolver.status);
}

export async function startResolver(
  paseo: PaseoApi,
  directory: string,
  target: ResolverTarget,
): Promise<{ agentId: string; workspaceId: string; reused: boolean }> {
  const key = resolverKey(target.repo, target.number);
  const existing = (await findResolvers(paseo, target.repo)).get(key);
  if (existing && isActive(existing)) {
    return { agentId: existing.agentId, workspaceId: existing.workspaceId, reused: true };
  }

  const workspace = await paseo.workspaces.create({
    title: `Resolve conflicts #${target.number}`,
    source: { kind: "worktree", cwd: directory, action: "checkout", refName: target.head },
  });
  const agent = await workspace.agents.create({
    config: RESOLVER_CONFIG,
    title: `[Factory] Resolve conflicts in #${target.number}`,
    prompt: resolverPrompt(target),
    labels: { [RESOLVER_LABEL]: key, [RESOLVER_HEAD_LABEL]: target.headOid },
  });
  return { agentId: agent.id, workspaceId: workspace.id, reused: false };
}

export async function resolverTarget(directory: string, number: number): Promise<ResolverTarget> {
  const [{ nameWithOwner }, view] = await Promise.all([
    repoInfo(directory),
    gh(directory, [
      "pr",
      "view",
      String(number),
      "--json",
      "number,title,url,headRefName,headRefOid,baseRefName,isCrossRepository",
    ]),
  ]);
  const pr = JSON.parse(view) as {
    title: string;
    url: string;
    headRefName: string;
    headRefOid: string;
    baseRefName: string;
    isCrossRepository: boolean;
  };
  if (pr.isCrossRepository) throw new Error(`#${number} comes from a fork; resolve it by hand`);
  return {
    repo: nameWithOwner,
    number,
    title: pr.title,
    url: pr.url,
    head: pr.headRefName,
    headOid: pr.headRefOid,
    base: pr.baseRefName,
  };
}
