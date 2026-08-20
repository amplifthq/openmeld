import { describe, expect, it } from "vitest";
import {
  AGENT_ACTIVITY_SESSION_INVENTORY_PAGE_DEFAULT,
  agentActivityEventSchema,
  agentActivityPublicDigestSchema,
  agentActivitySessionInventoryQuerySchema,
  agentActivitySessionInventoryResponseSchema,
  agentActivitySnapshotQuerySchema,
  agentActivitySnapshotResponseSchema,
  agentActivityStatsQuerySchema,
  agentActivityStatsResponseSchema,
  agentActivityStatsRpcInputSchema,
  submitAgentActivityEventsBodySchema,
  submitAgentActivityEventsResponseSchema,
  submitAgentActivitySessionReconciliationBodySchema,
  submitAgentActivitySessionReconciliationRpcInputSchema,
  summarizeAgentActivityDigestRpcInputSchema,
} from "../../src";

describe("Agent Activity Session Inventory contracts", () => {
  const session = {
    boundAgentProfileId: null,
    bindingState: "unbound" as const,
    canFork: false,
    canResume: true,
    computer: {
      id: "computer-public-1",
      lastSeenAtMs: 1_787_199_900_000,
      name: "Felix's MacBook Pro",
      state: "online" as const,
    },
    dataState: "current" as const,
    inventoryUpdatedAtMs: 1_787_200_000_000,
    lastActiveAtMs: 1_787_199_800_000,
    localAgent: {
      agentControllerRef: "builtin:codex",
      name: "Codex",
      provider: "codex" as const,
    },
    nativeSessionId: "019c1234-5678-7000-8000-123456789abc",
    nativeSessionTitle: "Upgrade Agent Activity Sessions",
    organization: { id: "org-1", name: "Amplift" },
    origin: "local" as const,
    owner: { name: "Felix", userId: "user-1" },
    project: { id: "project-1", name: "OpenMeld", slug: "openmeld" },
    startedAtMs: 1_787_190_000_000,
    status: "idle" as const,
  };

  it("uses stable bounded paging and rejects a cursor from an unknown field", () => {
    expect(agentActivitySessionInventoryQuerySchema.parse({})).toEqual({
      limit: AGENT_ACTIVITY_SESSION_INVENTORY_PAGE_DEFAULT,
    });
    expect(
      agentActivitySessionInventoryQuerySchema.safeParse({
        limit: 101,
      }).success
    ).toBe(false);
    expect(
      agentActivitySessionInventoryQuerySchema.safeParse({
        limit: 10,
        transcript: true,
      }).success
    ).toBe(false);
  });

  it("publishes the native Session identity without private local content", () => {
    const response = {
      asOfMs: 1_787_200_000_000,
      coverage: [],
      nextCursor: null,
      organization: session.organization,
      sessions: [session],
    };
    expect(agentActivitySessionInventoryResponseSchema.parse(response)).toEqual(
      response
    );
    expect(
      agentActivitySessionInventoryResponseSchema.safeParse({
        ...response,
        sessions: [
          {
            ...session,
            absolutePath: "/Users/felix/.codex/sessions/private.jsonl",
            transcript: [{ role: "user", text: "secret prompt" }],
          },
        ],
      }).success
    ).toBe(false);
    expect(
      agentActivitySessionInventoryResponseSchema.safeParse({
        ...response,
        sessions: [
          {
            ...session,
            localAgent: {
              ...session.localAgent,
              agentControllerRef: "builtin:claude-code",
            },
          },
        ],
      }).success
    ).toBe(false);
  });

  it("requires honest terminal provider outcomes and unique native IDs per page", () => {
    const base = {
      agentControllerRef: "builtin:codex",
      lane: "dev",
      localConnectionId:
        "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      observedAtMs: 1_787_200_000_000,
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority" as const,
        value: "runtime-1",
      },
      organizationId: "org-1",
      pageIndex: 0,
      projectId: "project-1",
      provider: "codex" as const,
      reconciliationId: "reconciliation-1",
      repositoryFingerprint: null,
      terminal: true,
    };
    const observed = {
      canFork: false,
      canResume: true,
      lastActiveAtMs: session.lastActiveAtMs,
      nativeSessionId: session.nativeSessionId,
      nativeSessionTitle: session.nativeSessionTitle,
      origin: session.origin,
      startedAtMs: session.startedAtMs,
      status: session.status,
    };
    expect(
      submitAgentActivitySessionReconciliationBodySchema.safeParse({
        ...base,
        result: "sessions",
        sessions: [observed, observed],
      }).success
    ).toBe(false);
    expect(
      submitAgentActivitySessionReconciliationBodySchema.safeParse({
        ...base,
        result: "unsupported",
        sessions: [],
      }).success
    ).toBe(false);
    expect(
      submitAgentActivitySessionReconciliationBodySchema.safeParse({
        ...base,
        problemCode: "provider_inventory_unavailable",
        result: "unsupported",
        sessions: [],
      }).success
    ).toBe(true);
    expect(
      submitAgentActivitySessionReconciliationBodySchema.safeParse({
        ...base,
        agentControllerRef: "builtin:claude-code",
        result: "sessions",
        sessions: [observed],
      }).success
    ).toBe(false);
    expect(
      submitAgentActivitySessionReconciliationRpcInputSchema.safeParse({
        ...base,
        agentControllerRef: "builtin:claude-code",
        deviceId: "device-1",
        result: "sessions",
        sessions: [observed],
      }).success
    ).toBe(false);
    expect(
      submitAgentActivitySessionReconciliationRpcInputSchema.safeParse({
        ...base,
        deviceId: "device-1",
        pageIndex: 1,
        problemCode: "provider_inventory_unavailable",
        result: "unsupported",
        sessions: [],
        terminal: false,
      }).success
    ).toBe(false);
  });
});

describe("Agent Activity snapshot contracts", () => {
  it("requires an explicit compatible opt-in before returning provider details", () => {
    expect(
      agentActivitySnapshotQuerySchema.parse({
        includeProviderMetadata: "true",
      })
    ).toEqual({ includeProviderMetadata: true });
    expect(
      agentActivitySnapshotQuerySchema.parse({ includeProviderMetadata: true })
    ).toEqual({ includeProviderMetadata: true });
    expect(
      agentActivitySnapshotQuerySchema.parse({
        includeProviderMetadata: "false",
      })
    ).toEqual({ includeProviderMetadata: false });
    expect(
      agentActivitySnapshotQuerySchema.safeParse({
        includeProviderMetadata: "sometimes",
      })
    ).toMatchObject({ success: false });
  });

  it("accepts bounded all-time stats and rejects unknown fields", () => {
    const stats = {
      daily: [
        {
          activeDurationMs: 120_000,
          sessionCount: 2,
          utcDate: "2026-07-10",
        },
        {
          activeDurationMs: 60_000,
          sessionCount: 1,
          utcDate: "2026-07-11",
        },
      ],
      dailyTruncated: false,
      organizationId: "org-1",
      sinceMs: Date.UTC(2026, 6, 10),
      totalActiveDurationMs: 180_000,
      totalSessions: 3,
    };

    expect(agentActivityStatsResponseSchema.safeParse(stats)).toMatchObject({
      success: true,
    });
    expect(
      agentActivityStatsResponseSchema.safeParse({ ...stats, unknown: true })
    ).toMatchObject({ success: false });
    expect(
      agentActivityStatsResponseSchema.safeParse({
        ...stats,
        daily: Array.from({ length: 401 }, (_, index) => ({
          activeDurationMs: 0,
          sessionCount: 0,
          utcDate: new Date(Date.UTC(2025, 0, 1 + index))
            .toISOString()
            .slice(0, 10),
        })),
      })
    ).toMatchObject({ success: false });
  });

  it("accepts an optional Project scope for stats reads", () => {
    const projectId = "project_11111111-1111-4111-8111-111111111111";

    expect(agentActivityStatsQuerySchema.parse({ projectId })).toEqual({
      projectId,
    });
    expect(agentActivityStatsRpcInputSchema.parse({ projectId })).toEqual({
      projectId,
    });
    expect(
      agentActivityStatsQuerySchema.safeParse({ projectId, unknown: true })
    ).toMatchObject({ success: false });
  });
});

describe("Agent Activity event contracts", () => {
  const validCodexEvent = {
    clientKind: "codex-app" as const,
    eventId: "activity-event-1",
    eventType: "session_active" as const,
    expiresAtMs: 1_783_892_490_000,
    gitBranch: "main",
    gitCommit: "f5ed74125265b042763b5b484e46bc033b759d98",
    model: "gpt-5.6-sol",
    observedAtMs: 1_783_892_400_000,
    organizationId: "org-1",
    projectId: "project-1",
    provider: "codex" as const,
    providerMetadata: {
      approvalPolicy: "never",
      cliVersion: "0.144.1",
      contextWindow: 272_000,
      modelProvider: "openai",
      originator: "desktop",
      reasoningEffort: "xhigh",
      sandboxMode: "danger-full-access",
      source: "rollout",
    },
    providerSessionId: "019f5204-bd4b-7a90-80dc-a5c0f3162b81",
    repositoryFingerprint:
      "sha256:9e2ad4675834b2b34f92832dd05229bc9f99df436f958640d0fd916c8e73e0fd",
    source: "observed" as const,
    startedAtMs: 1_783_892_000_000,
    status: "active" as const,
    title: "Build Agent Activity",
  };

  it("accepts only provider-specific, explicitly safe metadata", () => {
    expect(agentActivityEventSchema.safeParse(validCodexEvent)).toMatchObject({
      success: true,
    });

    for (const forbiddenField of [
      "absolutePath",
      "cwd",
      "lastAssistantMessage",
      "prompt",
      "transcriptPath",
    ]) {
      expect(
        agentActivityEventSchema.safeParse({
          ...validCodexEvent,
          providerMetadata: {
            ...validCodexEvent.providerMetadata,
            [forbiddenField]: "private content",
          },
        })
      ).toMatchObject({ success: false });
    }
  });

  it("does not let an observed event claim RuntimeCoordinator authority", () => {
    expect(
      agentActivityEventSchema.safeParse({
        ...validCodexEvent,
        runtimeCoordinatorExecutionId: "execution-1",
      })
    ).toMatchObject({ success: false });
  });

  it("keeps OpenCode client provenance unknown unless the provider supplies it", () => {
    const openCodeEvent = {
      ...validCodexEvent,
      clientKind: "unknown",
      provider: "opencode",
      providerMetadata: {
        agent: "build",
        cost: 0.12,
        modelProvider: "opencode",
        modelVariant: "high",
        tokensInput: 120,
        tokensOutput: 45,
        tokensReasoning: 10,
        version: "1.17.15",
      },
    };
    expect(agentActivityEventSchema.safeParse(openCodeEvent)).toMatchObject({
      success: true,
    });
    expect(
      agentActivityEventSchema.safeParse({
        ...openCodeEvent,
        clientKind: "opencode-desktop",
      })
    ).toMatchObject({ success: false });
  });

  it("accepts only reviewed Cursor hook metadata and client kinds", () => {
    const cursorEvent = {
      ...validCodexEvent,
      clientKind: "cursor-ide",
      model: "default",
      provider: "cursor",
      providerMetadata: {
        composerMode: "chat",
        isBackgroundAgent: false,
        source: "hook",
        version: "3.2.1",
      },
    };

    expect(agentActivityEventSchema.safeParse(cursorEvent)).toMatchObject({
      success: true,
    });
    expect(
      agentActivityEventSchema.safeParse({
        ...cursorEvent,
        providerMetadata: {
          ...cursorEvent.providerMetadata,
          prompt: "private prompt",
        },
      })
    ).toMatchObject({ success: false });
    expect(
      agentActivityEventSchema.safeParse({
        ...cursorEvent,
        clientKind: "cursor-cloud",
      })
    ).toMatchObject({ success: false });
  });

  it("requires a future TTL for active presence evidence", () => {
    expect(
      agentActivityEventSchema.safeParse({
        ...validCodexEvent,
        expiresAtMs: validCodexEvent.observedAtMs,
      })
    ).toMatchObject({ success: false });
  });

  it("bounds expiry for every non-active session status", () => {
    for (const [eventType, status] of [
      ["session_idle", "idle"],
      ["session_ended", "ended"],
      ["session_error", "error"],
      ["session_updated", "unknown"],
    ] as const) {
      expect(
        agentActivityEventSchema.safeParse({
          ...validCodexEvent,
          eventType,
          expiresAtMs: validCodexEvent.observedAtMs + 300_001,
          status,
        })
      ).toMatchObject({ success: false });
      expect(
        agentActivityEventSchema.safeParse({
          ...validCodexEvent,
          eventType,
          expiresAtMs: validCodexEvent.observedAtMs + 300_000,
          status,
        })
      ).toMatchObject({ success: true });
    }
  });

  it("rejects contradictory event type and status pairs", () => {
    for (const [eventType, status] of [
      ["session_active", "idle"],
      ["session_ended", "active"],
      ["session_error", "idle"],
      ["heartbeat", "unknown"],
      ["session_updated", "active"],
    ] as const) {
      expect(
        agentActivityEventSchema.safeParse({
          ...validCodexEvent,
          eventType,
          status,
        })
      ).toMatchObject({ success: false });
    }
    expect(
      agentActivityEventSchema.safeParse({
        ...validCodexEvent,
        eventType: "session_started",
        expiresAtMs: validCodexEvent.observedAtMs,
        status: "unknown",
      })
    ).toMatchObject({ success: true });
  });

  it("rejects raw provider provenance objects and unreviewed policy values", () => {
    for (const providerMetadata of [
      {
        ...validCodexEvent.providerMetadata,
        source: { subagent: { threadId: "private-thread" } },
      },
      {
        ...validCodexEvent.providerMetadata,
        approvalPolicy: "future-unreviewed-policy",
      },
    ]) {
      expect(
        agentActivityEventSchema.safeParse({
          ...validCodexEvent,
          providerMetadata,
        })
      ).toMatchObject({ success: false });
    }
  });

  it("keeps batch envelopes parseable while returning per-event permanent failures", () => {
    expect(
      submitAgentActivityEventsBodySchema.safeParse({
        events: [validCodexEvent, { prompt: "must be rejected per event" }],
        lane: "dev",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
      })
    ).toMatchObject({ success: true });

    expect(
      submitAgentActivityEventsResponseSchema.safeParse({
        events: [
          { eventId: "activity-event-1", index: 0, outcome: "accepted" },
          {
            index: 1,
            outcome: "permanent_rejected",
            reason: "event_invalid",
          },
        ],
        status: "partial",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
      })
    ).toMatchObject({ success: true });
  });

  it("rejects duplicate result indices before a client can misapply them", () => {
    expect(
      submitAgentActivityEventsResponseSchema.safeParse({
        events: [
          { eventId: "activity-event-1", index: 0, outcome: "accepted" },
          { eventId: "activity-event-2", index: 0, outcome: "reused" },
        ],
        status: "accepted",
        openMeldServiceRuntimeId: {
          source: "runtime_registry_authority",
          value: "runtime-1",
        },
      })
    ).toMatchObject({ success: false });
  });

  it("requires explicit snapshot truncation facts", () => {
    const snapshot = {
      asOfMs: 1000,
      digests: [],
      organizationId: "org-1",
      projects: [],
      recentEvents: [],
      sessions: [],
      stalenessThresholdMs: 300_000,
    };

    expect(
      agentActivitySnapshotResponseSchema.safeParse(snapshot)
    ).toMatchObject({
      success: false,
    });
    expect(
      agentActivitySnapshotResponseSchema.safeParse({
        ...snapshot,
        digestsTruncated: false,
        sessionsTruncated: false,
      })
    ).toMatchObject({ success: true });
  });

  it("returns reviewed provider details without exposing provider session ids or local device identity", () => {
    const session = {
      clientKind: "codex-app",
      expiresAtMs: 2000,
      gitBranch: "main",
      gitCommit: null,
      id: "activity-session-public-1",
      isActive: true,
      lastObservedAtMs: 1000,
      memberName: "Felix",
      memberUserId: "user-1",
      model: "gpt-5.6-sol",
      projectId: "project-1",
      provider: "codex",
      providerMetadata: {
        approvalPolicy: "never",
        cliVersion: "0.144.1",
        contextWindow: 272_000,
        modelProvider: "openai",
        originator: "desktop",
        reasoningEffort: "xhigh",
        sandboxMode: "danger-full-access",
        source: "rollout",
      },
      startedAtMs: 900,
      status: "active",
      title: "Build Agent Activity",
    };
    expect(
      agentActivitySnapshotResponseSchema.safeParse({
        asOfMs: 1000,
        digests: [],
        digestsTruncated: false,
        organizationId: "org-1",
        projects: [],
        recentEvents: [],
        sessions: [session],
        sessionsTruncated: false,
        stalenessThresholdMs: 300_000,
      })
    ).toMatchObject({ success: true });
    for (const forbidden of ["providerSessionId", "deviceId", "localPath"]) {
      expect(
        agentActivitySnapshotResponseSchema.safeParse({
          asOfMs: 1000,
          digests: [],
          digestsTruncated: false,
          organizationId: "org-1",
          projects: [],
          recentEvents: [],
          sessions: [{ ...session, [forbidden]: "private" }],
          sessionsTruncated: false,
          stalenessThresholdMs: 300_000,
        })
      ).toMatchObject({ success: false });
    }
    expect(
      agentActivitySnapshotResponseSchema.safeParse({
        asOfMs: 1000,
        digests: [],
        digestsTruncated: false,
        organizationId: "org-1",
        projects: [],
        recentEvents: [],
        sessions: [
          {
            ...session,
            providerMetadata: {
              ...session.providerMetadata,
              unreviewedProviderField: "private",
            },
          },
        ],
        sessionsTruncated: false,
        stalenessThresholdMs: 300_000,
      })
    ).toMatchObject({ success: false });
  });

  it("requires digest status fields to agree and carries the full sampled event count", () => {
    const completed = {
      citations: [{ eventId: "event-1", observedAtMs: 100 }],
      createdAtMs: 1000,
      eventCount: 150,
      failureReason: null,
      id: "digest-1",
      projectId: "project-1",
      status: "completed" as const,
      summary: "A sampled activity summary.",
      windowEndedAtMs: 900,
      windowStartedAtMs: 100,
    };
    expect(agentActivityPublicDigestSchema.safeParse(completed)).toMatchObject({
      success: true,
    });
    expect(
      agentActivityPublicDigestSchema.safeParse({
        ...completed,
        failureReason: "summarization_unavailable",
      })
    ).toMatchObject({ success: false });
    expect(
      agentActivityPublicDigestSchema.safeParse({
        ...completed,
        citations: [],
        status: "failed",
        summary: null,
      })
    ).toMatchObject({ success: false });

    expect(
      summarizeAgentActivityDigestRpcInputSchema.safeParse({
        eventCount: 150,
        evidence: [
          {
            eventId: "event-1",
            eventType: "session_active",
            memberName: "Felix",
            observedAtMs: 100,
            provider: "codex",
            status: "active",
            title: "Build Agent Activity",
          },
        ],
        organizationId: "org-1",
        projectId: "project-1",
        windowEndedAtMs: 900,
        windowStartedAtMs: 100,
      })
    ).toMatchObject({ success: true });
  });
});
