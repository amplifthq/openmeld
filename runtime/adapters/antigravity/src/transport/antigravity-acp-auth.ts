import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { RuntimeAgentControllerLaunchContract } from "@openmeld/adapter-core";

const AUTH_URL_PREFIX =
  "Open the following link to authenticate the ACP server: ";
const WHITESPACE_RE = /\s/u;
const LOOPBACK_REDIRECT_RE = /^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/u;

export function antigravityAuthRequired(): Error {
  return Object.assign(
    new Error("Sign in to Antigravity ACP on this computer, then check again."),
    {
      code: "auth.required",
      errorType: "auth",
    }
  );
}

// The official Python server prints this line outside JSON-RPC during OAuth.
// Consume only that known extension; malformed protocol output still fails.
export function consumeAntigravityAuthLine(
  onAuthorizationUrl?: (url: string) => void
) {
  const seen = new Set<string>();
  return (line: string): boolean => {
    if (
      !onAuthorizationUrl &&
      line.endsWith(
        "Credentials missing or invalid. Launching browser login flow..."
      )
    ) {
      throw antigravityAuthRequired();
    }
    if (!line.startsWith(AUTH_URL_PREFIX)) {
      return false;
    }
    if (!onAuthorizationUrl) {
      throw antigravityAuthRequired();
    }
    const text = line.slice(AUTH_URL_PREFIX.length);
    let url: URL;
    try {
      url = new URL(text);
    } catch {
      throw new Error("Antigravity returned an invalid sign-in URL.");
    }
    const redirect = url.searchParams.get("redirect_uri");
    if (
      text.length > 16_384 ||
      WHITESPACE_RE.test(text) ||
      url.origin !== "https://accounts.google.com" ||
      url.pathname !== "/o/oauth2/v2/auth" ||
      url.username ||
      url.password ||
      url.hash ||
      url.searchParams.getAll("state").length !== 1 ||
      !url.searchParams.get("state") ||
      url.searchParams.getAll("redirect_uri").length !== 1 ||
      url.searchParams.getAll("response_type").length !== 1 ||
      url.searchParams.get("response_type") !== "code" ||
      !redirect ||
      !LOOPBACK_REDIRECT_RE.test(redirect)
    ) {
      throw new Error("Antigravity returned an invalid sign-in URL.");
    }
    const port = Number(new URL(redirect).port);
    if (port < 1024 || port > 65_535) {
      throw new Error("Antigravity returned an invalid sign-in URL.");
    }
    if (!seen.has(text)) {
      seen.add(text);
      onAuthorizationUrl(text);
    }
    return true;
  };
}

export function antigravityAcpEnvironment(
  launch: RuntimeAgentControllerLaunchContract,
  env?: Record<string, string | undefined>
) {
  const path =
    launch.kind === "node_script" ? launch.scriptPath : launch.commandPath;
  const harness = join(
    dirname(path),
    process.platform === "win32"
      ? "localharness_external.exe"
      : "localharness_external"
  );
  // Python webbrowser falls back to the system browser when a handler fails.
  // A successful sink suppresses fallback. Verify it before starting the server.
  // The URL is delivered through the native stdout line, never a shell command.
  const browser =
    process.platform === "win32"
      ? 'node -e "process.exit(0)" -- %s'
      : "/usr/bin/true";
  execFileSync(
    process.platform === "win32" ? "node" : browser,
    process.platform === "win32" ? ["-e", "process.exit(0)"] : [],
    { timeout: 2000, stdio: "ignore" }
  );
  return {
    ...env,
    ...(existsSync(harness) ? { ANTIGRAVITY_HARNESS_PATH: harness } : {}),
    // All ACP entry points use the same native file store. Do not access the
    // interactive system credential store during inventory or background work.
    AGY_ACP_FORCE_FILE_STORAGE: "1",
    BROWSER: browser,
    PYTHONUNBUFFERED: "1",
  };
}
