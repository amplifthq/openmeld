import { createHash } from "node:crypto";
import type { StoredAuthSession } from "./auth-session";
import { normalizeAccountKey, type OpenMeldAccountKey } from "./paths";

type AuthSessionLike = Pick<
  StoredAuthSession,
  "authBaseUrl" | "clientId" | "createdAt" | "user"
>;

export type OpenMeldAccountContext = {
  key: OpenMeldAccountKey;
  source: "session" | "fallback";
  authBaseUrl?: string;
  user?: {
    id?: string;
    email?: string;
    name?: string;
  };
};

export function resolveOpenMeldAccountContext(input?: {
  session?: AuthSessionLike | null;
}): OpenMeldAccountContext {
  const session = input?.session ?? null;
  if (!session) {
    return {
      key: normalizeAccountKey({}),
      source: "fallback",
    };
  }

  const normalizedBaseUrl = normalizeOptionalString(session.authBaseUrl);
  const hostKey = resolveHostKey(normalizedBaseUrl);
  const user = normalizeUser(session.user);
  const userKey =
    user?.id ??
    user?.email ??
    buildSessionScopedUserKey({
      authBaseUrl: normalizedBaseUrl,
      clientId: normalizeOptionalString(session.clientId),
      createdAt: normalizeOptionalString(session.createdAt),
    });
  const key = normalizeAccountKey({
    hostKey: hostKey ?? undefined,
    userKey,
  });

  return {
    key,
    source: "session",
    ...(normalizedBaseUrl ? { authBaseUrl: normalizedBaseUrl } : {}),
    ...(user ? { user } : {}),
  };
}

export async function resolveCurrentOpenMeldAccountContext(): Promise<OpenMeldAccountContext> {
  const { getAuthSessionMetadata } = await import("./auth-session");
  const session = await getAuthSessionMetadata().catch(() => null);
  return resolveOpenMeldAccountContext({ session });
}

function resolveHostKey(baseUrl: string | null): string | null {
  if (!baseUrl) {
    return null;
  }
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}

function buildSessionScopedUserKey(input: {
  authBaseUrl: string | null;
  clientId: string | null;
  createdAt: string | null;
}): string | undefined {
  const seed = [input.authBaseUrl, input.clientId, input.createdAt]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("|");
  if (!seed) {
    return undefined;
  }
  const digest = createHash("sha256").update(seed, "utf8").digest("hex");
  return `session-${digest.slice(0, 16)}`;
}

function normalizeUser(value: unknown): OpenMeldAccountContext["user"] | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const id = normalizeOptionalString(record.id);
  const email = normalizeOptionalString(record.email);
  const name = normalizeOptionalString(record.name);
  if (!(id || email || name)) {
    return null;
  }
  return {
    ...(id ? { id } : {}),
    ...(email ? { email } : {}),
    ...(name ? { name } : {}),
  };
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
