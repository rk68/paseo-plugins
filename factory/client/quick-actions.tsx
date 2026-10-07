import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  markReadyRpc,
  openBranchRpc,
  retargetToTrunkRpc,
  squashMergeRpc,
  startTaskRpc,
  type TaskKind,
  updateBranchRpc,
} from "../shared/actions";
import { type PrAction, prActions } from "../shared/pr-signals";
import type { Pr } from "../shared/pr-stack";
import { usePanel } from "./panel-context";

const ACTION_ICON: Record<PrAction, string> = {
  retarget: "GitCompareArrows",
  update: "GitPullRequestArrow",
  conflicts: "GitMerge",
  ci: "Wrench",
  comments: "MessageSquareText",
  ready: "GitPullRequest",
  merge: "GitMerge",
  checkout: "GitBranch",
  "open-agent": "Bot",
};

const PENDING_LABEL: Record<PrAction, string> = {
  retarget: "Changing base...",
  update: "Updating...",
  conflicts: "Starting...",
  ci: "Starting...",
  comments: "Starting...",
  ready: "Marking ready...",
  merge: "Merging...",
  checkout: "Opening...",
  "open-agent": "Opening...",
};
// A merge cannot be undone, so it takes a second press within this window.
const CONFIRM_MS = 4_000;
const RECHECK_MS = 5_000;

function actionLabel(action: PrAction, pr: Pr, confirmingMerge: boolean): string {
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
      return confirmingMerge ? "Confirm squash and merge" : "Squash and merge";
    case "checkout":
      return pr.worktree ? "Open worktree" : "Check out";
    case "open-agent":
      return "Open agent";
  }
}

/** The next steps a PR needs, one click each, visible without expanding the row. */
export function QuickActions({ pr }: { pr: Pr }) {
  const { directory, openAgent, openWorkspace, refresh, styles } = usePanel();
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
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  useEffect(() => {
    if (!confirmingMerge) return;
    const timer = setTimeout(() => setConfirmingMerge(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [confirmingMerge]);

  let pending: PrAction | null = null;
  if (retarget.isPending) pending = "retarget";
  else if (update.isPending) pending = "update";
  else if (checkout.isPending) pending = "checkout";
  else if (ready.isPending) pending = "ready";
  else if (merge.isPending) pending = "merge";
  else if (task.isPending) pending = task.variables ?? null;
  const agentId = task.data?.agentId ?? pr.task?.agentId;

  const run = useCallback(
    (action: PrAction) => {
      if (action !== "merge") setConfirmingMerge(false);
      if (action === "retarget") retarget.mutate();
      else if (action === "update") update.mutate();
      else if (action === "checkout") checkout.mutate();
      else if (action === "ready") ready.mutate();
      else if (action === "merge") {
        if (confirmingMerge) merge.mutate();
        setConfirmingMerge(!confirmingMerge);
      } else if (action === "open-agent") {
        if (agentId) openAgent?.(agentId);
      } else task.mutate(action);
    },
    [retarget, update, task, checkout, ready, merge, confirmingMerge, agentId, openAgent],
  );

  const actions = prActions(pr).filter((action) => action !== "open-agent" || openAgent);
  if (!actions.length) return null;
  const error =
    retarget.error ?? update.error ?? task.error ?? checkout.error ?? ready.error ?? merge.error;
  return (
    <View style={styles.quickActions}>
      <View style={styles.actions}>
        {actions.map((action) => (
          <ActionChip
            key={action}
            action={action}
            label={
              pending === action ? PENDING_LABEL[action] : actionLabel(action, pr, confirmingMerge)
            }
            disabled={pending !== null && action !== "open-agent"}
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
