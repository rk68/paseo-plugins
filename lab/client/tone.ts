import type { PluginTheme } from "@getpaseo/plugin";
import type { Tone } from "../shared/format";

export function toneColor(theme: PluginTheme, tone: Tone): string {
  const { colors } = theme;
  return {
    danger: colors.statusDanger,
    warning: colors.statusWarning,
    success: colors.statusSuccess,
    muted: colors.foregroundMuted,
  }[tone];
}
