import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { collectObservedSessionWorkingDirectories } from "../src/agent-activity/local-observer";
import { collectProfileWorkspaceCandidatePaths } from "../src/local-service/projects/profile-workspace-candidates";
import { setCustomProfileWorkspace } from "../src/profile-workspace/service";

const temporaryRoots: string[] = [];
const originalOpenMeldHome = process.env.OPENMELD_HOME;

afterEach(async () => {
  if (originalOpenMeldHome === undefined) {
    process.env.OPENMELD_HOME = undefined;
  } else {
    process.env.OPENMELD_HOME = originalOpenMeldHome;
  }
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true }))
  );
});

describe("local Project candidate sources", () => {
  it("reads only working-directory identity metadata from Codex and Claude sessions", async () => {
    const homeDir = await tempRoot();
    const codexPath = join(homeDir, ".codex", "sessions", "2026", "run.jsonl");
    const claudePath = join(
      homeDir,
      ".claude",
      "projects",
      "workspace",
      "session.jsonl"
    );
    await Promise.all([
      mkdir(join(codexPath, ".."), { recursive: true }),
      mkdir(join(claudePath, ".."), { recursive: true }),
    ]);
    await writeFile(
      codexPath,
      `${JSON.stringify({ type: "session_meta", payload: { cwd: "/work/codex", secret: "ignored" } })}\n${JSON.stringify({ type: "message", payload: { text: "private transcript" } })}\n`,
      "utf8"
    );
    await writeFile(
      claudePath,
      `${JSON.stringify({ cwd: "/work/claude", sessionId: "session-1" })}\n${JSON.stringify({ message: "private transcript" })}\n`,
      "utf8"
    );

    await expect(
      collectObservedSessionWorkingDirectories({ homeDir })
    ).resolves.toEqual(["/work/claude", "/work/codex"]);
  });

  it("reuses the Profile workspace store for custom workspace candidates", async () => {
    const rootDir = await tempRoot();
    const customWorkspacePath = join(rootDir, "custom-workspace");
    await mkdir(customWorkspacePath);
    process.env.OPENMELD_HOME = rootDir;
    await setCustomProfileWorkspace({
      account: { hostKey: "api-openmeld-ai", userKey: "user-1" },
      customWorkspacePath,
      openMeldProfileId: "profile-1",
    });

    await expect(collectProfileWorkspaceCandidatePaths()).resolves.toEqual([
      customWorkspacePath,
    ]);
  });

  it("reports an unreadable OpenCode identity store without exposing local paths", async () => {
    const homeDir = await tempRoot();
    const databasePath = join(
      homeDir,
      ".local",
      "share",
      "opencode",
      "opencode.db"
    );
    await mkdir(join(databasePath, ".."), { recursive: true });
    await writeFile(databasePath, "not a SQLite database", "utf8");
    const diagnostics: Record<string, unknown>[] = [];

    await collectObservedSessionWorkingDirectories({
      homeDir,
      onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
    });

    expect(diagnostics).toEqual([
      {
        code: "opencode_identity_read_failed",
        errorCode: "ERR_SQLITE_ERROR",
        errorName: "Error",
        provider: "opencode",
      },
    ]);
    expect(JSON.stringify(diagnostics)).not.toContain(homeDir);
  });
});

async function tempRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "openmeld-project-sources-"));
  temporaryRoots.push(path);
  return path;
}
