import { describe, expect, it } from "vitest";
import {
  listSpaceSlashCommands,
  resolveSpaceSlashCommand,
} from "../src/space/composer/slash-command-registry";

describe("slash command registry", () => {
  it("exposes the frozen phase-two slash command set", () => {
    expect(listSpaceSlashCommands()).toEqual([
      {
        name: "help",
        panelKind: "help",
        trigger: "/help",
        description: "Show available Space composer commands",
        kind: "panel",
      },
      {
        name: "space",
        panelKind: "space",
        trigger: "/space",
        description: "Show current Space info",
        kind: "panel",
      },
      {
        name: "members",
        panelKind: "members",
        trigger: "/members",
        description: "Show current Space members",
        kind: "panel",
      },
      {
        name: "logs",
        panelKind: "logs",
        trigger: "/logs",
        description: "Show current Space logs",
        kind: "panel",
      },
      {
        action: "quit",
        trigger: "/quit",
        description: "Leave the current Space session",
        kind: "control",
        name: "quit",
      },
    ]);
  });

  it("resolves exact slash commands case-insensitively", () => {
    expect(resolveSpaceSlashCommand(" /SPACE ")).toEqual({
      name: "space",
      panelKind: "space",
      trigger: "/space",
      description: "Show current Space info",
      kind: "panel",
    });
    expect(resolveSpaceSlashCommand("/missing")).toBeNull();
    expect(resolveSpaceSlashCommand("/")).toBeNull();
  });
});
