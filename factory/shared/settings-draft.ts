import { type FactorySettings, TASK_KINDS } from "./actions";

export type DraftFields = Pick<FactorySettings, "prompts" | "ignoredChecks">;

type FieldKey = `prompts.${(typeof TASK_KINDS)[number]}` | "ignoredChecks";

function read(values: DraftFields, key: FieldKey): string {
  if (key === "ignoredChecks") return values.ignoredChecks.join("\n");
  return values.prompts[key.slice("prompts.".length) as (typeof TASK_KINDS)[number]];
}

const FIELDS: FieldKey[] = [
  ...TASK_KINDS.map((kind) => `prompts.${kind}` as const),
  "ignoredChecks",
];

/**
 * Applies only the fields the user edited onto the latest settings. A field another client
 * changed since the draft began is a conflict, never a silent overwrite.
 */
export function mergeDraft(
  latest: FactorySettings,
  baseline: DraftFields,
  draft: DraftFields,
): { values: FactorySettings } | { conflicts: FieldKey[] } {
  const edited = FIELDS.filter((key) => read(draft, key) !== read(baseline, key));
  const conflicts = edited.filter(
    (key) => read(latest, key) !== read(baseline, key) && read(latest, key) !== read(draft, key),
  );
  if (conflicts.length) return { conflicts };
  const prompts = { ...latest.prompts };
  for (const kind of TASK_KINDS) {
    if (edited.includes(`prompts.${kind}`)) prompts[kind] = draft.prompts[kind];
  }
  const ignoredChecks = edited.includes("ignoredChecks")
    ? draft.ignoredChecks
    : latest.ignoredChecks;
  return { values: { ...latest, prompts, ignoredChecks } };
}
