import type { PrGroup } from "../shared/pr-stack";
import { commitsNotOn } from "./git-stack";
import type { GhPr } from "./stack";
import { git } from "./worktrees";

export interface CheckedOutBranch {
  name: string;
  oid: string;
  /** The branch's commits that are not on trunk. */
  commits: Set<string>;
}

/** The branch a workspace has checked out, or null on trunk or a detached HEAD. */
export async function checkedOutBranch(
  directory: string,
  trunk: string,
  trunkOid: string | null,
): Promise<CheckedOutBranch | null> {
  const name = (await git(directory, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => "")).trim();
  if (!name || name === "HEAD" || name === trunk) return null;
  const oid = (await git(directory, ["rev-parse", "HEAD"])).trim();
  const commits = trunkOid ? await commitsNotOn(directory, "HEAD", trunkOid) : new Set<string>();
  return { name, oid, commits };
}

/**
 * The PRs tied to a branch: its own PR, the PRs it is built on, and the PRs built on it, by PR
 * base or by commit ancestry. Branches cut from this worktree count as built on it.
 */
export function relatedPrs(
  prs: GhPr[],
  branch: CheckedOutBranch,
  uniqueCommits: Map<number, Set<string>>,
): Set<number> {
  const related = new Set<number>();
  for (const pr of prs) {
    // A fork's branch name lives in another repository and says nothing about this branch.
    const own = !pr.isCrossRepository && pr.headRefName === branch.name;
    const above = pr.baseRefName === branch.name || uniqueCommits.get(pr.number)?.has(branch.oid);
    const below = branch.commits.has(pr.headRefOid);
    if (own || above || below) related.add(pr.number);
  }
  return related;
}

/** Keeps whole stacks that touch the related PRs, and only the related independent PRs. */
export function scopeGroups(groups: PrGroup[], related: ReadonlySet<number>): PrGroup[] {
  return groups.flatMap((group) => {
    if (group.kind === "independent") {
      const prs = group.prs.filter((pr) => related.has(pr.number));
      return prs.length ? [{ kind: group.kind, prs }] : [];
    }
    return group.prs.some((pr) => related.has(pr.number)) ? [group] : [];
  });
}
