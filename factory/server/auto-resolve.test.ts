import { describe, expect, it } from "vitest";
import { prsToResolve } from "./auto-resolve";
import { type ResolverAgent, resolverPrompt } from "./resolver";
import type { GhPr } from "./stack";

const REPO = "o/r";

function pr(number: number, extra: Partial<GhPr> = {}): GhPr {
  return {
    number,
    title: `PR ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    headRefName: `b${number}`,
    headRefOid: `oid${number}`,
    baseRefName: "main",
    isCrossRepository: false,
    isDraft: false,
    mergeable: "CONFLICTING",
    mergeStateStatus: "DIRTY",
    reviewDecision: null,
    statusCheckRollup: [],
    ...extra,
  };
}

function resolver(status: string, headOid: string): ResolverAgent {
  return { agentId: "a", workspaceId: "w", status, headOid };
}

const numbers = (prs: GhPr[]) => prs.map((p) => p.number);

describe("prsToResolve", () => {
  it("picks conflicting PRs from this repo, skipping forks and clean PRs", () => {
    const prs = [pr(1), pr(2, { mergeable: "MERGEABLE" }), pr(3, { isCrossRepository: true })];
    expect(numbers(prsToResolve(prs, REPO, new Map(), new Set()))).toEqual([1]);
  });

  it("tries each head commit once, then again after the head moves", () => {
    const finished = new Map([["o/r#1", resolver("idle", "oid1")]]);
    expect(numbers(prsToResolve([pr(1)], REPO, finished, new Set()))).toEqual([]);
    expect(
      numbers(prsToResolve([pr(1, { headRefOid: "new" })], REPO, finished, new Set())),
    ).toEqual([1]);
    expect(numbers(prsToResolve([pr(1)], REPO, new Map(), new Set(["o/r#1@oid1"])))).toEqual([]);
  });

  it("caps concurrent resolvers per repository", () => {
    const busy = new Map([["o/r#9", resolver("running", "x")]]);
    expect(numbers(prsToResolve([pr(1), pr(2), pr(3)], REPO, busy, new Set()))).toEqual([1]);
    expect(numbers(prsToResolve([pr(9, { headRefOid: "y" })], REPO, busy, new Set()))).toEqual([]);
  });
});

describe("resolverPrompt", () => {
  it("pushes to the PR head branch without force and forbids rebasing", () => {
    const prompt = resolverPrompt({
      repo: REPO,
      number: 7,
      title: "t",
      url: "u",
      head: "feat/x",
      headOid: "o",
      base: "main",
    });
    expect(prompt).toContain("git push origin HEAD:refs/heads/feat/x");
    expect(prompt).toContain("git merge origin/main");
    expect(prompt).toContain("Do not rebase. Do not force-push.");
  });
});
