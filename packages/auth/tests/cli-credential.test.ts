import { describe, expect, it, vi } from "vitest";

const sessionFromContext = vi.hoisted(() => vi.fn());
vi.mock("@openmeld/schemas", async (importActual) => ({
  ...(await importActual<typeof import("@openmeld/schemas")>()),
  MEMBER_AGENTS_ENABLED: true,
}));
vi.mock("better-auth/api", async (importActual) => ({
  ...(await importActual<typeof import("better-auth/api")>()),
  getSessionFromCtx: sessionFromContext,
}));

import {
  CLI_CREDENTIAL_SESSION_FIELD,
  createCliCredentialPlugin,
  hasBearerAuthorization,
  INTERACTIVE_SESSION_REQUIRED_CODE,
  isCliCredentialSessionRecord,
} from "../src/plugins/cli-credential";

// Every session a CLI holds stays marked (member-agent-program.md §4.7).
// The native OTT exchange is covered through Better Auth's handler in
// cli-credential-handoff.test.ts.

const plugin = createCliCredentialPlugin();
const markHook = plugin.hooks?.after?.[0];
const blockHook = plugin.hooks?.before?.[0];

function afterContext(input: {
  path: string;
  headers?: Record<string, string>;
  newSession?: unknown;
  returned?: unknown;
  session?: unknown;
}) {
  const updateSession = vi.fn(
    async (_token: string, _data: Record<string, unknown>) => null
  );
  return {
    context: {
      internalAdapter: { updateSession },
      newSession: input.newSession ?? null,
      returned: input.returned,
      session: input.session ?? null,
    },
    headers: new Headers(input.headers ?? {}),
    path: input.path,
    updateSession,
  };
}

describe("CLI credential sessions", () => {
  it("adds the marker column without accepting it as input", () => {
    expect(plugin.schema).toEqual({
      session: {
        fields: {
          [CLI_CREDENTIAL_SESSION_FIELD]: {
            input: false,
            required: false,
            type: "date",
          },
        },
      },
    });
  });

  it("marks a device-login session and any Bearer use", async () => {
    const cases = [
      afterContext({
        newSession: { session: { token: "device-token" } },
        path: "/device/token",
      }),
      afterContext({
        headers: { authorization: "Bearer bearer-token" },
        path: "/get-session",
        returned: { session: { token: "bearer-token" } },
      }),
    ];
    for (const context of cases) {
      expect(markHook?.matcher(context as never)).toBe(true);
      await markHook?.handler(context as never);
    }
    expect(
      cases.map((context) => context.updateSession.mock.calls[0]?.[0])
    ).toEqual(["device-token", "bearer-token"]);
    for (const context of cases) {
      expect(context.updateSession.mock.calls[0]?.[1]).toEqual({
        [CLI_CREDENTIAL_SESSION_FIELD]: expect.any(Date),
      });
    }
  });

  it("writes the marker once and ignores cookie requests", async () => {
    const marked = afterContext({
      headers: { authorization: "Bearer bearer-token" },
      path: "/get-session",
      returned: {
        session: {
          token: "bearer-token",
          [CLI_CREDENTIAL_SESSION_FIELD]: new Date(),
        },
      },
    });
    await markHook?.handler(marked as never);
    expect(marked.updateSession).not.toHaveBeenCalled();
    const cookie = afterContext({
      headers: { cookie: "better-auth.session_token=signed" },
      path: "/get-session",
    });
    expect(markHook?.matcher(cookie as never)).toBe(false);
  });

  it("keeps a CLI-held session away from endpoints that could mint an interactive one", () => {
    for (const path of [
      "/electron/transfer-user",
      "/passkey/generate-register-options",
      "/passkey/verify-registration",
      "/link-social",
      "/change-email",
      "/change-password",
    ]) {
      expect(blockHook?.matcher({ path } as never)).toBe(true);
    }
    expect(blockHook?.matcher({ path: "/get-session" } as never)).toBe(false);
  });

  it("refuses a Bearer or marked session there and lets a browser session through", async () => {
    const attempt = (input: {
      headers: Record<string, string>;
      session: Record<string, unknown>;
      stored?: Record<string, unknown>;
    }) => {
      // The context's session can come from the cookie cache; the stored one
      // is authoritative.
      sessionFromContext.mockResolvedValue({
        session: { token: input.session.token },
        user: { id: "user-1" },
      });
      return blockHook?.handler({
        context: {
          internalAdapter: {
            findSession: async () => ({
              session: input.stored ?? input.session,
              user: { id: "user-1" },
            }),
          },
        },
        headers: new Headers(input.headers),
        path: "/electron/transfer-user",
      } as never);
    };
    await expect(
      attempt({
        headers: { authorization: "Bearer cli-token" },
        session: { token: "cli-token" },
      })
    ).rejects.toMatchObject({
      body: { code: INTERACTIVE_SESSION_REQUIRED_CODE },
    });
    await expect(
      attempt({
        headers: { cookie: "better-auth.session_token=signed" },
        session: { token: "held", [CLI_CREDENTIAL_SESSION_FIELD]: new Date() },
      })
    ).rejects.toMatchObject({
      body: { code: INTERACTIVE_SESSION_REQUIRED_CODE },
    });
    await expect(
      attempt({
        headers: { cookie: "better-auth.session_token=signed" },
        session: { token: "cached" },
        stored: {
          token: "cached",
          [CLI_CREDENTIAL_SESSION_FIELD]: new Date(),
        },
      })
    ).rejects.toMatchObject({
      body: { code: INTERACTIVE_SESSION_REQUIRED_CODE },
    });
    await expect(
      attempt({
        headers: { cookie: "better-auth.session_token=signed" },
        session: { token: "browser" },
      })
    ).resolves.toBeUndefined();
  });

  it("reads the marker and the Bearer scheme strictly", () => {
    expect(isCliCredentialSessionRecord({ cliCredentialAt: new Date() })).toBe(
      true
    );
    expect(isCliCredentialSessionRecord({ cliCredentialAt: null })).toBe(false);
    expect(isCliCredentialSessionRecord({})).toBe(false);
    expect(
      hasBearerAuthorization(new Headers({ authorization: "bearer token" }))
    ).toBe(true);
    expect(
      hasBearerAuthorization(new Headers({ authorization: "Bearer " }))
    ).toBe(false);
    expect(
      hasBearerAuthorization(new Headers({ authorization: "Basic abc" }))
    ).toBe(false);
    expect(hasBearerAuthorization(undefined)).toBe(false);
  });
});
