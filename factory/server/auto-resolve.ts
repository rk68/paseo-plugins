import type { PluginHandlerContext, PluginSettings } from "@getpaseo/plugin/server";
import type { factorySettings } from "../shared/actions";
import { repoInfo } from "./gh";
import { listOpenPrs } from "./pr-stack";
import {
  findResolvers,
  isActive,
  type ResolverAgent,
  resolverKey,
  startResolver,
} from "./resolver";
import type { GhPr } from "./stack";

type PaseoApi = PluginHandlerContext["paseo"];

const POLL_MS = 5 * 60_000;
const MAX_ACTIVE_RESOLVERS_PER_REPO = 2;

/**
 * Picks the conflicting PRs that need a new resolver. A PR gets one attempt per head commit, so a
 * resolver that fails does not respawn until someone pushes; a successful merge commit moves the
 * head and re-arms the PR for the next conflict.
 */
export function prsToResolve(
  prs: GhPr[],
  repo: string,
  resolvers: Map<string, ResolverAgent>,
  attempted: Set<string>,
): GhPr[] {
  let slots =
    MAX_ACTIVE_RESOLVERS_PER_REPO -
    [...resolvers.values()].filter((resolver) => isActive(resolver)).length;
  const picked: GhPr[] = [];
  for (const pr of [...prs].sort((a, b) => a.number - b.number)) {
    if (slots <= 0) break;
    if (pr.mergeable !== "CONFLICTING" || pr.isCrossRepository) continue;
    const key = resolverKey(repo, pr.number);
    const resolver = resolvers.get(key);
    if (isActive(resolver) || resolver?.headOid === pr.headRefOid) continue;
    if (attempted.has(`${key}@${pr.headRefOid}`)) continue;
    picked.push(pr);
    slots -= 1;
  }
  return picked;
}

type Settings = PluginSettings<typeof factorySettings.schema>;

export interface AutoResolver {
  /** The plugin's daemon session only reaches handlers and hooks, so the watcher borrows it from them. */
  attach(paseo: PaseoApi): void;
  stop(): void;
}

export function createAutoResolver(
  settings: Settings,
  log: (message: string) => void,
): AutoResolver {
  let paseo: PaseoApi | null = null;
  let running = false;
  const attempted = new Set<string>();

  async function resolveDirectory(api: PaseoApi, directory: string) {
    const [{ nameWithOwner }, prs] = await Promise.all([
      repoInfo(directory),
      listOpenPrs(directory),
    ]);
    if (!prs.some((pr) => pr.mergeable === "CONFLICTING")) return;
    const resolvers = await findResolvers(api, nameWithOwner);
    for (const pr of prsToResolve(prs, nameWithOwner, resolvers, attempted)) {
      attempted.add(`${resolverKey(nameWithOwner, pr.number)}@${pr.headRefOid}`);
      const started = await startResolver(api, directory, {
        repo: nameWithOwner,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        head: pr.headRefName,
        headOid: pr.headRefOid,
        base: pr.baseRefName,
      });
      log(`Auto-resolve started agent ${started.agentId} for ${nameWithOwner}#${pr.number}`);
    }
  }

  async function tick() {
    if (!paseo || running) return;
    running = true;
    try {
      const state = await settings.read();
      if (state.status !== "ready") return;
      for (const directory of state.values.autoResolveDirectories) {
        await resolveDirectory(paseo, directory).catch((error: unknown) =>
          log(
            `Auto-resolve skipped ${directory}: ${error instanceof Error ? error.message : error}`,
          ),
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
