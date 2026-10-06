import { byUrgency, prTone, TONE_RANK } from "./pr-signals";
import type { Pr, PrGroup } from "./pr-stack";

export type PrSort = "urgency" | "newest";

function byNewest(a: Pr, b: Pr): number {
  return b.createdAt.localeCompare(a.createdAt) || b.number - a.number;
}

function newestIn(group: PrGroup): string {
  return group.prs.reduce((latest, pr) => (pr.createdAt > latest ? pr.createdAt : latest), "");
}

function urgencyOf(group: PrGroup): number {
  return Math.min(...group.prs.map((pr) => TONE_RANK[prTone(pr)]));
}

const SECTION_ORDER: PrGroup["kind"][] = ["wrong_base", "stack", "independent"];

/**
 * Orders groups inside their sections (wrong base, stacks, independent PRs) and the PRs inside
 * the independent group. A stack keeps its merge order: parents always come before their children.
 */
export function orderGroups(groups: PrGroup[], sort: PrSort): PrGroup[] {
  const compareGroups =
    sort === "newest"
      ? (a: PrGroup, b: PrGroup) => newestIn(b).localeCompare(newestIn(a))
      : (a: PrGroup, b: PrGroup) => urgencyOf(a) - urgencyOf(b);
  return SECTION_ORDER.flatMap((kind) =>
    groups
      .filter((group) => group.kind === kind)
      .map((group) =>
        kind === "independent"
          ? { kind: group.kind, prs: [...group.prs].sort(sort === "newest" ? byNewest : byUrgency) }
          : group,
      )
      .sort(compareGroups),
  );
}

export function age(iso: string, nowMs: number): string {
  const hours = Math.floor((nowMs - Date.parse(iso)) / 3_600_000);
  if (!Number.isFinite(hours)) return "";
  if (hours < 1) return "opened just now";
  if (hours < 48) return `opened ${hours}h ago`;
  return `opened ${Math.floor(hours / 24)}d ago`;
}
