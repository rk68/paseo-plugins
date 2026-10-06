import { describe, expect, it } from "vitest";
import { parseWorktrees } from "./worktrees";
import {
  buildPrGroups,
  ciStatus,
  type GhCheck,
  type GhPr,
  gitStackParents,
  toChecks,
} from "./stack";

function pr(number: number, head: string, base: string, extra: Partial<GhPr> = {}): GhPr {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    headRefName: head,
    headRefOid: `oid-${head}`,
    baseRefName: base,
    createdAt: "2026-01-01T00:00:00Z",
    isCrossRepository: false,
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    statusCheckRollup: [],
    ...extra,
  };
}

const summary = (groups: ReturnType<typeof buildPrGroups>) =>
  groups.map((g) => ({ kind: g.kind, prs: g.prs.map((p) => [p.number, p.depth, p.builtOn]) }));

const prNumbers = (groups: ReturnType<typeof buildPrGroups>) =>
  groups.flatMap((g) => g.prs.map((p) => p.number));

describe("buildPrGroups", () => {
  it("orders a base-chained stack parent-first and keeps lone trunk PRs independent", () => {
    const groups = buildPrGroups(
      [pr(44, "c", "b"), pr(39, "solo", "main"), pr(43, "b", "a"), pr(42, "a", "main")],
      "main",
    );
    expect(summary(groups)).toEqual([
      {
        kind: "stack",
        prs: [
          [42, 0, null],
          [43, 1, null],
          [44, 2, null],
        ],
      },
      { kind: "independent", prs: [[39, 0, null]] },
    ]);
  });

  it("stacks a PR that targets trunk but is built on another PR's branch, and flags it", () => {
    const groups = buildPrGroups(
      [pr(101, "api-setup", "main"), pr(102, "api-guide", "main")],
      "main",
      new Map([[102, 101]]),
    );
    expect(summary(groups)).toEqual([
      {
        kind: "stack",
        prs: [
          [101, 0, null],
          [102, 1, 101],
        ],
      },
    ]);
  });

  it("flags a root whose base is neither trunk nor an open PR head, with its subtree", () => {
    const groups = buildPrGroups(
      [pr(2, "feat", "old-base"), pr(5, "feat-2", "feat"), pr(39, "x", "main")],
      "main",
    );
    expect(summary(groups)).toEqual([
      {
        kind: "wrong_base",
        prs: [
          [2, 0, null],
          [5, 1, null],
        ],
      },
      { kind: "independent", prs: [[39, 0, null]] },
    ]);
  });

  it("still lists PRs whose ancestry forms a cycle", () => {
    const groups = buildPrGroups(
      [pr(1, "a", "main"), pr(2, "b", "main")],
      "main",
      new Map([
        [1, 2],
        [2, 1],
      ]),
    );
    expect(prNumbers(groups).sort()).toEqual([1, 2]);
  });

  it("maps GitHub merge state to conflicts, needs update and blocked", () => {
    const [group] = buildPrGroups(
      [
        pr(1, "a", "main", { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }),
        pr(2, "b", "main", { mergeStateStatus: "BEHIND" }),
        pr(3, "c", "main", { mergeStateStatus: "BLOCKED" }),
        pr(4, "d", "main", { mergeStateStatus: "UNSTABLE" }),
      ],
      "main",
    );
    expect(group.prs.map((p) => p.merge)).toEqual(["conflicts", "behind", "blocked", "ready"]);
  });
});

describe("gitStackParents", () => {
  it("picks the nearest PR whose head is in the branch, ignoring PRs on the same commit", () => {
    const prs = [
      { number: 1, headRefOid: "a1" },
      { number: 2, headRefOid: "b2" },
      { number: 3, headRefOid: "c3" },
      { number: 4, headRefOid: "c3" },
    ];
    const unique = new Map([
      [1, new Set(["a1"])],
      [2, new Set(["a1", "b1", "b2"])],
      [3, new Set(["a1", "b1", "b2", "c3"])],
      [4, new Set(["a1", "b1", "b2", "c3"])],
    ]);
    expect([...gitStackParents(prs, unique)]).toEqual([
      [2, 1],
      [3, 2],
      [4, 2],
    ]);
  });
});

describe("checks", () => {
  it("names each check, sorts failures first and maps skipped runs", () => {
    const checks = toChecks([
      { name: "test", status: "COMPLETED", conclusion: "SUCCESS", detailsUrl: "u1" },
      { name: "lint", status: "COMPLETED", conclusion: "FAILURE", detailsUrl: "u2" },
      { context: "sonar", state: "PENDING", targetUrl: "u3" },
      { name: "deploy", status: "COMPLETED", conclusion: "SKIPPED" },
    ]);
    expect(checks.map((c) => [c.name, c.state, c.url])).toEqual([
      ["lint", "fail", "u2"],
      ["sonar", "pending", "u3"],
      ["test", "pass", "u1"],
      ["deploy", "skipped", null],
    ]);
  });

  it.each<[GhCheck[] | null, ReturnType<typeof ciStatus>]>([
    [null, "none"],
    [[{ status: "COMPLETED", conclusion: "SKIPPED" }], "none"],
    [[{ status: "COMPLETED", conclusion: "SUCCESS" }, { state: "SUCCESS" }], "pass"],
    [[{ status: "IN_PROGRESS", conclusion: null }, { state: "SUCCESS" }], "pending"],
    [[{ status: "IN_PROGRESS", conclusion: null }, { state: "ERROR" }], "fail"],
  ])("%j -> %s", (rollup, expected) => {
    expect(ciStatus(toChecks(rollup))).toBe(expected);
  });
});

describe("parseWorktrees", () => {
  it("maps checked-out branches to paths and skips detached worktrees", () => {
    const porcelain = [
      "worktree /repo",
      "HEAD aaa",
      "branch refs/heads/main",
      "",
      "worktree /wt/feat",
      "HEAD bbb",
      "branch refs/heads/feat/x",
      "",
      "worktree /wt/detached",
      "HEAD ccc",
      "detached",
      "",
    ].join("\n");
    expect([...parseWorktrees(porcelain)]).toEqual([
      ["main", "/repo"],
      ["feat/x", "/wt/feat"],
    ]);
  });
});

describe("fork PRs", () => {
  it("never make a same-repository PR a stack child through a shared branch name", () => {
    const groups = buildPrGroups(
      [pr(1, "main", "main", { isCrossRepository: true }), pr(2, "feature", "main")],
      "main",
    );
    expect(summary(groups)).toEqual([
      {
        kind: "independent",
        prs: [
          [1, 0, null],
          [2, 0, null],
        ],
      },
    ]);
  });
});
