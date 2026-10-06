import { git } from "./worktrees";

/** A local worktree to reuse for a PR. A fork's branch name can match an unrelated local branch. */
export function reusableWorktree(
  worktrees: Map<string, string>,
  pr: { number: number; head: string; isCrossRepository: boolean },
): string | undefined {
  return worktrees.get(localBranchFor(pr));
}

/** The local branch that holds a PR: its own name for same-repository PRs, `pr/<n>` for forks. */
export function localBranchFor(pr: { number: number; head: string; isCrossRepository: boolean }) {
  return pr.isCrossRepository ? `pr/${pr.number}` : pr.head;
}

/** The remote ref a PR's head is fetched into, so later commands never depend on `origin`. */
export function remotePrRef(
  remote: string,
  pr: { number: number; head: string; isCrossRepository: boolean },
) {
  return pr.isCrossRepository
    ? `refs/remotes/${remote}/pr/${pr.number}`
    : `refs/remotes/${remote}/${pr.head}`;
}

function sourceRef(pr: { number: number; head: string; isCrossRepository: boolean }) {
  return pr.isCrossRepository ? `refs/pull/${pr.number}/head` : `refs/heads/${pr.head}`;
}

/** Fetches the PR head through `remote` into `remotePrRef` and returns its commit. */
export async function fetchPrHead(
  directory: string,
  remote: string,
  pr: { number: number; head: string; isCrossRepository: boolean },
): Promise<string> {
  const ref = remotePrRef(remote, pr);
  await git(
    directory,
    ["fetch", "--no-tags", "--quiet", remote, `+${sourceRef(pr)}:${ref}`],
    60_000,
  );
  return (await git(directory, ["rev-parse", "--verify", `${ref}^{commit}`])).trim();
}

/**
 * Makes the PR's local branch exist, creating it from the fetched head when it is missing.
 * An existing local branch is left as it is: it may hold the user's unpushed work.
 */
export async function ensureLocalBranch(
  directory: string,
  remote: string,
  pr: { number: number; head: string; isCrossRepository: boolean },
): Promise<string> {
  const branch = localBranchFor(pr);
  const exists = await git(directory, [
    "show-ref",
    "--verify",
    "--quiet",
    `refs/heads/${branch}`,
  ]).then(
    () => true,
    () => false,
  );
  if (!exists) await git(directory, ["branch", "--no-track", branch, remotePrRef(remote, pr)]);
  return branch;
}
