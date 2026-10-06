import { describe, expect, it } from "vitest";
import type { Pr, PrGroup } from "../shared/pr-stack";
import { type CheckedOutBranch, relatedPrs, scopeGroups } from "./scope";
import type { GhPr } from "./stack";

function gh(number: number, head: string, base: string, headOid = `oid-${head}`): GhPr {
  return {
    number,
    title: `PR ${number}`,
    url: "u",
    headRefName: head,
    headRefOid: headOid,
    baseRefName: base,
    createdAt: "2026-01-01",
    isCrossRepository: false,
    isDraft: false,
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    reviewDecision: null,
    statusCheckRollup: [],
  };
}

const branch = (name: string, oid: string, commits: string[] = []): CheckedOutBranch => ({
  name,
  oid,
  commits: new Set(commits),
});

describe("relatedPrs", () => {
  const prs = [
    gh(1, "feat/a", "main"),
    gh(2, "feat/b", "feat/a"),
    gh(3, "feat/c", "main"),
    gh(4, "other", "main"),
  ];
  const unique = new Map([
    [1, new Set(["oid-feat/a"])],
    [2, new Set(["oid-feat/a", "oid-feat/b"])],
    [3, new Set(["oid-feat/a", "x", "oid-feat/c"])],
    [4, new Set(["oid-other"])],
  ]);

  it("finds the branch's own PR and every PR built on it, by base or by ancestry", () => {
    expect([...relatedPrs(prs, branch("feat/a", "oid-feat/a", ["oid-feat/a"]), unique)]).toEqual([
      1, 2, 3,
    ]);
  });

  it("finds the PRs a branch without its own PR is built on", () => {
    const local = branch("feat/d", "oid-d", ["oid-d", "oid-feat/b", "oid-feat/a"]);
    expect([...relatedPrs(prs, local, unique)]).toEqual([1, 2]);
  });

  it("returns nothing for an unrelated branch", () => {
    expect(relatedPrs(prs, branch("solo", "oid-solo", ["oid-solo"]), unique).size).toBe(0);
  });
});

const numbers = (groups: PrGroup[]) => groups.map((g) => g.prs.map((p) => p.number));

describe("scopeGroups", () => {
  const pr = (number: number) => ({ number }) as Pr;
  const groups: PrGroup[] = [
    { kind: "stack", prs: [pr(1), pr(2), pr(5)] },
    { kind: "stack", prs: [pr(6), pr(7)] },
    { kind: "independent", prs: [pr(3), pr(4)] },
  ];

  it("keeps whole stacks that touch a related PR and only related independent PRs", () => {
    const scoped = scopeGroups(groups, new Set([2, 3]));
    expect(numbers(scoped)).toEqual([[1, 2, 5], [3]]);
  });
});
