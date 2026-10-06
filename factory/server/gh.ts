import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { git } from "./worktrees";

const run = promisify(execFile);
const mainCheckouts = new Map<string, string>();

/** The repository's main checkout, which every worktree of it shares remotes with. */
export async function mainCheckout(directory: string): Promise<string> {
  const known = mainCheckouts.get(directory);
  if (known) return known;
  const commonDir = await git(directory, [
    "rev-parse",
    "--path-format=absolute",
    "--git-common-dir",
  ])
    .then((out) => out.trim())
    .catch(() => "");
  const root = commonDir.endsWith("/.git") ? dirname(commonDir) : directory;
  mainCheckouts.set(directory, root);
  return root;
}

/**
 * Runs gh from the main checkout rather than the worktree: tools that choose a GitHub account by
 * directory then see the project, wherever Paseo keeps its worktrees.
 */
export async function gh(directory: string, args: string[]): Promise<string> {
  const cwd = await mainCheckout(directory);
  try {
    const { stdout } = await run("gh", args, {
      cwd,
      // gh wrappers that pick an account by directory read $PWD, which execFile does not update.
      env: { ...process.env, PWD: cwd },
      timeout: 30_000,
      maxBuffer: 16 << 20,
    });
    return stdout;
  } catch (error) {
    const stderr = (error as { stderr?: string }).stderr?.trim();
    throw new Error(stderr || (error instanceof Error ? error.message : String(error)), {
      cause: error,
    });
  }
}

export interface RepoInfo {
  nameWithOwner: string;
  /** The forge host, such as github.com or a GitHub Enterprise host. */
  host: string;
  trunk: string;
}

export async function repoInfo(directory: string): Promise<RepoInfo> {
  const repo = JSON.parse(
    await gh(directory, ["repo", "view", "--json", "nameWithOwner,url,defaultBranchRef"]),
  ) as { nameWithOwner: string; url: string; defaultBranchRef: { name: string } };
  return {
    nameWithOwner: repo.nameWithOwner,
    host: new URL(repo.url).host,
    trunk: repo.defaultBranchRef.name,
  };
}
