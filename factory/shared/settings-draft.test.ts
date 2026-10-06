import { describe, expect, it } from "vitest";
import { factorySettings, type FactorySettings } from "./actions";
import { mergeDraft } from "./settings-draft";

const base: FactorySettings = {
  automation: {},
  prompts: { conflicts: "", ci: "old ci", comments: "" },
  ignoredChecks: ["lint"],
  sort: "urgency",
};

describe("mergeDraft", () => {
  it("keeps another client's change to a field the user did not edit", () => {
    const latest = { ...base, prompts: { ...base.prompts, ci: "new ci" }, sort: "newest" as const };
    const draft = { prompts: { ...base.prompts, comments: "mine" }, ignoredChecks: ["lint"] };
    expect(mergeDraft(latest, base, draft)).toEqual({
      values: { ...latest, prompts: { conflicts: "", ci: "new ci", comments: "mine" } },
    });
  });

  it("reports a conflict instead of overwriting a field both sides changed", () => {
    const latest = { ...base, prompts: { ...base.prompts, ci: "theirs" } };
    const draft = { prompts: { ...base.prompts, ci: "mine" }, ignoredChecks: ["lint"] };
    expect(mergeDraft(latest, base, draft)).toEqual({ conflicts: ["prompts.ci"] });
  });
});

describe("settings migration", () => {
  it("drops version 1 automation keyed by a workspace folder", async () => {
    expect(await factorySettings.migrate?.({ autoResolveDirectories: ["/wt/feature"] }, 1)).toEqual(
      {},
    );
  });
});
