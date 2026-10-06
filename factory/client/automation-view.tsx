import { type SettingsState, useSettings } from "@getpaseo/plugin/client";
import { Icon, TextInput } from "@getpaseo/plugin/client/react-native";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { type ReactNode, useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { factorySettings, NO_AUTOMATION, TASK_KINDS, type TaskKind } from "../shared/actions";
import { type DraftFields, mergeDraft } from "../shared/settings-draft";
import { usePanel } from "./panel-context";

type Ready = Extract<SettingsState<typeof factorySettings.schema>, { status: "ready" }>;

const TASK_COPY: Record<
  TaskKind,
  { toggle: string; hint: string; prompt: string; example: string }
> = {
  conflicts: {
    toggle: "Auto-resolve conflicts",
    hint: "Starts an agent when a PR has merge conflicts",
    prompt: "Resolve conflicts",
    example: "Prefer the base branch for lockfiles, then reinstall",
  },
  ci: {
    toggle: "Auto-fix CI",
    hint: "Starts an agent when checks fail and no check is still running",
    prompt: "Fix CI",
    example: "Run pnpm lint and pnpm test before you push",
  },
  comments: {
    toggle: "Auto-address comments",
    hint: "Starts an agent when a PR has unresolved review threads",
    prompt: "Address comments",
    example: "Skip nitpicks about naming; reply that they are out of scope",
  },
};

/** Per-project automation switches, plus agent instructions shared by every project. */
export function AutomationView({ onBack }: { onBack(): void }) {
  const { styles, theme } = usePanel();
  const settings = useSettings(factorySettings);
  let body: ReactNode;
  if (settings.status === "loading") body = <Text style={styles.notice}>Loading...</Text>;
  else if (settings.status !== "ready")
    body = <Text style={styles.errorBlock}>{settings.error}</Text>;
  else body = <AutomationForm settings={settings} />;
  return (
    <>
      <Pressable accessibilityRole="button" onPress={onBack} style={styles.backButton}>
        <Icon name="ChevronLeft" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.headerText}>Pull requests</Text>
      </Pressable>
      {body}
    </>
  );
}

function AutomationForm({ settings }: { settings: Ready }) {
  const { projectRoot, styles } = usePanel();
  const enabled = settings.values.automation[projectRoot] ?? NO_AUTOMATION;
  const [prompts, setPrompts] = useState(settings.values.prompts);
  const [ignored, setIgnored] = useState(settings.values.ignoredChecks.join(", "));
  // What the drafts started from, so a save can tell its own edits from other clients' changes.
  const [baseline, setBaseline] = useState<DraftFields>(() => ({
    prompts: settings.values.prompts,
    ignoredChecks: settings.values.ignoredChecks,
  }));
  const [conflict, setConflict] = useState<string | null>(null);

  const setAutomation = useCallback(
    (kind: TaskKind, value: boolean) => {
      const automation = {
        ...settings.values.automation,
        [projectRoot]: { ...enabled, [kind]: value },
      };
      void settings.save({ ...settings.values, automation }, settings.revision);
    },
    [settings, projectRoot, enabled],
  );
  const saveInstructions = useCallback(async () => {
    const draft = {
      prompts,
      ignoredChecks: ignored
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    };
    const merged = mergeDraft(settings.values, baseline, draft);
    if ("conflicts" in merged) {
      setConflict(
        "Another window changed these instructions. Close and reopen this view to see them",
      );
      return;
    }
    setConflict(null);
    if (await settings.save(merged.values, settings.revision)) setBaseline(draft);
  }, [settings, prompts, ignored, baseline]);
  const setPrompt = useCallback(
    (kind: TaskKind, text: string) => setPrompts((current) => ({ ...current, [kind]: text })),
    [],
  );

  return (
    <>
      <SettingsSection
        title="This project"
        info="Agents use Claude Opus 5.5 in a new worktree. Automatic runs start one task per PR at a time, at most 2 per repository, one per head commit, and 3 per PR and task."
      >
        <SettingsCard>
          {TASK_KINDS.map((kind) => (
            <AutomationSwitch
              key={kind}
              kind={kind}
              value={enabled[kind]}
              disabled={settings.saving}
              onChange={setAutomation}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection
        title="Agent instructions"
        info="Added to the agent's briefing for each task, in every project"
      >
        <SettingsCard>
          {TASK_KINDS.map((kind) => (
            <PromptField key={kind} kind={kind} value={prompts[kind]} onChange={setPrompt} />
          ))}
          <SettingsInput
            label="Ignored checks"
            hint="Comma-separated check names. Their failures never start an automatic CI fix"
            initialValue={ignored}
            placeholder="linear-link, codecov/patch"
            onChangeText={setIgnored}
            disabled={settings.saving}
          />
          <SettingsAction
            label="Instructions and ignored checks"
            actionLabel={settings.saving ? "Saving..." : "Save"}
            disabled={settings.saving}
            onPress={saveInstructions}
          />
        </SettingsCard>
      </SettingsSection>
      {conflict ? <Text style={styles.errorBlock}>{conflict}</Text> : null}
      {settings.saveError ? <Text style={styles.errorBlock}>{settings.saveError}</Text> : null}
    </>
  );
}

function AutomationSwitch({
  kind,
  value,
  disabled,
  onChange,
}: {
  kind: TaskKind;
  value: boolean;
  disabled: boolean;
  onChange(kind: TaskKind, value: boolean): void;
}) {
  const change = useCallback((next: boolean) => onChange(kind, next), [onChange, kind]);
  return (
    <SettingsSwitch
      label={TASK_COPY[kind].toggle}
      hint={TASK_COPY[kind].hint}
      value={value}
      disabled={disabled}
      onValueChange={change}
    />
  );
}

function PromptField({
  kind,
  value,
  onChange,
}: {
  kind: TaskKind;
  value: string;
  onChange(kind: TaskKind, text: string): void;
}) {
  const { styles, theme } = usePanel();
  const change = useCallback((text: string) => onChange(kind, text), [onChange, kind]);
  return (
    <View style={styles.promptField}>
      <Text style={styles.buttonText}>{TASK_COPY[kind].prompt}</Text>
      <TextInput
        value={value}
        onChangeText={change}
        placeholder={TASK_COPY[kind].example}
        placeholderTextColor={theme.colors.foregroundMuted}
        multiline
        style={styles.promptInput}
      />
    </View>
  );
}
