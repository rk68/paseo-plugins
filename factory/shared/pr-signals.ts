import type { Pr } from "./pr-stack";

export type Tone = "danger" | "warning" | "success" | "muted";

export interface PrSignal {
  tone: Tone;
  label: string;
}

const TONE_RANK: Record<Tone, number> = { danger: 0, warning: 1, success: 2, muted: 3 };
const MAX_NAMED_CHECKS = 2;

function failingChecks(pr: Pr): string {
  const names = [...new Set(pr.checks.filter((c) => c.state === "fail").map((c) => c.name))];
  const shown = names.slice(0, MAX_NAMED_CHECKS).join(", ");
  return names.length > MAX_NAMED_CHECKS ? `${shown} +${names.length - MAX_NAMED_CHECKS}` : shown;
}

const ACTIVE_RESOLVER_STATUSES = new Set(["initializing", "running"]);

export function isResolving(pr: Pr): boolean {
  return pr.resolver !== null && ACTIVE_RESOLVER_STATUSES.has(pr.resolver.status);
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

/** What stands between this PR and a merge, most urgent first. Empty when nothing is known. */
export function prSignals(pr: Pr): PrSignal[] {
  const signals: PrSignal[] = [];
  if (pr.merge === "conflicts") {
    signals.push(
      isResolving(pr)
        ? { tone: "warning", label: "Resolving conflicts" }
        : { tone: "danger", label: "Conflicts" },
    );
  }
  if (pr.ci === "fail") signals.push({ tone: "danger", label: `CI failing: ${failingChecks(pr)}` });
  if (pr.review === "changes_requested") {
    signals.push({ tone: "danger", label: "Changes requested" });
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

export function prTone(pr: Pr): Tone {
  return prSignals(pr)[0]?.tone ?? "muted";
}

/** Most urgent first, so the PRs that need a decision sit at the top of an unordered group. */
export function byUrgency(a: Pr, b: Pr): number {
  return TONE_RANK[prTone(a)] - TONE_RANK[prTone(b)] || a.number - b.number;
}
