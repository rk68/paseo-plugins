import type { FinishedJob, QueuedJob } from "./cluster";

export type Tone = "danger" | "warning" | "success" | "muted";

export interface JobStatus {
  tone: Tone;
  label: string;
}

export function duration(totalSec: number): string {
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/** Parses sacct `Elapsed`, which is `[D-]HH:MM:SS`. */
export function slurmSeconds(elapsed: string): number {
  const match = /^(?:(\d+)-)?(\d+):(\d+):(\d+)$/.exec(elapsed);
  if (!match) return 0;
  const [, days = "0", h, m, s] = match;
  return ((Number(days) * 24 + Number(h)) * 60 + Number(m)) * 60 + Number(s);
}

export function timeAgo(iso: string, nowMs: number): string {
  const minutes = Math.round((nowMs - Date.parse(iso)) / 60_000);
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`;
}

const QOS_LIMITS: [RegExp, string][] = [
  [/Cpu/, "Over CPU quota"],
  [/GRES|Gres|Gpu/, "Over GPU quota"],
  [/Mem/, "Over memory quota"],
  [/Job/, "Over job count quota"],
];

export function waitStatus(job: Pick<QueuedJob, "reason" | "after">): JobStatus {
  const { reason, after } = job;
  if (reason === "DependencyNeverSatisfied") return { tone: "danger", label: "Dependency failed" };
  if (reason === "Dependency") {
    return {
      tone: "muted",
      label: after.length ? `After #${after.join(", #")}` : "After a dependency",
    };
  }
  if (reason.startsWith("QOS")) {
    const label = QOS_LIMITS.find(([pattern]) => pattern.test(reason))?.[1] ?? "Over QOS limit";
    return { tone: "muted", label };
  }
  const labels: Record<string, string> = {
    "": "Queued",
    Priority: "Queued behind higher priority",
    Resources: "Waiting for resources",
    ReqNodeNotAvail: "Nodes unavailable",
    BeginTime: "Scheduled to start later",
    JobHeldUser: "Held",
    JobHeldAdmin: "Held by admin",
  };
  return { tone: "muted", label: labels[reason] ?? reason };
}

function exitDetail(exitCode: string): string {
  const [code = "0", signal = "0"] = exitCode.split(":");
  if (signal !== "0") return ` · signal ${signal}`;
  return code !== "0" ? ` · exit ${code}` : "";
}

export function finishedStatus(
  job: Pick<FinishedJob, "state" | "elapsed" | "exitCode">,
): JobStatus {
  const ran = duration(slurmSeconds(job.elapsed));
  switch (job.state) {
    case "COMPLETED":
      return { tone: "success", label: `Completed in ${ran}` };
    case "FAILED":
      return { tone: "danger", label: `Failed after ${ran}${exitDetail(job.exitCode)}` };
    case "TIMEOUT":
      return { tone: "danger", label: `Timed out after ${ran}` };
    case "OUT_OF_MEMORY":
      return { tone: "danger", label: `Out of memory after ${ran}` };
    case "NODE_FAIL":
    case "BOOT_FAIL":
      return { tone: "danger", label: "Node failure" };
    case "PREEMPTED":
      return { tone: "warning", label: `Preempted after ${ran}` };
    case "CANCELLED":
      return {
        tone: "muted",
        label: slurmSeconds(job.elapsed) ? `Cancelled after ${ran}` : "Cancelled",
      };
    default:
      return { tone: "muted", label: job.state.toLowerCase() };
  }
}

/** Share of the time limit used, so a job close to its limit stands out before Slurm kills it. */
export function limitUsed(job: Pick<QueuedJob, "elapsedSec" | "limitSec">): number | null {
  return job.limitSec ? Math.min(1, job.elapsedSec / job.limitSec) : null;
}

export interface QueueNode {
  job: QueuedJob;
  depth: number;
}

/** Orders the queue as dependency trees: each job follows the queued job it waits for. */
export function queueTree(jobs: QueuedJob[]): QueueNode[] {
  const ids = new Set(jobs.map((job) => job.id));
  const parentOf = (job: QueuedJob) => job.after.find((id) => ids.has(id) && id !== job.id);
  const children = new Map<number, QueuedJob[]>();
  for (const job of [...jobs].sort((a, b) => a.id - b.id)) {
    const parent = parentOf(job);
    if (parent !== undefined) children.set(parent, [...(children.get(parent) ?? []), job]);
  }
  const running = (job: QueuedJob) => (job.state === "RUNNING" ? 0 : 1);
  const roots = jobs
    .filter((job) => parentOf(job) === undefined)
    .sort((a, b) => running(a) - running(b) || a.id - b.id);
  const visited = new Set<number>();
  const walk = (job: QueuedJob, depth: number): QueueNode[] => {
    if (visited.has(job.id)) return [];
    visited.add(job.id);
    return [
      { job, depth },
      ...(children.get(job.id) ?? []).flatMap((child) => walk(child, depth + 1)),
    ];
  };
  const ordered = roots.flatMap((root) => walk(root, 0));
  // Jobs in a dependency cycle have no root; list them flat so none disappear.
  return [
    ...ordered,
    ...jobs.filter((job) => !visited.has(job.id)).map((job) => ({ job, depth: 0 })),
  ];
}
