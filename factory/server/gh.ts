import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

export async function gh(directory: string, args: string[]): Promise<string> {
  try {
    const { stdout } = await run("gh", args, {
      cwd: directory,
      // gh wrappers that pick an account by directory read $PWD, which execFile does not update.
      env: { ...process.env, PWD: directory },
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
  trunk: string;
}

export async function repoInfo(directory: string): Promise<RepoInfo> {
  const repo = JSON.parse(
    await gh(directory, ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"]),
  ) as { nameWithOwner: string; defaultBranchRef: { name: string } };
  return { nameWithOwner: repo.nameWithOwner, trunk: repo.defaultBranchRef.name };
}
