import { describe, expect, it } from "vitest";
import type { Check, Pr } from "./pr-stack";
import { byUrgency, prActions, prSignals } from "./pr-signals";

function pr(extra: Partial<Pr> = {}): Pr {
  return {
    number: 1,
    title: "PR",
    url: "u",
    head: "feat",
    base: "main",
    createdAt: "2026-01-01T00:00:00Z",
    draft: false,
    checks: [],
    ci: "none",
    review: "none",
    merge: "ready",
    depth: 0,
    builtOn: null,
    worktree: null,
    threads: 0,
    task: null,
    ...extra,
  };
}

const check = (name: string, state: Check["state"]): Check => ({ name, state, url: null });
const labels = (value: Pr) => prSignals(value).map((s) => `${s.tone}:${s.label}`);
const task = (kind: "conflicts" | "ci" | "comments", status: string) => ({
  kind,
  agentId: "a",
  workspaceId: "w",
  status,
});

describe("prSignals", () => {
  it("orders blockers by urgency and names failing checks once", () => {
    expect(
      labels(
        pr({
          merge: "behind",
          ci: "fail",
          review: "review_required",
          threads: 2,
          checks: [check("lint", "fail"), check("lint", "fail"), check("test", "pass")],
        }),
      ),
    ).toEqual([
      "danger:CI failing: lint",
      "warning:2 unresolved comments",
      "warning:Needs update",
      "muted:Review required",
    ]);
  });

  it("caps the named failing checks", () => {
    const checks = ["a", "b", "c", "d"].map((name) => check(name, "fail"));
    expect(labels(pr({ ci: "fail", checks }))[0]).toBe("danger:CI failing: a, b +2");
  });

  it("calls a PR ready only when nothing danger or warning is left", () => {
    expect(labels(pr({ ci: "pass" }))).toEqual(["success:Ready to merge"]);
    expect(
      labels(pr({ ci: "pending", checks: [check("t", "pending"), check("u", "pass")] })),
    ).toEqual(["warning:CI running 1/2"]);
  });

  it("explains a blocked PR only when no other reason is known", () => {
    expect(labels(pr({ merge: "blocked" }))).toEqual(["muted:Blocked"]);
    expect(labels(pr({ merge: "blocked", review: "review_required" }))).toEqual([
      "muted:Review required",
    ]);
  });

  it("leads with a running task and drops the problem it is fixing", () => {
    const value = pr({ merge: "conflicts", ci: "fail", task: task("conflicts", "running") });
    expect(prSignals(value)[0]).toEqual({
      tone: "warning",
      label: "Resolving conflicts",
      busy: true,
    });
    expect(labels(value)).not.toContain("danger:Conflicts");
    expect(labels(pr({ merge: "conflicts", task: task("conflicts", "idle") }))).toEqual([
      "danger:Conflicts",
    ]);
  });

  it("flags a stacked branch that targets trunk", () => {
    expect(labels(pr({ builtOn: 101, merge: "unknown" }))).toEqual([
      "warning:Built on #101, targets main",
    ]);
  });
});

describe("prActions", () => {
  it("offers one click for each problem a PR has", () => {
    expect(
      prActions(pr({ merge: "behind", ci: "fail", review: "changes_requested", threads: 0 })),
    ).toEqual(["update", "ci", "comments", "checkout"]);
    expect(prActions(pr({ merge: "conflicts", threads: 3 }))).toEqual([
      "conflicts",
      "comments",
      "checkout",
    ]);
    expect(prActions(pr({ ci: "pass" }))).toEqual(["checkout"]);
  });

  it("offers only the agent while a task runs, and the agent after it ends", () => {
    expect(prActions(pr({ merge: "behind", task: task("ci", "running") }))).toEqual(["open-agent"]);
    expect(prActions(pr({ ci: "fail", task: task("ci", "idle") }))).toEqual([
      "ci",
      "checkout",
      "open-agent",
    ]);
  });
});

describe("byUrgency", () => {
  it("puts failures first, then warnings, then ready, then waiting", () => {
    const prs = [
      pr({ number: 1, review: "review_required", merge: "blocked" }),
      pr({ number: 2, ci: "pass" }),
      pr({ number: 3, merge: "behind" }),
      pr({ number: 4, merge: "conflicts" }),
    ];
    expect(prs.sort(byUrgency).map((p) => p.number)).toEqual([4, 3, 2, 1]);
  });
});
