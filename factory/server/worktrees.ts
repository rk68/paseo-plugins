import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export function git(directory: string, args: string[], timeout = 30_000): Promise<string> {
  return run("git", args, {
    cwd: directory,
    env: { ...process.env, PWD: directory, GIT_TERMINAL_PROMPT: "0" },
    timeout,
    maxBuffer: 16 << 20,
  }).then(({ stdout }) => stdout);
}

/** Maps each checked-out branch to its worktree path, from `git worktree list --porcelain`. */
export function parseWorktrees(porcelain: string): Map<string, string> {
  const branches = new Map<string, string>();
  for (const block of porcelain.split(/\n\s*\n/)) {
    const path = /^worktree (.+)$/m.exec(block)?.[1];
    const branch = /^branch refs\/heads\/(.+)$/m.exec(block)?.[1];
    if (path && branch) branches.set(branch, path);
  }
  return branches;
}

export async function listWorktrees(directory: string): Promise<Map<string, string>> {
  return parseWorktrees(await git(directory, ["worktree", "list", "--porcelain"]));
}

/** Brings a clean worktree up to a fetched ref; leaves local changes and diverged branches alone. */
export async function fastForward(path: string, ref: string): Promise<void> {
  if ((await git(path, ["status", "--porcelain"])).trim()) return;
  await git(path, ["merge", "--ff-only", "--quiet", ref]).catch(() => undefined);
}
