import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import type { PrStack, prStackRpc } from "../shared/pr-stack";
import { gh, repoInfo } from "./gh";
import { findGitParents } from "./git-stack";
import { findResolvers, resolverKey } from "./resolver";
import { buildPrGroups, type GhPr } from "./stack";

type PaseoApi = PluginHandlerContext["paseo"];

const PR_FIELDS = [
  "number",
  "title",
  "url",
  "headRefName",
  "headRefOid",
  "baseRefName",
  "isCrossRepository",
  "isDraft",
  "mergeable",
  "mergeStateStatus",
  "reviewDecision",
  "statusCheckRollup",
].join(",");

export async function listOpenPrs(directory: string): Promise<GhPr[]> {
  const list = await gh(directory, [
    "pr",
    "list",
    "--author",
    "@me",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    PR_FIELDS,
  ]);
  return JSON.parse(list) as GhPr[];
}

export async function listPrStack(
  { directory }: RpcInput<typeof prStackRpc>,
  paseo: PaseoApi,
): Promise<PrStack> {
  const [{ nameWithOwner, trunk }, prs] = await Promise.all([
    repoInfo(directory),
    listOpenPrs(directory),
  ]);
  const [{ parents, warning }, resolvers] = await Promise.all([
    findGitParents(directory, prs, trunk),
    findResolvers(paseo, nameWithOwner),
  ]);
  const groups = buildPrGroups(prs, trunk, parents);
  for (const pr of groups.flatMap((group) => group.prs)) {
    const resolver = resolvers.get(resolverKey(nameWithOwner, pr.number));
    pr.resolver = resolver
      ? { agentId: resolver.agentId, workspaceId: resolver.workspaceId, status: resolver.status }
      : null;
  }
  return { trunk, groups, warnings: warning ? [warning] : [] };
}
