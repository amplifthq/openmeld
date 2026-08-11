import { describe, expect, it } from "vitest";
import { resolveOpenMeldAccountContext } from "../src/config/account-context";

const SESSION_USER_KEY_REGEX = /^session-[a-f0-9]{16}$/;

describe("account context resolution", () => {
  it("derives a session-scoped user key when user id/email are missing", () => {
    const context = resolveOpenMeldAccountContext({
      session: {
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-02-21T03:10:00.000Z",
        user: {},
      },
    });

    expect(context.key.hostKey).toBe("auth.openmeld.invalid");
    expect(context.key.userKey).toMatch(SESSION_USER_KEY_REGEX);
  });

  it("ignores non-string user identifiers instead of coercing them", () => {
    const context = resolveOpenMeldAccountContext({
      session: {
        authBaseUrl: "https://auth.openmeld.invalid",
        clientId: "openmeld-cli",
        createdAt: "2026-02-21T03:10:00.000Z",
        user: {
          id: 1234,
          email: { value: "user@example.com" },
          name: ["Felix"],
        } as never,
      },
    });

    expect(context.key.hostKey).toBe("auth.openmeld.invalid");
    expect(context.key.userKey).toMatch(SESSION_USER_KEY_REGEX);
    expect(context.user).toBeUndefined();
  });
});
