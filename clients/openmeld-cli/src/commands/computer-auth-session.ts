import { resolveAuthBaseUrl } from "../config/auth-url";
import {
  type AuthUserSnapshot,
  extractAuthApiErrorMessage,
  fetchAuthUserSnapshot,
  type RevokeAuthAccessTokenResult,
  requestDeviceToken,
  resolveDeviceAuthClientId,
  resolveDeviceTokenExpiresAt,
  revokeAuthAccessToken,
} from "./auth-device-session-client";
import type { PreparedAuthSession } from "./prepared-auth-session";

export type { PreparedAuthSession } from "./prepared-auth-session";

export async function exchangeComputerAuthorizationGrant(input: {
  authBaseUrl?: string;
  clientId?: string;
  deviceCode: string;
}): Promise<PreparedAuthSession> {
  const authBaseUrl = resolveAuthBaseUrl(input.authBaseUrl);
  const clientId = resolveDeviceAuthClientId(input.clientId);
  const deviceCode = normalizeRequiredString(
    input.deviceCode,
    "computer authorization code is required"
  );
  const tokenResult = await requestDeviceToken({
    authBaseUrl,
    clientId,
    deviceCode,
  });
  if (!tokenResult.ok) {
    throw new Error(
      `computer authorization failed: ${extractAuthApiErrorMessage(
        tokenResult.error,
        tokenResult.status
      )}. Return to OpenMeld Web and get a new setup command to try again.`
    );
  }

  let user: AuthUserSnapshot;
  try {
    user = await fetchAuthUserSnapshot({
      authBaseUrl,
      accessToken: tokenResult.data.access_token,
    });
  } catch (error) {
    const cleanup = await revokeAuthAccessToken({
      accessToken: tokenResult.data.access_token,
      authBaseUrl,
      tokenType: tokenResult.data.token_type,
    });
    throw new Error(
      `computer authorization could not verify its OpenMeld account: ${toErrorMessage(error)}${formatCleanupFailure(cleanup)}`,
      { cause: error }
    );
  }
  const userId = normalizeOptionalString(user?.id);
  if (!userId) {
    const cleanup = await revokeAuthAccessToken({
      accessToken: tokenResult.data.access_token,
      authBaseUrl,
      tokenType: tokenResult.data.token_type,
    });
    throw new Error(
      `computer authorization account response did not include a user id${formatCleanupFailure(cleanup)}`
    );
  }

  const expiresAt = resolveDeviceTokenExpiresAt(tokenResult.data.expires_in);
  const scope = normalizeOptionalString(tokenResult.data.scope);
  return {
    accessToken: tokenResult.data.access_token,
    tokenType: tokenResult.data.token_type,
    authBaseUrl,
    clientId,
    ...(expiresAt ? { expiresAt } : {}),
    ...(scope ? { scope } : {}),
    user: {
      ...user,
      id: userId,
    },
  };
}

export function revokePreparedAuthSession(
  session: PreparedAuthSession
): Promise<RevokeAuthAccessTokenResult> {
  return revokeAuthAccessToken(session);
}

function formatCleanupFailure(result: RevokeAuthAccessTokenResult): string {
  if (result.ok) {
    return "";
  }
  const status =
    result.error.status === null
      ? "network error"
      : `HTTP ${result.error.status}`;
  return `; cleanup failed at ${result.error.endpoint} (${status}): ${result.error.message}`;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : String(error ?? "unknown error");
}

function normalizeRequiredString(value: string, message: string): string {
  const normalized = normalizeOptionalString(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeOptionalString(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
