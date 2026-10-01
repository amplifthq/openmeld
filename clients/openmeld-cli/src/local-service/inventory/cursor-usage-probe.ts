import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { createUnavailableProviderUsageLimits } from "@openmeld/adapter-core";
import { projectCursorUsageLimits } from "@openmeld/adapter-cursor";
import { readMacOsNativeKeychainToken } from "../../config/macos-native-keychain";

const CURSOR_ENDPOINT = "https://api2.cursor.sh";
const TRAILING_SLASH_RE = /\/$/u;

export async function probeCursorUsageLimits(input: {
  observedAt: string;
  environment?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  fetchFn?: typeof fetch;
  readCredentials?: (path: string) => Promise<string>;
  readKeychain?: () => Promise<string | null>;
}) {
  const env = input.environment ?? process.env;
  const platform = input.platform ?? process.platform;
  const unavailable = (
    reason: "not_applicable" | "not_reported" | "refresh_failed"
  ) =>
    createUnavailableProviderUsageLimits(input.observedAt, undefined, {
      reason,
    });
  // Do not send a native account token to a configured third-party endpoint.
  const endpoint = env.CURSOR_API_ENDPOINT?.trim().replace(
    TRAILING_SLASH_RE,
    ""
  );
  if (endpoint && endpoint !== CURSOR_ENDPOINT) {
    return unavailable("not_applicable");
  }
  let token = env.CURSOR_AUTH_TOKEN?.trim();
  if (
    !token &&
    (env.CURSOR_API_KEY?.trim() || env.AGENT_CLI_CREDENTIAL_STORE === "memory")
  ) {
    return unavailable("not_applicable");
  }
  try {
    if (!token) {
      token = await readStoredCursorToken({
        ...input,
        environment: env,
        platform,
      });
    }
    if (!token) {
      return unavailable("not_reported");
    }
    const response = await (input.fetchFn ?? fetch)(
      `${CURSOR_ENDPOINT}/aiserver.v1.DashboardService/GetCurrentPeriodUsage`,
      {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(4000),
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          "connect-protocol-version": "1",
          "x-cursor-client-type": "cli",
        },
        body: "{}",
      }
    );
    if (!response.ok) {
      return unavailable(
        response.status === 401 || response.status === 403
          ? "not_applicable"
          : "refresh_failed"
      );
    }
    return projectCursorUsageLimits({
      observedAt: input.observedAt,
      value: await response.json(),
    });
  } catch {
    return unavailable("refresh_failed");
  }
}

async function readStoredCursorToken(input: {
  environment: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  readCredentials?: (path: string) => Promise<string>;
  readKeychain?: () => Promise<string | null>;
}): Promise<string | undefined> {
  const env = input.environment;
  if (
    input.platform === "darwin" &&
    env.AGENT_CLI_CREDENTIAL_STORE !== "file"
  ) {
    return (
      await (
        input.readKeychain ??
        (() =>
          readMacOsNativeKeychainToken({
            service: "cursor-access-token",
            account: "cursor-user",
          }))
      )()
    )?.trim();
  }
  const home =
    (input.platform === "win32" ? env.USERPROFILE : env.HOME) || homedir();
  let directory = join(env.XDG_CONFIG_HOME || join(home, ".config"), "cursor");
  if (input.platform === "darwin") {
    directory = join(home, ".cursor");
  } else if (input.platform === "win32") {
    directory = join(env.APPDATA || join(home, "AppData", "Roaming"), "Cursor");
  }
  const content = await (
    input.readCredentials ?? ((path) => readFile(path, "utf8"))
  )(join(directory, "auth.json"));
  const credentials: unknown = JSON.parse(content);
  return credentials &&
    typeof credentials === "object" &&
    "accessToken" in credentials &&
    typeof credentials.accessToken === "string"
    ? credentials.accessToken.trim()
    : undefined;
}
