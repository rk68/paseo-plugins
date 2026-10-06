/**
 * How to create a worktree for a PR. Paseo fetches a missing local branch from `origin`, so a
 * branch-name checkout is only safe for same-repository PRs whose remote is `origin`; anything
 * else checks out through the PR itself.
 */
export function worktreeSource(
  directory: string,
  pr: { number: number; head: string; isCrossRepository: boolean },
  remote: string | null,
) {
  if (!pr.isCrossRepository && remote === "origin") {
    return { kind: "worktree", cwd: directory, action: "checkout", refName: pr.head } as const;
  }
  return {
    kind: "worktree",
    cwd: directory,
    action: "checkout",
    checkoutSource: { kind: "change_request", forge: "github", number: pr.number },
  } as const;
}

/** A local worktree to reuse for a PR. A fork's branch name can match an unrelated local branch. */
export function reusableWorktree(
  worktrees: Map<string, string>,
  pr: { head: string; isCrossRepository: boolean },
): string | undefined {
  return pr.isCrossRepository ? undefined : worktrees.get(pr.head);
}
