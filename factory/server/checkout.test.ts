import { describe, expect, it } from "vitest";
import { reusableWorktree, worktreeSource } from "./checkout";

describe("worktreeSource", () => {
  const pr = { number: 7, head: "feat", isCrossRepository: false };

  it("checks out by branch only for same-repository PRs on origin", () => {
    expect(worktreeSource("/repo", pr, "origin")).toMatchObject({ refName: "feat" });
  });

  it("checks out through the PR for forks and for other remotes", () => {
    const viaPr = { checkoutSource: { kind: "change_request", forge: "github", number: 7 } };
    expect(worktreeSource("/repo", { ...pr, isCrossRepository: true }, "origin")).toMatchObject(
      viaPr,
    );
    expect(worktreeSource("/repo", pr, "upstream")).toMatchObject(viaPr);
    expect(worktreeSource("/repo", pr, null)).toMatchObject(viaPr);
  });
});

describe("reusableWorktree", () => {
  const worktrees = new Map([["main", "/repo"]]);

  it("never reuses a local worktree for a fork PR with the same branch name", () => {
    expect(reusableWorktree(worktrees, { head: "main", isCrossRepository: true })).toBeUndefined();
    expect(reusableWorktree(worktrees, { head: "main", isCrossRepository: false })).toBe("/repo");
  });
});
