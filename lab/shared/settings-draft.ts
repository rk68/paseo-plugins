/**
 * Applies only the fields the user edited onto the latest values. A field another client changed
 * since the draft began is a conflict, never a silent overwrite.
 */
export function mergeEdited<Values extends Record<string, string>>(
  latest: Values,
  baseline: Values,
  draft: Values,
): { values: Values } | { conflicts: (keyof Values)[] } {
  const keys = Object.keys(draft) as (keyof Values)[];
  const edited = keys.filter((key) => draft[key] !== baseline[key]);
  const conflicts = edited.filter(
    (key) => latest[key] !== baseline[key] && latest[key] !== draft[key],
  );
  if (conflicts.length) return { conflicts };
  const values = { ...latest };
  for (const key of edited) values[key] = draft[key];
  return { values };
}
