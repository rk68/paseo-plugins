import { describe, expect, it } from "vitest";
import { localBranchFor, remotePrRef, reusableWorktree } from "./checkout";

const own = { number: 7, head: "main", isCrossRepository: false };
const fork = { number: 7, head: "main", isCrossRepository: true };

describe("PR refs", () => {
  it("keeps fork heads apart from same-named local branches", () => {
    expect(localBranchFor(own)).toBe("main");
    expect(localBranchFor(fork)).toBe("pr/7");
    expect(remotePrRef("work", own)).toBe("refs/remotes/work/main");
    expect(remotePrRef("work", fork)).toBe("refs/remotes/work/pr/7");
  });
});

describe("reusableWorktree", () => {
  const worktrees = new Map([
    ["main", "/repo"],
    ["pr/9", "/wt/pr-9"],
  ]);

  it("never reuses a local worktree for a fork PR with the same branch name", () => {
    expect(reusableWorktree(worktrees, fork)).toBeUndefined();
    expect(reusableWorktree(worktrees, own)).toBe("/repo");
    expect(reusableWorktree(worktrees, { ...fork, number: 9 })).toBe("/wt/pr-9");
  });
});
