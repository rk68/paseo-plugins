import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import {
  archiveTasksRpc,
  closePrRpc,
  disableAutoMergeRpc,
  enableAutoMergeRpc,
  markReadyRpc,
  openBranchRpc,
  retargetToTrunkRpc,
  squashMergeRpc,
  startTaskRpc,
  TASK_KINDS,
  type TaskKind,
  updateBranchRpc,
} from "../shared/actions";
import { type PrAction, prActions } from "../shared/pr-signals";
import type { Pr } from "../shared/pr-stack";
import { usePanel } from "./panel-context";
import { pressRowAction, type RowAction, rowActionEnabled } from "./row-actions";
import { useArmed } from "./use-armed";

const ACTION_ICON: Record<PrAction, string> = {
  retarget: "GitCompareArrows",
  update: "GitPullRequestArrow",
  conflicts: "GitMerge",
  ci: "Wrench",
  comments: "MessageSquareText",
  ready: "GitPullRequest",
  merge: "GitMerge",
  "auto-merge": "Clock",
  "cancel-auto-merge": "X",
  checkout: "GitBranch",
  "open-agent": "Bot",
  "archive-task": "Archive",
};

const PENDING_LABEL: Record<PrAction, string> = {
  retarget: "Changing base...",
  update: "Updating...",
  conflicts: "Starting...",
  ci: "Starting...",
  comments: "Starting...",
  ready: "Marking ready...",
  merge: "Merging...",
  "auto-merge": "Turning on...",
  "cancel-auto-merge": "Turning off...",
  checkout: "Opening...",
  "open-agent": "Opening...",
  "archive-task": "Archiving...",
};
const RECHECK_MS = 5_000;

function isTaskKind(action: RowAction): action is TaskKind {
  return TASK_KINDS.some((kind) => kind === action);
}

function actionLabel(action: PrAction, pr: Pr, armed: RowAction | null): string {
  switch (action) {
    case "retarget":
      return `Change base to ${pr.retargetTo}`;
    case "update":
      return "Update branch";
    case "conflicts":
      return "Resolve conflicts";
    case "ci":
      return "Fix CI";
    case "comments":
      return pr.threads
        ? `Address ${pr.threads} ${pr.threads === 1 ? "comment" : "comments"}`
        : "Address review";
    case "ready":
      return "Mark ready";
    case "merge":
      return armed === "merge" ? "Confirm squash and merge" : "Squash and merge";
    case "auto-merge":
      return armed === "auto-merge" ? "Confirm auto-merge" : "Auto-merge when green";
    case "cancel-auto-merge":
      return "Cancel auto-merge";
    case "checkout":
      return pr.worktree ? "Open worktree" : "Check out";
    case "open-agent":
      return "Open agent";
    case "archive-task":
      return "Archive agent";
  }
}

/** The state and runner of every action on one PR row; the chips and the details share it. */
export function useRowActions(pr: Pr) {
  const { directory, openAgent, openWorkspace, refresh } = usePanel();
  const updateBranch = useRpc(updateBranchRpc);
  const startTask = useRpc(startTaskRpc);
  const update = useMutation({
    mutationFn: () => updateBranch({ directory, number: pr.number }),
    onSuccess: refresh,
  });
  const task = useMutation({
    mutationFn: (kind: TaskKind) => startTask({ directory, number: pr.number, kind }),
    onSuccess: refresh,
  });
  const openBranch = useRpc(openBranchRpc);
  const checkout = useMutation({
    mutationFn: () => openBranch({ directory, number: pr.number }),
    onSuccess: ({ workspaceId }) => {
      openWorkspace?.(workspaceId);
      refresh();
    },
  });
  const retargetToTrunk = useRpc(retargetToTrunkRpc);
  const retarget = useMutation({
    mutationFn: () => retargetToTrunk({ directory, number: pr.number }),
    onSuccess: () => {
      refresh();
      // GitHub computes conflicts after a base change, so the first refresh can miss them.
      setTimeout(refresh, RECHECK_MS);
    },
  });
  const archiveTasks = useRpc(archiveTasksRpc);
  const archive = useMutation({
    mutationFn: () => archiveTasks({ directory, number: pr.number }),
    onSuccess: refresh,
  });
  const markReady = useRpc(markReadyRpc);
  const ready = useMutation({
    mutationFn: () => markReady({ directory, number: pr.number }),
    onSuccess: refresh,
  });
  const squashMerge = useRpc(squashMergeRpc);
  const merge = useMutation({
    mutationFn: () => squashMerge({ directory, number: pr.number, headOid: pr.headOid }),
    onSuccess: refresh,
  });
  const enableAutoMerge = useRpc(enableAutoMergeRpc);
  const autoMerge = useMutation({
    mutationFn: () => enableAutoMerge({ directory, number: pr.number, headOid: pr.headOid }),
    onSuccess: refresh,
  });
  const disableAutoMerge = useRpc(disableAutoMergeRpc);
  const cancelAutoMerge = useMutation({
    mutationFn: () => disableAutoMerge({ directory, number: pr.number }),
    onSuccess: refresh,
  });
  const closePr = useRpc(closePrRpc);
  const close = useMutation({
    mutationFn: () => closePr({ directory, number: pr.number }),
    onSuccess: refresh,
  });
  const [armed, setArmed] = useArmed<RowAction>();

  const mutations: [
    Exclude<RowAction, TaskKind | "open-agent">,
    { isPending: boolean; error: Error | null; mutate(): void },
  ][] = [
    ["retarget", retarget],
    ["update", update],
    ["checkout", checkout],
    ["ready", ready],
    ["merge", merge],
    ["auto-merge", autoMerge],
    ["cancel-auto-merge", cancelAutoMerge],
    ["close", close],
    ["archive-task", archive],
  ];
  const pending: RowAction | null =
    mutations.find(([, mutation]) => mutation.isPending)?.[0] ??
    (task.isPending ? (task.variables ?? null) : null);
  const agentId = task.data?.agentId ?? pr.task?.agentId;

  const run = (action: RowAction) => {
    if (!rowActionEnabled(pending, action)) return;
    const next = pressRowAction(armed, action);
    setArmed(next.armed);
    if (!next.fire) return;
    if (action === "open-agent") {
      if (agentId) openAgent?.(agentId);
    } else if (isTaskKind(action)) task.mutate(action);
    else mutations.find(([key]) => key === action)?.[1].mutate();
  };

  const error = task.error ?? mutations.find(([, mutation]) => mutation.error)?.[1].error ?? null;
  return { armed, pending, run, error, canOpenAgent: openAgent !== undefined };
}

export type RowActions = ReturnType<typeof useRowActions>;

/** The next steps a PR needs, one click each, visible without expanding the row. */
export function QuickActions({ pr, actions }: { pr: Pr; actions: RowActions }) {
  const { styles } = usePanel();
  const { armed, pending, run, error, canOpenAgent } = actions;
  const chips = prActions(pr).filter((action) => action !== "open-agent" || canOpenAgent);
  if (!chips.length && !error) return null;
  return (
    <View style={styles.quickActions}>
      <View style={styles.actions}>
        {chips.map((action) => (
          <ActionChip
            key={action}
            action={action}
            label={pending === action ? PENDING_LABEL[action] : actionLabel(action, pr, armed)}
            disabled={!rowActionEnabled(pending, action)}
            onRun={run}
          />
        ))}
      </View>
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
    </View>
  );
}

function ActionChip({
  action,
  label,
  disabled,
  onRun,
}: {
  action: PrAction;
  label: string;
  disabled: boolean;
  onRun(action: PrAction): void;
}) {
  const { styles, theme } = usePanel();
  const press = useCallback(() => onRun(action), [onRun, action]);
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={press}
      style={disabled ? styles.buttonBusy : styles.button}
    >
      <Icon name={ACTION_ICON[action]} size={12} color={theme.colors.foregroundMuted} />
      <Text style={styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

/** Closes the PR without deleting its branch; PRs stacked on it then offer a base change. */
export function ClosePrButton({ actions }: { actions: RowActions }) {
  const { styles, theme } = usePanel();
  const { armed, pending, run } = actions;
  const press = useCallback(() => run("close"), [run]);
  const enabled = rowActionEnabled(pending, "close");
  let label = armed === "close" ? "Confirm close" : "Close PR";
  if (pending === "close") label = "Closing...";
  return (
    <View style={styles.actions}>
      <Pressable
        accessibilityRole="button"
        disabled={!enabled}
        onPress={press}
        style={enabled ? styles.button : styles.buttonBusy}
      >
        <Icon name="GitPullRequestClosed" size={12} color={theme.colors.foregroundMuted} />
        <Text style={styles.buttonText}>{label}</Text>
      </Pressable>
    </View>
  );
}
