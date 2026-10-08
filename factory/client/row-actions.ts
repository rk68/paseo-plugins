import type { PrAction } from "../shared/pr-signals";

/** Every action a PR row runs. "close" sits in the PR details, the rest are chips. */
export type RowAction = PrAction | "close";

const CONFIRMED = new Set<RowAction>(["merge", "close"]);

/**
 * One press on a row. An action that cannot be undone fires only on a second press while it is
 * armed. Any other press disarms it, so two such actions are never armed at once.
 */
export function pressRowAction(
  armed: RowAction | null,
  action: RowAction,
): { armed: RowAction | null; fire: boolean } {
  if (!CONFIRMED.has(action)) return { armed: null, fire: true };
  return armed === action ? { armed: null, fire: true } : { armed: action, fire: false };
}

/** While a row action runs, only "Open agent" stays enabled: any other action could race it. */
export function rowActionEnabled(pending: RowAction | null, action: RowAction): boolean {
  return pending === null || action === "open-agent";
}
