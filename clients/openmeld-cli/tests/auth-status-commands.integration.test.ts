import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAuthStatus } from "../src/commands/auth";
import { runWhoami } from "../src/commands/whoami";
import {
  getAuthSessionState,
  setAuthSession,
} from "../src/config/auth-session";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

type CapturedResult = {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
};

describe("auth command status states", () => {
  afterEach(() => {
    process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetAllMocks();
    process.exitCode = undefined;
  });

  it("reports missing auth state in auth status", async () => {
    await withTempHome(async () => {
      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toBe("");
      expect(result.stdout).toContain("Authentication Status");
      expect(result.stdout).toContain("Status: sign in needed");
      expect(result.stdout).toContain(
        "Next: Run `openmeld login` to continue."
      );
      expect(result.stdout).not.toContain('{"signedIn"');
    });
  });

  it("uses npx login guidance in auth status when launched via npm exec", async () => {
    vi.stubEnv("npm_command", "exec");
    vi.stubEnv("npm_lifecycle_script", '"openmeld"');
    vi.stubEnv(
      "npm_config_user_agent",
      "npm/11.6.2 node/v25.1.0 darwin arm64 workspaces/false"
    );

    await withTempHome(async () => {
      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain(
        "Next: Run `npx -y openmeld@latest login` to continue."
      );
    });
  });

  it("uses openmeld-dev login guidance when the dev shortcut is active", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-dev");

    await withTempHome(async () => {
      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain(
        "Next: Run `openmeld-dev login` to continue."
      );
    });
  });

  it("uses openmeld-canary login guidance when the canary shortcut is active", async () => {
    vi.stubEnv("OPENMELD_USER_FACING_CLI_COMMAND", "openmeld-canary");

    await withTempHome(async () => {
      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain(
        "Next: Run `openmeld-canary login` to continue."
      );
    });
  });

  it("reports expired auth state in auth status", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-expired",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Authentication Status");
      expect(result.stdout).toContain("Status: sign in expired");
      expect(result.stdout).not.toContain('{"signedIn"');
    });
  });

  it("reports invalid auth state in auth status", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await mkdir(join(home, ".openmeld", "auth"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "auth", "session.json"),
        `${JSON.stringify({
          v: 1,
          tokenRef: { provider: "insecure-file" },
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: new Date().toISOString(),
        })}\n`,
        "utf8"
      );

      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Authentication Status");
      expect(result.stdout).toContain("Status: sign in needs refresh");
      expect(result.stdout).not.toContain('{"signedIn"');
    });
  });

  it("preserves a local token-read failure for Agent View recovery", async () => {
    await withTempHome(async (home) => {
      const tokenKey = "a".repeat(64);
      await mkdir(
        join(home, ".openmeld", "auth", "tokens", `${tokenKey}.token`),
        { recursive: true }
      );
      await writeFile(
        join(home, ".openmeld", "auth", "session.json"),
        `${JSON.stringify({
          v: 1,
          tokenRef: { provider: "insecure-file", key: tokenKey },
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: new Date().toISOString(),
        })}\n`,
        "utf8"
      );

      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "agent" })
      );
      const authLine = parseJsonLine(result.stdout, "auth.status.session");

      expect(result.exitCode).toBe(1);
      expect(authLine?.payload).toMatchObject({
        signedIn: false,
        state: "invalid",
        reasonCode: "session_token_unavailable",
      });
      expect(authLine?.payload?.errorMessage).toEqual(expect.any(String));
    });
  });

  it("reports revoked auth state without changing the local session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    );
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-revoked",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });
      const sessionPath = join(home, ".openmeld", "auth", "session.json");
      const sessionBeforeStatus = await readFile(sessionPath, "utf8");

      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Authentication Status");
      expect(result.stdout).toContain("Status: sign in removed");
      expect(result.stdout).not.toContain('{"signedIn"');
      await expect(readFile(sessionPath, "utf8")).resolves.toBe(
        sessionBeforeStatus
      );
      expect(await getAuthSessionState()).toMatchObject({
        state: "valid",
      });
    });
  });

  it("reports invalid remote auth state without changing the local session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-invalid-url",
        tokenType: "Bearer",
        authBaseUrl: "not-a-url",
        clientId: "openmeld-cli",
      });
      const sessionPath = join(home, ".openmeld", "auth", "session.json");
      const sessionBeforeStatus = await readFile(sessionPath, "utf8");

      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "agent" })
      );

      const authLine = parseJsonLine(result.stdout, "auth.status.session");
      expect(result.exitCode).toBe(1);
      expect(authLine?.payload).toMatchObject({
        signedIn: false,
        state: "invalid",
      });
      expect(fetchMock).not.toHaveBeenCalled();
      await expect(readFile(sessionPath, "utf8")).resolves.toBe(
        sessionBeforeStatus
      );
      expect(await getAuthSessionState()).toMatchObject({
        state: "valid",
      });
    });
  });

  it("fails fast when auth status is signed in to a different OpenMeld environment in human view", async () => {
    vi.stubEnv("OPENMELD_GATEWAY_URL", "https://gateway.openmeld.invalid");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: { id: "session-1" },
            user: { id: "user-1", email: "you@company.com" },
          }),
          { status: 200 }
        )
      )
    );

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-valid",
        tokenType: "Bearer",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli",
      });

      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Wrong OpenMeld Environment");
      expect(result.stdout).toContain(
        "What happened: Sign in to the right OpenMeld environment"
      );
      expect(result.stdout).not.toContain("http://localhost:8788");
      expect(result.stdout).not.toContain("gateway.openmeld.invalid");
      expect(result.stdout).not.toContain("Status: signed in");
    });
  });

  it("keeps mismatch evidence in auth status agent output", async () => {
    vi.stubEnv("OPENMELD_GATEWAY_URL", "https://gateway.openmeld.invalid");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: { id: "session-1" },
            user: { id: "user-1", email: "you@company.com" },
          }),
          { status: 200 }
        )
      )
    );

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-valid",
        tokenType: "Bearer",
        authBaseUrl: "http://localhost:8788",
        clientId: "openmeld-cli",
      });

      const result = await runCommandAndCapture(() =>
        runAuthStatus({ view: "agent" })
      );

      const authLine = parseJsonLine(result.stdout, "auth.status.session");
      expect(result.exitCode).toBe(1);
      expect(authLine?.payload).toMatchObject({
        signedIn: false,
        state: "mismatch",
        guidanceReason: "mismatch",
        authBaseUrl: "http://localhost:8788",
        gatewayUrl: "https://gateway.openmeld.invalid",
      });
    });
  });

  it("shows active organization in auth status human and agent output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: { id: "session-1" },
            user: { id: "user-1", email: "you@company.com" },
          }),
          { status: 200 }
        )
      )
    );

    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-valid",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        activeOrganization: {
          id: "org-1",
          slug: "acme",
          name: "Acme",
          role: "owner",
        },
      });

      const human = await runCommandAndCapture(() =>
        runAuthStatus({ view: "human" })
      );
      expect(human.exitCode).toBe(0);
      expect(human.stdout).toContain("Active Organization: Acme (acme), owner");

      const agent = await runCommandAndCapture(() =>
        runAuthStatus({ view: "agent" })
      );
      const authLine = parseJsonLine(agent.stdout, "auth.status.session");
      expect(agent.exitCode).toBe(0);
      expect(authLine?.payload?.organization).toEqual({
        active: {
          id: "org-1",
          slug: "acme",
          name: "Acme",
          role: "owner",
        },
      });
    });
  });
});

describe("whoami auth state rows", () => {
  afterEach(() => {
    process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = undefined;
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.resetAllMocks();
    process.exitCode = undefined;
  });

  it("shows expired state in human card", async () => {
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-expired",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      });

      const result = await runCommandAndCapture(() =>
        runWhoami({ view: "human" })
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Status: sign in expired");
    });
  });

  it("shows invalid state in human card", async () => {
    await withTempHome(async (home) => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await mkdir(join(home, ".openmeld", "auth"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "auth", "session.json"),
        `${JSON.stringify({
          v: 1,
          tokenRef: { provider: "insecure-file" },
          tokenType: "Bearer",
          authBaseUrl: "https://auth.openmeld.invalid",
          clientId: "openmeld-cli",
          createdAt: new Date().toISOString(),
        })}\n`,
        "utf8"
      );

      const result = await runCommandAndCapture(() =>
        runWhoami({ view: "human" })
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Status: sign in needs refresh");
    });
  });

  it("shows revoked state in human card", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 401 }))
    );
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-revoked",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
      });

      const result = await runCommandAndCapture(() =>
        runWhoami({ view: "human" })
      );

      expect(result.exitCode).toBe(1);
      expect(result.stdout).toContain("Status: sign in removed");
    });
  });

  it("returns valid state and signed-in payload in agent output", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: { id: "session-1" },
            user: { id: "user-1", email: "you@company.com" },
          }),
          { status: 200 }
        )
      )
    );
    await withTempHome(async () => {
      process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
      await setAuthSession({
        accessToken: "token-valid",
        tokenType: "Bearer",
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        activeOrganization: {
          id: "org-1",
          slug: "acme",
          name: "Acme",
          role: "admin",
        },
      });

      const result = await runCommandAndCapture(() =>
        runWhoami({ view: "agent" })
      );

      const authLine = parseAuthLine(result.stdout);
      expect(result.exitCode).toBe(0);
      expect(authLine?.payload?.state).toBe("valid");
      expect(authLine?.payload?.signedIn).toBe(true);
      expect(authLine?.payload?.activeOrganization).toEqual({
        id: "org-1",
        slug: "acme",
        name: "Acme",
        role: "admin",
      });
      const contextLine = parseJsonLine(result.stdout, "whoami.context");
      expect(contextLine?.payload?.organization).toEqual({
        active: {
          id: "org-1",
          slug: "acme",
          name: "Acme",
          role: "admin",
        },
      });
    });
  });
});

async function runCommandAndCapture(
  command: () => Promise<void>
): Promise<CapturedResult> {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await withCapturedStdio(command);
    return {
      ...result,
      exitCode: process.exitCode,
    };
  } finally {
    process.exitCode = previousExitCode;
  }
}

function parseAuthLine(stdout: string): {
  code?: string;
  payload?: { [key: string]: unknown };
} {
  return parseJsonLine(stdout, "whoami.auth");
}

function parseJsonLine(
  stdout: string,
  code: string
): {
  code?: string;
  payload?: { [key: string]: unknown };
} {
  const lines = stdout
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const parsed = lines
    .map((line) => {
      try {
        return JSON.parse(line) as {
          code?: string;
          payload?: Record<string, unknown>;
        };
      } catch {
        return null;
      }
    })
    .filter(
      (value): value is { code?: string; payload?: Record<string, unknown> } =>
        Boolean(value)
    );

  return parsed.find((line) => line.code === code) ?? {};
}
