import { gatewayErrorEnvelopeSchema } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInit } from "../src/commands/init";
import {
  runSpaceOrganizationList,
  runSpaceSelfServeJoin,
} from "../src/space/organization-space-command";
import {
  runSpaceWakeProgress,
  runSpaceWakeStop,
} from "../src/space/wake-control-command";
import {
  ACTIVE_WAKE_PROGRESS_FIXTURE,
  COLLABORATION_CONTROL_AGENT_PROFILE_ID,
  COLLABORATION_CONTROL_HUMAN_PROFILE_ID,
  COLLABORATION_CONTROL_SPACE_ID,
  ORGANIZATION_SPACE_DIRECTORY_FIXTURE,
  SELECTED_WAKE_PROGRESS_FIXTURE,
  SELECTED_WAKE_PROGRESS_WITHOUT_ELIGIBILITY_FIXTURE,
  SELF_SERVE_SPACE_JOIN_FIXTURE,
  TERMINAL_FAILURE_WAKE_PROGRESS_FIXTURE,
  TERMINAL_WAKE_PROGRESS_FIXTURE,
  WAKE_STOP_CANCELLED_FIXTURE,
  WAKE_STOP_NOT_STOPPABLE_FIXTURE,
  WAKE_STOP_REQUESTED_FIXTURE,
} from "./fixtures/space-collaboration-control";
import {
  withCapturedStdio,
  withSilencedStdio,
  withTempHome,
} from "./helpers/fs";

const getAuthSessionStateMock = vi.hoisted(() => vi.fn());
const resolveOpenMeldProfileByIdOrNameMock = vi.hoisted(() => vi.fn());

const PROFILE = {
  openMeldProfileId: COLLABORATION_CONTROL_HUMAN_PROFILE_ID,
  profileName: "Mira",
  profileKind: "human",
  status: "active",
  ownerUserId: "user-1",
  source: "cli_create",
  createdByUserId: "user-1",
  lastUsedAt: null,
  createdAt: "2026-07-20T00:00:00.000Z",
  updatedAt: "2026-07-20T00:00:00.000Z",
} as const;

const AGENT_PROFILE = {
  ...PROFILE,
  openMeldProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
  profileName: "Builder",
  profileKind: "agent",
} as const;

const VALID_AUTH_STATE = {
  state: "valid" as const,
  session: {
    v: 1 as const,
    accessToken: "token-123",
    tokenType: "Bearer",
    authBaseUrl: "http://localhost",
    clientId: "openmeld-cli",
    createdAt: "2026-07-20T00:00:00.000Z",
    user: {
      id: "user-1",
      email: "felix@example.com",
    },
  },
};

vi.mock("@clack/prompts", () => ({
  cancel: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  multiselect: vi.fn(),
  note: vi.fn(),
  outro: vi.fn(),
  password: vi.fn(),
  select: vi.fn(() => "no"),
  spinner: vi.fn(),
  text: vi.fn(),
}));

vi.mock("../src/config/resolve-openmeld-profile", () => ({
  resolveOpenMeldProfileOrNull: vi.fn(
    async (input?: { openMeldProfileId?: string }) =>
      input?.openMeldProfileId === AGENT_PROFILE.openMeldProfileId
        ? AGENT_PROFILE
        : PROFILE
  ),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  resolveOpenMeldProfileByIdOrName: (...args: unknown[]) =>
    resolveOpenMeldProfileByIdOrNameMock(...args),
}));

vi.mock("../src/config/auth-session", async () => {
  const actual = await vi.importActual<
    typeof import("../src/config/auth-session")
  >("../src/config/auth-session");
  return {
    ...actual,
    getAuthSessionState: (...args: unknown[]) =>
      getAuthSessionStateMock(...args),
  };
});

vi.mock("../src/runtime/interaction", () => ({
  canUseInteractivePrompts: vi.fn(() => true),
}));

describe("Space collaboration control commands", () => {
  beforeEach(() => {
    getAuthSessionStateMock.mockResolvedValue(VALID_AUTH_STATE);
    resolveOpenMeldProfileByIdOrNameMock.mockResolvedValue(PROFILE);
    process.exitCode = undefined;
  });

  afterEach(() => {
    getAuthSessionStateMock.mockReset();
    resolveOpenMeldProfileByIdOrNameMock.mockReset();
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  async function initializeProfile(): Promise<void> {
    await withSilencedStdio(async () => {
      await runInit({
        profile: "mira--collaboration-control",
        profileId: PROFILE.openMeldProfileId,
        profileName: PROFILE.profileName,
        kind: "human",
      });
    });
  }

  it("returns active Wake progress as a stable polling payload", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(ACTIVE_WAKE_PROGRESS_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeProgress({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          view: "agent",
        });
      });

      expect(JSON.parse(plainStdout.trim())).toEqual({
        type: "result",
        code: "space.wake_progress",
        payload: {
          mode: "active",
          pollState: "active",
          activeCount: 1,
          terminalCount: 0,
          query: ACTIVE_WAKE_PROGRESS_FIXTURE.query,
          items: ACTIVE_WAKE_PROGRESS_FIXTURE.items,
        },
      });
      const [request, init] = fetchSpy.mock.calls[0] ?? [];
      expect(String(init?.method ?? "GET").toUpperCase()).toBe("GET");
      const requestUrl = new URL(String(request));
      expect(requestUrl.pathname).toBe(
        `/v1/spaces/${COLLABORATION_CONTROL_SPACE_ID}/active-wake-progress`
      );
      expect(requestUrl.searchParams.get("includeWaitReason")).toBe("true");
    });
  });

  it("renders active Wake progress clearly for a human operator", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(ACTIVE_WAKE_PROGRESS_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeProgress({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          view: "human",
        });
      });

      expect(plainStdout).toContain("Active Wake Progress");
      expect(plainStdout).toContain("@builder");
      expect(plainStdout).toContain("This is live progress");
      expect(plainStdout).toContain("service trace");
    });
  });

  it("returns one selected Wake as a terminal polling payload", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(TERMINAL_WAKE_PROGRESS_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeProgress({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          clientMessageId: "client-message-terminal",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          view: "agent",
        });
      });

      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "space.wake_progress",
        payload: {
          mode: "client_message",
          pollState: "terminal",
          activeCount: 0,
          terminalCount: 1,
          items: TERMINAL_WAKE_PROGRESS_FIXTURE.items,
        },
      });
      const url = new URL(String(fetchSpy.mock.calls[0]?.[0]));
      expect(url.pathname).toBe(
        `/v1/spaces/${COLLABORATION_CONTROL_SPACE_ID}/wake-progress`
      );
      expect(url.searchParams.get("clientMessageId")).toBe(
        "client-message-terminal"
      );
      expect(url.searchParams.get("includeWaitReason")).toBe("true");
      expect(url.searchParams.get("targetProfileId")).toBe(
        COLLABORATION_CONTROL_AGENT_PROFILE_ID
      );
    });
  });

  it("returns a hosted failure as terminal instead of active polling progress", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(TERMINAL_FAILURE_WAKE_PROGRESS_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeProgress({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          clientMessageId: "client-message-terminal-failure",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          view: "agent",
        });
      });

      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "space.wake_progress",
        payload: {
          mode: "client_message",
          pollState: "terminal",
          activeCount: 0,
          terminalCount: 1,
          query: TERMINAL_FAILURE_WAKE_PROGRESS_FIXTURE.query,
          items: [
            expect.objectContaining({
              dispatchId: "dispatch-terminal-failure",
              failureReasonCode: "remote_agent.turn_not_completed",
              phase: "failed",
              terminal: true,
            }),
          ],
        },
      });
    });
  });

  it("keeps Wake progress store failures structured for polling agents", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const failure = gatewayErrorEnvelopeSchema.parse({
        ok: false,
        error: {
          code: "space.wake_progress.store_unavailable",
          message: "Wake progress is temporarily unavailable.",
          requestId: "req-wake-progress-store",
        },
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(failure), {
          status: 503,
          headers: {
            "content-type": "application/json",
            "x-openmeld-request-id": "req-wake-progress-store",
          },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeProgress({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "space.wake_progress.store_unavailable",
        payload: {
          status: "error",
          operation: "space.wake_progress",
          error: {
            code: "space.wake_progress.store_unavailable",
            requestId: "req-wake-progress-store",
            status: 503,
          },
        },
      });
    });
  });

  it("preserves invalid Wake progress response diagnostics for agent polling", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const invalidProgress = {
        ...ACTIVE_WAKE_PROGRESS_FIXTURE,
        items: [
          {
            ...ACTIVE_WAKE_PROGRESS_FIXTURE.items[0],
            phase: "mystery",
          },
        ],
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(invalidProgress), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-openmeld-request-id": "req-invalid-wake-progress",
          },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeProgress({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "gateway.invalid_response",
        payload: {
          status: "error",
          operation: "space.wake_progress",
          error: {
            code: "gateway.invalid_response",
            requestId: "req-invalid-wake-progress",
            schemaIssueMessage: expect.stringContaining("Invalid option"),
            schemaIssuePath: "items.0.phase",
            status: 200,
          },
        },
      });
    });
  });

  it("does not report success while the server only confirms a pending Stop request", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((request, init) => {
          const url = new URL(String(request));
          const method = String(init?.method ?? "GET").toUpperCase();
          if (method === "GET" && url.pathname.endsWith("/wake-progress")) {
            return Promise.resolve(
              new Response(JSON.stringify(SELECTED_WAKE_PROGRESS_FIXTURE), {
                status: 200,
                headers: { "content-type": "application/json" },
              })
            );
          }
          if (method === "POST" && url.pathname.endsWith("/wake-stop")) {
            return Promise.resolve(
              new Response(JSON.stringify(WAKE_STOP_REQUESTED_FIXTURE), {
                status: 200,
                headers: { "content-type": "application/json" },
              })
            );
          }
          throw new Error(`unexpected request: ${method} ${url.toString()}`);
        });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeStop({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          clientMessageId: "client-message-1",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          reason: "Stop requested by the CLI operator.",
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(2);
      expect(JSON.parse(plainStdout.trim())).toEqual({
        type: "result",
        code: "space.wake_stop",
        payload: {
          confirmed: false,
          terminal: false,
          target: {
            by: "client_message",
            clientMessageId: "client-message-1",
            targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          },
          response: WAKE_STOP_REQUESTED_FIXTURE,
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      const progressUrl = new URL(String(fetchSpy.mock.calls[0]?.[0]));
      expect(progressUrl.searchParams.get("includeWakeStopEligibility")).toBe(
        "true"
      );
      expect(progressUrl.searchParams.get("includeWaitReason")).toBe("true");
      const stopInit = fetchSpy.mock.calls[1]?.[1];
      expect(JSON.parse(String(stopInit?.body))).toEqual({
        reason: "Stop requested by the CLI operator.",
        target: {
          by: "client_message",
          clientMessageId: "client-message-1",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
        },
      });
      expect(String(stopInit?.body)).not.toContain("dispatchId");
    });
  });

  it("tells a human operator when a Stop request is still pending", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      vi.spyOn(globalThis, "fetch").mockImplementation((request, init) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.pathname.endsWith("/wake-progress")) {
          return Promise.resolve(
            new Response(JSON.stringify(SELECTED_WAKE_PROGRESS_FIXTURE), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (method === "POST" && url.pathname.endsWith("/wake-stop")) {
          return Promise.resolve(
            new Response(JSON.stringify(WAKE_STOP_REQUESTED_FIXTURE), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeStop({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          clientMessageId: "client-message-1",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          view: "human",
        });
      });

      expect(process.exitCode).toBe(2);
      expect(plainStdout).toContain("Wake Stop");
      expect(plainStdout).toContain("not confirmed stopped yet");
      expect(plainStdout).toContain("cancellation_requested");
    });
  });

  it("reports Stop success only after the server confirms cancellation", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      vi.spyOn(globalThis, "fetch").mockImplementation((request, init) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (
          method === "GET" &&
          url.pathname.endsWith("/active-wake-progress")
        ) {
          return Promise.resolve(
            new Response(JSON.stringify(ACTIVE_WAKE_PROGRESS_FIXTURE), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (method === "POST" && url.pathname.endsWith("/wake-stop")) {
          return Promise.resolve(
            new Response(JSON.stringify(WAKE_STOP_CANCELLED_FIXTURE), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeStop({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          sourceSignalId: "sig-source-1",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          view: "agent",
        });
      });

      expect(JSON.parse(plainStdout.trim())).toEqual({
        type: "result",
        code: "space.wake_stop",
        payload: {
          confirmed: true,
          terminal: true,
          target: {
            by: "source_signal",
            sourceSignalId: "sig-source-1",
            targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          },
          response: WAKE_STOP_CANCELLED_FIXTURE,
        },
      });
      expect(process.exitCode).toBeUndefined();
    });
  });

  it("rejects ambiguous Stop selectors before any progress or Stop request", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeStop({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          clientMessageId: "client-message-1",
          sourceSignalId: "sig-source-1",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "space.wake_stop.selector_invalid",
        payload: {
          status: "error",
          operation: "space.wake_stop",
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("preserves a server permission refusal as a structured Stop failure", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation((request, init) => {
          const url = new URL(String(request));
          const method = String(init?.method ?? "GET").toUpperCase();
          if (method === "GET" && url.pathname.endsWith("/wake-progress")) {
            return Promise.resolve(
              new Response(JSON.stringify(SELECTED_WAKE_PROGRESS_FIXTURE), {
                status: 200,
                headers: { "content-type": "application/json" },
              })
            );
          }
          if (method === "POST" && url.pathname.endsWith("/wake-stop")) {
            const refusal = gatewayErrorEnvelopeSchema.parse({
              ok: false,
              error: {
                code: "space.forbidden",
                message: "You do not have writable access to this Space.",
                requestId: "req-wake-stop-forbidden",
              },
            });
            return Promise.resolve(
              new Response(JSON.stringify(refusal), {
                status: 403,
                headers: {
                  "content-type": "application/json",
                  "x-openmeld-request-id": "req-wake-stop-forbidden",
                },
              })
            );
          }
          throw new Error(`unexpected request: ${method} ${url.toString()}`);
        });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeStop({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          clientMessageId: "client-message-1",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toEqual({
        type: "result",
        code: "space.forbidden",
        payload: {
          status: "error",
          operation: "space.wake_stop",
          error: {
            code: "space.forbidden",
            message: "You do not have writable access to this Space.",
            requestId: "req-wake-stop-forbidden",
            status: 403,
            upstreamCode: null,
          },
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });
  });

  it("returns a server-declined Stop as a structured semantic failure", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      vi.spyOn(globalThis, "fetch").mockImplementation((request, init) => {
        const url = new URL(String(request));
        const method = String(init?.method ?? "GET").toUpperCase();
        if (method === "GET" && url.pathname.endsWith("/wake-progress")) {
          return Promise.resolve(
            new Response(JSON.stringify(SELECTED_WAKE_PROGRESS_FIXTURE), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        if (method === "POST" && url.pathname.endsWith("/wake-stop")) {
          return Promise.resolve(
            new Response(JSON.stringify(WAKE_STOP_NOT_STOPPABLE_FIXTURE), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
          );
        }
        throw new Error(`unexpected request: ${method} ${url.toString()}`);
      });

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeStop({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          clientMessageId: "client-message-1",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toEqual({
        type: "result",
        code: "space.wake_stop",
        payload: {
          confirmed: false,
          terminal: false,
          target: {
            by: "client_message",
            clientMessageId: "client-message-1",
            targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          },
          response: WAKE_STOP_NOT_STOPPABLE_FIXTURE,
        },
      });
    });
  });

  it("fails closed without posting when Stop eligibility is absent", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(
          JSON.stringify(SELECTED_WAKE_PROGRESS_WITHOUT_ELIGIBILITY_FIXTURE),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceWakeStop({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          clientMessageId: "client-message-1",
          targetProfileId: COLLABORATION_CONTROL_AGENT_PROFILE_ID,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "space.wake_stop.not_eligible",
        payload: {
          status: "error",
          operation: "space.wake_stop",
          error: {
            code: "space.wake_stop.not_eligible",
          },
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  });

  it("lists the active Organization Space directory without local membership inference", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(ORGANIZATION_SPACE_DIRECTORY_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceOrganizationList({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          limit: 20,
          view: "agent",
        });
      });

      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(plainStdout.trim())).toEqual({
        type: "result",
        code: "space.list.organization",
        payload: {
          scope: "organization",
          organizationId: ORGANIZATION_SPACE_DIRECTORY_FIXTURE.organizationId,
          generatedAt: ORGANIZATION_SPACE_DIRECTORY_FIXTURE.generatedAt,
          total: 2,
          returned: 2,
          spaces: ORGANIZATION_SPACE_DIRECTORY_FIXTURE.spaces.map(
            ({ visibility, ...space }) => ({
              ...space,
              organizationVisibility: visibility,
            })
          ),
        },
      });
      const [request, init] = fetchSpy.mock.calls[0] ?? [];
      expect(String(init?.method ?? "GET").toUpperCase()).toBe("GET");
      expect(new URL(String(request)).pathname).toBe(
        "/v1/organizations/current/spaces-with-member-counts"
      );
    });
  });

  it("uses the versioned CLI envelope for explicit Organization JSON output", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(ORGANIZATION_SPACE_DIRECTORY_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceOrganizationList({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          limit: 1,
          json: true,
          view: "human",
        });
      });

      expect(process.exitCode).toBeUndefined();
      const envelope = JSON.parse(plainStdout.trim());
      expect(envelope).toEqual({
        schemaVersion: 1,
        type: "space.list.organization",
        scope: "organization",
        organizationId: ORGANIZATION_SPACE_DIRECTORY_FIXTURE.organizationId,
        generatedAt: ORGANIZATION_SPACE_DIRECTORY_FIXTURE.generatedAt,
        total: 2,
        returned: 1,
        spaces: ORGANIZATION_SPACE_DIRECTORY_FIXTURE.spaces.slice(0, 1),
      });
      expect(Object.keys(envelope)).toEqual([
        "schemaVersion",
        "type",
        "scope",
        "organizationId",
        "generatedAt",
        "total",
        "returned",
        "spaces",
      ]);
    });
  });

  it("labels Organization visibility without implying link privacy", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(ORGANIZATION_SPACE_DIRECTORY_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceOrganizationList({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          limit: 20,
          view: "human",
        });
      });

      expect(plainStdout).toContain(
        "Organization visibility: discoverable; Organization members can join"
      );
      expect(plainStdout).toContain("Organization visibility: invite only");
      expect(plainStdout).toContain(
        "Organization visibility does not describe access for people who have the link."
      );
      expect(plainStdout).toContain("openmeld space status <space-id> --json");
    });
  });

  it("preserves Organization directory failures as structured agent output", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const failure = gatewayErrorEnvelopeSchema.parse({
        ok: false,
        error: {
          code: "organization.membership_required",
          message: "Active organization membership is required.",
          requestId: "req-organization-directory-forbidden",
        },
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(failure), {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-openmeld-request-id": "req-organization-directory-forbidden",
          },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceOrganizationList({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          limit: 20,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "organization.membership_required",
        payload: {
          status: "error",
          operation: "space.list.organization",
          error: {
            requestId: "req-organization-directory-forbidden",
            status: 403,
          },
        },
      });
    });
  });

  it("uses the strict CLI error envelope for explicit Organization JSON output", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const failure = gatewayErrorEnvelopeSchema.parse({
        ok: false,
        error: {
          code: "organization.membership_required",
          message: "Active organization membership is required.",
          requestId: "req-organization-directory-json-forbidden",
        },
      });
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(failure), {
          status: 403,
          headers: {
            "content-type": "application/json",
            "x-openmeld-request-id":
              "req-organization-directory-json-forbidden",
          },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceOrganizationList({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          limit: 20,
          json: true,
          view: "human",
        });
      });

      expect(process.exitCode).toBe(1);
      const envelope = JSON.parse(plainStdout.trim());
      expect(envelope).toEqual({
        schemaVersion: 1,
        type: "error",
        error: {
          code: "organization.membership_required",
          message: "Active organization membership is required.",
          requestId: "req-organization-directory-json-forbidden",
        },
      });
      expect(Object.keys(envelope)).toEqual(["schemaVersion", "type", "error"]);
    });
  });

  it("preserves invalid Organization directory response diagnostics in agent view", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const invalidDirectory = {
        ...ORGANIZATION_SPACE_DIRECTORY_FIXTURE,
        spaces: [
          {
            ...ORGANIZATION_SPACE_DIRECTORY_FIXTURE.spaces[0],
            visibility: "mystery",
          },
        ],
      };
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(invalidDirectory), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-openmeld-request-id": "req-invalid-organization-directory",
          },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceOrganizationList({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          limit: 20,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "gateway.invalid_response",
        payload: {
          status: "error",
          operation: "space.list.organization",
          error: {
            code: "gateway.invalid_response",
            requestId: "req-invalid-organization-directory",
            schemaIssueMessage: expect.stringContaining("Invalid option"),
            schemaIssuePath: "spaces.0.visibility",
            status: 200,
          },
        },
      });
    });
  });

  it("self-serves public Organization Space membership without opening an interactive session", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify(SELF_SERVE_SPACE_JOIN_FIXTURE), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceSelfServeJoin({
          entryChecksHandled: true,
          profile: PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          password: "  space-secret  ",
          view: "agent",
        });
      });

      expect(process.exitCode).toBeUndefined();
      expect(JSON.parse(plainStdout.trim())).toEqual({
        type: "result",
        code: "space.join.self_serve",
        payload: {
          mode: "self_serve_membership",
          spaceId: COLLABORATION_CONTROL_SPACE_ID,
          membershipProfileId: COLLABORATION_CONTROL_HUMAN_PROFILE_ID,
          membershipChanged: true,
          alreadyJoined: false,
          response: SELF_SERVE_SPACE_JOIN_FIXTURE,
        },
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [request, init] = fetchSpy.mock.calls[0] ?? [];
      expect(new URL(String(request)).pathname).toBe(
        `/v1/spaces/${COLLABORATION_CONTROL_SPACE_ID}/join`
      );
      expect(String(init?.method ?? "GET").toUpperCase()).toBe("POST");
      expect(new Headers(init?.headers).get("x-openmeld-space-password")).toBe(
        "space-secret"
      );
      expect(init?.body).toBeUndefined();
    });
  });

  it("fails closed before self-service join when the selected profile is not human", async () => {
    await withTempHome(async () => {
      await initializeProfile();
      resolveOpenMeldProfileByIdOrNameMock.mockResolvedValueOnce(AGENT_PROFILE);
      const fetchSpy = vi.spyOn(globalThis, "fetch");

      const { plainStdout } = await withCapturedStdio(async () => {
        await runSpaceSelfServeJoin({
          entryChecksHandled: true,
          profile: AGENT_PROFILE.openMeldProfileId,
          baseUrl: "http://localhost",
          space: COLLABORATION_CONTROL_SPACE_ID,
          view: "agent",
        });
      });

      expect(process.exitCode).toBe(1);
      expect(JSON.parse(plainStdout.trim())).toMatchObject({
        type: "result",
        code: "space.join.human_profile_required",
        payload: {
          status: "error",
          operation: "space.join.self_serve",
        },
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});
