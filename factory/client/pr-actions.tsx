import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import { factorySettings, resolveConflictsRpc, updateBranchRpc } from "../shared/actions";
import { isResolving } from "../shared/pr-signals";
import type { Pr } from "../shared/pr-stack";
import { usePanel } from "./panel-context";

const RESOLVER_STATUS: Record<string, string> = {
  initializing: "starting",
  running: "running",
  idle: "finished",
  error: "failed",
  closed: "closed",
};

/** Actions that move a PR towards a merge: update a stale branch, or hand conflicts to an agent. */
export function PrActions({ pr }: { pr: Pr }) {
  const { directory, openAgent, refresh, styles, theme } = usePanel();
  const updateBranch = useRpc(updateBranchRpc);
  const resolveConflicts = useRpc(resolveConflictsRpc);
  const update = useMutation({
    mutationFn: () => updateBranch({ directory, number: pr.number }),
    onSuccess: refresh,
  });
  const resolve = useMutation({
    mutationFn: () => resolveConflicts({ directory, number: pr.number }),
    onSuccess: refresh,
  });
  const resolving = isResolving(pr);
  const agentId = resolve.data?.agentId ?? pr.resolver?.agentId;
  const openResolver = useCallback(() => {
    if (agentId) openAgent?.(agentId);
  }, [agentId, openAgent]);
  const startUpdate = useCallback(() => update.mutate(), [update]);
  const startResolve = useCallback(() => resolve.mutate(), [resolve]);

  let resolveLabel = pr.resolver ? "Resolve again" : "Resolve conflicts";
  if (resolve.isPending) resolveLabel = "Starting...";
  const canUpdate = pr.merge === "behind";
  const canResolve = pr.merge === "conflicts" && !resolving;
  if (!canUpdate && !canResolve && !pr.resolver) return null;

  return (
    <>
      <View style={styles.actions}>
        {canUpdate ? (
          <Pressable
            accessibilityRole="button"
            disabled={update.isPending}
            onPress={startUpdate}
            style={update.isPending ? styles.buttonBusy : styles.button}
          >
            <Icon name="GitPullRequestArrow" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.buttonText}>
              {update.isPending ? "Updating..." : "Update branch"}
            </Text>
          </Pressable>
        ) : null}
        {canResolve ? (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Starts an Opus 5.5 agent in a new worktree"
            disabled={resolve.isPending}
            onPress={startResolve}
            style={resolve.isPending ? styles.buttonBusy : styles.button}
          >
            <Icon name="Bot" size={12} color={theme.colors.foregroundMuted} />
            <Text style={styles.buttonText}>{resolveLabel}</Text>
          </Pressable>
        ) : null}
      </View>
      {pr.resolver ? (
        <Text style={styles.meta}>
          {`Resolver ${RESOLVER_STATUS[pr.resolver.status] ?? pr.resolver.status}`}
          {openAgent ? (
            <Text style={styles.link} onPress={openResolver}>
              {"  Open agent"}
            </Text>
          ) : null}
        </Text>
      ) : null}
      {update.error ? <Text style={styles.error}>{update.error.message}</Text> : null}
      {resolve.error ? <Text style={styles.error}>{resolve.error.message}</Text> : null}
    </>
  );
}

/** Per-project switch: conflicting PRs get a resolver agent without a click. */
export function AutoResolveToggle() {
  const { directory, styles } = usePanel();
  const settings = useSettings(factorySettings);
  const ready = settings.status === "ready" ? settings : null;
  const enabled = ready?.values.autoResolveDirectories.includes(directory) ?? false;
  const toggle = useCallback(
    (next: boolean) => {
      if (!ready) return;
      const others = ready.values.autoResolveDirectories.filter((dir) => dir !== directory);
      void ready.save(
        { autoResolveDirectories: next ? [...others, directory] : others },
        ready.revision,
      );
    },
    [ready, directory],
  );
  return (
    <View style={styles.toggleRow}>
      <View style={styles.toggleText}>
        <Text style={styles.buttonText}>Auto-resolve conflicts</Text>
        <Text style={styles.meta}>
          {enabled
            ? "Opus 5.5 takes each new conflict. Checks every 5 min"
            : "Off. Use Resolve conflicts on a PR"}
        </Text>
      </View>
      <Switch
        accessibilityLabel="Auto-resolve conflicts in this project"
        value={enabled}
        disabled={!ready || ready.saving}
        onValueChange={toggle}
        trackColor={styles.switchTrack}
      />
    </View>
  );
}
