import { isAPIError } from "better-auth/api";
import type { createAuth } from ".";

type AuthInstance = ReturnType<typeof createAuth>;
type SessionPayload = NonNullable<
  Awaited<ReturnType<AuthInstance["api"]["getSession"]>>
>;

export type SessionRecord = SessionPayload["session"];
export type UserRecord = SessionPayload["user"];

export const AUTH_UPSTREAM_UNREACHABLE_CODE = "auth.upstream_unreachable";
export const AUTH_UPSTREAM_UNREACHABLE_MESSAGE = "auth upstream unavailable";

export type SessionResolutionResult =
  | {
      status: "authenticated";
      user: UserRecord;
      session: SessionRecord;
    }
  | {
      status: "unauthenticated";
      reason: "missing_session";
    }
  | {
      status: "unauthenticated";
      reason: "stale_local_user";
      userId: string;
    }
  | {
      status: "upstream_error";
      cause: unknown;
    }
  | {
      status: "local_state_error";
      cause: unknown;
    };

export async function resolveSessionFromHeaders(input: {
  auth: AuthInstance;
  headers: Headers;
  disableCookieCache?: boolean;
  deferSessionRefresh?: boolean;
  // HTTP-only opt-in. Never include credentials in the resolution projection.
  onSessionCookies?: (cookies: readonly string[]) => void;
  verifyLocalUserExists?: (userId: string) => Promise<boolean>;
}): Promise<SessionResolutionResult> {
  let sessionData: Awaited<ReturnType<AuthInstance["api"]["getSession"]>>;
  let sessionCookies: string[] = [];

  try {
    const options = {
      headers: input.headers,
      query: {
        ...(input.disableCookieCache ? { disableCookieCache: true } : {}),
        // Entry projections can leave renewal to the account-session HTTP read.
        // Identity-only RPC callers cannot return the vendor's renewal cookies.
        ...(input.deferSessionRefresh || !input.onSessionCookies
          ? { disableRefresh: true }
          : {}),
      },
    };
    if (input.onSessionCookies) {
      const result = await input.auth.api.getSession({
        ...options,
        returnHeaders: true,
      });
      sessionData = result.response;
      sessionCookies = result.headers.getSetCookie();
    } else {
      sessionData = await input.auth.api.getSession(options);
    }
  } catch (cause) {
    if (isAPIError(cause) && cause.body?.code === "account.unavailable") {
      return { status: "unauthenticated", reason: "missing_session" };
    }
    return {
      status: "upstream_error",
      cause,
    };
  }

  if (!(sessionData?.session && sessionData?.user)) {
    input.onSessionCookies?.(sessionCookies);
    return {
      status: "unauthenticated",
      reason: "missing_session",
    };
  }

  const userId = String(sessionData.user.id);
  if (input.verifyLocalUserExists) {
    try {
      const localUserExists = await input.verifyLocalUserExists(userId);
      if (!localUserExists) {
        return {
          status: "unauthenticated",
          reason: "stale_local_user",
          userId,
        };
      }
    } catch (cause) {
      return {
        status: "local_state_error",
        cause,
      };
    }
  }

  // A stale or unverifiable local user must never receive successful renewal.
  input.onSessionCookies?.(sessionCookies);
  return {
    status: "authenticated",
    user: sessionData.user,
    session: sessionData.session,
  };
}

export function toSessionResolutionErrorLog(cause: unknown) {
  if (cause instanceof Error) {
    return {
      message: cause.message,
      stack: cause.stack,
    };
  }

  return {
    value: String(cause),
  };
}
