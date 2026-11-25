import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buildSpaceFileEntryIdForMutation } from "@openmeld/schemas";
import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";
import {
  resolveMimeType,
  runSpaceFilesUpload,
} from "../src/space/files-command";
import { registerSpaceFilesCommands } from "../src/space/files-registration";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const FILE_COMMANDS = [
  "handoff",
  "working-copy",
  "list",
  "read",
  "history",
  "upload",
  "write",
  "download",
  "mkdir",
  "rename",
  "move",
  "trash",
  "restore",
  "restore-version",
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
    expect(commandHelp(files, "upload")).toContain(
      "--client-mutation-id <uuid>"
    );
    expect(commandHelp(files, "upload")).toContain("--timeout-ms <ms>");
    expect(commandHelp(files, "list")).toContain("--trash");
    expect(commandHelp(files, "handoff")).toContain("--client-message-id");
    expect(commandHelp(files, "handoff")).toContain("--thread");
    expect(commandHelp(files, "restore-version")).toContain(
      "--base-revision <number>"
    );
  });

  it("keeps an ambiguous upload unconfirmed and recovers its exact identity on the next invocation", async () => {
    await withTempHome(async (home) => {
      const space = "a".repeat(64);
      const profile = createTestOpenMeldProfile({
        openMeldProfileId: "11111111-1111-4111-8111-111111111111",
        profileKind: "agent",
        profileName: "Reviewer",
      });
      vi.spyOn(
        await import("../src/space/command-context"),
        "resolveOpenMeldProfileForSpaceCommand"
      ).mockResolvedValue(profile);
      const mutations: string[] = [];
      vi.spyOn(globalThis, "fetch").mockImplementation((url) => {
        const target = new URL(String(url));
        expect(target.pathname).toBe(`/v1/spaces/${space}/files`);
        mutations.push(target.searchParams.get("clientMutationId") ?? "");
        return Promise.resolve(
          new Response(null, {
            status: 502,
            headers: { "x-openmeld-request-id": "lost-receipt" },
          })
        );
      });
      const input = {
        space,
        file: join(home, "evidence.zip"),
        profile: profile.openMeldProfileId,
        view: "agent",
        json: true,
        baseUrl: "https://gateway.openmeld.invalid",
        entryChecksHandled: true,
      };
      await writeFile(input.file, "test evidence");
      const { plainStdout } = await withCapturedStdio(async () => {
        const failure = await runSpaceFilesUpload(input).catch(
          (error: Error) => error
        );
        const [id = ""] = mutations;
        expect(id).toBeTruthy();
        expect(failure).toMatchObject({
          code: "gateway.http_error",
          requestId: "lost-receipt",
        });
        const expectedFileId = await buildSpaceFileEntryIdForMutation(id);
        expect(failure).toHaveProperty(
          "message",
          expect.stringContaining(
            `files history ${space} ${expectedFileId} --profile ${profile.openMeldProfileId}`
          )
        );
        expect(failure).toHaveProperty(
          "message",
          expect.stringContaining(`--client-mutation-id ${id}`)
        );
        await expect(
          runSpaceFilesUpload({ ...input, clientMutationId: id })
        ).rejects.toThrow("Upload not confirmed");
        expect(mutations).toEqual([id, id]);
      });
      expect(plainStdout).toBe("");
    });
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
