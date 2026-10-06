import { describe, expect, it } from "vitest";
import {
  assertSshHost,
  expandOutputPath,
  fillLogPattern,
  logPattern,
  logTail,
  parseDependency,
  parseSacct,
  parseSqueueJson,
  remotePath,
  shellQuote,
} from "./slurm";

const NOW = 10_000;

function squeue(jobs: object[]) {
  return JSON.stringify({ jobs });
}

describe("parseSqueueJson", () => {
  it("lists running jobs first, counts elapsed only while running, and records log paths", () => {
    const { jobs, logPaths } = parseSqueueJson(
      squeue([
        {
          job_id: 1334,
          name: "train-a",
          job_state: ["PENDING"],
          state_reason: "QOSMaxCpuPerUserLimit",
          start_time: { set: true, infinite: false, number: NOW + 500 },
          time_limit: { set: true, infinite: false, number: 120 },
          standard_output: "/home/user/logs/train-a-1334.log",
        },
        {
          job_id: 1339,
          name: "train-b",
          job_state: ["RUNNING"],
          state_reason: "None",
          nodes: "spark-97a6",
          tres_per_node: "gres/gpu:1",
          start_time: { set: true, infinite: false, number: NOW - 921 },
          time_limit: { set: true, infinite: true, number: 0 },
        },
      ]),
      NOW,
    );
    expect(jobs.map((j) => [j.id, j.state, j.reason, j.elapsedSec, j.limitSec, j.gpu])).toEqual([
      [1339, "RUNNING", "", 921, null, true],
      [1334, "PENDING", "QOSMaxCpuPerUserLimit", 0, 7200, false],
    ]);
    expect([...logPaths]).toEqual([[1334, "/home/user/logs/train-a-1334.log"]]);
  });
});

describe("parseSacct", () => {
  it("keeps finished jobs only, newest first, without the cancelling uid", () => {
    const text = [
      "1338|1338|smoke|COMPLETED|00:00:52|0:0|2026-10-02T16:38:44",
      "1339|1339|train-b|RUNNING|00:15:41|0:0|Unknown",
      "1330|1330|sweep|CANCELLED by 1001|00:03:00|0:15|2026-10-02T17:01:00",
      "1331|1331|sweep|FAILED|01:00:00|1:0|2026-10-02T09:00:00",
      "",
    ].join("\n");
    expect(parseSacct(text, 2, (id) => id === 1338).map((j) => [j.id, j.state, j.hasLog])).toEqual([
      [1330, "CANCELLED", false],
      [1338, "COMPLETED", true],
    ]);
  });
});

describe("array jobs", () => {
  it("keeps finished array tasks with their raw ID and display label", () => {
    const text =
      "1236|1234_0|sweep|COMPLETED|00:01:00|0:0|2026-10-02T10:00:00\n1237|1234_1|sweep|FAILED|00:02:00|1:0|2026-10-02T10:05:00";
    expect(parseSacct(text, 5, () => false).map((j) => [j.id, j.label, j.state])).toEqual([
      [1237, "1234_1", "FAILED"],
      [1236, "1234_0", "COMPLETED"],
    ]);
  });
});

describe("output path placeholders", () => {
  const job = {
    job_id: 1339,
    name: "train",
    job_state: ["RUNNING"],
    user_name: "me",
    array_job_id: { set: true, number: 1330 },
    array_task_id: { set: true, number: 9 },
  };

  it("expands the sbatch --output placeholders, including zero padding", () => {
    expect(expandOutputPath("/logs/%x-%j.log", job)).toBe("/logs/train-1339.log");
    expect(expandOutputPath("/home/%u/%A_%3a.out", job)).toBe("/home/me/1330_009.out");
    expect(expandOutputPath("/logs/100%%.log", job)).toBe("/logs/100%.log");
  });

  it("refuses a placeholder it cannot resolve, so no wrong path is cached", () => {
    expect(expandOutputPath("/logs/%N.log", job)).toBeNull();
  });
});

describe("logTail", () => {
  it("reads CRLF logs", () => {
    expect(logTail("hello\r\nworld\r\n", 60)).toEqual(["hello", "world"]);
  });

  it("shows the latest progress-bar frame and drops trailing blank lines", () => {
    expect(logTail("start\nepoch 1  10%\repoch 1  50%\repoch 1 100%\ndone\n\n", 2)).toEqual([
      "epoch 1 100%",
      "done",
    ]);
  });
});

describe("ssh input safety", () => {
  it("rejects hosts that ssh would read as options", () => {
    expect(assertSshHost("user@cluster")).toBe("user@cluster");
    expect(() => assertSshHost("-oProxyCommand=touch /tmp/x")).toThrow();
    expect(() => assertSshHost("cluster; rm -rf ~")).toThrow();
  });

  it("keeps a leading ~/ expandable on the remote host", () => {
    expect(remotePath("~/logs/a b.log")).toBe(`"$HOME"/'logs/a b.log'`);
  });

  it("quotes a remote path containing a single quote", () => {
    expect(shellQuote("/logs/it's.log")).toBe(`'/logs/it'\\''s.log'`);
  });
});

describe("parseDependency", () => {
  it("reads every job id from after* clauses", () => {
    expect(parseDependency("afterok:1334(unfulfilled),afterany:1335_*:1336(unfulfilled)")).toEqual([
      1334, 1335, 1336,
    ]);
    expect(parseDependency("singleton(unfulfilled)")).toEqual([]);
    expect(parseDependency("")).toEqual([]);
  });
});

describe("log patterns", () => {
  it("learns a --output pattern from one job and fills it for another", () => {
    const pattern = logPattern("/home/user/logs/train-b-1339.log", "train-b", 1339);
    expect(pattern).toBe("/home/user/logs/%x-%j.log");
    expect(fillLogPattern(pattern ?? "", "smoke", 1338, "1338")).toBe(
      "/home/user/logs/smoke-1338.log",
    );
  });

  it("expands every placeholder of a configured pattern, including zero padding", () => {
    expect(fillLogPattern("/logs/%x-%05j.log", "train", 1339, "1339")).toBe(
      "/logs/train-01339.log",
    );
    expect(fillLogPattern("/logs/%N.log", "train", 1339, "1339")).toBeNull();
  });

  it("uses the array master ID for %A of a finished array task", () => {
    expect(fillLogPattern("/logs/%A_%a.out", "sweep", 1236, "1234_0")).toBe("/logs/1234_0.out");
  });

  it("learns nothing from a path without the job id", () => {
    expect(logPattern("/home/r/slurm.out", "x", 5)).toBeNull();
  });
});
