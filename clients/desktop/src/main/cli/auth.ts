import { execFile } from "node:child_process";
import type {
  AuthLogoutView,
  AuthView,
  CliProblem,
} from "../../shared/view-types";
import type { ExecFileFn } from "./driver";
import { resolveOpenMeldBin } from "./resolve-openmeld";

// `openmeld auth status` / `openmeld login` predate the `--json` envelope contract, so the
// json driver (which appends `--json`) can't drive them. We read the agent-view
// (`--view agent`) ndjson stream and pull the `auth.status.session` signal.

const DEFAULT_TIMEOUT_MS = 60_000;
const SIGN_IN_TIMEOUT_MS = 5 * 60_000;
const MAX_BUFFER_BYTES = 4 * 1024 * 1024;

type AuthDeps = {
  openMeldBin?: string | null;
  env?: NodeJS.ProcessEnv;
  exec?: ExecFileFn;
};

export function readAuthStatus(deps: AuthDeps = {}): Promise<AuthView> {
  return runOpenMeldAgentView(
    ["auth", "status"],
    deps,
    DEFAULT_TIMEOUT_MS
  ).then(parseAuthView);
}

/** Runs the browser sign-in flow (`openmeld login`), then re-reads auth status. */
export function runSignIn(deps: AuthDeps = {}): Promise<AuthView> {
  return runOpenMeldAgentView(["login"], deps, SIGN_IN_TIMEOUT_MS)
    .then(() => readAuthStatus(deps))
    .catch(() => readAuthStatus(deps));
}

/** Runs local sign-out (`openmeld logout`), then lets the caller reread auth/service. */
export function runSignOut(deps: AuthDeps = {}): Promise<AuthLogoutView> {
  return runOpenMeldAgentView(["logout"], deps, DEFAULT_TIMEOUT_MS).then(
    parseAuthLogoutView
  );
}

function runOpenMeldAgentView(
  args: readonly string[],
  deps: AuthDeps,
  timeoutMs: number
): Promise<{ stdout: string; failed: boolean }> {
  const exec = deps.exec ?? (execFile as unknown as ExecFileFn);
  const openMeldBin = resolveOpenMeldBin({
    env: deps.env,
    override: deps.openMeldBin,
  });
  return new Promise((resolve) => {
    exec(
      openMeldBin,
      [...args, "--view", "agent"],
      { timeout: timeoutMs, env: deps.env, maxBuffer: MAX_BUFFER_BYTES },
      (error, stdout) => {
        resolve({ stdout: stdout ?? "", failed: error != null });
      }
    );
  });
}

function parseAuthView(input: { stdout: string; failed: boolean }): AuthView {
  for (const line of input.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
      continue;
    }
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }
    const session = extractSession(parsed);
    if (session) {
      return {
        signedIn: session.signedIn,
        email: session.email,
        problem: null,
      };
    }
  }
  return {
    signedIn: input.failed ? null : false,
    email: null,
    problem: input.failed ? authProblem() : null,
  };
}

function parseAuthLogoutView(input: {
  stdout: string;
  failed: boolean;
}): AuthLogoutView {
  let localSession: AuthLogoutView["localSession"] = "unknown";
  let cleanup: AuthLogoutView["cleanup"] = {
    status: "unknown",
    message: null,
  };
  let sawLogoutSignal = false;

  for (const line of input.stdout.split("\n")) {
    const parsed = parseAgentViewLine(line);
    if (!parsed) {
      continue;
    }
    const code = typeof parsed.code === "string" ? parsed.code : null;
    if (!code) {
      continue;
    }

    if (code === "auth.logout.cleared") {
      sawLogoutSignal = true;
      localSession = "cleared";
      continue;
    }
    if (code === "auth.logout.no_session") {
      sawLogoutSignal = true;
      localSession = "none";
      continue;
    }
    if (code === "auth.logout.cleanup") {
      sawLogoutSignal = true;
      cleanup = {
        status: "finished",
        message: extractLineText(parsed),
      };
      continue;
    }
    if (code === "auth.logout.cleanup_warning") {
      sawLogoutSignal = true;
      cleanup = {
        status: "warning",
        message: extractLineText(parsed),
      };
    }
  }

  return {
    localSession,
    cleanup,
    problem:
      input.failed && !sawLogoutSignal
        ? {
            kind: "spawn_failed",
            code: "desktop.logout_unavailable",
            message: "Could not sign out of OpenMeld on this Mac.",
            requestId: null,
          }
        : null,
  };
}

function extractSession(
  parsed: Record<string, unknown>
): { signedIn: boolean; email: string | null } | null {
  const payload = isRecord(parsed.payload) ? parsed.payload : parsed;
  if (typeof payload.signedIn !== "boolean") {
    return null;
  }
  const user = isRecord(payload.user) ? payload.user : null;
  const email = user && typeof user.email === "string" ? user.email : null;
  return { signedIn: payload.signedIn, email };
}

function parseAgentViewLine(line: string): Record<string, unknown> | null {
  const trimmed = line.trim();
  if (!(trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    return null;
  }
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractLineText(parsed: Record<string, unknown>): string | null {
  return typeof parsed.text === "string" && parsed.text.trim()
    ? parsed.text
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function authProblem(): CliProblem {
  return {
    kind: "spawn_failed",
    code: "desktop.auth_unavailable",
    message: "Could not read OpenMeld sign-in status.",
    requestId: null,
  };
}
