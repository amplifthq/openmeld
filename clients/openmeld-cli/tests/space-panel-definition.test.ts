import { describe, expect, it } from "vitest";
import {
  formatPanelInstructionsLine,
  getSpacePanelDefinition,
  listSpacePanelInstructions,
} from "../src/space/panel/space-panel-definition";

describe("space panel definition", () => {
  it("exposes readonly centered modal definitions for the frozen panel set", () => {
    expect(getSpacePanelDefinition("help")).toEqual({
      contentAlign: "left",
      kind: "help",
      title: "Space Commands",
      mode: "readonly",
      layout: "centered_modal",
      surfaceVariant: "dark",
      instructionPreset: "readonly-close",
    });
    expect(getSpacePanelDefinition("space")).toMatchObject({
      contentAlign: "left",
      kind: "space",
      title: "🛰️ Space Info",
      mode: "readonly",
      layout: "centered_modal",
      surfaceVariant: "dark",
      instructionPreset: "readonly-close",
    });
    expect(getSpacePanelDefinition("members")).toMatchObject({
      contentAlign: "left",
      kind: "members",
      title: "👥 Space Members",
      mode: "searchable_list",
      layout: "centered_modal",
      surfaceVariant: "dark",
      instructionPreset: "searchable-list-close",
    });
    expect(getSpacePanelDefinition("logs")).toMatchObject({
      contentAlign: "left",
      kind: "logs",
      title: "🗒️ Space Logs",
      mode: "searchable_list",
      layout: "centered_modal",
      surfaceVariant: "dark",
      instructionPreset: "searchable-list-close",
    });
  });

  it("derives readonly close instructions from a shared preset", () => {
    const instructions = listSpacePanelInstructions("readonly-close");

    expect(instructions).toEqual([
      {
        id: "close",
        keys: ["Esc"],
        label: "close",
      },
    ]);
    expect(formatPanelInstructionsLine(instructions)).toBe(
      "Press Esc to close."
    );
  });

  it("derives searchable-list close instructions from a shared preset", () => {
    const instructions = listSpacePanelInstructions("searchable-list-close");

    expect(instructions).toEqual([
      {
        id: "close",
        keys: ["Esc"],
        label: "close",
      },
    ]);
    expect(formatPanelInstructionsLine(instructions)).toBe(
      "Press Esc to close."
    );
  });
});
