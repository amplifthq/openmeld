import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  registerRoutinesCommands,
  resolveRoutinesCliOutputMode,
} from "../src/routines/registration";

const ROUTINE_COMMANDS = [
  "list",
  "create",
  "show",
  "update",
  "pause",
  "resume",
  "delete",
  "runs",
] as const;
const NATIVE_ENGLISH_DESCRIPTION_PATTERN = /[A-Z][^.]+\./u;

describe("Routines CLI registration", () => {
  it("keeps explicit --json separate from Agent View entry routing", () => {
    expect(resolveRoutinesCliOutputMode({ json: true, view: "human" })).toEqual(
      { json: true, jsonOutput: true, view: "agent" }
    );
    expect(
      resolveRoutinesCliOutputMode({ json: false, view: "agent" })
    ).toEqual({ json: false, jsonOutput: false, view: "agent" });
    expect(resolveRoutinesCliOutputMode({})).toEqual({
      json: false,
      jsonOutput: false,
    });
  });

  it("registers all eight commands with native English help", () => {
    const routines = registerRoutinesCommands(
      new Command().name("openmeld"),
      handlers()
    );

    expect(routines.commands.map((command) => command.name())).toEqual(
      ROUTINE_COMMANDS
    );
    for (const commandName of ROUTINE_COMMANDS) {
      const command = routines.commands.find(
        (candidate) => candidate.name() === commandName
      );
      expect(command?.description()).toMatch(
        NATIVE_ENGLISH_DESCRIPTION_PATTERN
      );
      expect(command?.options.some((option) => option.long === "--json")).toBe(
        true
      );
    }
  });

  it("exposes raw cron, daily shorthand, timezone, and target Space inputs", () => {
    const routines = registerRoutinesCommands(
      new Command().name("openmeld"),
      handlers()
    );
    const createHelp = commandHelp(routines, "create");
    const updateHelp = commandHelp(routines, "update");

    for (const help of [createHelp, updateHelp]) {
      expect(help).toContain("--cron <expression>");
      expect(help).toContain("--daily <HH:MM>");
      expect(help).toContain("--timezone <timezone>");
      expect(help).toContain("--target-space <space-id>");
    }
    expect(createHelp).toContain("five-field cron");
    expect(createHelp).toContain("explicit IANA timezone");
  });

  it("exposes destructive confirmation and Run pagination parameters", () => {
    const routines = registerRoutinesCommands(
      new Command().name("openmeld"),
      handlers()
    );

    expect(commandHelp(routines, "delete")).toContain("--yes");
    const runsHelp = commandHelp(routines, "runs");
    expect(runsHelp).toContain("--limit <count>");
    expect(runsHelp).toContain("--before-scheduled-for <timestamp-ms>");
  });

  it("passes parsed create arguments by name instead of position", async () => {
    const callbacks = handlers();
    const program = new Command().name("openmeld").exitOverride();
    registerRoutinesCommands(program, callbacks);

    await program.parseAsync(
      [
        "routines",
        "create",
        "--name",
        "Daily brief",
        "--instructions",
        "Summarize new feedback.",
        "--daily",
        "09:00",
        "--timezone",
        "America/Los_Angeles",
        "--target-space",
        "space-1",
        "--json",
      ],
      { from: "user" }
    );

    expect(callbacks.create).toHaveBeenCalledWith(
      expect.objectContaining({
        daily: "09:00",
        instructions: "Summarize new feedback.",
        json: true,
        name: "Daily brief",
        targetSpace: "space-1",
        timezone: "America/Los_Angeles",
      })
    );
  });
});

function handlers() {
  return {
    create: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    list: vi.fn(async () => undefined),
    pause: vi.fn(async () => undefined),
    resume: vi.fn(async () => undefined),
    runs: vi.fn(async () => undefined),
    show: vi.fn(async () => undefined),
    update: vi.fn(async () => undefined),
  };
}

function commandHelp(parent: Command, name: string): string {
  const command = parent.commands.find(
    (candidate) => candidate.name() === name
  );
  if (!command) {
    throw new Error(`Missing registered Routines command: ${name}.`);
  }
  return command.helpInformation();
}
