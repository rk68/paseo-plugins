import type { PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import type { Tone } from "../shared/pr-signals";

export type Theme = PluginWorkspacePanelProps["theme"];
export type Styles = ReturnType<typeof createStyles>;

export function toneColor(theme: Theme, tone: Tone): string {
  const { colors } = theme;
  return {
    danger: colors.statusDanger,
    warning: colors.statusWarning,
    success: colors.statusSuccess,
    muted: colors.foregroundMuted,
  }[tone];
}

export function createStyles(theme: Theme) {
  const { colors } = theme;
  const row = {
    flexDirection: "row" as const,
    alignItems: "flex-start" as const,
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 8,
  };
  const iconButton = { padding: 4, borderRadius: 4 };
  const button = {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 6,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface0,
  };
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { paddingHorizontal: 8, paddingVertical: 12, gap: 16 },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 8,
    },
    headerText: { color: colors.foregroundMuted, fontSize: 12, flexShrink: 1 },
    iconButton,
    iconButtonBusy: { ...iconButton, opacity: 0.5 },
    toggleRow: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingHorizontal: 8,
    },
    toggleText: { flex: 1, gap: 2 },
    switchTrack: { false: colors.surface2, true: colors.accent },
    group: { gap: 2 },
    groupTitle: {
      color: colors.foregroundMuted,
      fontSize: 14,
      fontWeight: "500" as const,
      paddingHorizontal: 8,
      marginBottom: 4,
    },
    rail: { borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 4 },
    row,
    cardOpen: { borderRadius: 8, backgroundColor: colors.surface1 },
    // Optical: lifts the icon onto the title's first line.
    leading: { paddingTop: 2 },
    rowContent: { flex: 1, minWidth: 0, gap: 2 },
    title: { color: colors.foreground, fontSize: 14 },
    number: { color: colors.foregroundMuted },
    meta: { color: colors.foregroundMuted, fontSize: 12 },
    tone: {
      danger: { color: colors.statusDanger },
      warning: { color: colors.statusWarning },
      success: { color: colors.statusSuccess },
      muted: { color: colors.foregroundMuted },
    } satisfies Record<Tone, object>,
    details: { gap: 6, paddingLeft: 30, paddingRight: 8, paddingTop: 4, paddingBottom: 12 },
    branch: { color: colors.foregroundMuted, fontSize: 12 },
    checkRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    checkName: { color: colors.foreground, fontSize: 12, flexShrink: 1 },
    actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 8, marginTop: 2 },
    button,
    buttonBusy: { ...button, opacity: 0.5 },
    buttonText: { color: colors.foreground, fontSize: 12 },
    link: { color: colors.accent, fontSize: 12 },
    command: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 8,
      paddingVertical: 4,
      paddingHorizontal: 8,
      borderRadius: 6,
      backgroundColor: colors.surface0,
    },
    code: { color: colors.foreground, fontSize: 12, fontFamily: "monospace", flexShrink: 1 },
    notice: { color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8 },
    empty: { color: colors.foregroundMuted, fontSize: 14, paddingHorizontal: 8 },
    error: { color: colors.statusDanger, fontSize: 12 },
    errorBlock: { color: colors.statusDanger, fontSize: 12, paddingHorizontal: 8 },
  };
}
