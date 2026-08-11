import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_ACTIVITY_TITLE_MAX_CHARS } from "@openmeld/schemas";
import { afterEach, describe, expect, it } from "vitest";
import {
  normalizeSharedSessionTitle,
  readCodexSessionTitles,
} from "../src/agent-activity/provider-session-titles";

let homeDir: string | null = null;

afterEach(async () => {
  if (homeDir) {
    await rm(homeDir, { force: true, recursive: true });
    homeDir = null;
  }
});

describe("Agent Activity provider session titles", () => {
  it("reads Codex thread names without letting a partial index line hide valid titles", async () => {
    homeDir = await mkdtemp(join(tmpdir(), "openmeld-session-titles-"));
    const codexDir = join(homeDir, ".codex");
    await mkdir(codexDir);
    await writeFile(
      join(codexDir, "session_index.jsonl"),
      [
        JSON.stringify({ id: "session-1", thread_name: " First task " }),
        "{partially-written",
        JSON.stringify({ id: "session-2", thread_name: "Second task" }),
        JSON.stringify({ id: "session-3", thread_name: "" }),
        "",
      ].join("\n")
    );

    await expect(readCodexSessionTitles({ homeDir })).resolves.toEqual(
      new Map([
        ["session-1", "First task"],
        ["session-2", "Second task"],
      ])
    );
  });

  it("rejects empty and oversized titles at the disclosure boundary", () => {
    expect(normalizeSharedSessionTitle("  ")).toBeNull();
    expect(
      normalizeSharedSessionTitle(
        "x".repeat(AGENT_ACTIVITY_TITLE_MAX_CHARS + 1)
      )
    ).toBeNull();
    expect(normalizeSharedSessionTitle("  Build Agent Activity  ")).toBe(
      "Build Agent Activity"
    );
  });
});
