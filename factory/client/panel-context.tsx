import { createContext, useContext } from "react";
import type { Styles, Theme } from "./styles";

export interface PanelContextValue {
  theme: Theme;
  styles: Styles;
  directory: string;
  /** The project's main checkout; automation settings are keyed by it, so worktrees share them. */
  projectRoot: string;
  /** Undefined on hosts without client navigation. */
  openAgent: ((agentId: string) => void) | undefined;
  openWorkspace: ((workspaceId: string) => void) | undefined;
  refresh(): void;
  /** Set when PRs are sorted by age, so rows show when each PR was opened. */
  ageAt: number | null;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export const PanelProvider = PanelContext.Provider;

export function usePanel(): PanelContextValue {
  const value = useContext(PanelContext);
  if (!value) throw new Error("usePanel must be used inside the PR stack panel");
  return value;
}
