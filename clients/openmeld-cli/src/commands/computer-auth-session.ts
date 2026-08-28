import { resolveAuthBaseUrl } from "../config/auth-url";
import {
  type AuthUserSnapshot,
  extractAuthApiErrorMessage,
  fetchAuthUserSnapshot,
  requestDeviceToken,
  resolveDeviceAuthClientId,
  resolveDeviceTokenExpiresAt,
  revokeAuthAccessToken,
} from "./auth-device-session-client";

export type PreparedAuthSession = {
  accessToken: string;
  tokenType: string;
  authBaseUrl: string;
  clientId: string;
  expiresAt?: string;
  scope?: string;
  user: AuthUserSnapshot & { id: string };
};

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
      )}`
    );
  }

  const user = await fetchAuthUserSnapshot({
    authBaseUrl,
    accessToken: tokenResult.data.access_token,
  });
  const userId = normalizeOptionalString(user?.id);
  if (!userId) {
    const revoked = await revokeAuthAccessToken({
      accessToken: tokenResult.data.access_token,
      authBaseUrl,
      tokenType: tokenResult.data.token_type ?? "Bearer",
    });
    throw new Error(
      revoked
        ? "computer authorization did not return an OpenMeld account"
        : "computer authorization did not return an OpenMeld account, and OpenMeld could not revoke the unverified setup session"
    );
  }

  const expiresAt = resolveDeviceTokenExpiresAt(tokenResult.data.expires_in);
  const scope = normalizeOptionalString(tokenResult.data.scope);
  return {
    accessToken: tokenResult.data.access_token,
    tokenType: tokenResult.data.token_type ?? "Bearer",
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
): Promise<boolean> {
  return revokeAuthAccessToken(session);
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
