import { git } from "./worktrees";

/** `owner/repo` from a GitHub remote URL, including SSH host aliases such as `work:owner/repo.git`. */
export function repoFromUrl(url: string): string | null {
  const match = /[:/]([^/:]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? `${match[1]}/${match[2]}`.toLowerCase() : null;
}

/**
 * The remote whose fetch and push URLs both point at `repo`, preferring `origin`. A remote with a
 * push URL elsewhere is rejected, because agents push through it.
 */
export function pickRemote(remoteVerbose: string, repo: string): string | null {
  const urls = new Map<string, { fetch: string[]; push: string[] }>();
  for (const line of remoteVerbose.split("\n")) {
    const [name, url, kind] = line.trim().split(/\s+/);
    if (!name || !url) continue;
    const entry = urls.get(name) ?? { fetch: [], push: [] };
    if (kind === "(fetch)") entry.fetch.push(url);
    if (kind === "(push)") entry.push.push(url);
    urls.set(name, entry);
  }
  const target = repo.toLowerCase();
  const matches = (list: string[]) =>
    list.length > 0 && list.every((url) => repoFromUrl(url) === target);
  const names = [...urls]
    .filter(([, entry]) => matches(entry.fetch) && matches(entry.push))
    .map(([name]) => name);
  return names.includes("origin") ? "origin" : (names[0] ?? null);
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
