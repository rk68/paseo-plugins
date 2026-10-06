import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { RpcInput } from "@getpaseo/plugin";
import type { JobList, jobLogRpc, listJobsRpc, QueuedJob } from "../shared/cluster";
import {
  assertSshHost,
  fillLogPattern,
  logPattern,
  logTail,
  remotePath,
  parseSacct,
  parseSqueueJson,
  shellQuote,
} from "./slurm";

const run = promisify(execFile);

const SEPARATOR = "__paseo_lab_sacct__";
const FINISHED_LIMIT = 10;
const LOG_LINES = 60;
const LAST_LINE_BYTES = 4096;
const LOG_NOT_FOUND_EXIT = 3;

// Reusing one master connection keeps each poll fast when the host sits behind a proxy such as cloudflared.
const SSH_OPTIONS = [
  "-o",
  "BatchMode=yes",
  "-o",
  "ConnectTimeout=15",
  "-o",
  "ControlMaster=auto",
  "-o",
  "ControlPath=/tmp/paseo-lab-%C",
  "-o",
  "ControlPersist=10m",
];

interface HostLogs {
  paths: Map<number, string>;
  patterns: Set<string>;
}

// squeue only reports queued jobs, so remember their log paths and the --output patterns behind them.
const logsByHost = new Map<string, HostLogs>();

function hostLogs(host: string): HostLogs {
  let logs = logsByHost.get(host);
  if (!logs) {
    logs = { paths: new Map(), patterns: new Set() };
    logsByHost.set(host, logs);
  }
  return logs;
}

async function ssh(host: string, command: string): Promise<string> {
  try {
    const { stdout } = await run("ssh", [...SSH_OPTIONS, assertSshHost(host), command], {
      timeout: 30_000,
      maxBuffer: 32 << 20,
    });
    return stdout;
  } catch (error) {
    const failure = error as { stderr?: string; code?: number };
    if (failure.code === LOG_NOT_FOUND_EXIT)
      throw new Error("Log file not found", { cause: error });
    throw new Error(
      failure.stderr?.trim() || (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
}

async function readLastLines(host: string, jobs: QueuedJob[], paths: Map<number, string>) {
  const targets = jobs.filter((job) => job.state === "RUNNING" && paths.has(job.id));
  if (!targets.length) return new Map<number, string>();
  const script = targets
    .map(
      (job) =>
        `tail -c ${LAST_LINE_BYTES} -- ${shellQuote(paths.get(job.id) ?? "")} 2>/dev/null; printf '\\0'`,
    )
    .join("; ");
  const chunks = (await ssh(host, script)).split("\0");
  return new Map(
    targets.map((job, index) => [job.id, logTail(chunks[index] ?? "", 1)[0] ?? ""] as const),
  );
}

function patternsFor(logs: HostLogs, configured: string): string[] {
  return configured ? [configured, ...logs.patterns] : [...logs.patterns];
}

export async function listJobs({
  sshHost,
  logPattern: configured,
}: RpcInput<typeof listJobsRpc>): Promise<JobList> {
  const output = await ssh(
    sshHost,
    `squeue --me --json && echo ${SEPARATOR} && sacct -X -n -P -S now-24hours -o JobID,JobName,State,Elapsed,ExitCode,End`,
  );
  const [queueText, sacctText = ""] = output.split(SEPARATOR);
  const queue = parseSqueueJson(queueText, Math.floor(Date.now() / 1000));
  const logs = hostLogs(sshHost);
  for (const job of queue.jobs) {
    const path = queue.logPaths.get(job.id);
    if (!path) continue;
    logs.paths.set(job.id, path);
    const pattern = logPattern(path, job.name, job.id);
    if (pattern) logs.patterns.add(pattern);
  }
  const lastLines = await readLastLines(sshHost, queue.jobs, logs.paths).catch(
    () => new Map<number, string>(),
  );
  return {
    queued: queue.jobs.map((job) =>
      lastLines.has(job.id) ? Object.assign(job, { lastLine: lastLines.get(job.id) ?? null }) : job,
    ),
    finished: parseSacct(
      sacctText,
      FINISHED_LIMIT,
      (id) => logs.paths.has(id) || patternsFor(logs, configured).length > 0,
    ),
  };
}

export async function readJobLog({
  sshHost,
  logPattern: configured,
  jobId,
  name,
}: RpcInput<typeof jobLogRpc>) {
  const logs = hostLogs(sshHost);
  const known = logs.paths.get(jobId);
  const candidates = known
    ? [known]
    : patternsFor(logs, configured).map((pattern) => fillLogPattern(pattern, name, jobId));
  if (!candidates.length) throw new Error(`No log path known for job ${jobId}`);
  // Prints the first candidate that exists, then its tail; exits with a marker code when none exist.
  const script = `for f in ${candidates.map(remotePath).join(" ")}; do if [ -f "$f" ]; then printf '%s\\n' "$f"; tail -c 65536 -- "$f"; exit 0; fi; done; exit ${LOG_NOT_FOUND_EXIT}`;
  const output = await ssh(sshHost, script);
  const newline = output.indexOf("\n");
  const path = output.slice(0, newline);
  logs.paths.set(jobId, path);
  return { path, lines: logTail(output.slice(newline + 1), LOG_LINES) };
}
