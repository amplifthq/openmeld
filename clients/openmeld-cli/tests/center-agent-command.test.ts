import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import type { WakeProgressItem } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCenterAgentAsk } from "../src/center-agent/ask-command";
import {
  runCenterAgentContext,
  runCenterAgentContextReceipt,
} from "../src/center-agent/context-command";
import {
  runCenterAgentAudit,
  runCenterAgentDesignate,
  runCenterAgentPause,
  runCenterAgentResume,
  runCenterAgentStatus,
} from "../src/center-agent/management-command";
import {
  type StoredActiveOrganization,
  setAuthSession,
} from "../src/config/auth-session";
import {
  createCapturedBetterAuthGetFullOrganizationResponse,
  createCapturedBetterAuthOrganizationListResponse,
  createCapturedBetterAuthSessionResponse,
} from "./fixtures/auth-organizations";
import { withCapturedStdio, withTempHome } from "./helpers/fs";

type FetchCall = {
  pathname: string;
  method: string;
  body: unknown;
  requestedOrganizationId: string | null;
  search: string;
};

const ACTIVE_ORGANIZATION: StoredActiveOrganization = {
  id: "org-1",
  slug: "acme",
  name: "Acme",
  role: "owner",
};
const SECOND_ORGANIZATION: StoredActiveOrganization = {
  id: "org-2",
  slug: "launch",
  name: "Launch Team",
  role: "admin",
};
const CENTER_AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const SECOND_AGENT_PROFILE_ID = "agt_22222222-2222-4222-8222-222222222222";
const HUMAN_PROFILE_ID = "33333333-3333-4333-8333-333333333333";
const CREATED_AT = "2026-07-05T01:02:03.000Z";
const CENTER_AGENT_DM_SPACE_ID = "space-center-agent-dm-1";

describe("center-agent commands", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
    process.exitCode = undefined;
  });

  it("shows the current Center Agent designation with profile name and id", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentStatus({ view: "agent" })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      const envelope = parseJsonLine(result.stdout, "center_agent.status");
      expect(envelope?.payload).toMatchObject({
        status: "ok",
        organization: {
          active: ACTIVE_ORGANIZATION,
        },
        centerAgent: {
          designated: true,
          profile: {
            profileId: CENTER_AGENT_PROFILE_ID,
            profileName: "Atlas",
          },
          designation: {
            agentProfileId: CENTER_AGENT_PROFILE_ID,
            designatedBy: "user-1",
            createdAt: CREATED_AT,
          },
        },
      });
    });

    expect(calls.map((call) => call.pathname)).toContain(
      "/v1/organizations/current/directory"
    );
  });

  it("asks through the existing Center Agent Chat and returns the durable reply with Local Agent attribution", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          sessionId: "codex-thread-1",
          text: "Summarize the launch blockers I should handle next.",
          via: "codex",
          view: "agent",
        })
      );

      expect(
        result.exitCode,
        `${result.stdout}\nCalls: ${JSON.stringify(calls)}`
      ).toBeUndefined();
      expect(
        parseJsonLine(result.stdout, "center_agent.ask")?.payload
      ).toMatchObject({
        answer: "The launch has two blockers.",
        interaction: {
          centerAgentProfileId: CENTER_AGENT_PROFILE_ID,
          dispatchId: "dispatch-center-agent-ask-1",
          phase: "replied",
          source: {
            client: "codex",
            kind: "local_agent",
            sessionId: "codex-thread-1",
          },
          spaceId: CENTER_AGENT_DM_SPACE_ID,
        },
        status: "completed",
      });
    });

    const messageCall = calls.find(
      (call) =>
        call.pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
        call.method === "POST"
    );
    expect(messageCall?.body).toMatchObject({
      messageEnvelope: {
        activationTargets: [CENTER_AGENT_PROFILE_ID],
        referenceTargets: [],
        text: "Summarize the launch blockers I should handle next.",
      },
      meta: {
        centerAgentInteractionSource: {
          client: "codex",
          kind: "local_agent",
          sessionId: "codex-thread-1",
        },
      },
      text: "Summarize the launch blockers I should handle next.",
    });
    expect(calls).toContainEqual(
      expect.objectContaining({
        method: "POST",
        pathname: "/v1/organizations/current/center-agent/dm-space",
      })
    );
  });

  it("returns a terminal Center Agent failure without waiting for the ask timeout", async () => {
    const calls = mockCenterAgentFetch({
      wakeProgressItem: {
        clientMessageId: "client-message-from-request",
        dispatchId: "dispatch-center-agent-ask-1",
        failureReasonCode: "remote_agent.turn_not_completed",
        message: "Center Agent could not complete this request.",
        phase: "failed",
        sourceSignalId: "signal-center-agent-ask-1",
        targetLabel: "Atlas",
        targetProfileId: CENTER_AGENT_PROFILE_ID,
        terminal: true,
        updatedAtMs: 2,
      },
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "What is 37 plus 58?",
          timeoutSeconds: 300,
          view: "agent",
        })
      );

      expect(result.exitCode).toBe(1);
      expect(
        parseJsonLine(result.stdout, "remote_agent.turn_not_completed")?.payload
      ).toMatchObject({
        error: {
          code: "remote_agent.turn_not_completed",
          message: "Center Agent could not complete this request.",
        },
        interaction: {
          dispatchId: "dispatch-center-agent-ask-1",
          phase: "failed",
        },
        status: "error",
      });
    });

    expect(
      calls.filter(
        (call) =>
          call.pathname ===
          `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/wake-progress`
      )
    ).toHaveLength(1);
  });

  it("targets an explicit Organization without changing the active Organization used by the next request", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const explicitResult = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          organization: SECOND_ORGANIZATION.slug,
          text: "Record the launch decision.",
          view: "agent",
          wait: false,
        })
      );
      expect(explicitResult.exitCode, explicitResult.stdout).toBeUndefined();
      expect(
        parseJsonLine(explicitResult.stdout, "center_agent.ask")?.payload
      ).toMatchObject({
        organization: {
          selection: "explicit",
          target: {
            id: SECOND_ORGANIZATION.id,
            name: SECOND_ORGANIZATION.name,
            slug: SECOND_ORGANIZATION.slug,
          },
        },
        status: "submitted",
      });
      expect(
        parseJsonLine(explicitResult.stdout, "center_agent.ask")?.payload
          ?.organization
      ).toEqual({
        selection: "explicit",
        target: {
          id: SECOND_ORGANIZATION.id,
          name: SECOND_ORGANIZATION.name,
          slug: SECOND_ORGANIZATION.slug,
        },
      });

      const defaultResult = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Record the Acme decision.",
          view: "agent",
          wait: false,
        })
      );
      expect(defaultResult.exitCode, defaultResult.stdout).toBeUndefined();
      expect(
        parseJsonLine(defaultResult.stdout, "center_agent.ask")?.payload
      ).toMatchObject({
        organization: {
          selection: "current",
          target: {
            id: ACTIVE_ORGANIZATION.id,
            name: ACTIVE_ORGANIZATION.name,
            slug: ACTIVE_ORGANIZATION.slug,
          },
        },
        status: "submitted",
      });
      expect(
        parseJsonLine(defaultResult.stdout, "center_agent.ask")?.payload
          ?.organization
      ).toEqual({
        selection: "current",
        target: {
          id: ACTIVE_ORGANIZATION.id,
          name: ACTIVE_ORGANIZATION.name,
          slug: ACTIVE_ORGANIZATION.slug,
        },
      });
    });

    const organizationScopedCalls = calls.filter(
      (call) =>
        call.pathname === "/v1/organizations/current/center-agent/dm-space" ||
        (call.pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
          call.method === "POST")
    );
    expect(
      organizationScopedCalls.map((call) => call.requestedOrganizationId)
    ).toEqual([
      SECOND_ORGANIZATION.id,
      SECOND_ORGANIZATION.id,
      ACTIVE_ORGANIZATION.id,
      ACTIVE_ORGANIZATION.id,
    ]);
  });

  it("uses the account-selected Organization when another session still has an older active Organization", async () => {
    const calls = mockCenterAgentFetch({
      serverActiveOrganizationId: ACTIVE_ORGANIZATION.id,
      serverSelectedOrganizationId: SECOND_ORGANIZATION.id,
    });

    await withTempHome(async () => {
      await writeSignedInSession(ACTIVE_ORGANIZATION);

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Use the Organization I selected most recently.",
          view: "agent",
          wait: false,
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      expect(
        parseJsonLine(result.stdout, "center_agent.ask")?.payload
      ).toMatchObject({
        organization: {
          selection: "current",
          target: {
            id: SECOND_ORGANIZATION.id,
            name: SECOND_ORGANIZATION.name,
            slug: SECOND_ORGANIZATION.slug,
          },
        },
      });
    });

    expect(
      calls
        .filter(
          (call) =>
            call.pathname ===
              "/v1/organizations/current/center-agent/dm-space" ||
            (call.pathname ===
              `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
              call.method === "POST")
        )
        .map((call) => call.requestedOrganizationId)
    ).toEqual([SECOND_ORGANIZATION.id, SECOND_ORGANIZATION.id]);
  });

  it("fails closed when the account-selected Organization is no longer available", async () => {
    const calls = mockCenterAgentFetch({
      serverActiveOrganizationId: ACTIVE_ORGANIZATION.id,
      serverSelectedOrganizationId: "org-removed",
    });

    await withTempHome(async () => {
      await writeSignedInSession(ACTIVE_ORGANIZATION);

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Do not reroute this request to another Organization.",
          view: "agent",
          wait: false,
        })
      );

      expect(result.exitCode).toBe(1);
      expect(
        parseJsonLine(
          result.stdout,
          "center_agent.organization_selection_unavailable"
        )?.payload
      ).toMatchObject({
        error: {
          code: "center_agent.organization_selection_unavailable",
        },
        status: "error",
      });
    });

    expect(
      calls.some((call) =>
        call.pathname.startsWith("/v1/organizations/current")
      )
    ).toBe(false);
  });

  it("does not fall back to a stale local Organization when the server has no active selection", async () => {
    const calls = mockCenterAgentFetch({
      serverActiveOrganizationId: null,
      serverSelectedOrganizationId: null,
    });

    await withTempHome(async () => {
      await writeSignedInSession(ACTIVE_ORGANIZATION);

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Do not route this through a stale Organization.",
          view: "agent",
          wait: false,
        })
      );

      expect(result.exitCode).toBe(1);
      expect(
        parseJsonLine(result.stdout, "center_agent.organization_required")
          ?.payload
      ).toMatchObject({
        error: { code: "center_agent.organization_required" },
        status: "error",
      });
    });

    expect(
      calls.some((call) =>
        call.pathname.startsWith("/v1/organizations/current")
      )
    ).toBe(false);
  });

  it("fails closed when an explicit Organization is not available to the account", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          organization: "unknown-team",
          text: "Do not send this request.",
          view: "agent",
          wait: false,
        })
      );

      expect(result.exitCode).toBe(1);
      expect(
        parseJsonLine(result.stdout, "center_agent.organization_not_found")
          ?.payload
      ).toMatchObject({
        error: {
          code: "center_agent.organization_not_found",
          nextStep:
            "Run `openmeld org list`, then retry with an Organization shown there.",
        },
        status: "error",
      });
    });

    expect(
      calls.some((call) =>
        call.pathname.startsWith("/v1/organizations/current")
      )
    ).toBe(false);
  });

  it("automatically attributes a request to the detected Local Agent session", async () => {
    vi.stubEnv("CODEX_THREAD_ID", "codex-thread-detected");
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Summarize the launch blockers I should handle next.",
          view: "agent",
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
    });

    const messageCall = calls.find(
      (call) =>
        call.pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
        call.method === "POST"
    );
    expect(messageCall?.body).toMatchObject({
      meta: {
        centerAgentInteractionSource: {
          client: "codex",
          kind: "local_agent",
          sessionId: "codex-thread-detected",
        },
      },
    });
  });

  it("submits without polling when a Local Agent explicitly does not wait", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Start the release readiness review.",
          via: "claude-code",
          view: "agent",
          wait: false,
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      expect(
        parseJsonLine(result.stdout, "center_agent.ask")?.payload
      ).toMatchObject({
        answer: null,
        interaction: {
          source: {
            client: "claude-code",
            kind: "local_agent",
          },
        },
        status: "submitted",
      });
    });

    expect(calls.some((call) => call.pathname.endsWith("/wake-progress"))).toBe(
      false
    );
  });

  it("returns the visible reply without depending on a separate result archive", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          pollIntervalMs: 1,
          text: "Summarize the launch blockers.",
          via: "codex",
          view: "agent",
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      expect(
        parseJsonLine(result.stdout, "center_agent.ask")?.payload
      ).toMatchObject({
        answer: "The launch has two blockers.",
        status: "completed",
      });
    });

    expect(
      calls.some(
        (call) =>
          call.pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/result`
      )
    ).toBe(false);
  });

  it("keeps an accepted Center Agent request pending when a later status read fails", async () => {
    const wakeProgressError = new Error(
      "space.wake_progress request timed out after 10000ms"
    ) as Error & { code?: string };
    wakeProgressError.code = "network.timeout";
    const calls = mockCenterAgentFetch({ wakeProgressError });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Create a dedicated Task for the launch review.",
          via: "codex",
          view: "agent",
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      const payload = parseJsonLine(result.stdout, "center_agent.ask")?.payload;
      const postCall = calls.find(
        (call) =>
          call.pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
          call.method === "POST"
      );
      const postedClientMessageId = (
        postCall?.body as { meta?: { clientMessageId?: unknown } }
      )?.meta?.clientMessageId;

      expect(postedClientMessageId).toEqual(expect.any(String));
      expect(payload).toMatchObject({
        answer: null,
        interaction: {
          centerAgentProfileId: CENTER_AGENT_PROFILE_ID,
          clientMessageId: postedClientMessageId,
          phase: "request_sent",
          signalId: "signal-center-agent-ask-1",
          spaceId: CENTER_AGENT_DM_SPACE_ID,
          waitFailure: {
            code: "network.timeout",
          },
        },
        status: "pending",
      });
    });
  });

  it("keeps the accepted dispatch pending when the visible reply read fails", async () => {
    const signalReadError = new Error(
      "space.signals.read request timed out after 10000ms"
    ) as Error & { code?: string };
    signalReadError.code = "network.timeout";
    const calls = mockCenterAgentFetch({ signalReadError });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Create a dedicated Task for the launch review.",
          via: "codex",
          view: "agent",
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      const payload = parseJsonLine(result.stdout, "center_agent.ask")?.payload;
      const postCall = calls.find(
        (call) =>
          call.pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
          call.method === "POST"
      );
      const postedClientMessageId = (
        postCall?.body as { meta?: { clientMessageId?: unknown } }
      )?.meta?.clientMessageId;

      expect(payload).toMatchObject({
        answer: null,
        interaction: {
          clientMessageId: postedClientMessageId,
          dispatchId: "dispatch-center-agent-ask-1",
          phase: "replied",
          signalId: "signal-center-agent-ask-1",
          waitFailure: {
            code: "network.timeout",
          },
        },
        status: "pending",
      });
    });
  });

  it("replays an ambiguous Center Agent Signal submission with the same client message id", async () => {
    const signalPostTimeout = new Error(
      "space.send request timed out after 10000ms"
    ) as Error & { code?: string };
    signalPostTimeout.code = "network.timeout";
    const calls = mockCenterAgentFetch({
      signalPostErrors: [signalPostTimeout],
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Create a dedicated Task for the launch review.",
          via: "codex",
          view: "agent",
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      expect(
        parseJsonLine(result.stdout, "center_agent.ask")?.payload
      ).toMatchObject({
        interaction: {
          signalId: "signal-center-agent-ask-1",
        },
        status: "completed",
      });
    });

    const signalPosts = calls.filter(
      (call) =>
        call.pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
        call.method === "POST"
    );
    expect(signalPosts).toHaveLength(2);
    expect(signalPosts[1]?.body).toEqual(signalPosts[0]?.body);
  });

  it("preserves the client message id without inviting a duplicate when Signal submission stays ambiguous", async () => {
    const signalPostTimeouts = Array.from({ length: 2 }, () => {
      const error = new Error(
        "space.send request timed out after 10000ms"
      ) as Error & { code?: string };
      error.code = "network.timeout";
      return error;
    });
    const calls = mockCenterAgentFetch({
      signalPostErrors: signalPostTimeouts,
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAsk({
          text: "Create a dedicated Task for the launch review.",
          via: "codex",
          view: "agent",
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      const payload = parseJsonLine(result.stdout, "center_agent.ask")?.payload;
      expect(payload).toMatchObject({
        answer: null,
        interaction: {
          centerAgentProfileId: CENTER_AGENT_PROFILE_ID,
          clientMessageId: expect.any(String),
          phase: "submission_unknown",
          spaceId: CENTER_AGENT_DM_SPACE_ID,
          submissionAttemptCount: 2,
          submissionFailure: {
            code: "network.timeout",
          },
        },
        status: "submission_unknown",
      });
    });

    const signalPosts = calls.filter(
      (call) =>
        call.pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
        call.method === "POST"
    );
    expect(signalPosts).toHaveLength(2);
    expect(signalPosts[1]?.body).toEqual(signalPosts[0]?.body);
  });

  it("shows a clear next step when no Center Agent is designated", async () => {
    mockCenterAgentFetch({
      designationResponse: jsonResponse({
        organizationId: "org-1",
        designation: null,
      }),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentStatus({ view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("No Center Agent Designated");
      expect(result.plainStdout).toContain(
        "Status: No Center Agent is designated."
      );
      expect(result.plainStdout).toContain(
        "Next Step: Run `openmeld center-agent designate <agent-profile-id>` after connecting an Agent Profile you own."
      );
    });
  });

  it("designates the Center Agent and makes replacement semantics explicit", async () => {
    const calls = mockCenterAgentFetch({
      designateResponse: jsonResponse({
        organizationId: "org-1",
        designation: centerAgentDesignation(SECOND_AGENT_PROFILE_ID),
        status: "replaced",
      }),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentDesignate({
          agentProfileId: SECOND_AGENT_PROFILE_ID,
          view: "human",
        })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Center Agent Replaced");
      expect(result.plainStdout).toContain(
        `Agent Profile ID: ${SECOND_AGENT_PROFILE_ID}`
      );
      expect(result.plainStdout).toContain(
        "Result: This Agent Profile is now the Center Agent for Acme."
      );
    });

    expect(calls).toContainEqual(
      expect.objectContaining({
        pathname: "/v1/organizations/current/center-agent/designation",
        method: "PUT",
        body: { agentProfileId: SECOND_AGENT_PROFILE_ID },
        search: "",
      })
    );
  });

  it("fails closed before API calls when no active organization is selected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            session: { id: "session-1" },
            user: { id: "user-1" },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );

    await withTempHome(async () => {
      await writeSignedInSession(null);

      const result = await runCommandAndCapture(() =>
        runCenterAgentAudit({ view: "agent" })
      );

      expect(result.exitCode).toBe(1);
      const envelope = parseJsonLine(
        result.stdout,
        "center_agent.organization_required"
      );
      expect(envelope?.payload).toMatchObject({
        status: "error",
        organization: {
          active: null,
        },
        error: {
          code: "center_agent.organization_required",
        },
      });
    });
  });

  it.each([
    {
      name: "non owner/admin",
      response: gatewayErrorResponse({
        status: 403,
        code: "center_agent.permission_required",
        message: "internal permission detail",
      }),
      expectedCode: "center_agent.owner_or_admin_required",
    },
    {
      name: "missing profile",
      response: gatewayErrorResponse({
        status: 404,
        code: "center_agent.profile_not_found",
        message: "raw missing profile detail",
      }),
      expectedCode: "center_agent.profile_not_found",
    },
    {
      name: "profile outside active org",
      response: gatewayErrorResponse({
        status: 403,
        code: "center_agent.profile_org_mismatch",
        message: "raw org mismatch detail",
      }),
      expectedCode: "center_agent.profile_org_mismatch",
    },
    {
      name: "missing self Binding",
      response: gatewayErrorResponse({
        status: 409,
        code: "center_agent.profile_binding_required",
        message: "raw binding detail",
      }),
      expectedCode: "center_agent.profile_binding_required",
    },
    {
      name: "invalid response",
      response: jsonResponse({
        organizationId: "org-1",
        designation: null,
        status: "designated",
      }),
      expectedCode: "center_agent.response_invalid",
    },
  ])("classifies designate rejection: $name", async ({
    response,
    expectedCode,
  }) => {
    mockCenterAgentFetch({ designateResponse: response });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentDesignate({
          agentProfileId: CENTER_AGENT_PROFILE_ID,
          view: "agent",
        })
      );

      expect(result.exitCode).toBe(1);
      const envelope = parseJsonLine(result.stdout, expectedCode);
      expect(envelope?.payload).toMatchObject({
        status: "error",
        organization: {
          active: ACTIVE_ORGANIZATION,
        },
        error: {
          code: expectedCode,
        },
        agentProfileId: CENTER_AGENT_PROFILE_ID,
      });
      expect(result.stdout).not.toContain("raw ");
      expect(result.stdout).not.toContain("internal permission detail");
    });
  });

  it("pauses and resumes the current Center Agent without removing its designation", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const pauseResult = await runCommandAndCapture(() =>
        runCenterAgentPause({ view: "agent" })
      );
      expect(pauseResult.exitCode).toBeUndefined();
      expect(
        parseJsonLine(pauseResult.stdout, "center_agent.pause")?.payload
      ).toMatchObject({
        status: "ok",
        organization: {
          active: ACTIVE_ORGANIZATION,
        },
        operatingState: {
          affectedTaskCount: 2,
          changed: true,
          operatingState: "paused",
          organizationId: "org-1",
        },
      });

      const resumeResult = await runCommandAndCapture(() =>
        runCenterAgentResume({ view: "agent" })
      );
      expect(resumeResult.exitCode).toBeUndefined();
      expect(
        parseJsonLine(resumeResult.stdout, "center_agent.resume")?.payload
      ).toMatchObject({
        operatingState: {
          affectedTaskCount: 0,
          changed: true,
          operatingState: "active",
        },
      });
    });

    expect(calls).toContainEqual(
      expect.objectContaining({
        body: { operatingState: "paused" },
        method: "PUT",
        pathname: "/v1/organizations/current/center-agent/operating-state",
        search: "",
      })
    );
    expect(calls).toContainEqual(
      expect.objectContaining({
        body: { operatingState: "active" },
        method: "PUT",
        pathname: "/v1/organizations/current/center-agent/operating-state",
        search: "",
      })
    );
  });

  it("lists Center Agent audit entries with actor, action, on-behalf-of, and time", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentAudit({ limit: 25, view: "human" })
      );

      expect(result.exitCode).toBeUndefined();
      expect(result.plainStdout).toContain("Center Agent Audit");
      expect(result.plainStdout).toContain("Audit Entries: 1");
      expect(result.plainStdout).toContain(
        `create space | actor ${CENTER_AGENT_PROFILE_ID} | on behalf of Mira (${HUMAN_PROFILE_ID}) | ${CREATED_AT}`
      );
    });

    expect(calls).toContainEqual(
      expect.objectContaining({
        pathname: "/v1/organizations/current/center-agent/audit-journal",
        method: "GET",
        body: null,
        search: "?limit=25&actionSet=v16",
      })
    );
  });

  it("reads a selected Center Agent session separately from the Local Agent source session", async () => {
    const calls = mockCenterAgentFetch();

    await withTempHome(async () => {
      await writeSignedInSession();
      vi.stubEnv("CODEX_THREAD_ID", "thread-secret");

      const result = await runCommandAndCapture(() =>
        runCenterAgentContext({
          spaceId: "selected-center-session",
          limit: 10,
          maxContextTokens: 2048,
          view: "agent",
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      expect(
        parseJsonLine(result.stdout, "center_agent.context")?.payload
      ).toMatchObject({
        nextAction: {
          command: `openmeld center-agent context receipt ${centerAgentContextManifest().manifestId} --all --organization acme --view agent`,
          kind: "record_context_load",
          runAfter: "all_manifest_entries_added_to_working_context",
        },
        organization: {
          selection: "current",
          target: {
            id: ACTIVE_ORGANIZATION.id,
            name: ACTIVE_ORGANIZATION.name,
            slug: ACTIVE_ORGANIZATION.slug,
          },
        },
        status: "ok",
        manifest: {
          budget: { includedMessages: 1, requestedTokens: 2048 },
          entries: [
            {
              author: { profileName: "Felix" },
              content: { text: "Launch context" },
            },
          ],
          request: {
            source: {
              client: "codex",
              kind: "local_agent",
              sessionId: "thread-secret",
            },
          },
        },
      });
    });

    expect(calls).toContainEqual(
      expect.objectContaining({
        body: {
          spaceId: "selected-center-session",
          limit: 10,
          maxContextTokens: 2048,
          source: {
            client: "codex",
            kind: "local_agent",
            sessionId: "thread-secret",
          },
          view: "messages",
        },
        method: "POST",
        pathname: "/v1/organizations/current/center-agent/context-manifests",
        requestedOrganizationId: ACTIVE_ORGANIZATION.id,
        search: "",
      })
    );
  });

  it("explains how to retry when the next visible message cannot fit the token budget", async () => {
    mockCenterAgentFetch({
      contextResponse: gatewayErrorResponse({
        code: "center_agent.context_token_budget_too_small",
        message:
          "Center Agent context token budget must be at least 312 tokens for the next visible message.",
        status: 422,
      }),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentContext({
          maxContextTokens: 256,
          via: "codex",
          view: "agent",
        })
      );

      expect(result.exitCode).toBe(1);
      expect(
        parseJsonLine(
          result.stdout,
          "center_agent.context_token_budget_too_small"
        )?.payload,
        result.stdout
      ).toMatchObject({
        error: {
          code: "center_agent.context_token_budget_too_small",
          message:
            "The next visible message needs more context space than this token budget allows.",
          nextStep:
            "Retry with `openmeld center-agent context --max-tokens 8000`. OpenMeld did not skip the message.",
        },
        status: "error",
      });
      expect(result.stdout).not.toContain("at least 312 tokens");
    });
  });

  it("records the exact manifest messages loaded by the detected Local Agent", async () => {
    const calls = mockCenterAgentFetch();
    const manifest = centerAgentContextManifest();
    const entry = manifest.entries[0];
    if (!entry) {
      throw new Error("Expected a Center Agent context entry fixture.");
    }

    await withTempHome(async () => {
      await writeSignedInSession();
      vi.stubEnv("CODEX_THREAD_ID", "thread-secret");

      const result = await runCommandAndCapture(() =>
        runCenterAgentContextReceipt({
          entries: [`${entry.sourceRef.id}=${entry.materializedContentHash}`],
          manifestId: manifest.manifestId,
          organization: SECOND_ORGANIZATION.id,
          view: "agent",
        })
      );

      expect(result.exitCode, result.stdout).toBeUndefined();
      expect(
        parseJsonLine(result.stdout, "center_agent.context_receipt")?.payload
      ).toMatchObject({
        organization: {
          selection: "explicit",
          target: {
            id: SECOND_ORGANIZATION.id,
            name: SECOND_ORGANIZATION.name,
            slug: SECOND_ORGANIZATION.slug,
          },
        },
        receipt: {
          receipt: {
            client: "codex",
            includedMessages: 1,
            manifestId: manifest.manifestId,
            status: "loaded",
          },
        },
        status: "ok",
      });
    });

    expect(calls).toContainEqual(
      expect.objectContaining({
        body: {
          selection: {
            entries: [
              {
                materializedContentHash: entry.materializedContentHash,
                sourceRefId: entry.sourceRef.id,
              },
            ],
            kind: "selected_entries",
          },
          source: {
            client: "codex",
            kind: "local_agent",
            sessionId: "thread-secret",
          },
        },
        method: "POST",
        pathname: `/v1/organizations/current/center-agent/context-manifests/${manifest.manifestId}/load-receipt`,
        requestedOrganizationId: SECOND_ORGANIZATION.id,
        search: "",
      })
    );
  });

  it("guides a Local Agent to fresh context instead of faking an older load", async () => {
    const manifest = centerAgentContextManifest();
    mockCenterAgentFetch({
      contextReceiptResponse: gatewayErrorResponse({
        code: "center_agent.context_load_manifest_empty",
        message: "raw internal materialization detail",
        status: 409,
      }),
    });

    await withTempHome(async () => {
      await writeSignedInSession();

      const result = await runCommandAndCapture(() =>
        runCenterAgentContextReceipt({
          all: true,
          manifestId: manifest.manifestId,
          via: "codex",
          view: "agent",
        })
      );

      expect(result.exitCode).toBe(1);
      expect(
        parseJsonLine(result.stdout, "center_agent.context_load_manifest_empty")
          ?.payload,
        result.stdout
      ).toMatchObject({
        error: {
          code: "center_agent.context_load_manifest_empty",
          nextStep:
            "Request fresh context with `openmeld center-agent context`. Older snapshots cannot be turned into load receipts.",
        },
        status: "error",
      });
      expect(result.stdout).not.toContain(
        "raw internal materialization detail"
      );
    });
  });
});

async function writeSignedInSession(
  activeOrganization: StoredActiveOrganization | null = ACTIVE_ORGANIZATION
): Promise<void> {
  vi.stubEnv("OPENMELD_GATEWAY_URL", "https://gateway.openmeld.invalid");
  process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
  await setAuthSession({
    accessToken: "token-valid",
    tokenType: "Bearer",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    ...(activeOrganization ? { activeOrganization } : {}),
  });
}

function mockCenterAgentFetch(input?: {
  auditResponse?: Response;
  contextResponse?: Response;
  contextReceiptResponse?: Response;
  designationResponse?: Response;
  designateResponse?: Response;
  directoryResponse?: Response;
  operatingStateResponse?: Response;
  serverActiveOrganizationId?: string | null;
  serverSelectedOrganizationId?: string | null;
  signalReadError?: Error;
  updateOperatingStateResponse?: Response;
  signalPostErrors?: Error[];
  wakeProgressItem?: WakeProgressItem;
  wakeProgressError?: Error;
}): FetchCall[] {
  const calls: FetchCall[] = [];
  const signalPostErrors = [...(input?.signalPostErrors ?? [])];
  vi.stubGlobal(
    "fetch",
    vi.fn((request: string | URL | Request, init?: RequestInit) => {
      const url =
        typeof request === "string" || request instanceof URL
          ? String(request)
          : request.url;
      const parsedUrl = new URL(url);
      const pathname = parsedUrl.pathname;
      const method = String(
        init?.method ?? (request instanceof Request ? request.method : "GET")
      ).toUpperCase();
      const requestHeaders = new Headers(
        init?.headers ?? (request instanceof Request ? request.headers : {})
      );
      calls.push({
        pathname,
        method,
        body:
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as unknown)
            : null,
        requestedOrganizationId: requestHeaders.get(
          "x-openmeld-requested-organization-id"
        ),
        search: parsedUrl.search,
      });

      if (pathname === "/api/auth/get-session") {
        return jsonResponse(
          createCapturedBetterAuthSessionResponse({
            activeOrganizationId:
              input?.serverActiveOrganizationId === undefined
                ? ACTIVE_ORGANIZATION.id
                : input.serverActiveOrganizationId,
            lastSelectedOrganizationId:
              input?.serverSelectedOrganizationId === undefined
                ? ACTIVE_ORGANIZATION.id
                : input.serverSelectedOrganizationId,
          })
        );
      }

      if (pathname === "/api/auth/organization/list") {
        return jsonResponse(
          createCapturedBetterAuthOrganizationListResponse([
            ACTIVE_ORGANIZATION,
            SECOND_ORGANIZATION,
          ])
        );
      }

      if (pathname === "/api/auth/organization/get-full-organization") {
        return jsonResponse(
          createCapturedBetterAuthGetFullOrganizationResponse(
            ACTIVE_ORGANIZATION
          )
        );
      }

      if (
        pathname === "/v1/organizations/current/center-agent/designation" &&
        method === "GET"
      ) {
        return (
          input?.designationResponse ??
          jsonResponse({
            organizationId: "org-1",
            designation: centerAgentDesignation(CENTER_AGENT_PROFILE_ID),
          })
        );
      }

      if (
        pathname === "/v1/organizations/current/center-agent/designation" &&
        method === "PUT"
      ) {
        return (
          input?.designateResponse ??
          jsonResponse({
            organizationId: "org-1",
            designation: centerAgentDesignation(CENTER_AGENT_PROFILE_ID),
            status: "designated",
          })
        );
      }

      if (
        pathname === "/v1/organizations/current/center-agent/operating-state" &&
        method === "GET"
      ) {
        return (
          input?.operatingStateResponse ??
          jsonResponse({
            canChangeOperatingState: true,
            operatingState: "active",
            organizationId: "org-1",
            pausedAt: null,
          })
        );
      }

      if (
        pathname === "/v1/organizations/current/center-agent/operating-state" &&
        method === "PUT"
      ) {
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as { operatingState: "active" | "paused" })
            : { operatingState: "active" as const };
        return (
          input?.updateOperatingStateResponse ??
          jsonResponse({
            affectedTaskCount: body.operatingState === "paused" ? 2 : 0,
            canChangeOperatingState: true,
            changed: true,
            operatingState: body.operatingState,
            organizationId: "org-1",
            pausedAt:
              body.operatingState === "paused"
                ? "2026-07-29T00:00:00.000Z"
                : null,
          })
        );
      }

      if (
        pathname === "/v1/organizations/current/center-agent/audit-journal" &&
        method === "GET"
      ) {
        return (
          input?.auditResponse ??
          jsonResponse({
            organizationId: "org-1",
            entries: [
              {
                id: "audit-1",
                organizationId: "org-1",
                actorProfileId: CENTER_AGENT_PROFILE_ID,
                action: "create_space",
                onBehalfOf: {
                  profileId: HUMAN_PROFILE_ID,
                  userId: "user-2",
                  displayName: "Mira",
                },
                resource: {
                  type: "space",
                  id: "space-1",
                },
                createdAt: CREATED_AT,
              },
            ],
          })
        );
      }

      if (
        pathname ===
          "/v1/organizations/current/center-agent/context-manifests" &&
        method === "POST"
      ) {
        return (
          input?.contextResponse ?? jsonResponse(centerAgentContextManifest())
        );
      }

      if (
        pathname.endsWith("/load-receipt") &&
        pathname.startsWith(
          "/v1/organizations/current/center-agent/context-manifests/"
        ) &&
        method === "POST"
      ) {
        return (
          input?.contextReceiptResponse ??
          jsonResponse(centerAgentContextLoadReceipt())
        );
      }

      if (
        pathname === "/v1/organizations/current/center-agent/dm-space" &&
        method === "POST"
      ) {
        return jsonResponse({
          centerAgentProfileId: CENTER_AGENT_PROFILE_ID,
          created: false,
          memberProfileId: HUMAN_PROFILE_ID,
          organizationId:
            requestHeaders.get("x-openmeld-requested-organization-id") ??
            ACTIVE_ORGANIZATION.id,
          spaceId: CENTER_AGENT_DM_SPACE_ID,
        });
      }

      if (pathname === "/v1/profiles/resolve" && method === "POST") {
        return jsonResponse({
          ok: true,
          profile: humanProfile(),
        });
      }

      if (
        pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
        method === "GET"
      ) {
        if (input?.signalReadError) {
          throw input.signalReadError;
        }
        return jsonResponse({
          nextCursor: null,
          signals: [
            {
              data: {
                messageEnvelope: {
                  activationTargets: [],
                  referenceTargets: [],
                  replyToSignalId: "signal-center-agent-ask-1",
                  text: "The launch has two blockers.",
                },
                meta: {
                  centerAgentTaskReferences: [
                    { taskId: "task-release-readiness" },
                  ],
                },
                text: "The launch has two blockers.",
              },
              id: "signal-center-agent-reply-1",
              profile: {
                agentControllerRef: "hosted:center-agent",
                kind: "agent",
                profileId: CENTER_AGENT_PROFILE_ID,
                profileName: "Atlas",
              },
              spaceId: CENTER_AGENT_DM_SPACE_ID,
              ts: 2,
              type: "signal.text",
              v: 1,
            },
          ],
        });
      }

      if (
        pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/signals` &&
        method === "POST"
      ) {
        const signalPostError = signalPostErrors.shift();
        if (signalPostError) {
          throw signalPostError;
        }
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as {
                meta?: Record<string, unknown>;
                text?: string;
              })
            : {};
        return jsonResponse({
          data: {
            meta: body.meta,
            text: body.text,
          },
          id: "signal-center-agent-ask-1",
          profile: {
            kind: "human",
            profileHandle: "felix",
            profileId: HUMAN_PROFILE_ID,
            profileName: "Felix",
          },
          spaceId: CENTER_AGENT_DM_SPACE_ID,
          ts: 1,
          type: "signal.text",
          v: 1,
        });
      }

      if (
        pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/wake-progress` &&
        method === "GET"
      ) {
        if (input?.wakeProgressError) {
          throw input.wakeProgressError;
        }
        const clientMessageId = parsedUrl.searchParams.get("clientMessageId");
        return jsonResponse({
          items: [
            input?.wakeProgressItem ?? {
              clientMessageId,
              dispatchId: "dispatch-center-agent-ask-1",
              failureReasonCode: null,
              message: "Center Agent replied.",
              phase: "replied",
              sourceSignalId: "signal-center-agent-ask-1",
              targetLabel: "Atlas",
              targetProfileId: CENTER_AGENT_PROFILE_ID,
              terminal: true,
              updatedAtMs: 2,
            },
          ],
          query: {
            clientMessageId,
            spaceId: CENTER_AGENT_DM_SPACE_ID,
            targetProfileId: CENTER_AGENT_PROFILE_ID,
          },
        });
      }

      if (
        pathname === `/v1/spaces/${CENTER_AGENT_DM_SPACE_ID}/result` &&
        method === "GET"
      ) {
        return jsonResponse({
          actorName: "Atlas",
          actorProfileId: CENTER_AGENT_PROFILE_ID,
          createdAt: CREATED_AT,
          dispatchId: "dispatch-center-agent-ask-1",
          finalText: "The launch has two blockers.",
          publicOutcome: "post_message",
          publishedSignalId: "signal-center-agent-reply-1",
          resultKind: "text",
          resultRef: "result-center-agent-ask-1",
          spaceId: CENTER_AGENT_DM_SPACE_ID,
        });
      }

      if (
        pathname === "/v1/organizations/current/directory" &&
        method === "GET"
      ) {
        return (
          input?.directoryResponse ?? jsonResponse(organizationDirectory())
        );
      }

      return new Response("not found", { status: 404 });
    })
  );
  return calls;
}

function centerAgentContextManifest() {
  const hash = `sha256:${"a".repeat(64)}`;
  return {
    authorization: {
      principal: "authenticated_member",
      scope: "requester_private",
    },
    availableViews: ["messages"],
    budget: {
      estimateAlgorithm: "utf8_bytes_divided_by_3.v1",
      estimatedTokens: 100,
      includedMessages: 1,
      requestedTokens: 2048,
      truncated: false,
      truncationReasons: [],
    },
    continuation: { cursor: null, hasMore: false },
    entries: [
      {
        author: {
          profileId: HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Felix",
        },
        content: {
          originalCharacterCount: 14,
          text: "Launch context",
          truncated: false,
          type: "text",
        },
        materializedContentHash: hash,
        occurredAt: CREATED_AT,
        redactions: [],
        sourceRef: {
          id: "signal-context-1",
          type: "space_signal",
          uri: `openmeld://spaces/${CENTER_AGENT_DM_SPACE_ID}/signals/signal-context-1`,
          version: hash,
        },
      },
    ],
    generatedAt: CREATED_AT,
    manifestId:
      "center_agent_context_manifest_11111111-1111-4111-8111-111111111111",
    provenance: {
      auditEntryId: "audit-context-1",
      contentProjection: "user_visible_space_signals",
    },
    request: {
      source: {
        client: "codex",
        kind: "local_agent",
        sessionId: "thread-secret",
      },
    },
    schemaVersion: "center_agent_context_manifest.v1",
    subject: {
      centerAgentProfileId: CENTER_AGENT_PROFILE_ID,
      conversationId: CENTER_AGENT_DM_SPACE_ID,
      kind: "center_agent_conversation",
      memberProfileId: HUMAN_PROFILE_ID,
      organizationId: ACTIVE_ORGANIZATION.id,
    },
    view: "messages",
  };
}

function centerAgentContextLoadReceipt() {
  const manifest = centerAgentContextManifest();
  const entry = manifest.entries[0];
  if (!entry) {
    throw new Error("Expected a Center Agent context entry fixture.");
  }
  return {
    authorization: {
      principal: "authenticated_member" as const,
      scope: "requester_private" as const,
    },
    provenance: { auditEntryId: "audit-load-1" },
    receipt: {
      client: "codex",
      estimatedTokens: 100,
      id: "center_agent_context_load_receipt_11111111-1111-4111-8111-111111111111",
      includedMessages: 1,
      manifestId: manifest.manifestId,
      selectedEntries: [
        {
          materializedContentHash: entry.materializedContentHash,
          sourceRefId: entry.sourceRef.id,
        },
      ],
      status: "loaded" as const,
    },
    recordedAt: "2026-08-10T00:00:01.000Z",
    schemaVersion: "center_agent_context_load_receipt.v1" as const,
  };
}

function centerAgentDesignation(agentProfileId: string) {
  return {
    organizationId: "org-1",
    agentProfileId,
    duty: null,
    designatedBy: "user-1",
    createdAt: CREATED_AT,
  };
}

function humanProfile() {
  return {
    createdAt: CREATED_AT,
    createdByUserId: "user-1",
    creatorProfileId: HUMAN_PROFILE_ID,
    isDefault: true,
    lastUsedAt: null,
    managedRole: null,
    ownerUserId: "user-1",
    profileHandle: "felix",
    profileKind: "human",
    profileName: "Felix",
    source: "auth",
    status: "active",
    updatedAt: CREATED_AT,
    openMeldProfileId: HUMAN_PROFILE_ID,
  };
}

function organizationDirectory() {
  return {
    organizationId: "org-1",
    generatedAt: CREATED_AT,
    members: [],
    agentProfiles: [
      organizationDirectoryAgentProfile({
        isCenterAgent: true,
        profileId: CENTER_AGENT_PROFILE_ID,
        profileHandle: "atlas",
        profileName: "Atlas",
      }),
      organizationDirectoryAgentProfile({
        isCenterAgent: false,
        profileId: SECOND_AGENT_PROFILE_ID,
        profileHandle: "beacon",
        profileName: "Beacon",
      }),
    ],
  };
}

function organizationDirectoryAgentProfile(input: {
  isCenterAgent: boolean;
  profileHandle: string;
  profileId: string;
  profileName: string;
}) {
  return {
    organizationId: "org-1",
    profileId: input.profileId,
    profileName: input.profileName,
    profileHandle: input.profileHandle,
    profileKind: "agent",
    isDefault: false,
    status: "active",
    ownerUserId: "user-1",
    source: "agent_profile_binding_api",
    managedRole: null,
    createdByUserId: "user-1",
    creatorProfileId: HUMAN_PROFILE_ID,
    lastUsedAt: null,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    isCenterAgent: input.isCenterAgent,
    readiness: agentReadiness(input.profileId, input.profileName),
  };
}

function agentReadiness(agentProfileId: string, profileName: string) {
  return {
    agentExecutionReadiness: {
      agentProfileId,
      displayState: "ready",
      facts: {
        profile: {
          active: true,
          reasonCodes: ["agent_profile.active"],
          source: "profile_identity",
        },
        binding: {
          reasonCodes: ["agent_profile_binding.command_eligible"],
          routable: true,
          source: "binding_truth",
        },
        claim: {
          executionBlocked: false,
          grantsClaimSuccess: false,
          reasonCodes: ["claim.eligible"],
          source: "claim_diagnostics",
        },
        providerAccount: {
          blocked: false,
          expiresAtMs: null,
          observedAtMs: null,
          provider: null,
          reasonCodes: [],
          source: "not_checked",
        },
        providerConversation: {
          agentControllerConversationId: null,
          errorCode: null,
          errorMessage: null,
          errorType: null,
          expiresAtMs: null,
          method: null,
          observedAtMs: null,
          provider: null,
          ready: true,
          reasonCodes: [],
          required: false,
          source: "not_required",
          status: "not_required",
        },
        readinessImpact: {
          blocked: false,
          expiresAtMs: null,
          impactKind: null,
          observedAtMs: null,
          reasonCodes: [],
          source: "not_checked",
        },
        localService: {
          reachable: true,
          refreshable: false,
          reasonCodes: ["runtime_transport.session_reachable"],
          source: "runtime_transport",
        },
        service: {
          executionCompatible: true,
          expectedEpoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
          observedEpoch: String(CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH),
          reasonCodes: ["service.execution_compatible"],
          source: "runtime_transport",
        },
        route: {
          deviceId: "device-1",
          lane: "dev-local",
          observedAt: CREATED_AT,
          online: true,
          reasonCodes: ["daemon_route.online"],
          source: "daemon_route",
        },
        runtime: {
          ready: true,
          reasonCodes: ["runtime.ready"],
          source: "prepare_readiness",
        },
      },
      primaryAction: "none",
      reasonCodes: ["agent_execution.ready"],
    },
    agentWakeAvailability: {
      action: "none",
      badgeLabel: "Available",
      category: "available",
      isRefreshing: false,
      label: "This profile can be woken in Space",
      phase: "available",
      reasonCode: "agent_execution.ready",
      status: "available_for_wake",
      summary: "Available for Wake",
      tooltip: "Available for Wake",
    },
    agentWakeRouteRegistration: {
      status: "registered",
      reasonCode: null,
      reportedAtMs: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      serviceVersion: "0.2.9",
    },
    agentProfileId,
    agentControllerRef: "builtin:codex",
    generatedAt: CREATED_AT,
    ownerUserId: "user-1",
    primaryBinding: agentPrimaryBinding(agentProfileId),
    primaryActionPlan: {
      action: "none",
      target: null,
    },
    profileName,
    routeDeviceId: "device-1",
    routeLane: "dev-local",
    runtimeDeviceDisplayName: "Felix MacBook",
    wakeRouteEvidence: {
      observedAt: CREATED_AT,
      reasonCode: "online",
      status: "online",
    },
    wakeRouteStatus: {
      connectionGeneration: 1,
      daemonSessionId: "daemon-session-1",
      deviceId: "device-1",
      lane: "dev-local",
      lastHeartbeatMs: 1,
      leaseEpoch: 1,
      status: "ready",
    },
  };
}

function agentPrimaryBinding(agentProfileId: string) {
  return {
    agentProfileId,
    authoritySource: "binding_truth",
    bindingId: `binding_${agentProfileId}`,
    bindingState: "enabled_primary",
    dispatchEligibility: {
      reasonCodes: ["agent_profile_binding.command_eligible"],
      routable: true,
      status: "routable",
    },
    grantsClaimSuccess: false,
    reasonCodes: ["agent_profile_binding.command_eligible"],
    resolutionSource: "binding_truth",
    routable: true,
    executionTarget: {
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-1",
      },
    },
  };
}

function gatewayErrorResponse(input: {
  status: number;
  code: string;
  message: string;
}): Response {
  return new Response(
    JSON.stringify({
      ok: false,
      error: {
        code: input.code,
        message: input.message,
        requestId: "req-center-agent-command",
      },
    }),
    {
      status: input.status,
      headers: { "content-type": "application/json" },
    }
  );
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function runCommandAndCapture(command: () => Promise<void>) {
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    const result = await withCapturedStdio(command);
    return {
      ...result,
      exitCode: process.exitCode,
    };
  } finally {
    process.exitCode = previousExitCode;
  }
}

function parseJsonLine(
  stdout: string,
  code: string
): {
  code?: string;
  payload?: Record<string, unknown>;
} | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const parsed = JSON.parse(trimmed) as {
      code?: string;
      payload?: Record<string, unknown>;
    };
    if (parsed.code === code) {
      return parsed;
    }
  }
  return null;
}
