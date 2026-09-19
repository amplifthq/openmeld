import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { assertPilotAuthCallback } from "../src/main/pilot-auth-callback";

it("rejects a generic macOS Electron and a different worktree before opening the browser", async () => {
  const root = mkdtempSync(join(tmpdir(), "desktop-callback-"));
  const expected = join(root, "Owned.app");
  const other = join(root, "Other.app");
  mkdirSync(join(expected, "Contents", "MacOS"), { recursive: true });
  mkdirSync(other);
  const app = {
    isPackaged: false,
    whenReady: async () => undefined,
    getPath: () => join(expected, "Contents", "MacOS", "OpenMeld"),
    getApplicationInfoForProtocol: vi.fn().mockResolvedValue({ path: other }),
  };
  try {
    await expect(
      assertPilotAuthCallback(app, "worktree", "darwin")
    ).rejects.toThrow("app bundle");
    expect(app.getApplicationInfoForProtocol).not.toHaveBeenCalled();
    app.isPackaged = true;
    await expect(
      assertPilotAuthCallback(app, "worktree", "darwin")
    ).rejects.toThrow("different app");
    app.getApplicationInfoForProtocol.mockResolvedValue({ path: expected });
    await expect(
      assertPilotAuthCallback(app, "worktree", "darwin")
    ).resolves.toBeUndefined();
    await expect(
      assertPilotAuthCallback(
        { ...app, isPackaged: false },
        "worktree",
        "win32"
      )
    ).resolves.toBeUndefined();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
