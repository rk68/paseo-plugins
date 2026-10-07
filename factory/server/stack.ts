import type { Check, Pr, PrGroup } from "../shared/pr-stack";

export interface GhCheck {
  name?: string;
  context?: string;
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
  detailsUrl?: string | null;
  targetUrl?: string | null;
}

export interface GhPr {
  number: number;
  title: string;
  url: string;
  headRefName: string;
  headRefOid: string;
  baseRefName: string;
  createdAt: string;
  isCrossRepository: boolean;
  isDraft: boolean;
  mergeable: string;
  mergeStateStatus: string;
  reviewDecision: string | null;
  statusCheckRollup: GhCheck[] | null;
}

const FAILED = new Set(["FAILURE", "ERROR", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
// Matches Paseo's own PR view: a cancelled run is superseded, not failed.
const SKIPPED = new Set(["SKIPPED", "NEUTRAL", "STALE", "CANCELLED"]);
const PENDING_STATES = new Set(["PENDING", "EXPECTED"]);
const CHECK_ORDER: Record<Check["state"], number> = { fail: 0, pending: 1, pass: 2, skipped: 3 };

function checkState(check: GhCheck): Check["state"] {
  const outcome = check.conclusion ?? check.state ?? "";
  if (FAILED.has(outcome)) return "fail";
  // CheckRuns report `status`; StatusContexts only report `state`.
  const running = check.status ? check.status !== "COMPLETED" : PENDING_STATES.has(outcome);
  if (running) return "pending";
  return SKIPPED.has(outcome) ? "skipped" : "pass";
}

export function toChecks(rollup: GhCheck[] | null): Check[] {
  return (rollup ?? [])
    .map((check) => ({
      name: check.name ?? check.context ?? "check",
      state: checkState(check),
      url: check.detailsUrl ?? check.targetUrl ?? null,
    }))
    .sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state] || a.name.localeCompare(b.name));
}

export function ciStatus(checks: Check[]): Pr["ci"] {
  if (checks.some((check) => check.state === "fail")) return "fail";
  if (checks.some((check) => check.state === "pending")) return "pending";
  return checks.some((check) => check.state === "pass") ? "pass" : "none";
}

function reviewStatus(decision: string | null): Pr["review"] {
  switch (decision) {
    case "APPROVED":
      return "approved";
    case "CHANGES_REQUESTED":
      return "changes_requested";
    case "REVIEW_REQUIRED":
      return "review_required";
    default:
      return "none";
  }
}

function mergeStatus(pr: GhPr): Pr["merge"] {
  if (pr.mergeable === "CONFLICTING" || pr.mergeStateStatus === "DIRTY") return "conflicts";
  switch (pr.mergeStateStatus) {
    case "BEHIND":
      return "behind";
    case "BLOCKED":
      return "blocked";
    case "CLEAN":
    case "UNSTABLE":
    case "HAS_HOOKS":
      return "ready";
    default:
      return "unknown";
  }
}

/**
 * Finds, for each PR, the nearest other PR whose head commit is in its branch.
 * `uniqueCommits` holds each PR's commits that are not on trunk; the nearest ancestor PR has the most of them.
 */
export function gitStackParents(
  prs: Pick<GhPr, "number" | "headRefOid">[],
  uniqueCommits: Map<number, Set<string>>,
): Map<number, number> {
  const parents = new Map<number, number>();
  for (const pr of prs) {
    const commits = uniqueCommits.get(pr.number);
    if (!commits) continue;
    let nearest: { number: number; size: number } | null = null;
    for (const candidate of prs) {
      if (candidate.headRefOid === pr.headRefOid || !commits.has(candidate.headRefOid)) continue;
      const size = uniqueCommits.get(candidate.number)?.size ?? 0;
      if (!nearest || size > nearest.size) nearest = { number: candidate.number, size };
    }
    if (nearest) parents.set(pr.number, nearest.number);
  }
  return parents;
}

/** Each group lists PRs in merge order: a parent always comes before the PRs stacked on it. */
export function buildPrGroups(
  prs: GhPr[],
  trunk: string,
  gitParents: Map<number, number> = new Map(),
): PrGroup[] {
  const byNumber = new Map(prs.map((pr) => [pr.number, pr]));
  // A fork's branch names belong to another repository, so only same-repository heads can be a base.
  const byHead = new Map(
    prs.filter((pr) => !pr.isCrossRepository).map((pr) => [pr.headRefName, pr]),
  );
  const parentOf = (pr: GhPr) => {
    const parent = byHead.get(pr.baseRefName) ?? byNumber.get(gitParents.get(pr.number) ?? -1);
    return parent && parent.number !== pr.number ? parent : undefined;
  };

  const sorted = [...prs].sort((a, b) => a.number - b.number);
  const children = new Map<number, GhPr[]>();
  for (const pr of sorted) {
    const parent = parentOf(pr);
    if (parent) children.set(parent.number, [...(children.get(parent.number) ?? []), pr]);
  }

  const visited = new Set<number>();
  const walk = (pr: GhPr, depth: number, parent: GhPr | undefined): Pr[] => {
    if (visited.has(pr.number)) return [];
    visited.add(pr.number);
    const checks = toChecks(pr.statusCheckRollup);
    const node: Pr = {
      number: pr.number,
      title: pr.title,
      url: pr.url,
      head: pr.headRefName,
      headOid: pr.headRefOid,
      base: pr.baseRefName,
      createdAt: pr.createdAt,
      draft: pr.isDraft,
      checks,
      ci: ciStatus(checks),
      review: reviewStatus(pr.reviewDecision),
      merge: mergeStatus(pr),
      depth,
      canSquash: false,
      builtOn: parent && parent.headRefName !== pr.baseRefName ? parent.number : null,
      worktree: null,
      threads: 0,
      task: null,
    };
    const below = children.get(pr.number) ?? [];
    return [node, ...below.flatMap((child) => walk(child, depth + 1, pr))];
  };

  const wrongBase: PrGroup[] = [];
  const stacks: PrGroup[] = [];
  const independent: Pr[] = [];
  // PRs left over after the roots sit in a cycle; walking them as roots still shows them once.
  const roots = [...sorted.filter((pr) => !parentOf(pr)), ...sorted];
  for (const root of roots) {
    if (visited.has(root.number)) continue;
    const tree = walk(root, 0, undefined);
    if (root.baseRefName !== trunk) wrongBase.push({ kind: "wrong_base", prs: tree });
    else if (tree.length > 1) stacks.push({ kind: "stack", prs: tree });
    else independent.push(...tree);
  }

  const groups = [...wrongBase, ...stacks];
  if (independent.length) groups.push({ kind: "independent", prs: independent });
  return groups;
}
