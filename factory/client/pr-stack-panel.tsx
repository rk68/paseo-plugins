import {
  openExternalUrl,
  type PluginWorkspacePanelProps,
  useRpc,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { byUrgency, checkCounts, prSignals, prTone, type Tone } from "../shared/pr-signals";
import { type Check, type Pr, type PrGroup, prStackRpc } from "../shared/pr-stack";
import { type PanelContextValue, PanelProvider, usePanel } from "./panel-context";
import { AutoResolveToggle, PrActions } from "./pr-actions";
import { Spinner } from "./spinner";
import { createStyles, toneColor } from "./styles";

const REFRESH_MS = 60_000;
// The rail runs under the center of the parent row's 14px status icon.
const RAIL_OFFSET = 14;
const RAIL_STEP = 22;

const TONE_ICON: Record<Tone, string> = {
  danger: "CircleX",
  warning: "CircleDot",
  success: "CircleCheck",
  muted: "CircleDashed",
};
const CHECK_ICON: Record<Check["state"], { icon: string; tone: Tone }> = {
  fail: { icon: "CircleX", tone: "danger" },
  pending: { icon: "CircleDot", tone: "warning" },
  pass: { icon: "CircleCheck", tone: "success" },
  skipped: { icon: "CircleSlash", tone: "muted" },
};

export function PrStackPanel({ theme, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const directory = useWorkspace(workspaceId, (workspace) => workspace.directory);
  const listPrStack = useRpc(prStackRpc);
  const query = useQuery({
    queryKey: ["factory.prStack", directory],
    queryFn: () => listPrStack({ directory: directory ?? "" }),
    enabled: directory !== null,
    refetchInterval: REFRESH_MS,
  });
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const toggle = useCallback(
    (number: number) => setExpanded((current) => (current === number ? null : number)),
    [],
  );
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigateToAgent = navigation?.openAgent;
  const panel = useMemo<PanelContextValue>(
    () => ({
      theme,
      styles,
      directory: directory ?? "",
      openAgent: navigateToAgent ? (agentId) => navigateToAgent({ agentId }) : undefined,
      refresh,
    }),
    [theme, styles, directory, navigateToAgent, refresh],
  );
  const summary = useMemo(() => summarize(query.data?.groups ?? []), [query.data]);
  let headerText = " ";
  if (query.data) headerText = summary;
  else if (query.isPending) headerText = "Loading...";

  return (
    <PanelProvider value={panel}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.headerText} numberOfLines={1}>
            {headerText}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Refresh pull requests"
            onPress={refresh}
            disabled={query.isFetching}
            style={query.isFetching ? styles.iconButtonBusy : styles.iconButton}
          >
            <Icon name="RefreshCw" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        </View>
        {directory ? <AutoResolveToggle /> : null}
        {query.error ? <Text style={styles.errorBlock}>{query.error.message}</Text> : null}
        {query.data?.warnings.map((warning) => (
          <Text key={warning} style={styles.notice}>
            {warning}
          </Text>
        ))}
        {query.data?.groups.length === 0 ? (
          <Text style={styles.empty}>No open pull requests</Text>
        ) : null}
        {query.data?.groups.map((group) => (
          <Group
            key={`${group.kind}-${group.prs[0]?.number}`}
            group={group}
            trunk={query.data.trunk}
            expanded={expanded}
            onToggle={toggle}
          />
        ))}
      </ScrollView>
    </PanelProvider>
  );
}

function summarize(groups: PrGroup[]): string {
  const prs = groups.flatMap((group) => group.prs);
  const tones = prs.map(prTone);
  const parts = [`${prs.length} open`];
  const attention = tones.filter((tone) => tone === "danger" || tone === "warning").length;
  const ready = tones.filter((tone) => tone === "success").length;
  if (attention) parts.push(`${attention} need attention`);
  if (ready) parts.push(`${ready} ready`);
  return parts.join(" · ");
}

const GROUP_TITLE: Record<PrGroup["kind"], string> = {
  wrong_base: "Wrong base",
  stack: "Stack · merge top down",
  independent: "Independent",
};

function Group({
  group,
  trunk,
  expanded,
  onToggle,
}: {
  group: PrGroup;
  trunk: string;
  expanded: number | null;
  onToggle(number: number): void;
}) {
  const { styles } = usePanel();
  const prs = useMemo(
    () => (group.kind === "independent" ? [...group.prs].sort(byUrgency) : group.prs),
    [group],
  );
  return (
    <View style={styles.group}>
      <Text style={styles.groupTitle}>
        {group.kind === "independent"
          ? `${GROUP_TITLE.independent} · into ${trunk}`
          : GROUP_TITLE[group.kind]}
      </Text>
      {prs.map((pr) => (
        <PrRow
          key={pr.number}
          pr={pr}
          retargetTo={group.kind === "wrong_base" && pr.depth === 0 ? trunk : null}
          open={expanded === pr.number}
          onToggle={onToggle}
        />
      ))}
    </View>
  );
}

function PrRow({
  pr,
  retargetTo,
  open,
  onToggle,
}: {
  pr: Pr;
  retargetTo: string | null;
  open: boolean;
  onToggle(number: number): void;
}) {
  const { theme, styles } = usePanel();
  const toggle = useCallback(() => onToggle(pr.number), [onToggle, pr.number]);
  const signals = useMemo(() => {
    const list = prSignals(pr);
    return retargetTo
      ? [{ tone: "danger" as const, label: `Base ${pr.base} has no open PR` }, ...list]
      : list;
  }, [pr, retargetTo]);
  const [lead, ...rest] = signals;
  const a11yState = useMemo(() => ({ expanded: open }), [open]);
  const tone = lead?.tone ?? "muted";
  const railStyle = useMemo(
    () =>
      pr.depth
        ? { ...styles.rail, marginLeft: RAIL_OFFSET + (pr.depth - 1) * RAIL_STEP }
        : undefined,
    [styles.rail, pr.depth],
  );

  return (
    <View style={railStyle}>
      <View style={open ? styles.cardOpen : undefined}>
        <Pressable
          accessibilityRole="button"
          accessibilityState={a11yState}
          accessibilityLabel={`Pull request ${pr.number}, ${lead?.label ?? "open"}`}
          onPress={toggle}
          style={styles.row}
        >
          <View style={styles.leading}>
            {lead?.busy ? (
              <Spinner size={14} color={theme.colors.accent} />
            ) : (
              <Icon name={TONE_ICON[tone]} size={14} color={toneColor(theme, tone)} />
            )}
          </View>
          <View style={styles.rowContent}>
            <Text style={styles.title} numberOfLines={open ? undefined : 1}>
              <Text style={styles.number}>{`#${pr.number} `}</Text>
              {pr.title}
            </Text>
            <Text style={styles.meta} numberOfLines={open ? undefined : 1}>
              <Text style={styles.tone[tone]}>{lead?.label ?? "Open"}</Text>
              {rest.length ? ` · ${rest.map((signal) => signal.label).join(" · ")}` : ""}
            </Text>
          </View>
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
        </Pressable>
        {open ? <PrDetails pr={pr} retargetTo={retargetTo} /> : null}
      </View>
    </View>
  );
}

function PrDetails({ pr, retargetTo }: { pr: Pr; retargetTo: string | null }) {
  const { theme, styles } = usePanel();
  const { passed, skipped } = checkCounts(pr);
  const attention = pr.checks.filter(
    (check) => check.state === "fail" || check.state === "pending",
  );
  const retarget = retargetTo ? `gh pr edit ${pr.number} --base ${retargetTo}` : null;
  const copyRetarget = useCallback(() => {
    if (retarget) void copyText(retarget);
  }, [retarget]);
  return (
    <View style={styles.details}>
      <Text style={styles.branch} numberOfLines={1}>{`${pr.head} → ${pr.base}`}</Text>
      {attention.map((check) => (
        <CheckRow key={`${check.name}-${check.url}`} check={check} />
      ))}
      {pr.checks.length ? (
        <Text style={styles.meta}>
          {[passed && `${passed} passed`, skipped && `${skipped} skipped`]
            .filter(Boolean)
            .join(" · ") || "No passed checks"}
        </Text>
      ) : (
        <Text style={styles.meta}>No checks reported</Text>
      )}
      {retarget ? (
        <Pressable accessibilityRole="button" onPress={copyRetarget} style={styles.command}>
          <Text style={styles.code} numberOfLines={1}>
            {retarget}
          </Text>
          <Icon name="Copy" size={12} color={theme.colors.foregroundMuted} />
        </Pressable>
      ) : null}
      <PrActions pr={pr} />
      <ExternalLink href={pr.url}>Open on GitHub</ExternalLink>
    </View>
  );
}

function CheckRow({ check }: { check: Check }) {
  const { theme, styles } = usePanel();
  const { url } = check;
  const open = useCallback(() => {
    if (url) void openExternalUrl(url);
  }, [url]);
  const { icon, tone } = CHECK_ICON[check.state];
  return (
    <Pressable accessibilityRole="link" disabled={!url} onPress={open} style={styles.checkRow}>
      <Icon name={icon} size={12} color={toneColor(theme, tone)} />
      <Text style={styles.checkName} numberOfLines={1}>
        {check.name}
      </Text>
    </Pressable>
  );
}
