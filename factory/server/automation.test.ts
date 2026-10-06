import { describe, expect, it } from "vitest";
import { type Automation, NO_AUTOMATION, type TaskKind } from "../shared/actions";
import { nextTasks, type PrState, runAttempt } from "./automation";
import type { GhPr } from "./stack";
import { taskPrompt } from "./task-prompts";
import type { TaskAgent, Trigger } from "./tasks";

const REPO = "o/r";
const ALL: Automation = { conflicts: true, ci: true, comments: true };

function state(number: number, extra: Partial<GhPr> = {}, threads = 0): PrState {
  return {
    threads,
    pr: {
      number,
      title: `PR ${number}`,
      url: `https://github.com/o/r/pull/${number}`,
      headRefName: `b${number}`,
      headRefOid: `oid${number}`,
      baseRefName: "main",
      createdAt: "2026-01-01T00:00:00Z",
      isCrossRepository: false,
      isDraft: false,
      mergeable: "MERGEABLE",
      mergeStateStatus: "CLEAN",
      reviewDecision: null,
      statusCheckRollup: [],
      ...extra,
    },
  };
}

const conflicting = { mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" };
const failing = (name: string) => ({
  statusCheckRollup: [{ name, status: "COMPLETED", conclusion: "FAILURE" }],
});

function task(
  kind: TaskKind,
  status: string,
  headOid: string,
  trigger: Trigger = "auto",
): TaskAgent {
  return { agentId: "a", workspaceId: "w", status, kind, headOid, trigger, createdAt: "t" };
}

function run(
  states: PrState[],
  options: {
    tasks?: [string, TaskAgent[]][];
    enabled?: Automation;
    ignored?: string[];
    attempted?: string[];
  } = {},
) {
  return nextTasks(
    states,
    REPO,
    new Map(options.tasks ?? []),
    options.enabled ?? ALL,
    new Set(options.ignored ?? []),
    new Set(options.attempted ?? []),
  ).map(({ state: s, kind }) => `${s.pr.number}:${kind}`);
}

describe("nextTasks", () => {
  it("starts the most urgent enabled task per PR, only where it is needed", () => {
    const states = [
      state(1, { ...conflicting, ...failing("test") }),
      state(2, failing("test")),
      state(3, {}, 2),
      state(4),
    ];
    expect(run(states)).toEqual(["1:conflicts", "2:ci"]);
    expect(run(states, { enabled: { ...NO_AUTOMATION, comments: true } })).toEqual(["3:comments"]);
  });

  it("waits for running checks and ignores listed checks before fixing CI", () => {
    const running = {
      statusCheckRollup: [
        { name: "test", status: "COMPLETED", conclusion: "FAILURE" },
        { name: "e2e", status: "IN_PROGRESS", conclusion: null },
      ],
    };
    expect(run([state(1, running)])).toEqual([]);
    expect(run([state(1, failing("lint"))], { ignored: ["lint"] })).toEqual([]);
  });

  it("runs one task per PR, at most two per repository", () => {
    const busy: [string, TaskAgent[]][] = [["o/r#9", [task("ci", "running", "x")]]];
    const states = [state(1, conflicting), state(2, conflicting), state(9, conflicting)];
    expect(run(states, { tasks: busy })).toEqual(["1:conflicts"]);
  });

  it("tries a kind once per head commit and three times automatically in total", () => {
    const sameHead: [string, TaskAgent[]][] = [
      ["o/r#1", [task("conflicts", "idle", "oid1", "manual")]],
    ];
    expect(run([state(1, conflicting)], { tasks: sameHead })).toEqual([]);
    const threeAuto: [string, TaskAgent[]][] = [
      ["o/r#1", ["h1", "h2", "h3"].map((head) => task("ci", "idle", head))],
    ];
    expect(run([state(1, failing("test"))], { tasks: threeAuto })).toEqual([]);
    expect(run([state(1, failing("test"))], { attempted: ["o/r#1:ci@oid1"] })).toEqual([]);
  });

  it("falls through to the next kind when the urgent one is spent", () => {
    const spent: [string, TaskAgent[]][] = [["o/r#1", [task("conflicts", "idle", "oid1")]]];
    expect(run([state(1, { ...conflicting, ...failing("test") })], { tasks: spent })).toEqual([
      "1:ci",
    ]);
  });
});

describe("taskPrompt", () => {
  const target = {
    repo: REPO,
    number: 7,
    title: "t",
    url: "u",
    head: "feat/x",
    headOid: "o",
    base: "main",
    remote: "upstream",
    failingChecks: [{ name: "test", url: "https://ci/1" }],
  };

  it("pushes to the PR branch without force in every task", () => {
    for (const kind of ["conflicts", "ci", "comments"] as const) {
      const prompt = taskPrompt(kind, target, "");
      expect(prompt).toContain("git push 'upstream' 'HEAD:refs/heads/feat/x'");
      expect(prompt).toContain("Do not force-push");
    }
  });

  it("uses the remote and repository of the PR, not origin", () => {
    const prompt = taskPrompt("conflicts", target, "");
    expect(prompt).toContain("git merge 'upstream/main'");
    expect(prompt).toContain("gh pr view 7 --repo o/r");
    expect(prompt).not.toContain("origin");
  });

  it("quotes a branch name that holds shell syntax", () => {
    const prompt = taskPrompt("ci", { ...target, head: "feat/x;printf${IFS}INJECTED;#" }, "");
    expect(prompt).toContain("'HEAD:refs/heads/feat/x;printf${IFS}INJECTED;#'");
    expect(prompt).toContain("git merge --ff-only 'upstream/feat/x;printf${IFS}INJECTED;#'");
  });

  it("names the failing checks and forbids weakening them", () => {
    const prompt = taskPrompt("ci", target, "");
    expect(prompt).toContain("- test: https://ci/1");
    expect(prompt).toContain("Do not skip, disable or weaken a test or a check");
  });

  it("appends the user's extra instructions only when present", () => {
    expect(taskPrompt("comments", target, "  Skip nitpicks  ")).toMatch(
      /## Extra instructions from the user\nSkip nitpicks$/,
    );
    expect(taskPrompt("comments", target, " ")).not.toContain("Extra instructions");
  });
});

describe("runAttempt", () => {
  it("records started and failed attempts but not a start declined for capacity", async () => {
    const attempted = new Set<string>();
    await runAttempt(attempted, "declined", async () => null);
    await runAttempt(attempted, "started", async () => ({ agentId: "a" }));
    await runAttempt(attempted, "failed", async () => {
      throw new Error("boom");
    }).catch(() => undefined);
    expect([...attempted]).toEqual(["started", "failed"]);
  });
});
