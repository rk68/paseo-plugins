import { describe, expect, it } from "vitest";
import {
  logId,
  parseWorkstation,
  patternDir,
  WORKSTATION_MARKER,
  workstationScript,
} from "./workstation";

const SEP = "__paseo_lab_ws_sep__";
const sample = [
  WORKSTATION_MARKER,
  "spark-06aa",
  "NVIDIA GB10",
  SEP,
  "4242 29735 rishi",
  "999 14517 arun",
  SEP,
  "4100 3600 /home/rishi/mar/logs/m1-full.log",
  "4242 3590 /home/rishi/mar/logs/m1-full.log",
  "5000 20 /home/rishi/mar/logs/m3 data.log",
  "6000 3 /tmp/scratch/out",
  SEP,
  "1793560000 O /home/rishi/mar/logs/m1-full.log",
  "1793550000 E /home/rishi/mar/logs/m1-pilot.log",
  "1793540000 O /home/rishi/mar/logs/setup.log",
  SEP,
  "/home/rishi/mar/logs/m1-full.log\nround 1\rround 2\n\0/home/rishi/mar/logs/m3 data.log\nbuilding\n\0",
].join("\n");

describe("parseWorkstation", () => {
  const { list, paths } = parseWorkstation(sample, 10);

  it("groups processes by log file and names the job after it", () => {
    expect(list.queued.map((job) => job.name)).toEqual(["m1-full", "m3 data"]);
    expect(list.queued[0]).toMatchObject({
      id: 4100,
      elapsedSec: 3600,
      gpu: true,
      node: "spark-06aa",
      lastLine: "round 2",
    });
    expect(list.queued[1]).toMatchObject({ gpu: false, lastLine: "building" });
  });

  it("lists ended logs that are not running, with errors marked", () => {
    expect(list.finished.map((job) => [job.name, job.state])).toEqual([
      ["m1-pilot", "ERRORED"],
      ["setup", "ENDED"],
    ]);
    expect(list.finished[0].end).toBe(new Date(1793550000 * 1000).toISOString());
  });

  it("sums GPU memory per user and remembers every log path", () => {
    expect(list.machine).toEqual({
      kind: "workstation",
      gpu: "NVIDIA GB10",
      gpuUse: [
        { user: "rishi", mib: 29735 },
        { user: "arun", mib: 14517 },
      ],
    });
    expect(paths.get(4100)).toBe("/home/rishi/mar/logs/m1-full.log");
    expect(paths.get(logId("/home/rishi/mar/logs/setup.log"))).toBe(
      "/home/rishi/mar/logs/setup.log",
    );
  });

  it("handles an idle host with no GPU tool", () => {
    const idle = parseWorkstation(
      [WORKSTATION_MARKER, "box", "", SEP, SEP, SEP, SEP, ""].join("\n"),
      10,
    );
    expect(idle.list).toEqual({
      queued: [],
      finished: [],
      machine: { kind: "workstation", gpu: null, gpuUse: [] },
    });
  });
});

describe("workstation helpers", () => {
  it("takes the folder of a pattern only when it has no placeholders", () => {
    expect(patternDir("~/mar/logs/%x-%j.log")).toBe("~/mar/logs");
    expect(patternDir("~/logs/%u/%j.log")).toBeNull();
    expect(patternDir("job.log")).toBeNull();
  });

  it("quotes configured folders and ends with a zero status", () => {
    const script = workstationScript(["~/my logs"]);
    expect(script).toContain(`printf '%s\\n' "$HOME"/'my logs';`);
    expect(script.trim().endsWith("true")).toBe(true);
  });
});
