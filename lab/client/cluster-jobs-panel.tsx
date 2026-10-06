import {
  type PluginWorkspacePanelProps,
  type SettingsState,
  useRpc,
  useSettings,
} from "@getpaseo/plugin/client";
import { Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { SettingsAction, SettingsCard, SettingsInput } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useCallback, useMemo, useRef, useState } from "react";
import { Platform, Pressable, type ScrollView as NativeScrollView, Text, View } from "react-native";
import {
  clusterSettings,
  type FinishedJob,
  jobLogRpc,
  listJobsRpc,
  type QueuedJob,
} from "../shared/cluster";
import {
  duration,
  finishedStatus,
  type JobStatus,
  limitUsed,
  queueTree,
  visibleQueue,
  timeAgo,
  type Tone,
  waitStatus,
} from "../shared/format";
import { Spinner } from "./spinner";

type Theme = PluginWorkspacePanelProps["theme"];
type Styles = ReturnType<typeof createStyles>;
type ReadySettings = Extract<SettingsState<typeof clusterSettings.schema>, { status: "ready" }>;

const JOBS_REFRESH_MS = 30_000;
const LOG_REFRESH_MS = 15_000;
const NEAR_LIMIT = 0.85;

const FINISHED_ICON: Record<Tone, string> = {
  success: "CircleCheck",
  danger: "CircleX",
  warning: "CircleAlert",
  muted: "CircleSlash",
};

export function ClusterJobsPanel({ theme }: PluginWorkspacePanelProps) {
  const settings = useSettings(clusterSettings);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [editingHost, setEditingHost] = useState(false);
  const editHost = useCallback(() => setEditingHost(true), []);
  const closeEditor = useCallback(() => setEditingHost(false), []);

  let body: ReactNode;
  if (settings.status === "loading") body = <Text style={styles.empty}>Loading...</Text>;
  else if (settings.status !== "ready") body = <Text style={styles.error}>{settings.error}</Text>;
  else if (editingHost || !settings.values.sshHost) {
    body = <HostForm settings={settings} onDone={closeEditor} />;
  } else {
    body = (
      <Jobs
        sshHost={settings.values.sshHost}
        logPattern={settings.values.logPattern}
        theme={theme}
        styles={styles}
        onEditHost={editHost}
      />
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {body}
    </ScrollView>
  );
}

function HostForm({ settings, onDone }: { settings: ReadySettings; onDone(): void }) {
  const [host, setHost] = useState(settings.values.sshHost);
  const [pattern, setPattern] = useState(settings.values.logPattern);
  const save = useCallback(async () => {
    const values = { sshHost: host.trim(), logPattern: pattern.trim() };
    if (await settings.save(values, settings.revision)) onDone();
  }, [settings, host, pattern, onDone]);
  return (
    <SettingsCard>
      <SettingsInput
        label="SSH host"
        hint="A host from ~/.ssh/config that runs Slurm. It must log in without a password"
        initialValue={settings.values.sshHost}
        placeholder="my-cluster"
        onChangeText={setHost}
        disabled={settings.saving}
        error={settings.saveError}
      />
      <SettingsInput
        label="Log path pattern"
        hint="Optional. Finds logs of jobs that finished before Paseo saw them. Uses the sbatch --output syntax"
        initialValue={settings.values.logPattern}
        placeholder="~/logs/%x-%j.log"
        onChangeText={setPattern}
        disabled={settings.saving}
      />
      <SettingsAction
        label="Show this host's jobs"
        actionLabel={settings.saving ? "Saving..." : "Save"}
        disabled={settings.saving || !host.trim()}
        onPress={save}
      />
    </SettingsCard>
  );
}

function Jobs({
  sshHost,
  logPattern,
  theme,
  styles,
  onEditHost,
}: {
  sshHost: string;
  logPattern: string;
  theme: Theme;
  styles: Styles;
  onEditHost(): void;
}) {
  const listJobs = useRpc(listJobsRpc);
  const query = useQuery({
    queryKey: ["lab.jobs", sshHost, logPattern],
    queryFn: () => listJobs({ sshHost, logPattern }),
    refetchInterval: JOBS_REFRESH_MS,
  });
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const [selected, setSelected] = useState<number | null>(null);
  const toggle = useCallback(
    (id: number) => setSelected((current) => (current === id ? null : id)),
    [],
  );

  const running = query.data?.queued.filter((job) => job.state === "RUNNING") ?? [];
  const waiting = query.data?.queued.filter((job) => job.state !== "RUNNING") ?? [];
  const finished = query.data?.finished ?? [];
  const queue = useMemo(() => queueTree(query.data?.queued ?? []), [query.data]);
  // Pipelines start collapsed into their first job; the user opens the ones they follow.
  const [openParents, setOpenParents] = useState<ReadonlySet<number>>(new Set());
  const toggleParent = useCallback(
    (id: number) =>
      setOpenParents((current) => {
        const next = new Set(current);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const shownQueue = useMemo(() => visibleQueue(queue, openParents), [queue, openParents]);
  const counts = [
    running.length ? `${running.length} running` : "",
    waiting.length ? `${waiting.length} waiting` : "",
  ].filter(Boolean);
  const summary = [sshHost, ...(counts.length ? counts : ["queue empty"])].join(" · ");
  const now = query.dataUpdatedAt;

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.headerText} numberOfLines={1}>
          {query.data ? summary : `${sshHost} · Connecting...`}
        </Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Change SSH host"
            onPress={onEditHost}
            style={styles.iconButton}
          >
            <Icon name="Pencil" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh cluster jobs"
            onPress={refresh}
            disabled={query.isFetching}
            style={query.isFetching ? styles.iconButtonBusy : styles.iconButton}
          >
            <Icon name="RefreshCw" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
      </View>
      {query.error ? <Text style={styles.error}>{query.error.message}</Text> : null}
      {query.data && !running.length && !waiting.length && !finished.length ? (
        <Text style={styles.empty}>No jobs in the last 24 hours</Text>
      ) : null}
      <Section title="Queue" styles={styles} visible={queue.length > 0}>
        {shownQueue.map(({ job, depth, descendants }) => (
          <QueueRow
            key={job.id}
            job={job}
            depth={depth}
            descendants={descendants}
            collapsed={!openParents.has(job.id)}
            onToggleParent={toggleParent}
            sshHost={sshHost}
            logPattern={logPattern}
            open={selected === job.id}
            onToggle={toggle}
            theme={theme}
            styles={styles}
          />
        ))}
      </Section>
      <Section title="Finished · last 24 h" styles={styles} visible={finished.length > 0}>
        {finished.map((job) => (
          <FinishedRow
            key={job.id}
            job={job}
            now={now}
            sshHost={sshHost}
            logPattern={logPattern}
            open={selected === job.id}
            onToggle={toggle}
            theme={theme}
            styles={styles}
          />
        ))}
      </Section>
    </>
  );
}

function Section({
  title,
  visible,
  styles,
  children,
}: {
  title: string;
  visible: boolean;
  styles: Styles;
  children: ReactNode;
}) {
  if (!visible) return null;
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>{title}</Text>
      {children}
    </View>
  );
}

function FinishedRow({
  job,
  now,
  ...row
}: { job: FinishedJob; now: number } & Omit<
  JobRowProps,
  "id" | "name" | "hasLog" | "icon" | "iconColor" | "spinning" | "children" | keyof ParentProps
>) {
  const status = finishedStatus(job);
  return (
    <JobRow
      {...row}
      id={job.id}
      name={job.name}
      hasLog={job.hasLog}
      icon={FINISHED_ICON[status.tone]}
      iconColor={toneColor(row.theme, status.tone)}
    >
      <Meta
        status={status}
        detail={metaTail(timeAgo(job.end, now), `#${job.label}`)}
        styles={row.styles}
      />
    </JobRow>
  );
}

// The rail runs under the center of the parent row's 14px status icon.
const RAIL_OFFSET = 14;
const RAIL_STEP = 22;

function QueueRow({
  job,
  depth,
  descendants,
  collapsed,
  onToggleParent,
  ...row
}: {
  job: QueuedJob;
  depth: number;
  descendants: number;
  collapsed: boolean;
  onToggleParent(id: number): void;
} & Omit<
  JobRowProps,
  "id" | "name" | "hasLog" | "icon" | "iconColor" | "spinning" | "children" | keyof ParentProps
>) {
  const { theme, styles } = row;
  const railStyle = useMemo(
    () =>
      depth ? { ...styles.rail, marginLeft: RAIL_OFFSET + (depth - 1) * RAIL_STEP } : undefined,
    [styles.rail, depth],
  );
  if (job.state === "RUNNING") {
    return (
      <View style={railStyle}>
        <JobRow
          {...row}
          id={job.id}
          name={job.name}
          hasLog={job.hasLog}
          icon="LoaderCircle"
          iconColor={theme.colors.accent}
          spinning
          descendants={descendants}
          collapsed={collapsed}
          onToggleParent={onToggleParent}
        >
          <RunningDetail job={job} styles={styles} />
        </JobRow>
      </View>
    );
  }
  const status = waitStatus(job);
  return (
    <View style={railStyle}>
      <JobRow
        {...row}
        open={false}
        id={job.id}
        name={job.name}
        hasLog={false}
        icon={status.tone === "danger" ? "CircleX" : "Clock"}
        iconColor={toneColor(theme, status.tone)}
        descendants={descendants}
        collapsed={collapsed}
        onToggleParent={onToggleParent}
      >
        <Meta
          status={status}
          detail={metaTail(job.gpu ? "GPU" : "", `#${job.id}`)}
          styles={styles}
        />
      </JobRow>
    </View>
  );
}

function ParentToggle({
  id,
  count,
  collapsed,
  onToggle,
  theme,
  styles,
}: {
  id: number;
  count: number;
  collapsed: boolean;
  onToggle(id: number): void;
  theme: Theme;
  styles: Styles;
}) {
  const toggle = useCallback(() => onToggle(id), [onToggle, id]);
  const a11yState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={a11yState}
      accessibilityLabel={`${collapsed ? "Show" : "Hide"} ${count} jobs that wait for this job`}
      onPress={toggle}
      style={styles.parentToggle}
    >
      <Text style={styles.parentCount}>{count}</Text>
      <Icon
        name={collapsed ? "ChevronRight" : "ChevronDown"}
        size={14}
        color={theme.colors.foregroundMuted}
      />
    </Pressable>
  );
}

function RunningDetail({ job, styles }: { job: QueuedJob; styles: Styles }) {
  const used = limitUsed(job);
  const nearLimit = used !== null && used >= NEAR_LIMIT;
  const time = job.limitSec
    ? `${duration(job.elapsedSec)} of ${duration(job.limitSec)}`
    : duration(job.elapsedSec);
  const fillStyle = useMemo(
    () => ({
      ...(nearLimit ? styles.progressFillWarning : styles.progressFill),
      width: `${Math.round((used ?? 0) * 100)}%` as const,
    }),
    [nearLimit, used, styles.progressFill, styles.progressFillWarning],
  );
  return (
    <>
      <Text style={styles.meta} numberOfLines={1}>
        <Text style={nearLimit ? styles.tone.warning : undefined}>{time}</Text>
        {metaTail(job.node, job.gpu ? "GPU" : "", `#${job.id}`)}
      </Text>
      {used !== null ? (
        <View style={styles.progressTrack}>
          <View style={fillStyle} />
        </View>
      ) : null}
      {job.lastLine ? (
        <Text style={styles.lastLine} numberOfLines={1}>
          {job.lastLine}
        </Text>
      ) : null}
    </>
  );
}

function metaTail(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .map((part) => ` · ${part}`)
    .join("");
}

function Meta({ status, detail, styles }: { status: JobStatus; detail: string; styles: Styles }) {
  return (
    <Text style={styles.meta} numberOfLines={1}>
      {/* The leading icon already shows success; color is kept for states that need action. */}
      <Text style={status.tone === "success" ? undefined : styles.tone[status.tone]}>
        {status.label}
      </Text>
      {detail}
    </Text>
  );
}

interface ParentProps {
  /** Queued jobs that wait on this one; the row shows a toggle for them when above zero. */
  descendants?: number;
  collapsed?: boolean;
  onToggleParent?(id: number): void;
}

interface JobRowProps extends ParentProps {
  id: number;
  name: string;
  hasLog: boolean;
  icon: string;
  iconColor: string;
  spinning?: boolean;
  sshHost: string;
  logPattern: string;
  open: boolean;
  onToggle(id: number): void;
  theme: Theme;
  styles: Styles;
  children: ReactNode;
}

function JobRow({
  id,
  name,
  hasLog,
  icon,
  iconColor,
  spinning = false,
  descendants = 0,
  collapsed = true,
  onToggleParent,
  sshHost,
  logPattern,
  open,
  onToggle,
  theme,
  styles,
  children,
}: JobRowProps) {
  const toggle = useCallback(() => onToggle(id), [onToggle, id]);
  const a11yState = useMemo(() => ({ expanded: open, disabled: !hasLog }), [open, hasLog]);
  return (
    <View style={open ? styles.cardOpen : undefined}>
      <View style={styles.rowLine}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={a11yState}
          accessibilityLabel={`Job ${name}${hasLog ? ", show log" : ""}`}
          disabled={!hasLog}
          onPress={toggle}
          style={styles.rowMain}
        >
          <View style={styles.leading}>
            {spinning ? (
              <Spinner size={14} color={iconColor} />
            ) : (
              <Icon name={icon} size={14} color={iconColor} />
            )}
          </View>
          <View style={styles.rowContent}>
            <Text style={styles.title} numberOfLines={1}>
              {name}
            </Text>
            {children}
          </View>
          {hasLog ? (
            <Icon
              name={open ? "ChevronDown" : "ChevronRight"}
              size={14}
              color={theme.colors.foregroundMuted}
            />
          ) : null}
        </Pressable>
        {/* Beside the row button, not inside it: web cannot nest buttons. */}
        {descendants && onToggleParent ? (
          <ParentToggle
            id={id}
            count={descendants}
            collapsed={collapsed}
            onToggle={onToggleParent}
            theme={theme}
            styles={styles}
          />
        ) : null}
      </View>
      {open ? (
        <JobLog sshHost={sshHost} logPattern={logPattern} jobId={id} name={name} styles={styles} />
      ) : null}
    </View>
  );
}

function JobLog({
  sshHost,
  logPattern,
  jobId,
  name,
  styles,
}: {
  sshHost: string;
  logPattern: string;
  jobId: number;
  name: string;
  styles: Styles;
}) {
  const readLog = useRpc(jobLogRpc);
  const query = useQuery({
    queryKey: ["lab.jobs.log", sshHost, jobId],
    queryFn: () => readLog({ sshHost, logPattern, jobId, name }),
    refetchInterval: LOG_REFRESH_MS,
  });
  const scroller = useRef<NativeScrollView>(null);
  const toEnd = useCallback(() => scroller.current?.scrollToEnd({ animated: false }), []);
  let body: ReactNode;
  if (query.error) body = <Text style={styles.error}>{query.error.message}</Text>;
  else if (!query.data) body = <Text style={styles.meta}>Reading log...</Text>;
  else {
    body = (
      <>
        <Text style={styles.meta} numberOfLines={1}>
          {query.data.path}
        </Text>
        <ScrollView ref={scroller} style={styles.logBox} onContentSizeChange={toEnd}>
          {/* Log lines keep their width; wrapping breaks progress bars and tables. */}
          <ScrollView horizontal>
            <Text style={styles.logText} selectable>
              {query.data.lines.join("\n") || "Empty log"}
            </Text>
          </ScrollView>
        </ScrollView>
      </>
    );
  }
  return <View style={styles.details}>{body}</View>;
}

function toneColor(theme: Theme, tone: Tone): string {
  const { colors } = theme;
  return {
    danger: colors.statusDanger,
    warning: colors.statusWarning,
    success: colors.statusSuccess,
    muted: colors.foregroundMuted,
  }[tone];
}

function createStyles(theme: Theme) {
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
  const progressFill = { height: 2, borderRadius: 1, backgroundColor: colors.accent };
  const mono = Platform.select({ ios: "Menlo", default: "monospace" });
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
    headerActions: { flexDirection: "row" as const, gap: 4 },
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
    rowLine: { flexDirection: "row" as const, alignItems: "flex-start" as const },
    rowMain: { ...row, flex: 1 },
    parentToggle: {
      flexDirection: "row" as const,
      alignItems: "center" as const,
      gap: 2,
      paddingVertical: 8,
      paddingRight: 8,
      paddingLeft: 4,
      borderRadius: 6,
    },
    parentCount: { color: colors.foregroundMuted, fontSize: 12 },
    cardOpen: { borderRadius: 8, backgroundColor: colors.surface1 },
    rail: { borderLeftWidth: 1, borderLeftColor: colors.border, paddingLeft: 4 },
    // Optical: lifts the icon onto the title's first line.
    leading: { paddingTop: 2 },
    rowContent: { flex: 1, minWidth: 0, gap: 4 },
    title: { color: colors.foreground, fontSize: 14 },
    meta: { color: colors.foregroundMuted, fontSize: 12 },
    tone: {
      danger: { color: colors.statusDanger },
      warning: { color: colors.statusWarning },
      success: { color: colors.statusSuccess },
      muted: { color: colors.foregroundMuted },
    } satisfies Record<Tone, object>,
    progressTrack: { height: 2, borderRadius: 1, backgroundColor: colors.surface2 },
    progressFill,
    progressFillWarning: { ...progressFill, backgroundColor: colors.statusWarning },
    lastLine: { color: colors.foregroundMuted, fontSize: 12, fontFamily: mono },
    details: { gap: 6, paddingLeft: 30, paddingRight: 8, paddingTop: 4, paddingBottom: 12 },
    logBox: { maxHeight: 320, borderRadius: 6, backgroundColor: colors.surface0, padding: 8 },
    logText: { color: colors.foreground, fontSize: 12, fontFamily: mono },
    empty: { color: colors.foregroundMuted, fontSize: 14, paddingHorizontal: 8 },
    error: { color: colors.statusDanger, fontSize: 12, paddingHorizontal: 8 },
  };
}
