import { createContext, useContext } from "react";
import type { Styles, Theme } from "./styles";

export interface PanelContextValue {
  theme: Theme;
  styles: Styles;
  directory: string;
  /** Undefined on hosts without client navigation. */
  openAgent: ((agentId: string) => void) | undefined;
  openWorkspace: ((workspaceId: string) => void) | undefined;
  refresh(): void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export const PanelProvider = PanelContext.Provider;

export function usePanel(): PanelContextValue {
  const value = useContext(PanelContext);
  if (!value) throw new Error("usePanel must be used inside the PR stack panel");
  return value;
}
