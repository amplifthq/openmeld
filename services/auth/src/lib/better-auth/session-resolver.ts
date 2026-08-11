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
  verifyLocalUserExists?: (userId: string) => Promise<boolean>;
}): Promise<SessionResolutionResult> {
  let sessionData: Awaited<ReturnType<AuthInstance["api"]["getSession"]>>;

  try {
    sessionData = await input.auth.api.getSession({
      headers: input.headers,
    });
  } catch (cause) {
    return {
      status: "upstream_error",
      cause,
    };
  }

  if (!(sessionData?.session && sessionData?.user)) {
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
