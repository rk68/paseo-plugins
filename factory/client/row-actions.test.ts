import { describe, expect, it } from "vitest";
import { pressRowAction, type RowAction, rowActionEnabled } from "./row-actions";

function presses(actions: RowAction[]) {
  let armed: RowAction | null = null;
  const fired: RowAction[] = [];
  for (const action of actions) {
    const next = pressRowAction(armed, action);
    armed = next.armed;
    if (next.fire) fired.push(action);
  }
  return { armed, fired };
}

describe("pressRowAction", () => {
  it("fires a merge or a close only on a second press in a row", () => {
    expect(presses(["merge"])).toEqual({ armed: "merge", fired: [] });
    expect(presses(["merge", "merge"])).toEqual({ armed: null, fired: ["merge"] });
    expect(presses(["close", "close"])).toEqual({ armed: null, fired: ["close"] });
  });

  it("disarms the merge when the close is armed, so a confirmed close cannot also merge", () => {
    expect(presses(["merge", "close", "close"])).toEqual({ armed: null, fired: ["close"] });
    expect(presses(["merge", "close", "merge"])).toEqual({ armed: "merge", fired: [] });
  });

  it("fires other actions at once and disarms a pending confirm", () => {
    expect(presses(["merge", "update", "merge"])).toEqual({ armed: "merge", fired: ["update"] });
  });
});

describe("rowActionEnabled", () => {
  it("disables every action but the agent while a close or merge runs", () => {
    expect(rowActionEnabled("close", "merge")).toBe(false);
    expect(rowActionEnabled("merge", "close")).toBe(false);
    expect(rowActionEnabled("close", "open-agent")).toBe(true);
    expect(rowActionEnabled(null, "merge")).toBe(true);
  });
});
