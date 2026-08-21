import { mkdtemp, readFile, rename, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { recordOpenMeldCreatedLocalAgentSession } from "../src/agent-activity/session-inventory-origin-store";

let root: string | null = null;

afterEach(async () => {
  if (root) {
    await rm(root, { force: true, recursive: true });
    root = null;
  }
});

describe("Session Inventory origin store", () => {
  it("preserves existing provenance when the store cannot be read", async () => {
    root = await mkdtemp(join(tmpdir(), "openmeld-session-origin-store-"));
    await recordOpenMeldCreatedLocalAgentSession({
      agentControllerRef: "builtin:codex",
      nativeSessionId: "native-existing",
      rootDir: root,
    });
    const storePath = join(
      root,
      "device",
      "agent-activity",
      "session-inventory-origins.json"
    );
    const preservedPath = `${storePath}.preserved`;
    await rename(storePath, preservedPath);
    await symlink(storePath, storePath);
    const preserved = await readFile(preservedPath, "utf8");

    await expect(
      recordOpenMeldCreatedLocalAgentSession({
        agentControllerRef: "builtin:codex",
        nativeSessionId: "native-new",
        rootDir: root,
      })
    ).rejects.toThrow("Failed to read the Session Inventory origin store");
    expect(await readFile(preservedPath, "utf8")).toBe(preserved);
  });
});
