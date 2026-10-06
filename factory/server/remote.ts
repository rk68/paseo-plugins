import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RepoInfo } from "./gh";
import { git } from "./worktrees";

const run = promisify(execFile);

export interface RemoteUrl {
  /** Host as written in the URL; for SSH it can be an alias from ~/.ssh/config. */
  host: string;
  ssh: boolean;
  repo: string;
}

/** Host and `owner/repo` of a git remote URL: HTTPS, ssh:// or scp-like `host:owner/repo`. */
export function parseRemoteUrl(url: string): RemoteUrl | null {
  const trimmed = url.trim();
  const full =
    /^(https?|ssh|git):\/\/(?:[^@/]+@)?([^/:]+)(?::\d+)?\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(
      trimmed,
    );
  if (full) {
    return { host: full[2], ssh: full[1] === "ssh", repo: `${full[3]}/${full[4]}`.toLowerCase() };
  }
  const scp = /^(?:[^@/]+@)?([^/:]+):([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(trimmed);
  return scp ? { host: scp[1], ssh: true, repo: `${scp[2]}/${scp[3]}`.toLowerCase() } : null;
}

/**
 * The remote whose fetch and push URLs all point at the repository on the expected host,
 * preferring `origin`. `resolveHost` maps SSH aliases to real host names. A remote with any URL
 * elsewhere is rejected, because agents fetch and push through it.
 */
export function pickRemote(
  remoteVerbose: string,
  target: { repo: string; host: string },
  resolveHost: (url: RemoteUrl) => string,
): string | null {
  const urls = new Map<string, { fetch: string[]; push: string[] }>();
  for (const line of remoteVerbose.split("\n")) {
    const [name, url, kind] = line.trim().split(/\s+/);
    if (!name || !url) continue;
    const entry = urls.get(name) ?? { fetch: [], push: [] };
    if (kind === "(fetch)") entry.fetch.push(url);
    if (kind === "(push)") entry.push.push(url);
    urls.set(name, entry);
  }
  const repo = target.repo.toLowerCase();
  const host = target.host.toLowerCase();
  const pointsAtTarget = (url: string) => {
    const parsed = parseRemoteUrl(url);
    return parsed !== null && parsed.repo === repo && resolveHost(parsed).toLowerCase() === host;
  };
  const all = (list: string[]) => list.length > 0 && list.every(pointsAtTarget);
  const names = [...urls]
    .filter(([, entry]) => all(entry.fetch) && all(entry.push))
    .map(([name]) => name);
  return names.includes("origin") ? "origin" : (names[0] ?? null);
}

async function sshHostName(alias: string): Promise<string> {
  const { stdout } = await run("ssh", ["-G", "--", alias], { timeout: 10_000 }).catch(() => ({
    stdout: "",
  }));
  return /^hostname (\S+)$/im.exec(stdout)?.[1] ?? alias;
}

export async function remoteFor(
  directory: string,
  info: Pick<RepoInfo, "nameWithOwner" | "host">,
): Promise<string | null> {
  const verbose = await git(directory, ["remote", "-v"]);
  const aliases = new Set<string>();
  for (const line of verbose.split("\n")) {
    const parsed = parseRemoteUrl(line.trim().split(/\s+/)[1] ?? "");
    if (parsed?.ssh) aliases.add(parsed.host);
  }
  const resolved = new Map(
    await Promise.all(
      [...aliases].map(async (alias) => [alias, await sshHostName(alias)] as const),
    ),
  );
  return pickRemote(verbose, { repo: info.nameWithOwner, host: info.host }, (url) =>
    url.ssh ? (resolved.get(url.host) ?? url.host) : url.host,
  );
}

/** Like `remoteFor`, but a missing remote stops the operation instead of using the wrong one. */
export async function requireRemote(
  directory: string,
  info: Pick<RepoInfo, "nameWithOwner" | "host">,
): Promise<string> {
  const remote = await remoteFor(directory, info);
  if (!remote) {
    throw new Error(`No git remote in ${directory} points to ${info.host}/${info.nameWithOwner}`);
  }
  return remote;
}
