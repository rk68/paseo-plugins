import type { FinishedJob, JobList, QueuedJob } from "../shared/cluster";
import { logTail, remotePath } from "./slurm";

export const WORKSTATION_MARKER = "__paseo_lab_workstation__";
const SEPARATOR = "__paseo_lab_ws_sep__";
const FINISHED_SCAN = 30;
const ERROR_PATTERN = "Traceback|[A-Za-z]Error:|Killed|out of memory";

/**
 * Lists a host without Slurm: the GPU and its users, the user's running jobs, and logs that ended in the last 24 hours.
 * A job is every process of the user whose stdout is a `.log` or `.out` file, grouped by that file, so
 * `nohup cmd > x.log &` shows as one job named after its log. Finished logs come from `logDirs` and from the folders of running logs.
 */
export function workstationScript(logDirs: string[]): string {
  const configured = logDirs.map((dir) => `printf '%s\\n' ${remotePath(dir)};`).join(" ");
  return [
    `echo ${WORKSTATION_MARKER}`,
    "hostname",
    "nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1",
    `echo ${SEPARATOR}`,
    `nvidia-smi --query-compute-apps=pid,used_memory --format=csv,noheader,nounits 2>/dev/null | while IFS=', ' read -r p m; do [ -n "$p" ] && printf '%s %s %s\\n' "$p" "$m" "$(ps -o user= -p "$p" 2>/dev/null)"; done`,
    `echo ${SEPARATOR}`,
    `R=$(for p in $(pgrep -u "$(id -u)"); do f=$(readlink "/proc/$p/fd/1" 2>/dev/null) || continue; [ -f "$f" ] && printf '%s %s %s\\n' "$p" "$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')" "$f"; done)`,
    `[ -n "$R" ] && printf '%s\\n' "$R"`,
    `echo ${SEPARATOR}`,
    `{ [ -n "$R" ] && printf '%s\\n' "$R" | cut -d' ' -f3- | while IFS= read -r f; do dirname -- "$f"; done; ${configured} true; } | sort -u | while IFS= read -r d; do [ -d "$d" ] && find "$d" -maxdepth 1 -type f -name '*.log' -mmin -1440 -printf '%T@ %p\\n'; done | sort -rn | head -n ${FINISHED_SCAN} | while read -r t f; do if tail -c 4096 -- "$f" 2>/dev/null | grep -qE '${ERROR_PATTERN}'; then s=E; else s=O; fi; printf '%s %s %s\\n' "\${t%.*}" "$s" "$f"; done`,
    `echo ${SEPARATOR}`,
    `[ -n "$R" ] && printf '%s\\n' "$R" | cut -d' ' -f3- | sort -u | while IFS= read -r f; do printf '%s\\n' "$f"; tail -c 4096 -- "$f" 2>/dev/null | tr '\\0' ' '; printf '\\0'; done`,
    "true",
  ].join("\n");
}

/** The folder of an sbatch-style `--output` pattern, when it has no placeholders. */
export function patternDir(pattern: string): string | null {
  const slash = pattern.lastIndexOf("/");
  if (slash <= 0) return null;
  const dir = pattern.slice(0, slash);
  return dir.includes("%") ? null : dir;
}

/** A stable numeric id for a finished log, which has no process id. */
export function logId(path: string): number {
  let hash = 0x811c9dc5;
  for (const char of path) hash = Math.imul(hash ^ char.charCodeAt(0), 0x01000193) >>> 0;
  return hash;
}

function jobName(path: string): string {
  return (path.slice(path.lastIndexOf("/") + 1) || path).replace(/\.log$/, "");
}

export interface ParsedWorkstation {
  list: JobList;
  /** Log path per job id, for the log reader. */
  paths: Map<number, string>;
}

export function parseWorkstation(text: string, finishedLimit: number): ParsedWorkstation {
  const body = text.slice(text.indexOf(WORKSTATION_MARKER) + WORKSTATION_MARKER.length);
  const [head = "", gpuText = "", runningText = "", finishedText = "", tailText = ""] =
    body.split(SEPARATOR);
  const [host = "", gpuName = ""] = head.trim().split("\n");

  const gpuPids = new Set<number>();
  const byUser = new Map<string, number>();
  for (const line of lines(gpuText)) {
    const [pid, mib, user = "?"] = line.trim().split(/\s+/);
    gpuPids.add(Number(pid));
    byUser.set(user, (byUser.get(user) ?? 0) + (Number(mib) || 0));
  }

  const groups = new Map<string, { pids: number[]; root: number; elapsedSec: number }>();
  for (const line of lines(runningText)) {
    const match = /^(\d+) (\d+) (.+\.(?:log|out))$/.exec(line);
    if (!match) continue;
    const pid = Number(match[1]);
    const elapsedSec = Number(match[2]);
    const group = groups.get(match[3]) ?? { pids: [], root: pid, elapsedSec };
    group.pids.push(pid);
    if (elapsedSec >= group.elapsedSec) Object.assign(group, { root: pid, elapsedSec });
    groups.set(match[3], group);
  }

  const tails = new Map<string, string>();
  for (const chunk of tailText.split("\0")) {
    const text = chunk.replace(/^\n/, "");
    const newline = text.indexOf("\n");
    if (newline > 0) tails.set(text.slice(0, newline), text.slice(newline + 1));
  }
  const paths = new Map<number, string>();
  const queued: QueuedJob[] = [...groups.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([path, group]) => {
      paths.set(group.root, path);
      return {
        id: group.root,
        name: jobName(path),
        state: "RUNNING",
        reason: "",
        node: host,
        gpu: group.pids.some((pid) => gpuPids.has(pid)),
        elapsedSec: group.elapsedSec,
        limitSec: null,
        after: [],
        lastLine: logTail(tails.get(path) ?? "", 1)[0] ?? null,
        hasLog: true,
      };
    });

  const finished: FinishedJob[] = [];
  for (const line of lines(finishedText)) {
    const match = /^(\d+) ([EO]) (.+)$/.exec(line);
    if (!match || groups.has(match[3]) || finished.length >= finishedLimit) continue;
    const id = logId(match[3]);
    paths.set(id, match[3]);
    finished.push({
      id,
      label: jobName(match[3]),
      name: jobName(match[3]),
      state: match[2] === "E" ? "ERRORED" : "ENDED",
      elapsed: "",
      exitCode: "",
      end: new Date(Number(match[1]) * 1000).toISOString(),
      hasLog: true,
    });
  }

  return {
    list: {
      queued,
      finished,
      machine: {
        kind: "workstation",
        gpu: gpuName.trim() || null,
        gpuUse: [...byUser.entries()]
          .map(([user, mib]) => ({ user, mib }))
          .sort((a, b) => b.mib - a.mib),
      },
    },
    paths,
  };
}

function lines(text: string): string[] {
  return text.split("\n").filter((line) => line.trim() !== "");
}
