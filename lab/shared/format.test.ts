import { describe, expect, it } from "vitest";
import type { QueuedJob } from "./cluster";
import {
  duration,
  finishedStatus,
  queueTree,
  slurmSeconds,
  timeAgo,
  visibleQueue,
  waitStatus,
} from "./format";

describe("waitStatus", () => {
  it.each([
    [{ reason: "Dependency", after: [1334, 1336] }, "After #1334, #1336"],
    [{ reason: "QOSMaxCpuPerUserLimit", after: [] }, "Over CPU quota"],
    [{ reason: "QOSMaxGRESPerUser", after: [] }, "Over GPU quota"],
    [{ reason: "QOSGrpNodeLimit", after: [] }, "Over QOS limit"],
    [{ reason: "Priority", after: [] }, "Queued behind higher priority"],
    [{ reason: "SomethingNew", after: [] }, "SomethingNew"],
  ])("%j -> %s", (job, label) => {
    expect(waitStatus(job).label).toBe(label);
  });

  it("marks a dependency that can never run as a failure", () => {
    expect(waitStatus({ reason: "DependencyNeverSatisfied", after: [1] }).tone).toBe("danger");
  });
});

describe("finishedStatus", () => {
  it.each([
    [{ state: "COMPLETED", elapsed: "00:00:52", exitCode: "0:0" }, "success", "Completed in 0:52"],
    [
      { state: "FAILED", elapsed: "01:00:00", exitCode: "1:0" },
      "danger",
      "Failed after 1:00:00 · exit 1",
    ],
    [
      { state: "FAILED", elapsed: "00:10:00", exitCode: "0:9" },
      "danger",
      "Failed after 10:00 · signal 9",
    ],
    [
      { state: "TIMEOUT", elapsed: "1-02:00:00", exitCode: "0:15" },
      "danger",
      "Timed out after 26:00:00",
    ],
    [{ state: "CANCELLED", elapsed: "00:00:00", exitCode: "0:0" }, "muted", "Cancelled"],
  ])("%j", (job, tone, label) => {
    expect(finishedStatus(job)).toEqual({ tone, label });
  });
});

describe("time formatting", () => {
  it("formats durations and sacct elapsed values", () => {
    expect(duration(921)).toBe("15:21");
    expect(duration(7200)).toBe("2:00:00");
    expect(slurmSeconds("2-00:00:01")).toBe(172_801);
    expect(slurmSeconds("Unknown")).toBe(0);
  });

  it("reads relative times", () => {
    const now = Date.parse("2026-10-06T12:00:00");
    expect(timeAgo("2026-10-06T11:59:40", now)).toBe("just now");
    expect(timeAgo("2026-10-06T11:48:00", now)).toBe("12m ago");
    expect(timeAgo("2026-10-06T09:00:00", now)).toBe("3h ago");
  });
});

describe("queueTree", () => {
  const job = (id: number, state: string, after: number[] = []): QueuedJob => ({
    id,
    name: `j${id}`,
    state,
    reason: "",
    node: "",
    gpu: false,
    elapsedSec: 0,
    limitSec: null,
    after,
    lastLine: null,
    hasLog: false,
  });
  const shape = (nodes: ReturnType<typeof queueTree>) => nodes.map((n) => [n.job.id, n.depth]);
  const pipeline = [
    job(1519, "PENDING", [1518]),
    job(1517, "PENDING"),
    job(1520, "PENDING", [1517]),
    job(1518, "PENDING", [1517]),
    job(1510, "RUNNING"),
  ];

  it("nests pipelines under the job they wait for, running roots first", () => {
    expect(shape(queueTree(pipeline))).toEqual([
      [1510, 0],
      [1517, 0],
      [1518, 1],
      [1519, 2],
      [1520, 1],
    ]);
  });

  it("counts every job below a parent", () => {
    const counts = queueTree(pipeline).map((n) => [n.job.id, n.descendants]);
    expect(counts).toEqual([
      [1510, 0],
      [1517, 3],
      [1518, 1],
      [1519, 0],
      [1520, 0],
    ]);
  });

  it("hides the subtree of each collapsed parent", () => {
    const tree = queueTree(pipeline);
    expect(shape(visibleQueue(tree, new Set()))).toEqual([
      [1510, 0],
      [1517, 0],
    ]);
    expect(shape(visibleQueue(tree, new Set([1517])))).toEqual([
      [1510, 0],
      [1517, 0],
      [1518, 1],
      [1520, 1],
    ]);
    expect(shape(visibleQueue(tree, new Set([1517, 1518])))).toHaveLength(5);
  });

  it("treats a dependency on a job that left the queue as a root", () => {
    expect(shape(queueTree([job(5, "PENDING", [4])]))).toEqual([[5, 0]]);
  });

  it("keeps jobs that depend on each other", () => {
    expect(shape(queueTree([job(1, "PENDING", [2]), job(2, "PENDING", [1])]))).toEqual([
      [1, 0],
      [2, 0],
    ]);
  });
});
