import type { FinishedJob, QueuedJob } from "../shared/cluster";

interface SlurmNumber {
  set?: boolean;
  infinite?: boolean;
  number?: number;
}

interface SqueueJob {
  job_id: number;
  name: string;
  job_state: string[] | string;
  state_reason?: string;
  nodes?: string;
  tres_per_node?: string;
  tres_alloc_str?: string;
  start_time?: SlurmNumber;
  time_limit?: SlurmNumber;
  standard_output?: string;
  dependency?: string;
}

export interface ParsedQueue {
  jobs: QueuedJob[];
  logPaths: Map<number, string>;
}

function setNumber(value: SlurmNumber | undefined): number | null {
  return value?.set && !value.infinite && typeof value.number === "number" ? value.number : null;
}

export function parseSqueueJson(text: string, nowSec: number): ParsedQueue {
  const { jobs } = JSON.parse(text) as { jobs: SqueueJob[] };
  const logPaths = new Map<number, string>();
  const parsed = jobs.map((job) => {
    const state = Array.isArray(job.job_state) ? (job.job_state[0] ?? "") : job.job_state;
    const start = setNumber(job.start_time);
    const limitMin = setNumber(job.time_limit);
    if (job.standard_output) logPaths.set(job.job_id, job.standard_output);
    return {
      id: job.job_id,
      name: job.name,
      state,
      reason: job.state_reason && job.state_reason !== "None" ? job.state_reason : "",
      node: job.nodes ?? "",
      gpu: `${job.tres_per_node ?? ""},${job.tres_alloc_str ?? ""}`.includes("gpu"),
      // Slurm reports an estimated start time for pending jobs, so elapsed only counts once running.
      elapsedSec: state === "RUNNING" && start !== null ? Math.max(0, nowSec - start) : 0,
      limitSec: limitMin === null ? null : limitMin * 60,
      after: parseDependency(job.dependency ?? ""),
      lastLine: null,
      hasLog: Boolean(job.standard_output),
    };
  });
  const order = (job: { state: string }) => (job.state === "RUNNING" ? 0 : 1);
  parsed.sort((a, b) => order(a) - order(b) || a.id - b.id);
  return { jobs: parsed, logPaths };
}

const ACTIVE_STATES = new Set(["RUNNING", "PENDING", "REQUEUED", "SUSPENDED"]);

/** Parses `sacct -X -n -P -o JobID,JobName,State,Elapsed,ExitCode,End`, newest first. */
export function parseSacct(
  text: string,
  limit: number,
  hasLog: (id: number) => boolean,
): FinishedJob[] {
  return text
    .split("\n")
    .map((line) => line.split("|"))
    .filter((fields) => fields.length >= 6 && /^\d+$/.test(fields[0]))
    .map(([id, name, state, elapsed, exitCode, end]) => ({
      id: Number(id),
      name,
      // "CANCELLED by 1234" carries the cancelling uid; the state alone is enough here.
      state: state.split(" ")[0],
      elapsed,
      exitCode,
      end,
      hasLog: hasLog(Number(id)),
    }))
    .filter((job) => !ACTIVE_STATES.has(job.state))
    .sort((a, b) => b.end.localeCompare(a.end))
    .slice(0, limit);
}

/** Reads job ids from a Slurm dependency such as `afterok:1334(unfulfilled),afterany:1335_*`. */
export function parseDependency(dependency: string): number[] {
  const ids = dependency
    .split(/[,?]/)
    .filter((part) => part.startsWith("after"))
    .flatMap((part) =>
      part
        .replace(/\(.*\)$/, "")
        .split(":")
        .slice(1),
    )
    .map((id) => Number.parseInt(id, 10))
    .filter((id) => Number.isFinite(id));
  return [...new Set(ids)];
}

/** Turns a seen log path back into a Slurm `--output` pattern, so unseen jobs' logs can be found. */
export function logPattern(path: string, name: string, id: number): string | null {
  if (!path.includes(String(id))) return null;
  return path.replaceAll(String(id), "%j").replaceAll(name, "%x");
}

export function fillLogPattern(pattern: string, name: string, id: number): string {
  return pattern.replaceAll("%x", name).replaceAll("%j", String(id));
}

/** Keeps the last carriage-return segment of each line, so progress bars show their latest frame. */
export function logTail(text: string, count: number): string[] {
  const lines = text.split("\n").map((line) => line.slice(line.lastIndexOf("\r") + 1));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-count);
}

export function assertSshHost(host: string): string {
  if (!/^[A-Za-z0-9_.@][A-Za-z0-9_.@:-]*$/.test(host)) {
    throw new Error(`Invalid SSH host: "${host}"`);
  }
  return host;
}

/** Quotes a remote path for the shell, keeping a leading `~/` expandable. */
export function remotePath(path: string): string {
  return path.startsWith("~/") ? `"$HOME"/${shellQuote(path.slice(2))}` : shellQuote(path);
}

export function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}
