import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alignSelectedOpenMeldProfileStorage,
  clearAllSelectedOpenMeldProfileIds,
  clearSelectedOpenMeldProfileId,
  getSelectedOpenMeldProfileId,
  setSelectedOpenMeldProfileId,
} from "../src/config/openmeld-profile-selection";
import {
  getSessionOpenMeldProfileId,
  setSessionOpenMeldProfileId,
} from "../src/config/session-profile";
import { withTempHome } from "./helpers/fs";

describe("OpenMeld profile selection session scope", () => {
  it("persists selected OpenMeld profile per CLI context id", async () => {
    await withTempHome(async (home) => {
      const previousSessionId = process.env.OPENMELD_CLI_CONTEXT_ID;
      try {
        process.env.OPENMELD_CLI_CONTEXT_ID = "session/a";
        const firstWrite = await setSelectedOpenMeldProfileId("agt_alpha");
        expect(firstWrite).toMatchObject({
          persistent: true,
          cliContextSource: "environment:OPENMELD_CLI_CONTEXT_ID",
        });
        expect(await getSelectedOpenMeldProfileId()).toBe("agt_alpha");

        process.env.OPENMELD_CLI_CONTEXT_ID = "session:b";
        expect(await getSelectedOpenMeldProfileId()).toBeNull();

        await setSelectedOpenMeldProfileId("agt_bravo");
        expect(await getSelectedOpenMeldProfileId()).toBe("agt_bravo");

        process.env.OPENMELD_CLI_CONTEXT_ID = "session/a";
        expect(await getSelectedOpenMeldProfileId()).toBe("agt_alpha");

        const files = await readdir(
          join(home, ".openmeld", "runtime", "sessions")
        );
        expect(files.length).toBe(2);
        expect(files[0]).not.toBe(files[1]);
        const payloadRaw = await readFile(
          join(home, ".openmeld", "runtime", "sessions", files[0] ?? ""),
          "utf8"
        );
        expect(payloadRaw).toContain('"selectedOpenMeldProfileId"');
      } finally {
        if (previousSessionId === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");
        } else {
          process.env.OPENMELD_CLI_CONTEXT_ID = previousSessionId;
        }
      }
    });
  });

  it("clear only affects current CLI context selection", async () => {
    await withTempHome(async () => {
      const previousSessionId = process.env.OPENMELD_CLI_CONTEXT_ID;
      try {
        process.env.OPENMELD_CLI_CONTEXT_ID = "session-a";
        await setSessionOpenMeldProfileId("mira--primary");
        await setSelectedOpenMeldProfileId("agt_alpha");

        process.env.OPENMELD_CLI_CONTEXT_ID = "session-b";
        await setSelectedOpenMeldProfileId("agt_bravo");
        expect(await getSelectedOpenMeldProfileId()).toBe("agt_bravo");

        await clearSelectedOpenMeldProfileId();
        expect(await getSelectedOpenMeldProfileId()).toBeNull();

        process.env.OPENMELD_CLI_CONTEXT_ID = "session-a";
        expect(await getSelectedOpenMeldProfileId()).toBe("agt_alpha");
      } finally {
        if (previousSessionId === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");
        } else {
          process.env.OPENMELD_CLI_CONTEXT_ID = previousSessionId;
        }
      }
    });
  });

  it("persists fallback selection in non-interactive no-session mode", async () => {
    await withTempHome(async (home) => {
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: false,
        });

        const writeResult = await setSelectedOpenMeldProfileId("agt_ephemeral");
        expect(writeResult).toMatchObject({
          persistent: true,
          cliContextSource: "fallback:no_runtime_session",
        });
        expect(await getSelectedOpenMeldProfileId()).toBe("agt_ephemeral");
        const fallbackRaw = await readFile(
          join(home, ".openmeld", "runtime", "selected-profile-fallback.json"),
          "utf8"
        );
        expect(fallbackRaw).toContain('"openMeldProfileId": "agt_ephemeral"');
        await clearSelectedOpenMeldProfileId();
        expect(await getSelectedOpenMeldProfileId()).toBeNull();

        const selectedDir = join(home, ".openmeld", "runtime", "sessions");
        const dirExists = await readdir(selectedDir)
          .then(() => true)
          .catch(() => false);
        expect(dirExists).toBe(false);
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
    });
  });

  it("keeps fallback selection when local-state alignment cleans legacy files", async () => {
    await withTempHome(async (home) => {
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: false,
        });

        await setSelectedOpenMeldProfileId("agt_persistent_fallback");
        const alignment = await alignSelectedOpenMeldProfileStorage();

        expect(alignment.removedLegacySelectionFile).toBe(false);
        expect(await getSelectedOpenMeldProfileId()).toBe(
          "agt_persistent_fallback"
        );
        const fallbackRaw = await readFile(
          join(home, ".openmeld", "runtime", "selected-profile-fallback.json"),
          "utf8"
        );
        expect(fallbackRaw).toContain(
          '"sessionSource": "fallback:no_runtime_session"'
        );
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
    });
  });

  it("migrates legacy fallback selection out of auth storage", async () => {
    await withTempHome(async (home) => {
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: false,
        });

        const authDir = join(home, ".openmeld", "auth");
        await mkdir(authDir, { recursive: true });
        await writeFile(
          join(authDir, "selected-profile.json"),
          `${JSON.stringify(
            {
              v: 1,
              sessionId: "global-default",
              sessionSource: "fallback:no_runtime_session",
              openMeldProfileId: "agt_legacy_fallback",
              updatedAt: "2026-03-09T00:00:00.000Z",
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        const alignment = await alignSelectedOpenMeldProfileStorage();

        expect(alignment.removedLegacySelectionFile).toBe(true);
        expect(await getSelectedOpenMeldProfileId()).toBe(
          "agt_legacy_fallback"
        );
        const migratedRaw = await readFile(
          join(home, ".openmeld", "runtime", "selected-profile-fallback.json"),
          "utf8"
        );
        expect(migratedRaw).toContain(
          '"openMeldProfileId": "agt_legacy_fallback"'
        );
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
    });
  });

  it("clears selected OpenMeld profile pointers across all sessions in the current OpenMeld home", async () => {
    await withTempHome(async (home) => {
      const previousSessionId = process.env.OPENMELD_CLI_CONTEXT_ID;
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        process.env.OPENMELD_CLI_CONTEXT_ID = "session-a";
        await setSessionOpenMeldProfileId("mira--primary");
        await setSelectedOpenMeldProfileId("agt_alpha");

        process.env.OPENMELD_CLI_CONTEXT_ID = "session-b";
        await setSelectedOpenMeldProfileId("agt_bravo");

        Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: false,
        });
        await setSelectedOpenMeldProfileId("agt_fallback");
        expect(await getSelectedOpenMeldProfileId()).toBe("agt_fallback");

        const result = await clearAllSelectedOpenMeldProfileIds();

        expect(result.clearedSessionSelections).toBe(2);
        expect(result.failedSessionIds).toEqual([]);
        expect(result.removedFallbackSelection).toBe(true);
        expect(result.removedLegacySelectionFile).toBe(false);

        process.env.OPENMELD_CLI_CONTEXT_ID = "session-a";
        expect(await getSelectedOpenMeldProfileId()).toBeNull();

        process.env.OPENMELD_CLI_CONTEXT_ID = "session-b";
        expect(await getSelectedOpenMeldProfileId()).toBeNull();

        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: false,
        });
        expect(await getSelectedOpenMeldProfileId()).toBeNull();

        const sessionFiles = await readdir(
          join(home, ".openmeld", "runtime", "sessions")
        );
        for (const sessionFile of sessionFiles) {
          const raw = await readFile(
            join(home, ".openmeld", "runtime", "sessions", sessionFile),
            "utf8"
          );
          expect(raw).not.toContain('"selectedOpenMeldProfileId"');
        }
        process.env.OPENMELD_CLI_CONTEXT_ID = "session-a";
        expect(await getSessionOpenMeldProfileId()).toBe("mira--primary");
      } finally {
        if (previousSessionId === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");
        } else {
          process.env.OPENMELD_CLI_CONTEXT_ID = previousSessionId;
        }
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
    });
  });

  it("limits all-session selected profile cleanup to the current OPENMELD_HOME", async () => {
    await withTempHome(async (home) => {
      const primaryHome = join(home, ".openmeld");
      const otherHome = join(home, ".openmeld-dev");
      const previousOpenMeldHome = process.env.OPENMELD_HOME;
      const previousSessionId = process.env.OPENMELD_CLI_CONTEXT_ID;
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        process.env.OPENMELD_HOME = primaryHome;
        process.env.OPENMELD_CLI_CONTEXT_ID = "primary-session";
        await setSelectedOpenMeldProfileId("agt_primary");

        process.env.OPENMELD_HOME = otherHome;
        process.env.OPENMELD_CLI_CONTEXT_ID = "other-session";
        await setSelectedOpenMeldProfileId("agt_other");

        process.env.OPENMELD_HOME = primaryHome;
        process.env.OPENMELD_CLI_CONTEXT_ID = "primary-session";
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: false,
        });

        const result = await clearAllSelectedOpenMeldProfileIds();

        expect(result.clearedSessionSelections).toBe(1);

        process.env.OPENMELD_HOME = primaryHome;
        process.env.OPENMELD_CLI_CONTEXT_ID = "primary-session";
        expect(await getSelectedOpenMeldProfileId()).toBeNull();

        process.env.OPENMELD_HOME = otherHome;
        process.env.OPENMELD_CLI_CONTEXT_ID = "other-session";
        expect(await getSelectedOpenMeldProfileId()).toBe("agt_other");
      } finally {
        if (previousOpenMeldHome === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_HOME");
        } else {
          process.env.OPENMELD_HOME = previousOpenMeldHome;
        }
        if (previousSessionId === undefined) {
          Reflect.deleteProperty(process.env, "OPENMELD_CLI_CONTEXT_ID");
        } else {
          process.env.OPENMELD_CLI_CONTEXT_ID = previousSessionId;
        }
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
    });
  });
});

function setRuntimeTtyState(input: {
  ppid: number;
  stdinIsTty: boolean | undefined;
  stdoutIsTty: boolean | undefined;
}): void {
  Object.defineProperty(process, "ppid", {
    value: input.ppid,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(process.stdin, "isTTY", {
    value: input.stdinIsTty,
    writable: true,
    enumerable: true,
    configurable: true,
  });

  Object.defineProperty(process.stdout, "isTTY", {
    value: input.stdoutIsTty,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
