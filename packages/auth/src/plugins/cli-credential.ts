import { MEMBER_AGENTS_ENABLED } from "@openmeld/schemas";
import type { BetterAuthPlugin } from "better-auth";
import {
  APIError,
  createAuthMiddleware,
  getSessionFromCtx,
} from "better-auth/api";

// Sensitive operations accept the owner's own Web or App session, but not the
// CLI login credential while a task with another root requester runs
// (design-plans/member-agent-program.md §4.7). The two must stay
// distinguishable even though a CLI can hold a browser session's own token
// (`openmeld setup --ott` returns the generating session). So a session is
// marked, once and permanently, as soon as a CLI holds it.

export const CLI_CREDENTIAL_SESSION_FIELD = "cliCredentialAt";
export const INTERACTIVE_SESSION_REQUIRED_CODE =
  "auth.interactive_session_required";

const BEARER_SCHEME = "bearer ";
const ONE_TIME_TOKEN_VERIFY_PATH = "/one-time-token/verify";
const DEVICE_TOKEN_PATH = "/device/token";

/**
 * Endpoints that could turn a CLI-held session into a new interactive one,
 * or change how the account signs in. A CLI-held session may not call them.
 */
const INTERACTIVE_SESSION_ONLY_PATHS = new Set([
  "/electron/transfer-user",
  "/passkey/generate-register-options",
  "/passkey/verify-registration",
  "/link-social",
  "/change-email",
  "/change-password",
]);

type SessionShape = {
  session: { token: string; [CLI_CREDENTIAL_SESSION_FIELD]?: unknown };
};

export function isCliCredentialSessionRecord(session: unknown): boolean {
  if (!(session && typeof session === "object")) {
    return false;
  }
  const value = (session as Record<string, unknown>)[
    CLI_CREDENTIAL_SESSION_FIELD
  ];
  return value !== null && value !== undefined;
}

export function hasBearerAuthorization(headers: Headers | undefined): boolean {
  const authorization = headers?.get("authorization");
  return (
    typeof authorization === "string" &&
    authorization.slice(0, BEARER_SCHEME.length).toLowerCase() ===
      BEARER_SCHEME &&
    authorization.slice(BEARER_SCHEME.length).trim().length > 0
  );
}

function readRequestHeaders(context: {
  headers?: Headers;
  request?: Request;
}): Headers | undefined {
  return context.request?.headers ?? context.headers;
}

function readSessionShape(value: unknown): SessionShape | null {
  if (!(value && typeof value === "object")) {
    return null;
  }
  const session = (value as { session?: unknown }).session;
  if (
    !(session && typeof session === "object") ||
    typeof (session as { token?: unknown }).token !== "string"
  ) {
    return null;
  }
  return value as SessionShape;
}

/** The session a CLI now holds after this request, if any. */
function readHeldSession(context: {
  context: { newSession?: unknown; returned?: unknown; session?: unknown };
  path?: string;
}): SessionShape | null {
  if (context.path === DEVICE_TOKEN_PATH) {
    return readSessionShape(context.context.newSession);
  }
  if (context.path === ONE_TIME_TOKEN_VERIFY_PATH) {
    return readSessionShape(context.context.returned);
  }
  return (
    readSessionShape(context.context.session) ??
    readSessionShape(context.context.returned)
  );
}

export function createCliCredentialPlugin(): BetterAuthPlugin {
  return {
    id: "openmeld-cli-credential",
    schema: {
      session: {
        fields: {
          [CLI_CREDENTIAL_SESSION_FIELD]: {
            type: "date",
            required: false,
            input: false,
          },
        },
      },
    },
    hooks: {
      before: [
        {
          // Marking runs regardless, so sessions are classified before the
          // MemberAgent program turns enforcement on; refusing waits for it.
          matcher: (context) =>
            MEMBER_AGENTS_ENABLED &&
            INTERACTIVE_SESSION_ONLY_PATHS.has(context.path ?? ""),
          handler: createAuthMiddleware(async (context) => {
            const session = await getSessionFromCtx(context, {
              disableRefresh: true,
            });
            if (!session) {
              return;
            }
            // The cookie cache can predate the marker: read the stored session.
            const stored = await context.context.internalAdapter.findSession(
              session.session.token
            );
            if (
              hasBearerAuthorization(readRequestHeaders(context)) ||
              !stored ||
              isCliCredentialSessionRecord(stored.session)
            ) {
              throw new APIError("FORBIDDEN", {
                code: INTERACTIVE_SESSION_REQUIRED_CODE,
                message: "Sign in to OpenMeld in your browser to do this.",
              });
            }
          }),
        },
      ],
      after: [
        {
          matcher: (context) =>
            context.path === DEVICE_TOKEN_PATH ||
            context.path === ONE_TIME_TOKEN_VERIFY_PATH ||
            hasBearerAuthorization(readRequestHeaders(context)),
          handler: createAuthMiddleware(async (context) => {
            const held = readHeldSession(context);
            if (!held || isCliCredentialSessionRecord(held.session)) {
              return;
            }
            await context.context.internalAdapter.updateSession(
              held.session.token,
              { [CLI_CREDENTIAL_SESSION_FIELD]: new Date() }
            );
          }),
        },
      ],
    },
  };
}
