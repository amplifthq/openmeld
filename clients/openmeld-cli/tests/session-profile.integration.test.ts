import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cliContextStatePath,
  getSessionOpenMeldProfileId,
  resolveCliContextId,
  setSessionOpenMeldProfileId,
} from "../src/config/session-profile";
import { withTempHome } from "./helpers/fs";

// False-positive note: withTempHome restores CLI context env keys after each
// test, so explicit env assignments here are isolated and do not leak.
describe("session profile id resolution", () => {
  it("prefers OpenMeld CLI context env over legacy OpenMeld agent session env", async () => {
    await withTempHome(() => {
      process.env.OPENMELD_CLI_CONTEXT_ID = "runtime-session-123";
      process.env.OPENMELD_AGENT_SESSION_ID = "legacy-session-999";

      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 4242,
          stdinIsTty: true,
          stdoutIsTty: true,
        });

        expect(resolveCliContextId()).toBe("runtime-session-123");
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
      return Promise.resolve();
    });
  });

  it("keeps legacy OpenMeld agent session env as a read compatibility fallback", async () => {
    await withTempHome(() => {
      process.env.OPENMELD_AGENT_SESSION_ID = "agent-session-123";

      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 4242,
          stdinIsTty: true,
          stdoutIsTty: true,
        });

        expect(resolveCliContextId()).toBe("agent-session-123");
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
      return Promise.resolve();
    });
  });

  it("uses terminal fingerprint when stdin and stdout are both TTY", async () => {
    await withTempHome(() => {
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: true,
          stdoutIsTty: true,
        });

        expect(resolveCliContextId()).toBe("terminal-ppid-7331");
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
      return Promise.resolve();
    });
  });

  it("uses terminal fingerprint when stdin is TTY and stdout is redirected", async () => {
    await withTempHome(() => {
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: true,
          stdoutIsTty: false,
        });

        expect(resolveCliContextId()).toBe("terminal-ppid-7331");
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
      return Promise.resolve();
    });
  });

  it("uses terminal fingerprint when stdout is TTY and stdin is not", async () => {
    await withTempHome(() => {
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: true,
        });

        expect(resolveCliContextId()).toBe("terminal-ppid-7331");
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
      return Promise.resolve();
    });
  });

  it("does not use terminal fallback in non-interactive mode", async () => {
    await withTempHome(() => {
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: false,
        });

        expect(resolveCliContextId()).toBeNull();
      } finally {
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
      return Promise.resolve();
    });
  });

  it("does not use provider or terminal environment variables as OpenMeld CLI contexts", async () => {
    await withTempHome(() => {
      const ignoredEnv = {
        AGENT_SESSION_ID: "agent-session",
        CODEX_THREAD_ID: "codex-thread",
        CODEX_SESSION_ID: "codex-session",
        CLAUDE_SESSION_ID: "claude-session",
        ANTHROPIC_SESSION_ID: "anthropic-session",
        OPENAI_SESSION_ID: "openai-session",
        CURSOR_SESSION_ID: "cursor-session",
        TERM_SESSION_ID: "term-session",
        ITERM_SESSION_ID: "iterm-session",
        TMUX_PANE: "tmux-pane",
        WEZTERM_PANE: "wezterm-pane",
      } as const;
      const previousEnv = Object.fromEntries(
        Object.keys(ignoredEnv).map((key) => [key, process.env[key]])
      ) as Record<keyof typeof ignoredEnv, string | undefined>;
      const originalPpid = process.ppid;
      const originalStdinIsTty = process.stdin.isTTY;
      const originalStdoutIsTty = process.stdout.isTTY;

      try {
        Object.assign(process.env, ignoredEnv);
        setRuntimeTtyState({
          ppid: 7331,
          stdinIsTty: false,
          stdoutIsTty: false,
        });

        expect(resolveCliContextId()).toBeNull();
      } finally {
        for (const key of Object.keys(ignoredEnv) as Array<
          keyof typeof ignoredEnv
        >) {
          const value = previousEnv[key];
          if (value === undefined) {
            Reflect.deleteProperty(process.env, key);
            continue;
          }
          process.env[key] = value;
        }
        setRuntimeTtyState({
          ppid: originalPpid,
          stdinIsTty: originalStdinIsTty,
          stdoutIsTty: originalStdoutIsTty,
        });
      }
      return Promise.resolve();
    });
  });

  it("keeps distinct files for session ids with same sanitized prefix", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_CLI_CONTEXT_ID = "session/1";
      await setSessionOpenMeldProfileId("mira--aaaaaaaa");

      process.env.OPENMELD_CLI_CONTEXT_ID = "session:1";
      await setSessionOpenMeldProfileId("nova--bbbbbbbb");

      process.env.OPENMELD_CLI_CONTEXT_ID = "session/1";
      expect(await getSessionOpenMeldProfileId()).toBe("mira--aaaaaaaa");

      process.env.OPENMELD_CLI_CONTEXT_ID = "session:1";
      expect(await getSessionOpenMeldProfileId()).toBe("nova--bbbbbbbb");

      const files = await readdir(
        join(home, ".openmeld", "runtime", "sessions")
      );
      expect(files).toHaveLength(2);
      expect(files[0]).not.toBe(files[1]);
    });
  });

  it("persists CLI context source in session mapping payload", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_CLI_CONTEXT_ID = "agent-session-source";
      await setSessionOpenMeldProfileId("mira--aaaaaaaa");
      const files = await readdir(
        join(home, ".openmeld", "runtime", "sessions")
      );
      expect(files).toHaveLength(1);
      const sessionFile = files[0];
      if (!sessionFile) {
        throw new Error("missing session file");
      }

      const payloadRaw = await readFile(
        join(home, ".openmeld", "runtime", "sessions", sessionFile),
        "utf8"
      );
      const payload = JSON.parse(payloadRaw) as {
        cliContextSource?: string;
      };
      expect(payload.cliContextSource).toBe(
        "environment:OPENMELD_CLI_CONTEXT_ID"
      );
    });
  });

  it("fails fast when stored openMeldProfileId conflicts with the legacy profile field", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_CLI_CONTEXT_ID = "conflict-session";
      const path = cliContextStatePath("conflict-session");
      await mkdir(dirname(path), { recursive: true });
      await writeFile(
        path,
        `${JSON.stringify(
          {
            v: 1,
            sessionId: "conflict-session",
            openMeldProfileId: "agt_alice",
            profile: "agt_bob",
            updatedAt: "2026-03-31T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(getSessionOpenMeldProfileId()).rejects.toThrow(
        "conflicting stored OpenMeld profile identity: openMeldProfileId=agt_alice, profile=agt_bob. Remove or reconcile the legacy profile field so it matches openMeldProfileId."
      );
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
