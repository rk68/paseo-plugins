import type { PluginTheme } from "@getpaseo/plugin";
import { type PluginSurfaceProps, useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { clusterSettings } from "../shared/cluster";
import {
  folderName,
  metaTail,
  progressShare,
  progressText,
  runStatus,
  timeAgo,
  type Tone,
} from "../shared/format";
import { type AgentRun, listRunsRpc, type Progress, type Subagent } from "../shared/runs";
import { ClusterJobs } from "./cluster-jobs-panel";
import { Spinner } from "./spinner";
import { toneColor } from "./tone";

type Styles = ReturnType<typeof createStyles>;
type OpenAgent = NonNullable<PluginSurfaceProps["navigation"]>["openAgent"];

const RUNS_REFRESH_MS = 5_000;
const RAIL_OFFSET = 14;
const RAIL_STEP = 22;

const STATUS_ICON: Record<Tone, string> = {
  warning: "ShieldAlert",
  danger: "CircleX",
  success: "CircleCheck",
  muted: "Circle",
};

const SUBAGENT_TONE: Record<Subagent["status"], Tone> = {
  running: "muted",
  completed: "success",
  failed: "danger",
  canceled: "muted",
};

const SUBAGENT_ICON: Record<Subagent["status"], string> = {
  running: "LoaderCircle",
  completed: "CircleCheck",
  failed: "CircleX",
  canceled: "CircleSlash",
};

/** Every agent that works or waits for the user, on all workspaces, with the cluster queue below. */
export function RunsScreen({ theme, navigation }: PluginSurfaceProps) {
  const styles = useMemo(() => createStyles(theme), [theme]);
  const listRuns = useRpc(listRunsRpc);
  const query = useQuery({
    queryKey: ["lab.runs"],
    queryFn: () => listRuns({}),
    refetchInterval: RUNS_REFRESH_MS,
  });
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const agents = query.data?.agents ?? [];
  const needYou = agents.filter((run) => ["warning", "danger"].includes(runStatus(run).tone));
  const working = agents.filter((run) => runStatus(run).busy);
  const counts = [
    working.length ? `${working.length} working` : "",
    needYou.length ? `${needYou.length} need you` : "",
  ].filter(Boolean);
  const summary = counts.length ? counts.join(" · ") : "No agent is working";

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.block}>
        <View style={styles.header}>
          <Text style={styles.headerText} numberOfLines={1}>
            {query.data ? summary : "Loading agents..."}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh agents"
            onPress={refresh}
            disabled={query.isFetching}
            style={query.isFetching ? styles.iconButtonBusy : styles.iconButton}
          >
            <Icon name="RefreshCw" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
        {query.error ? <Text style={styles.error}>{query.error.message}</Text> : null}
        {agents.length ? (
          <View style={styles.group}>
            <Text style={styles.groupTitle}>Agents</Text>
            {agents.map((run) => (
              <AgentRow
                key={run.id}
                run={run}
                now={query.dataUpdatedAt}
                onOpen={navigation?.openAgent}
                theme={theme}
                styles={styles}
              />
            ))}
          </View>
        ) : null}
      </View>
      <ClusterSection theme={theme} styles={styles} />
    </ScrollView>
  );
}

function ClusterSection({ theme, styles }: { theme: PluginTheme; styles: Styles }) {
  const settings = useSettings(clusterSettings);
  if (settings.status !== "ready" || !settings.values.sshHost) return null;
  return (
    <View>
      <Text style={styles.sectionTitle}>Cluster</Text>
      <ClusterJobs theme={theme} />
    </View>
  );
}

function AgentRow({
  run,
  now,
  onOpen,
  theme,
  styles,
}: {
  run: AgentRun;
  now: number;
  onOpen: OpenAgent | undefined;
  theme: PluginTheme;
  styles: Styles;
}) {
  const status = runStatus(run);
  // An idle agent can still own a background script that reports progress.
  const busy = status.busy || run.progress.some((entry) => entry.live);
  const open = useCallback(() => onOpen?.({ agentId: run.id }), [onOpen, run.id]);
  const railStyle = useMemo(
    () =>
      run.depth
        ? { ...styles.rail, marginLeft: RAIL_OFFSET + (run.depth - 1) * RAIL_STEP }
        : undefined,
    [styles.rail, run.depth],
  );
  return (
    <View style={railStyle}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open agent ${run.title}`}
        disabled={!onOpen}
        onPress={open}
        style={styles.row}
      >
        <View style={styles.leading}>
          {busy ? (
            <Spinner size={14} color={theme.colors.accent} />
          ) : (
            <Icon name={STATUS_ICON[status.tone]} size={14} color={toneColor(theme, status.tone)} />
          )}
        </View>
        <View style={styles.rowContent}>
          <Text style={styles.title} numberOfLines={1}>
            {run.title}
          </Text>
          <Text style={styles.meta} numberOfLines={1}>
            <Text style={status.tone === "muted" ? undefined : styles.tone[status.tone]}>
              {status.label}
            </Text>
            {metaTail(folderName(run.cwd), run.provider, timeAgo(run.updatedAt, now))}
          </Text>
          {run.currentTool ? (
            <Text style={styles.mono} numberOfLines={1}>
              {run.currentTool}
            </Text>
          ) : null}
          {run.progress.map((entry) => (
            <ProgressLine key={entry.name} progress={entry} styles={styles} />
          ))}
          {run.subagents.map((subagent) => (
            <SubagentLine key={subagent.id} subagent={subagent} theme={theme} styles={styles} />
          ))}
        </View>
      </Pressable>
    </View>
  );
}

function ProgressLine({ progress, styles }: { progress: Progress; styles: Styles }) {
  const share = progressShare(progress);
  const fillStyle = useMemo(
    () => ({ ...styles.progressFill, width: `${Math.round((share ?? 0) * 100)}%` as const }),
    [styles.progressFill, share],
  );
  return (
    <View style={styles.progress}>
      <Text style={styles.meta} numberOfLines={1}>
        <Text style={styles.progressTask}>{progress.task ?? progress.name}</Text>
        {metaTail(progressText(progress))}
      </Text>
      {share === null ? null : (
        <View style={styles.progressTrack}>
          <View style={fillStyle} />
        </View>
      )}
    </View>
  );
}

function SubagentLine({
  subagent,
  theme,
  styles,
}: {
  subagent: Subagent;
  theme: PluginTheme;
  styles: Styles;
}) {
  const tone = SUBAGENT_TONE[subagent.status];
  const actions = subagent.actions === 1 ? "1 tool call" : `${subagent.actions} tool calls`;
  return (
    <View style={styles.subagent}>
      {subagent.status === "running" ? (
        <Spinner size={12} color={theme.colors.accent} />
      ) : (
        <Icon name={SUBAGENT_ICON[subagent.status]} size={12} color={toneColor(theme, tone)} />
      )}
      <Text style={styles.subagentText} numberOfLines={1}>
        {subagent.description}
        <Text style={styles.meta}>
          {metaTail(subagent.actions ? actions : "", subagent.lastAction ?? "")}
        </Text>
      </Text>
    </View>
  );
}

function createStyles(theme: PluginTheme) {
  const { colors } = theme;
  const iconButton = { padding: 4, borderRadius: 4 };
  const meta = { color: colors.foregroundMuted, fontSize: 12 };
  const mono = Platform.select({ ios: "Menlo", default: "monospace" });
  return {
    screen: { flex: 1, backgroundColor: colors.surface0 },
    content: { paddingVertical: 12, gap: 16 },
    block: { paddingHorizontal: 8, gap: 16 },
    header: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      justifyContent: "space-between" as const,
      paddingHorizontal: 8,
    },
    headerText: { ...meta, flexShrink: 1 },
    iconButton,
    iconButtonBusy: { ...iconButton, opacity: 0.5 },
    group: { gap: 2 },
    groupTitle: {
      color: colors.foregroundMuted,
      fontSize: 14,
      fontWeight: "500" as const,
      paddingHorizontal: 8,
      marginBottom: 4,
    },
    sectionTitle: {
      color: colors.foregroundMuted,
      fontSize: 14,
      fontWeight: "500" as const,
      paddingHorizontal: 16,
    },
    row: {
      flexDirection: "row" as const,
      alignItems: "flex-start" as const,
      gap: 8,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: 8,
    },
    rail: { borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 4 },
    // Optical: lifts the icon onto the title's first line.
    leading: { paddingTop: 2 },
    rowContent: { flex: 1, minWidth: 0, gap: 4 },
    title: { color: colors.foreground, fontSize: 14 },
    meta,
    mono: { ...meta, fontFamily: mono },
    tone: {
      danger: { color: colors.statusDanger },
      warning: { color: colors.statusWarning },
      success: { color: colors.statusSuccess },
      muted: { color: colors.foregroundMuted },
    } satisfies Record<Tone, object>,
    progress: { gap: 4 },
    progressTask: { color: colors.foreground },
    progressTrack: { height: 2, borderRadius: 1, backgroundColor: colors.surface2 },
    progressFill: { height: 2, borderRadius: 1, backgroundColor: colors.accent },
    subagent: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
    subagentText: { color: colors.foreground, fontSize: 12, flexShrink: 1 },
    error: { color: colors.statusDanger, fontSize: 12, paddingHorizontal: 8 },
  };
}
