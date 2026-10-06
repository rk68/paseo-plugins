import { git } from "./worktrees";

/** A local worktree to reuse for a PR. A fork's branch name can match an unrelated local branch. */
export function reusableWorktree(
  worktrees: Map<string, string>,
  pr: { number: number; head: string; isCrossRepository: boolean },
): string | undefined {
  return worktrees.get(localBranchFor(pr));
}

/**
 * The local branch that holds a PR: its own name for same-repository PRs. Fork PRs get a branch
 * in the plugin's own namespace, so they never meet a user branch such as `pr/7`.
 */
export function localBranchFor(pr: { number: number; head: string; isCrossRepository: boolean }) {
  return pr.isCrossRepository ? `factory/fork-pr-${pr.number}` : pr.head;
}

/**
 * The ref a PR's head is fetched into. Same-repository heads use the normal tracking ref; fork
 * heads use a private namespace, since `refs/remotes/<remote>/pr/7` can be a real branch.
 */
export function remotePrRef(
  remote: string,
  pr: { number: number; head: string; isCrossRepository: boolean },
) {
  return pr.isCrossRepository
    ? `refs/factory/${remote}/pull/${pr.number}`
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
