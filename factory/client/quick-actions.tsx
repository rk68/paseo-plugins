import { useRpc } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { openBranchRpc, startTaskRpc, type TaskKind, updateBranchRpc } from "../shared/actions";
import { type PrAction, prActions } from "../shared/pr-signals";
import type { Pr } from "../shared/pr-stack";
import { usePanel } from "./panel-context";

const ACTION_ICON: Record<PrAction, string> = {
  update: "GitPullRequestArrow",
  conflicts: "GitMerge",
  ci: "Wrench",
  comments: "MessageSquareText",
  checkout: "GitBranch",
  "open-agent": "Bot",
};

function actionLabel(action: PrAction, pr: Pr): string {
  switch (action) {
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
    case "checkout":
      return pr.worktree ? "Open worktree" : "Check out";
    case "open-agent":
      return "Open agent";
  }
}

/** The fixes a PR needs, one click each, visible without expanding the row. */
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
  const busy = update.isPending || task.isPending || checkout.isPending;
  const agentId = task.data?.agentId ?? pr.task?.agentId;

  const run = useCallback(
    (action: PrAction) => {
      if (action === "update") update.mutate();
      else if (action === "checkout") checkout.mutate();
      else if (action === "open-agent") {
        if (agentId) openAgent?.(agentId);
      } else task.mutate(action);
    },
    [update, task, checkout, agentId, openAgent],
  );

  const actions = prActions(pr).filter((action) => action !== "open-agent" || openAgent);
  if (!actions.length) return null;
  const error = update.error ?? task.error ?? checkout.error;
  return (
    <View style={styles.quickActions}>
      <View style={styles.actions}>
        {actions.map((action) => (
          <ActionChip
            key={action}
            action={action}
            label={
              pendingLabel(
                action,
                update.isPending,
                checkout.isPending,
                task.variables,
                task.isPending,
              ) ?? actionLabel(action, pr)
            }
            disabled={busy && action !== "open-agent"}
            onRun={run}
          />
        ))}
      </View>
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
    </View>
  );
}

function pendingLabel(
  action: PrAction,
  updating: boolean,
  checkingOut: boolean,
  startingKind: TaskKind | undefined,
  starting: boolean,
): string | null {
  if (action === "update" && updating) return "Updating...";
  if (action === "checkout" && checkingOut) return "Opening...";
  if (starting && action === startingKind) return "Starting...";
  return null;
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
