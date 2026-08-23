import { afterEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import { runConnect as runConnectCommand } from "../src/space/connect";
import { withCapturedStdio, withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

const connectWebSocketMock = vi.fn();
const SPACE_NOT_FOUND_ERROR = /couldn't find that Space/i;
const ACCESS_DENIED_ERROR = /forbidden/i;
const HUMAN_RUNTIME_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SPACE_PASSWORD_REQUIRED_ERROR = /space password required/i;

type RunConnectInput = Parameters<typeof runConnectCommand>[0];

const runConnect = async (
  input: Omit<RunConnectInput, "connectionMode"> & {
    connectionMode?: RunConnectInput["connectionMode"];
  }
) =>
  await runConnectCommand({
    ...input,
    connectionMode: input.connectionMode ?? "join",
  });

vi.mock("../src/transport/ws", () => {
  return {
    connectWebSocket: (
      ...args: Parameters<typeof connectWebSocketMock>
    ): ReturnType<typeof connectWebSocketMock> => connectWebSocketMock(...args),
  };
});

describe("connect error handling", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("uses distinct cursor warnings and exposes aggregate socket details", async () => {
    connectWebSocketMock.mockRejectedValue(
      new AggregateError(
        [
          new Error("connect ECONNREFUSED ::1:65535"),
          new Error("connect ECONNREFUSED 127.0.0.1:65535"),
        ],
        "socket connection failed"
      )
    );

    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? "GET").toUpperCase();

      if (method === "GET" && url.pathname.endsWith("/meta")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              spaceId: "ops-room",
              organizationId: "org-1",
              visibility: "private",
            }),
            {
              status: 200,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }
      if (method === "GET" && url.pathname.includes("/cursors/")) {
        throw new Error("cursor get down");
      }
      if (method === "PATCH" && url.pathname.includes("/cursors/")) {
        throw new Error("cursor patch down");
      }

      throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
    });

    const { result, stderr } = await withCapturedStdio(async () => {
      let caught: unknown = null;

      await withTempHome(async () => {
        await runInit({
          profile: "codex--connect-errors",
          profileId: "aaaaaaaa-0000-0000-0000-000000000000",
          profileName: "Codex",
          kind: "agent",
          silent: true,
        });

        try {
          await runConnect({
            profile: "codex--connect-errors",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "http://localhost:65535",
            space: "ops-room",
            stdio: false,
            output: "text",
            role: "incident-triage",
            view: "human",
          });
        } catch (error) {
          caught = error;
        }
      });

      return { caught };
    });

    expect(result.caught).toBeInstanceOf(Error);
    expect((result.caught as Error).message).toContain("connect ECONNREFUSED");

    expect(stderr).toContain(
      "OpenMeld couldn't load where you left off. Live updates will continue."
    );
    expect(stderr).toContain(
      "OpenMeld couldn't save your new place. Live updates will continue."
    );
    expect(stderr).not.toContain(
      "warn: failed to persist lastSeenTs: cursor get down"
    );
    expect(stderr).not.toContain(
      "warn: failed to persist lastSeenTs: cursor patch down"
    );
  });

  it("returns view-aware error when joining a non-existent space", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(String(input));
      const method = String(init?.method ?? "GET").toUpperCase();
      if (method === "GET" && url.pathname.endsWith("/meta")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              error: {
                code: "upstream_error",
                message: "space not found",
                requestId: "req-space-not-found",
              },
            }),
            {
              status: 404,
              headers: { "content-type": "application/json" },
            }
          )
        );
      }
      throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
    });

    await withTempHome(async () => {
      for (const view of ["human", "agent"] as const) {
        let caught: unknown = null;
        try {
          await runConnect({
            profile: "codex--connect-errors",
            openMeldProfile: createOpenMeldProfileInput({
              openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
              profileName: "Codex",
              profileKind: "agent",
            }),
            baseUrl: "http://localhost:65535",
            space: "ops-room",
            stdio: false,
            output: "text",
            view,
          });
        } catch (error) {
          caught = error;
        }
        expect(caught).toBeInstanceOf(Error);
        if (view === "human") {
          expect((caught as Error).message).toMatch(SPACE_NOT_FOUND_ERROR);
          expect((caught as Error).message).toContain("Check the Space ID");
        } else {
          expect((caught as Error).message.toLowerCase()).toContain(
            "space not found"
          );
        }
      }
    });
  });

  it("does not upsert profile-space-history active before websocket connect succeeds", async () => {
    connectWebSocketMock.mockRejectedValue(new Error("socket unavailable"));
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/meta")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                spaceId: "ops-room",
                organizationId: "org-1",
                visibility: "private",
                name: "Ops Room",
                creator: {
                  profileId: HUMAN_RUNTIME_PROFILE_ID,
                  profileName: "Felix",
                  kind: "human",
                },
                createdAt: "2026-02-20T00:00:00.000Z",
                updatedAt: "2026-02-20T01:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }

        if (method === "GET" && url.pathname.includes("/cursors/")) {
          return Promise.resolve(
            new Response(JSON.stringify({}), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });

    await withTempHome(async () => {
      await expect(
        runConnect({
          profile: "codex--connect-errors",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "http://localhost:65535",
          space: "ops-room",
          trackProfileSpaceHistory: true,
          stdio: false,
          output: "text",
          role: "Ops",
          view: "human",
        })
      ).rejects.toThrow("socket unavailable");
    });

    const upsertCall = fetchMock.mock.calls.find((call) => {
      const url = new URL(String(call[0]));
      const method = String(
        (call[1] as RequestInit | undefined)?.method ?? "GET"
      ).toUpperCase();
      return method === "PATCH" && url.pathname.endsWith("/spaces/ops-room");
    });
    expect(upsertCall).toBeUndefined();
  });

  it("syncs profile-space-history status to removed on space-not-found join", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/meta")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                error: {
                  code: "upstream_error",
                  message: "space not found",
                  requestId: "req-space-not-found",
                },
              }),
              {
                status: 404,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }

        if (method === "PATCH" && url.pathname.endsWith("/status")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                profileId: "aaaaaaaa-0000-0000-0000-000000000000",
                gatewayHost: "localhost:65535",
                spaceId: "ops-room",
                status: "removed",
                updatedAt: "2026-02-24T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });

    await withTempHome(async () => {
      await expect(
        runConnect({
          profile: "codex--connect-errors",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "http://localhost:65535",
          space: "ops-room",
          trackProfileSpaceHistory: true,
          stdio: false,
          output: "text",
          view: "human",
        })
      ).rejects.toThrow(SPACE_NOT_FOUND_ERROR);
    });

    const statusCall = fetchMock.mock.calls.find((call) => {
      const url = new URL(String(call[0]));
      const method = String(
        (call[1] as RequestInit | undefined)?.method ?? "GET"
      ).toUpperCase();
      return method === "PATCH" && url.pathname.endsWith("/status");
    });
    expect(statusCall).toBeDefined();
    const requestBody = JSON.parse(
      String((statusCall?.[1] as RequestInit | undefined)?.body ?? "{}")
    ) as { status?: string };
    expect(requestBody.status).toBe("removed");
  });

  it("syncs profile-space-history status to inaccessible on access denied join", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/meta")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                error: {
                  code: "upstream_error",
                  message: "forbidden",
                  requestId: "req-space-forbidden",
                },
              }),
              {
                status: 403,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }

        if (method === "PATCH" && url.pathname.endsWith("/status")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                profileId: "aaaaaaaa-0000-0000-0000-000000000000",
                gatewayHost: "localhost:65535",
                spaceId: "ops-room",
                status: "inaccessible",
                updatedAt: "2026-02-24T00:00:00.000Z",
              }),
              {
                status: 200,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });

    await withTempHome(async () => {
      await expect(
        runConnect({
          profile: "codex--connect-errors",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "http://localhost:65535",
          space: "ops-room",
          trackProfileSpaceHistory: true,
          stdio: false,
          output: "text",
          view: "human",
        })
      ).rejects.toThrow(ACCESS_DENIED_ERROR);
    });

    const statusCall = fetchMock.mock.calls.find((call) => {
      const url = new URL(String(call[0]));
      const method = String(
        (call[1] as RequestInit | undefined)?.method ?? "GET"
      ).toUpperCase();
      return method === "PATCH" && url.pathname.endsWith("/status");
    });
    expect(statusCall).toBeDefined();
    const requestBody = JSON.parse(
      String((statusCall?.[1] as RequestInit | undefined)?.body ?? "{}")
    ) as { status?: string };
    expect(requestBody.status).toBe("inaccessible");
  });

  it("forwards password header when fetching protected space metadata", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const url = new URL(String(input));
        const method = String(init?.method ?? "GET").toUpperCase();

        if (method === "GET" && url.pathname.endsWith("/meta")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                ok: false,
                error: {
                  code: "space.password_required",
                  message: "space password required",
                  requestId: "req-space-password-required",
                },
              }),
              {
                status: 401,
                headers: { "content-type": "application/json" },
              }
            )
          );
        }

        throw new Error(`unexpected fetch call: ${method} ${url.toString()}`);
      });

    await withTempHome(async () => {
      await expect(
        runConnect({
          profile: "codex--connect-errors",
          openMeldProfile: createOpenMeldProfileInput({
            openMeldProfileId: "aaaaaaaa-0000-0000-0000-000000000000",
            profileName: "Codex",
            profileKind: "agent",
          }),
          baseUrl: "http://localhost:65535",
          space: "ops-room",
          password: "pw-123456",
          stdio: false,
          output: "text",
          view: "human",
        })
      ).rejects.toThrow(SPACE_PASSWORD_REQUIRED_ERROR);
    });

    const metaCall = fetchMock.mock.calls.find((call) => {
      const url = new URL(String(call[0]));
      const method = String(
        (call[1] as RequestInit | undefined)?.method ?? "GET"
      ).toUpperCase();
      return method === "GET" && url.pathname.endsWith("/meta");
    });
    const headers = ((metaCall?.[1] as RequestInit | undefined)?.headers ??
      {}) as Record<string, string>;
    expect(headers["x-openmeld-space-password"]).toBe("pw-123456");
  });
});

function createOpenMeldProfileInput(input: {
  openMeldProfileId: string;
  profileName: string;
  profileKind: "human" | "agent" | "system";
}) {
  return createTestOpenMeldProfile({
    openMeldProfileId: input.openMeldProfileId,
    profileName: input.profileName,
    profileKind: input.profileKind,
    createdAt: "2026-02-20T00:00:00.000Z",
    updatedAt: "2026-02-20T00:00:00.000Z",
  });
}
