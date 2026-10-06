import { git } from "./worktrees";

/** `owner/repo` from a GitHub remote URL, including SSH host aliases such as `work:owner/repo.git`. */
export function repoFromUrl(url: string): string | null {
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

/** The remote that points at `repo`, preferring `origin` when several do. */
export function pickRemote(remoteVerbose: string, repo: string): string | null {
  const names = new Set<string>();
  for (const line of remoteVerbose.split("\n")) {
    const [name, url, kind] = line.trim().split(/\s+/);
    if (kind === "(fetch)" && url && repoFromUrl(url) === repo.toLowerCase()) names.add(name);
  }
  if (names.has("origin")) return "origin";
  return names.values().next().value ?? null;
}

export async function remoteFor(directory: string, repo: string): Promise<string | null> {
  return pickRemote(await git(directory, ["remote", "-v"]), repo);
}

/** Like `remoteFor`, but a missing remote stops the operation instead of using the wrong one. */
export async function requireRemote(directory: string, repo: string): Promise<string> {
  const remote = await remoteFor(directory, repo);
  if (!remote) throw new Error(`No git remote in ${directory} points to ${repo}`);
  return remote;
}
