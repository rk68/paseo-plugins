import type { TaskKind } from "./actions";
import type { Pr } from "./pr-stack";

export type Tone = "danger" | "warning" | "success" | "muted";

export interface PrSignal {
  tone: Tone;
  label: string;
  /** Work is in progress, such as an agent task; the row shows a spinner. */
  busy?: boolean;
}

export type PrAction = "update" | TaskKind | "ready" | "merge" | "checkout" | "open-agent";

export const TONE_RANK: Record<Tone, number> = { danger: 0, warning: 1, success: 2, muted: 3 };
const MAX_NAMED_CHECKS = 2;
const ACTIVE_TASK_STATUSES = new Set(["initializing", "running"]);

export const TASK_RUNNING_LABEL: Record<TaskKind, string> = {
  conflicts: "Resolving conflicts",
  ci: "Fixing CI",
  comments: "Addressing comments",
};

export function activeTask(pr: Pr): TaskKind | null {
  return pr.task && ACTIVE_TASK_STATUSES.has(pr.task.status) ? pr.task.kind : null;
}

function failingChecks(pr: Pr): string {
  const names = [...new Set(pr.checks.filter((c) => c.state === "fail").map((c) => c.name))];
  const shown = names.slice(0, MAX_NAMED_CHECKS).join(", ");
  return names.length > MAX_NAMED_CHECKS ? `${shown} +${names.length - MAX_NAMED_CHECKS}` : shown;
}

export function checkCounts(pr: Pr) {
  const count = (state: string) => pr.checks.filter((c) => c.state === state).length;
  return {
    passed: count("pass"),
    failed: count("fail"),
    running: count("pending"),
    skipped: count("skipped"),
  };
}

export function commentsLabel(count: number): string {
  return count === 1 ? "1 unresolved comment" : `${count} unresolved comments`;
}

/** What stands between this PR and a merge, most urgent first. Empty when nothing is known. */
export function prSignals(pr: Pr): PrSignal[] {
  const task = activeTask(pr);
  const signals: PrSignal[] = [];
  if (task) signals.push({ tone: "warning", label: TASK_RUNNING_LABEL[task], busy: true });
  if (pr.merge === "conflicts" && task !== "conflicts") {
    signals.push({ tone: "danger", label: "Conflicts" });
  }
  if (pr.ci === "fail" && task !== "ci") {
    signals.push({ tone: "danger", label: `CI failing: ${failingChecks(pr)}` });
  }
  if (pr.review === "changes_requested" && task !== "comments") {
    signals.push({ tone: "danger", label: "Changes requested" });
  }
  if (pr.threads > 0 && task !== "comments") {
    signals.push({ tone: "warning", label: commentsLabel(pr.threads) });
  }
  if (pr.builtOn !== null) {
    signals.push({ tone: "warning", label: `Built on #${pr.builtOn}, targets ${pr.base}` });
  }
  if (pr.merge === "behind") signals.push({ tone: "warning", label: "Needs update" });
  if (pr.ci === "pending") {
    const { passed, running } = checkCounts(pr);
    signals.push({ tone: "warning", label: `CI running ${passed}/${passed + running}` });
  }
  if (pr.draft) signals.push({ tone: "muted", label: "Draft" });
  if (pr.review === "review_required") signals.push({ tone: "muted", label: "Review required" });
  if (pr.merge === "blocked" && signals.length === 0) {
    signals.push({ tone: "muted", label: "Blocked" });
  }
  if (pr.merge === "ready" && signals.every((s) => s.tone === "muted")) {
    signals.unshift({ tone: "success", label: "Ready to merge" });
  }
  return signals;
}

/**
 * The one-click actions a PR row offers. While an agent works on the PR, only its agent is
 * offered: a second task, a branch update or local edits would race its push.
 */
export function prActions(pr: Pr): PrAction[] {
  if (activeTask(pr)) return ["open-agent"];
  const actions: PrAction[] = [];
  if (pr.merge === "behind") actions.push("update");
  if (pr.merge === "conflicts") actions.push("conflicts");
  if (pr.ci === "fail") actions.push("ci");
  if (pr.threads > 0 || pr.review === "changes_requested") actions.push("comments");
  if (pr.draft) actions.push("ready");
  // Only a row that reads "Ready to merge" offers it, so a merge never skips a visible warning.
  if (pr.canSquash && prTone(pr) === "success") actions.push("merge");
  actions.push("checkout");
  if (pr.task) actions.push("open-agent");
  return actions;
}

export function prTone(pr: Pr): Tone {
  return prSignals(pr)[0]?.tone ?? "muted";
}

/** Most urgent first, so the PRs that need a decision sit at the top of an unordered group. */
export function byUrgency(a: Pr, b: Pr): number {
  return TONE_RANK[prTone(a)] - TONE_RANK[prTone(b)] || a.number - b.number;
}
