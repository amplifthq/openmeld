import { describe, expect, it } from "vitest";
import { readAccountSession } from "../src/account-session";
import { createOpenMeldApiClient } from "../src/client";
import { createFetchTransport } from "../src/transport";

const accountSession = {
  session: { id: "current-session" },
  user: {
    id: "account",
    email: "account@example.com",
    name: "Account",
    image: null,
    emailVerified: true,
    createdAt: "2024-01-02T00:00:00.000Z",
  },
};

function clientFor(payload: unknown, status = 200) {
  return createOpenMeldApiClient({
    baseUrl: "https://openmeld.test",
    transport: createFetchTransport({
      fetch: async () => Response.json(payload, { status }),
    }),
  });
}

describe("account session read boundary", () => {
  it.each([
    200, 401, 403, 500, 503,
  ])("preserves HTTP %s semantics", async (status) => {
    const result = readAccountSession(clientFor(accountSession, status));
    if (status === 200) {
      await expect(result).resolves.toEqual(accountSession);
    } else if (status === 401) {
      await expect(result).resolves.toBeNull();
    } else {
      await expect(result).rejects.toMatchObject({ status });
    }
  });

  it.each([
    { ...accountSession, token: "secret" },
    { ...accountSession, session: { id: "current-session", token: "secret" } },
    {
      ...accountSession,
      session: { id: "current-session", ipAddress: "127.0.0.1" },
    },
    { ...accountSession, user: { ...accountSession.user, secret: "secret" } },
    { ...accountSession, session: {} },
    { ...accountSession, session: { id: "" } },
    { ...accountSession, user: { ...accountSession.user, id: "" } },
    {
      ...accountSession,
      user: { ...accountSession.user, emailVerified: undefined },
    },
    { ...accountSession, user: { ...accountSession.user, createdAt: null } },
    {
      ...accountSession,
      user: { ...accountSession.user, createdAt: "not-a-date" },
    },
    null,
  ])("rejects malformed or credential-bearing successful payloads %#", async (payload) => {
    await expect(readAccountSession(clientFor(payload))).rejects.toThrow(
      "Invalid account session response."
    );
  });
});
