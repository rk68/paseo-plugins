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
    group: { gap: 2 },
    stackGroup: {
      gap: 2,
      paddingVertical: 8,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
    },
    stackHeader: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 8,
      marginBottom: 2,
    },
    stackTitle: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
    // Indented to the title, past the chevron and its gap.
    stackSummary: { color: colors.foregroundMuted, fontSize: 12, paddingLeft: 24, paddingRight: 8 },
    sortButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingVertical: 4,
      paddingHorizontal: 6,
      borderRadius: 4,
    },
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
    actions: { flexDirection: "row" as const, flexWrap: "wrap" as const, gap: 6 },
    // Aligns the action row with the title rail: row padding plus the icon and its gap.
    quickActions: { gap: 4, paddingLeft: 30, paddingRight: 8, paddingBottom: 8, marginTop: -2 },
    headerActions: { flexDirection: "row" as const, gap: 4 },
    backButton: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 4,
      paddingHorizontal: 8,
      alignSelf: "flex-start" as const,
    },
    promptField: { gap: 6, paddingHorizontal: 16, paddingVertical: 12 },
    promptInput: {
      minHeight: 56,
      color: colors.foreground,
      fontSize: 12,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 6,
      textAlignVertical: "top" as const,
    },
    button,
    buttonBusy: { ...button, opacity: 0.5 },
    buttonText: { color: colors.foreground, fontSize: 12 },
    link: { color: colors.accent, fontSize: 12 },
    notice: { color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8 },
    scopeLine: { color: colors.foregroundMuted, fontSize: 12, paddingHorizontal: 8, marginTop: -8 },
    empty: { color: colors.foregroundMuted, fontSize: 14, paddingHorizontal: 8 },
    error: { color: colors.statusDanger, fontSize: 12 },
    errorBlock: { color: colors.statusDanger, fontSize: 12, paddingHorizontal: 8 },
  };
}
