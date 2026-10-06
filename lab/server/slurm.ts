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
  user_name?: string;
  array_job_id?: SlurmNumber;
  array_task_id?: SlurmNumber;
}

export interface ParsedQueue {
  jobs: QueuedJob[];
  logPaths: Map<number, string>;
}

function setNumber(value: SlurmNumber | undefined): number | null {
  return value?.set && !value.infinite && typeof value.number === "number" ? value.number : null;
}

/**
 * Expands the sbatch `--output` placeholders that some Slurm versions leave in `standard_output`.
 * Returns null when a placeholder cannot be resolved, so no wrong path is cached.
 */
export function expandOutputPath(path: string, job: SqueueJob): string | null {
  const arrayJob = setNumber(job.array_job_id);
  const arrayTask = setNumber(job.array_task_id);
  const values: Record<string, string | undefined> = {
    "%": "%",
    x: job.name,
    j: String(job.job_id),
    u: job.user_name,
    A: arrayJob ? String(arrayJob) : String(job.job_id),
    a: arrayTask === null ? undefined : String(arrayTask),
  };
  let unresolved = false;
  const expanded = path.replace(/%(\d*)([%A-Za-z])/g, (_match, width: string, key: string) => {
    const value = values[key];
    if (value === undefined) {
      unresolved = true;
      return "";
    }
    return width && /^\d+$/.test(value) ? value.padStart(Number(width), "0") : value;
  });
  return unresolved ? null : expanded;
}

export function parseSqueueJson(text: string, nowSec: number): ParsedQueue {
  const { jobs } = JSON.parse(text) as { jobs: SqueueJob[] };
  const logPaths = new Map<number, string>();
  const parsed = jobs.map((job) => {
    const state = Array.isArray(job.job_state) ? (job.job_state[0] ?? "") : job.job_state;
    const start = setNumber(job.start_time);
    const limitMin = setNumber(job.time_limit);
    const logPath = job.standard_output ? expandOutputPath(job.standard_output, job) : null;
    if (logPath) logPaths.set(job.job_id, logPath);
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
      hasLog: logPath !== null,
    };
  });
  const order = (job: { state: string }) => (job.state === "RUNNING" ? 0 : 1);
  parsed.sort((a, b) => order(a) - order(b) || a.id - b.id);
  return { jobs: parsed, logPaths };
}

const ACTIVE_STATES = new Set(["RUNNING", "PENDING", "REQUEUED", "SUSPENDED"]);

/**
 * Parses `sacct -X -n -P -o JobIDRaw,JobID,JobName,State,Elapsed,ExitCode,End`, newest first.
 * JobIDRaw keeps array tasks such as `1234_0` numeric; JobID is their display label.
 */
export function parseSacct(
  text: string,
  limit: number,
  hasLog: (id: number) => boolean,
): FinishedJob[] {
  return text
    .split("\n")
    .map((line) => line.split("|"))
    .filter((fields) => fields.length >= 7 && /^\d+$/.test(fields[0]))
    .map(([id, label, name, state, elapsed, exitCode, end]) => ({
      id: Number(id),
      label,
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

/** Fills a `--output` pattern for a finished job; null when it needs data sacct does not give. */
export function fillLogPattern(pattern: string, name: string, id: number): string | null {
  return expandOutputPath(pattern, { job_id: id, name, job_state: [] });
}

/** Keeps the last carriage-return segment of each line, so progress bars show their latest frame. */
export function logTail(text: string, count: number): string[] {
  const lines = text
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => line.slice(line.lastIndexOf("\r") + 1));
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
