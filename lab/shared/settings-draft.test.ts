import { describe, expect, it } from "vitest";
import { mergeEdited } from "./settings-draft";

const baseline = { sshHost: "old-cluster", logPattern: "" };

describe("mergeEdited", () => {
  it("keeps another client's host change when only the pattern was edited", () => {
    const latest = { sshHost: "new-cluster", logPattern: "" };
    const draft = { sshHost: "old-cluster", logPattern: "~/logs/%x-%j.log" };
    expect(mergeEdited(latest, baseline, draft)).toEqual({
      values: { sshHost: "new-cluster", logPattern: "~/logs/%x-%j.log" },
    });
  });

  it("reports a conflict when both sides changed the same field", () => {
    const latest = { sshHost: "new-cluster", logPattern: "" };
    const draft = { sshHost: "mine", logPattern: "" };
    expect(mergeEdited(latest, baseline, draft)).toEqual({ conflicts: ["sshHost"] });
  });
});
