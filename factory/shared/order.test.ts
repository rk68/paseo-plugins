import { describe, expect, it } from "vitest";
import { age, orderGroups } from "./order";
import type { Pr, PrGroup } from "./pr-stack";

function pr(number: number, createdAt: string, extra: Partial<Pr> = {}): Pr {
  return {
    number,
    title: `PR ${number}`,
    url: "u",
    head: `b${number}`,
    headOid: "oid",
    base: "main",
    createdAt,
    draft: false,
    checks: [],
    ci: "pass",
    review: "none",
    merge: "ready",
    depth: 0,
    canSquash: false,
    builtOn: null,
    worktree: null,
    threads: 0,
    task: null,
    ...extra,
  };
}

const shape = (groups: PrGroup[]) =>
  groups.map((g) => `${g.kind}:${g.prs.map((p) => p.number).join(",")}`);

const groups: PrGroup[] = [
  {
    kind: "independent",
    prs: [pr(1, "2026-01-01"), pr(3, "2026-03-01"), pr(2, "2026-02-01", { merge: "conflicts" })],
  },
  { kind: "stack", prs: [pr(10, "2026-01-05"), pr(11, "2026-01-06", { depth: 1 })] },
  {
    kind: "stack",
    prs: [pr(20, "2026-02-05", { merge: "conflicts" }), pr(21, "2026-04-01", { depth: 1 })],
  },
  { kind: "wrong_base", prs: [pr(30, "2026-01-02")] },
];

describe("orderGroups", () => {
  it("puts the newest first and orders each stack by its newest PR, keeping merge order", () => {
    expect(shape(orderGroups(groups, "newest"))).toEqual([
      "wrong_base:30",
      "stack:20,21",
      "stack:10,11",
      "independent:3,2,1",
    ]);
  });

  it("puts the most urgent first", () => {
    expect(shape(orderGroups(groups, "urgency"))).toEqual([
      "wrong_base:30",
      "stack:20,21",
      "stack:10,11",
      "independent:2,1,3",
    ]);
  });
});

describe("age", () => {
  it("reads how long ago a PR was opened", () => {
    const now = Date.parse("2026-03-10T12:00:00Z");
    expect(age("2026-03-10T11:59:40Z", now)).toBe("opened just now");
    expect(age("2026-03-10T11:40:00Z", now)).toBe("opened 20m ago");
    expect(age("2026-03-09T12:00:00Z", now)).toBe("opened 24h ago");
    expect(age("2026-03-01T12:00:00Z", now)).toBe("opened 9d ago");
  });
});
