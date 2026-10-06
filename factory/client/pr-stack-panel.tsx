import {
  openExternalUrl,
  type PluginWorkspacePanelProps,
  useRpc,
  useSettings,
  useWorkspace,
} from "@getpaseo/plugin/client";
import { copyText, Icon, ScrollView } from "@getpaseo/plugin/client/react-native";
import { ExternalLink } from "@getpaseo/plugin/client/ui";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { factorySettings } from "../shared/actions";
import { age, orderGroups, type PrSort } from "../shared/order";
import { checkCounts, prSignals, prTone, type Tone } from "../shared/pr-signals";
import { type Check, type Pr, type PrGroup, prStackRpc } from "../shared/pr-stack";
import { type PanelContextValue, PanelProvider, usePanel } from "./panel-context";
import { AutomationView } from "./automation-view";
import { QuickActions } from "./quick-actions";
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

type PrStackData = NonNullable<ReturnType<typeof usePrStack>["data"]>;

function usePrStack(directory: string | null, scope: "branch" | "all") {
  const listPrStack = useRpc(prStackRpc);
  return useQuery({
    queryKey: ["factory.prStack", directory, scope],
    queryFn: () => listPrStack({ directory: directory ?? "", scope }),
    enabled: directory !== null,
    refetchInterval: REFRESH_MS,
  });
}

function useSort() {
  const settings = useSettings(factorySettings);
  const ready = settings.status === "ready" ? settings : null;
  const sort: PrSort = ready?.values.sort ?? "urgency";
  const toggleSort = useCallback(() => {
    if (!ready) return;
    void ready.save(
      { ...ready.values, sort: ready.values.sort === "newest" ? "urgency" : "newest" },
      ready.revision,
    );
  }, [ready]);
  return { sort, toggleSort, canSort: ready !== null };
}

export function PrStackPanel({ theme, workspaceId, navigation }: PluginWorkspacePanelProps) {
  const workspace = useWorkspace(workspaceId, ({ directory, projectRootPath }) => ({
    directory,
    projectRootPath,
  }));
  const directory = workspace?.directory ?? null;
  const projectRoot = workspace?.projectRootPath ?? directory ?? "";
  const [scope, setScope] = useState<"branch" | "all">("branch");
  const toggleScope = useCallback(
    () => setScope((current) => (current === "branch" ? "all" : "branch")),
    [],
  );
  const query = usePrStack(directory, scope);
  const { refetch } = query;
  const refresh = useCallback(() => void refetch(), [refetch]);
  const { sort, toggleSort, canSort } = useSort();
  const ageAt = sort === "newest" ? query.dataUpdatedAt : null;
  const [view, setView] = useState<"list" | "automation">("list");
  const showAutomation = useCallback(() => setView("automation"), []);
  const showList = useCallback(() => setView("list"), []);
  const styles = useMemo(() => createStyles(theme), [theme]);
  const navigateToAgent = navigation?.openAgent;
  const navigateToWorkspace = navigation?.openWorkspace;
  const panel = useMemo<PanelContextValue>(
    () => ({
      theme,
      styles,
      directory: directory ?? "",
      projectRoot,
      openAgent: navigateToAgent ? (agentId) => navigateToAgent({ agentId }) : undefined,
      openWorkspace: navigateToWorkspace
        ? (target) => navigateToWorkspace({ workspaceId: target })
        : undefined,
      refresh,
      ageAt,
    }),
    [theme, styles, directory, projectRoot, navigateToAgent, navigateToWorkspace, refresh, ageAt],
  );
  let summary = " ";
  if (query.data) summary = summarize(query.data.groups);
  else if (query.isPending) summary = "Loading...";

  return (
    <PanelProvider value={panel}>
      <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
        {view === "automation" ? (
          <AutomationView onBack={showList} />
        ) : (
          <>
            <PanelHeader
              summary={summary}
              sort={sort}
              canSort={canSort}
              onToggleSort={toggleSort}
              onShowAutomation={directory ? showAutomation : null}
              onRefresh={refresh}
              fetching={query.isFetching}
            />
            {query.error ? <Text style={styles.errorBlock}>{query.error.message}</Text> : null}
            {query.data ? (
              <PrList data={query.data} sort={sort} onToggleScope={toggleScope} />
            ) : null}
          </>
        )}
      </ScrollView>
    </PanelProvider>
  );
}

function PanelHeader({
  summary,
  sort,
  canSort,
  onToggleSort,
  onShowAutomation,
  onRefresh,
  fetching,
}: {
  summary: string;
  sort: PrSort;
  canSort: boolean;
  onToggleSort(): void;
  onShowAutomation: (() => void) | null;
  onRefresh(): void;
  fetching: boolean;
}) {
  const { styles, theme } = usePanel();
  return (
    <View style={styles.header}>
      <Text style={styles.headerText} numberOfLines={1}>
        {summary}
      </Text>
      <View style={styles.headerActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Sorted by ${sort === "newest" ? "newest" : "urgency"}. Change sort`}
          onPress={onToggleSort}
          disabled={!canSort}
          style={styles.sortButton}
        >
          <Icon name="ArrowDownUp" size={12} color={theme.colors.foregroundMuted} />
          <Text style={styles.headerText}>{sort === "newest" ? "Newest" : "Urgent"}</Text>
        </Pressable>
        {onShowAutomation ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Automation settings"
            onPress={onShowAutomation}
            style={styles.iconButton}
          >
            <Icon name="Settings" size={14} color={theme.colors.foregroundMuted} />
          </Pressable>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Refresh pull requests"
          onPress={onRefresh}
          disabled={fetching}
          style={fetching ? styles.iconButtonBusy : styles.iconButton}
        >
          <Icon name="RefreshCw" size={14} color={theme.colors.foregroundMuted} />
        </Pressable>
      </View>
    </View>
  );
}

function PrList({
  data,
  sort,
  onToggleScope,
}: {
  data: PrStackData;
  sort: PrSort;
  onToggleScope(): void;
}) {
  const { styles } = usePanel();
  const groups = useMemo(() => orderGroups(data.groups, sort), [data.groups, sort]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const toggle = useCallback(
    (number: number) => setExpanded((current) => (current === number ? null : number)),
    [],
  );
  return (
    <>
      {data.branch ? <ScopeLine data={data} onToggleScope={onToggleScope} /> : null}
      {data.warnings.map((warning) => (
        <Text key={warning} style={styles.notice}>
          {warning}
        </Text>
      ))}
      {groups.length === 0 ? (
        <Text style={styles.empty}>
          {data.filtered ? "No open PRs for this branch" : "No open pull requests"}
        </Text>
      ) : null}
      {groups.map((group) => (
        <Group
          key={`${group.kind}-${group.prs[0]?.number}`}
          group={group}
          trunk={data.trunk}
          expanded={expanded}
          onToggle={toggle}
        />
      ))}
    </>
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
  stack: "Stack",
  independent: "Independent",
};

function ScopeLine({ data, onToggleScope }: { data: PrStackData; onToggleScope(): void }) {
  const { styles } = usePanel();
  if (data.fallback) {
    return (
      <Text style={styles.scopeLine} numberOfLines={1}>
        {`No PRs for ${data.branch} yet. Showing all`}
      </Text>
    );
  }
  return (
    <Text style={styles.scopeLine} numberOfLines={1}>
      {data.filtered ? `PRs for ${data.branch}` : "All your PRs"}
      <Text style={styles.link} onPress={onToggleScope}>
        {data.filtered ? "  Show all" : `  Only ${data.branch}`}
      </Text>
    </Text>
  );
}

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
  let title = GROUP_TITLE[group.kind];
  if (group.kind === "independent") title = `${title} · into ${trunk}`;
  if (group.kind === "stack") title = `Stack of ${group.prs.length} · merge top down`;
  return (
    <View style={group.kind === "stack" ? styles.stackGroup : styles.group}>
      <Text style={group.kind === "stack" ? styles.stackTitle : styles.groupTitle}>{title}</Text>
      {group.prs.map((pr) => (
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
  const { theme, styles, ageAt } = usePanel();
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
              {[ageAt ? age(pr.createdAt, ageAt) : "", ...rest.map((signal) => signal.label)]
                .filter(Boolean)
                .map((label) => ` · ${label}`)
                .join("")}
            </Text>
          </View>
          <Icon
            name={open ? "ChevronDown" : "ChevronRight"}
            size={14}
            color={theme.colors.foregroundMuted}
          />
        </Pressable>
        {/* Outside the row button: web cannot nest buttons. */}
        <QuickActions pr={pr} />
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
