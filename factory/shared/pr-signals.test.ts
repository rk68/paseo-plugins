import { describe, expect, it } from "vitest";
import type { Check, Pr } from "./pr-stack";
import { byUrgency, prSignals } from "./pr-signals";

function pr(extra: Partial<Pr> = {}): Pr {
  return {
    number: 1,
    title: "PR",
    url: "u",
    head: "feat",
    base: "main",
    draft: false,
    checks: [],
    ci: "none",
    review: "none",
    merge: "ready",
    depth: 0,
    builtOn: null,
    resolver: null,
    ...extra,
  };
}

const check = (name: string, state: Check["state"]): Check => ({ name, state, url: null });
const labels = (value: Pr) => prSignals(value).map((s) => `${s.tone}:${s.label}`);

describe("prSignals", () => {
  it("orders blockers by urgency and names failing checks once", () => {
    expect(
      labels(
        pr({
          merge: "behind",
          ci: "fail",
          review: "review_required",
          checks: [check("lint", "fail"), check("lint", "fail"), check("test", "pass")],
        }),
      ),
    ).toEqual(["danger:CI failing: lint", "warning:Needs update", "muted:Review required"]);
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

  it("shows a running resolver instead of the raw conflict", () => {
    const resolver = { agentId: "a", workspaceId: "w", status: "running" };
    expect(labels(pr({ merge: "conflicts", resolver }))).toEqual(["warning:Resolving conflicts"]);
    expect(labels(pr({ merge: "conflicts", resolver: { ...resolver, status: "idle" } }))).toEqual([
      "danger:Conflicts",
    ]);
  });

  it("flags a stacked branch that targets trunk", () => {
    expect(labels(pr({ builtOn: 101, merge: "unknown" }))).toEqual([
      "warning:Built on #101, targets main",
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
