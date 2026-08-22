import { Command } from "commander";
import { describe, expect, it } from "vitest";
import { resolveMimeType } from "../src/space/files-command";
import { registerSpaceFilesCommands } from "../src/space/files-registration";

const FILE_COMMANDS = [
  "list",
  "read",
  "upload",
  "write",
  "download",
  "mkdir",
  "rename",
  "move",
  "trash",
] as const;

describe("Space Files CLI", () => {
  it("registers the complete shared-file workflow with clear help", () => {
    const space = new Command().name("space");

    registerSpaceFilesCommands(space);

    const files = space.commands.find((command) => command.name() === "files");
    expect(files?.description()).toBe(
      "Share and collaborate on files in a Space."
    );
    expect(files?.commands.map((command) => command.name())).toEqual(
      FILE_COMMANDS
    );
    expect(commandHelp(files, "write")).toContain("--base-revision <number>");
    expect(commandHelp(files, "write")).toContain("--stdin");
    expect(commandHelp(files, "download")).toContain("--force");
  });

  it("infers common media types while keeping an explicit type authoritative", () => {
    expect(resolveMimeType(undefined, "launch-notes.md")).toBe("text/markdown");
    expect(resolveMimeType(undefined, "diagram.png")).toBe("image/png");
    expect(resolveMimeType(undefined, "archive.unknown")).toBe(
      "application/octet-stream"
    );
    expect(resolveMimeType(" TEXT/PLAIN ", "launch-notes.md")).toBe(
      "text/plain"
    );
  });
});

function commandHelp(parent: Command | undefined, name: string): string {
  const command = parent?.commands.find(
    (candidate) => candidate.name() === name
  );
  if (!command) {
    throw new Error(`Missing command: ${name}`);
  }
  return command.helpInformation();
}
