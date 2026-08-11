import { env } from "cloudflare:test";
import type { AgentActivityEvent } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it } from "vitest";
import { runAgentActivityDigestTick } from "../src/agent-activity/activity-digest-service";
import {
  runAgentActivityDailyAggregation,
  runAgentActivityRetention,
} from "../src/agent-activity/activity-retention-service";
import { readAgentActivityStats } from "../src/agent-activity/activity-stats-repository";
import type { CoreBindings } from "../src/lib/bindings";
import {
  rpcReadAgentActivitySnapshot,
  rpcReadAgentActivityStats,
  rpcSubmitAgentActivityEvents,
  rpcSubmitRuntimeRegistration,
} from "../src/rpc/methods";

const owned = new Set<string>();

afterEach(async () => {
  for (const suffix of owned) {
    const organizationId = `org_activity_${suffix}`;
    const userId = `user_activity_${suffix}`;
    const deviceId = `device_activity_${suffix}`;
    await env.OPENMELD_DB.batch([
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_daily_session_keys WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_daily_aggregates WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_digests WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_sessions WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM agent_activity_events WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openMeldDaemon_runtime_registry_records WHERE device_id = ?"
      ).bind(deviceId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM projects WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM members WHERE organization_id = ?"
      ).bind(organizationId),
      env.OPENMELD_DB.prepare(
        "DELETE FROM openmeld_profiles WHERE owner_user_id = ?"
      ).bind(userId),
      env.OPENMELD_DB.prepare("DELETE FROM organizations WHERE id = ?").bind(
        organizationId
      ),
      env.OPENMELD_DB.prepare("DELETE FROM users WHERE id = ?").bind(userId),
    ]);
  }
  owned.clear();
});

describe("Core Agent Activity event ingestion", () => {
  it("atomically accepts evidence, reuses exact duplicates, rejects conflicts, and never stores raw content", async () => {
    const fixture = await seedFixture();
    const nowMs = Date.now();
    const event = buildEvent(fixture, {
      eventId: `event_${fixture.suffix}_1`,
      observedAtMs: nowMs,
      title: "Build Agent Activity ingestion",
    });

    const first = await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, [
        event,
        {
          eventId: `event_${fixture.suffix}_private`,
          prompt: "PRIVACY_CANARY_PROMPT_MUST_NEVER_PERSIST",
          transcriptPath: "/private/canary/transcript.jsonl",
        },
      ])
    );
    expect(first).toMatchObject({
      events: [
        { eventId: event.eventId, outcome: "accepted" },
        { outcome: "permanent_rejected", reason: "event_invalid" },
      ],
      status: "partial",
    });

    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [event])
      )
    ).resolves.toMatchObject({
      events: [{ eventId: event.eventId, outcome: "reused" }],
      status: "accepted",
    });

    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [{ ...event, title: "Conflicting title" }])
      )
    ).resolves.toMatchObject({
      events: [
        {
          eventId: event.eventId,
          outcome: "permanent_rejected",
          reason: "event_id_conflict",
        },
      ],
      status: "rejected",
    });

    const older = buildEvent(fixture, {
      eventId: `event_${fixture.suffix}_older`,
      observedAtMs: nowMs - 1000,
      status: "idle",
      title: "Older state",
    });
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [older])
      )
    ).resolves.toMatchObject({ events: [{ outcome: "accepted" }] });

    const session = await env.OPENMELD_DB.prepare(
      `
        SELECT title, status, last_event_id, provider_metadata_json
        FROM agent_activity_sessions
        WHERE organization_id = ?
      `
    )
      .bind(fixture.organizationId)
      .first<{
        last_event_id: string;
        provider_metadata_json: string;
        status: string;
        title: string;
      }>();
    expect(session).toMatchObject({
      last_event_id: event.eventId,
      status: "active",
      title: event.title,
    });
    expect(session?.provider_metadata_json).not.toContain("private");

    const persistedJson = await env.OPENMELD_DB.prepare(
      `
        SELECT group_concat(provider_metadata_json || coalesce(title, '')) AS value
        FROM agent_activity_events
        WHERE organization_id = ?
      `
    )
      .bind(fixture.organizationId)
      .first<{ value: string }>();
    expect(persistedJson?.value).not.toContain("PRIVACY_CANARY");
    expect(persistedJson?.value).not.toContain("/private/");

    const snapshot = await rpcReadAgentActivitySnapshot(env as CoreBindings, {
      context: fixture.context,
    });
    expect(snapshot).toMatchObject({
      organizationId: fixture.organizationId,
      recentEvents: expect.arrayContaining([
        expect.objectContaining({ eventId: older.eventId }),
      ]),
      sessions: [
        expect.objectContaining({
          isActive: true,
          memberUserId: fixture.userId,
          title: event.title,
        }),
      ],
    });
    expect(snapshot.sessions[0]).not.toHaveProperty("providerMetadata");
    const snapshotWithProviderMetadata = await rpcReadAgentActivitySnapshot(
      env as CoreBindings,
      {
        context: fixture.context,
        includeProviderMetadata: true,
      }
    );
    expect(snapshotWithProviderMetadata.sessions[0]).toMatchObject({
      providerMetadata: {
        approvalPolicy: "never",
        cliVersion: "0.144.1",
        originator: "desktop",
        reasoningEffort: "xhigh",
        sandboxMode: "danger-full-access",
        source: "rollout",
      },
    });

    const sparseHookEvent = {
      ...buildEvent(fixture, {
        eventId: `event_${fixture.suffix}_sparse_hook`,
        observedAtMs: nowMs + 1,
      }),
      clientKind: "unknown" as const,
      gitBranch: null,
      gitCommit: null,
      model: null,
      providerMetadata: {
        originator: "desktop" as const,
        source: "hook" as const,
      },
      title: null,
    };
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [sparseHookEvent])
      )
    ).resolves.toMatchObject({ events: [{ outcome: "accepted" }] });
    const snapshotAfterSparseHook = await rpcReadAgentActivitySnapshot(
      env as CoreBindings,
      {
        context: fixture.context,
        includeProviderMetadata: true,
      }
    );
    expect(snapshotAfterSparseHook.sessions[0]).toMatchObject({
      clientKind: "codex-app",
      gitBranch: "main",
      gitCommit: "f5ed74125265b042763b5b484e46bc033b759d98",
      model: "gpt-5.6-sol",
      providerMetadata: {
        approvalPolicy: "never",
        cliVersion: "0.144.1",
        originator: "desktop",
        reasoningEffort: "xhigh",
        sandboxMode: "danger-full-access",
        source: "hook",
      },
      title: event.title,
    });
    expect(JSON.stringify(snapshot)).not.toContain(event.providerSessionId);
    expect(JSON.stringify(snapshot)).not.toContain(fixture.deviceId);

    await env.OPENMELD_DB.prepare(
      "UPDATE agent_activity_sessions SET expires_at_ms = last_observed_at_ms WHERE organization_id = ?"
    )
      .bind(fixture.organizationId)
      .run();
    const expired = await rpcReadAgentActivitySnapshot(env as CoreBindings, {
      context: fixture.context,
    });
    expect(expired.sessions).toEqual([
      expect.objectContaining({ isActive: false, status: "unknown" }),
    ]);
    await expect(
      rpcReadAgentActivitySnapshot(env as CoreBindings, {
        context: fixture.context,
        status: "active",
      })
    ).resolves.toMatchObject({ sessions: [] });
    await expect(
      rpcReadAgentActivitySnapshot(env as CoreBindings, {
        context: fixture.context,
        status: "unknown",
      })
    ).resolves.toMatchObject({
      sessions: [expect.objectContaining({ status: "unknown" })],
    });
  });

  it("returns reviewed Claude and OpenCode metadata without private parent session ids", async () => {
    const fixture = await seedFixture();
    const nowMs = Date.now();
    const base = buildEvent(fixture, {
      eventId: `event_${fixture.suffix}_provider_base`,
      observedAtMs: nowMs,
    });
    const {
      clientKind: _clientKind,
      provider: _provider,
      providerMetadata: _providerMetadata,
      ...common
    } = base;
    const claudeEvent: AgentActivityEvent = {
      ...common,
      clientKind: "claude-code-cli",
      eventId: `event_${fixture.suffix}_claude`,
      provider: "claude-code",
      providerMetadata: {
        entrypoint: "cli",
        parentSessionId: "private-parent-claude",
        permissionMode: "plan",
        source: "jsonl",
        version: "1.0.0",
      },
      providerSessionId: `claude_${fixture.suffix}`,
      title: "Review Agent Activity",
    };
    const openCodeEvent: AgentActivityEvent = {
      ...common,
      clientKind: "unknown",
      eventId: `event_${fixture.suffix}_opencode`,
      provider: "opencode",
      providerMetadata: {
        agent: "build",
        modelProvider: "openai",
        parentSessionId: "private-parent-opencode",
        tokensInput: 42,
        version: "2.0.0",
      },
      providerSessionId: `opencode_${fixture.suffix}`,
      title: "Implement Agent Activity",
    };

    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [claudeEvent, openCodeEvent])
      )
    ).resolves.toMatchObject({
      events: [{ outcome: "accepted" }, { outcome: "accepted" }],
    });
    const snapshot = await rpcReadAgentActivitySnapshot(env as CoreBindings, {
      context: fixture.context,
      includeProviderMetadata: true,
    });
    expect(snapshot.sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          provider: "claude-code",
          providerMetadata: {
            entrypoint: "cli",
            permissionMode: "plan",
            source: "jsonl",
            version: "1.0.0",
          },
          title: "Review Agent Activity",
        }),
        expect.objectContaining({
          provider: "opencode",
          providerMetadata: {
            agent: "build",
            modelProvider: "openai",
            tokensInput: 42,
            version: "2.0.0",
          },
          title: "Implement Agent Activity",
        }),
      ])
    );
    expect(JSON.stringify(snapshot)).not.toContain("private-parent");
  });

  it("permanently rejects non-active events with an overlong presence expiry", async () => {
    const fixture = await seedFixture();
    const observedAtMs = Date.now();
    const idle = {
      ...buildEvent(fixture, {
        eventId: `event_${fixture.suffix}_idle_overlong`,
        observedAtMs,
        status: "idle",
      }),
      expiresAtMs: observedAtMs + 300_001,
    };
    const ended = {
      ...idle,
      eventId: `event_${fixture.suffix}_ended_overlong`,
      eventType: "session_ended",
      status: "ended",
    };

    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [idle, ended])
      )
    ).resolves.toMatchObject({
      events: [
        {
          eventId: idle.eventId,
          outcome: "permanent_rejected",
          reason: "event_invalid",
        },
        {
          eventId: ended.eventId,
          outcome: "permanent_rejected",
          reason: "event_invalid",
        },
      ],
      status: "rejected",
    });
  });

  it("expires current sessions from their last observation, not a hostile legacy expiry", async () => {
    const fixture = await seedFixture();
    const observedAtMs = Date.now();
    const event = buildEvent(fixture, {
      eventId: `event_${fixture.suffix}_legacy_expiry`,
      observedAtMs,
    });
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, [event])
    );
    await env.OPENMELD_DB.prepare(
      `UPDATE agent_activity_sessions
       SET expires_at_ms = last_observed_at_ms + ?
       WHERE organization_id = ?`
    )
      .bind(14 * 24 * 60 * 60_000, fixture.organizationId)
      .run();

    await expect(
      runAgentActivityRetention({
        db: env.OPENMELD_DB,
        nowMs: observedAtMs + 14 * 24 * 60 * 60_000 + 1,
      })
    ).resolves.toMatchObject({ sessions: 1 });
    const session = await env.OPENMELD_DB.prepare(
      "SELECT id FROM agent_activity_sessions WHERE organization_id = ?"
    )
      .bind(fixture.organizationId)
      .first();
    expect(session).toBeNull();
  });

  it("permanently rejects removed membership, archived Projects, and fingerprint mismatch", async () => {
    const fixture = await seedFixture();
    const event = buildEvent(fixture, {
      eventId: `event_${fixture.suffix}_membership`,
      observedAtMs: Date.now(),
    });
    await env.OPENMELD_DB.prepare("DELETE FROM members WHERE id = ?")
      .bind(fixture.memberId)
      .run();
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [event])
      )
    ).resolves.toMatchObject({
      events: [{ outcome: "permanent_rejected", reason: "membership_removed" }],
    });

    await env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', 1)"
    )
      .bind(fixture.memberId, fixture.organizationId, fixture.userId)
      .run();
    await env.OPENMELD_DB.prepare(
      "UPDATE projects SET archived_at_ms = ?, updated_at_ms = ? WHERE id = ?"
    )
      .bind(Date.now(), Date.now(), fixture.projectId)
      .run();
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [
          { ...event, eventId: `${event.eventId}_archived` },
        ])
      )
    ).resolves.toMatchObject({
      events: [{ outcome: "permanent_rejected", reason: "project_archived" }],
    });

    await env.OPENMELD_DB.prepare(
      "UPDATE projects SET archived_at_ms = NULL, updated_at_ms = updated_at_ms + 1 WHERE id = ?"
    )
      .bind(fixture.projectId)
      .run();
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [
          {
            ...event,
            eventId: `${event.eventId}_fingerprint`,
            repositoryFingerprint:
              "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          },
        ])
      )
    ).resolves.toMatchObject({
      events: [
        {
          outcome: "permanent_rejected",
          reason: "repository_fingerprint_mismatch",
        },
      ],
    });
  });

  it("uses accepted sequence to order same-millisecond session updates and ignores reused retries", async () => {
    const fixture = await seedFixture();
    const observedAtMs = Date.now();
    const first = buildEvent(fixture, {
      eventId: `event_${fixture.suffix}_same_ms_first`,
      observedAtMs,
      title: "First same-millisecond state",
    });
    const second = buildEvent(fixture, {
      eventId: `event_${fixture.suffix}_same_ms_second`,
      observedAtMs,
      title: "Second same-millisecond state",
    });

    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [first, second])
      )
    ).resolves.toMatchObject({
      events: [{ outcome: "accepted" }, { outcome: "accepted" }],
    });
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(fixture, [first])
      )
    ).resolves.toMatchObject({ events: [{ outcome: "reused" }] });

    const session = await env.OPENMELD_DB.prepare(
      `
        SELECT last_event_id, last_accepted_sequence, title
        FROM agent_activity_sessions
        WHERE organization_id = ?
      `
    )
      .bind(fixture.organizationId)
      .first<{
        last_accepted_sequence: number;
        last_event_id: string;
        title: string;
      }>();
    const accepted = await env.OPENMELD_DB.prepare(
      `
        SELECT accepted_sequence
        FROM agent_activity_events
        WHERE organization_id = ? AND event_id = ?
      `
    )
      .bind(fixture.organizationId, second.eventId)
      .first<{ accepted_sequence: number }>();
    expect(session).toEqual({
      last_accepted_sequence: accepted?.accepted_sequence,
      last_event_id: second.eventId,
      title: second.title,
    });
  });

  it("treats stale Runtime authority as retryable without writing evidence", async () => {
    const fixture = await seedFixture();
    const event = buildEvent(fixture, {
      eventId: `event_${fixture.suffix}_runtime`,
      observedAtMs: Date.now(),
    });
    const response = await rpcSubmitAgentActivityEvents(env as CoreBindings, {
      ...submission(fixture, [event]),
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime_stale_authority",
      },
    });
    expect(response).toMatchObject({
      events: [
        {
          outcome: "retryable_rejected",
          reason: "openmeld_service_runtime_id_mismatch",
        },
      ],
      status: "rejected",
    });
    const row = await env.OPENMELD_DB.prepare(
      "SELECT 1 AS present FROM agent_activity_events WHERE event_id = ?"
    )
      .bind(event.eventId)
      .first();
    expect(row).toBeNull();
  });

  it("scopes event idempotency to one organization and rejects oversized candidates", async () => {
    const first = await seedFixture();
    const second = await seedFixture();
    const eventId = "same-public-event-id";
    const nowMs = Date.now();
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(first, [buildEvent(first, { eventId, observedAtMs: nowMs })])
      )
    ).resolves.toMatchObject({ events: [{ outcome: "accepted" }] });
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(second, [
          buildEvent(second, { eventId, observedAtMs: nowMs }),
        ])
      )
    ).resolves.toMatchObject({ events: [{ outcome: "accepted" }] });
    await expect(
      rpcSubmitAgentActivityEvents(
        env as CoreBindings,
        submission(first, [
          { eventId: "too-large", prompt: "x".repeat(17 * 1024) },
        ])
      )
    ).resolves.toMatchObject({
      events: [{ outcome: "permanent_rejected", reason: "event_invalid" }],
    });
    const count = await env.OPENMELD_DB.prepare(
      "SELECT count(*) AS count FROM agent_activity_events WHERE event_id = ?"
    )
      .bind(eventId)
      .first<{ count: number }>();
    expect(count?.count).toBe(2);
  });

  it("creates fenced digests, exposes failures without replacing the last summary, and aggregates retention", async () => {
    const fixture = await seedFixture();
    const nowMs = Date.now();
    const events = Array.from({ length: 10 }, (_, index) =>
      buildEvent(fixture, {
        eventId: `event_${fixture.suffix}_digest_${index}`,
        observedAtMs: nowMs - 10_000 + index,
      })
    );
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, events)
    );
    await expect(
      runAgentActivityDigestTick({
        db: env.OPENMELD_DB,
        nowMs,
        summarize: (request) => {
          expect(request.eventCount).toBe(10);
          return Promise.resolve({
            citations: [
              {
                eventId: request.evidence.at(-1)?.eventId ?? "missing",
                observedAtMs: request.evidence.at(-1)?.observedAtMs ?? 0,
              },
            ],
            summary: `10 events through ${request.evidence.at(-1)?.eventId} at ${request.windowEndedAtMs}.`,
          });
        },
      })
    ).resolves.toMatchObject({ completed: 1, failed: 0 });

    const laterEvents = Array.from({ length: 10 }, (_, index) =>
      buildEvent(fixture, {
        eventId: `event_${fixture.suffix}_digest_later_${index}`,
        observedAtMs: nowMs - 20_000 + index,
      })
    );
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, laterEvents)
    );
    await expect(
      runAgentActivityDigestTick({
        db: env.OPENMELD_DB,
        nowMs: nowMs + 2000,
        summarize: async () => ({
          citations: [{ eventId: "event-outside-evidence", observedAtMs: 1 }],
          summary: "Unfenced summary",
        }),
      })
    ).resolves.toMatchObject({ completed: 0, failed: 1 });

    const snapshot = await rpcReadAgentActivitySnapshot(env as CoreBindings, {
      context: fixture.context,
    });
    expect(snapshot.digests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          status: "completed",
          summary: expect.any(String),
        }),
        expect.objectContaining({
          failureReason: "summarization_citation_mismatch",
          status: "failed",
          summary: null,
        }),
      ])
    );

    const aggregationNowMs =
      (Math.floor(nowMs / (24 * 60 * 60_000)) + 1) * 24 * 60 * 60_000;
    await expect(
      runAgentActivityDailyAggregation({
        batchLimit: 7,
        db: env.OPENMELD_DB,
        nowMs: aggregationNowMs,
      })
    ).resolves.toMatchObject({ events: 20, sessionKeys: 1 });
    const aggregate = await env.OPENMELD_DB.prepare(
      "SELECT sum(event_count) AS count, sum(session_count) AS sessions FROM agent_activity_daily_aggregates WHERE organization_id = ?"
    )
      .bind(fixture.organizationId)
      .first<{ count: number; sessions: number }>();
    expect(aggregate).toEqual({ count: 20, sessions: 1 });
    const retentionNowMs = aggregationNowMs + 14 * 24 * 60 * 60_000 + 1;
    await expect(
      runAgentActivityRetention({
        batchLimit: 7,
        db: env.OPENMELD_DB,
        nowMs: retentionNowMs,
      })
    ).resolves.toMatchObject({ events: 7 });
    await expect(
      runAgentActivityRetention({
        batchLimit: 7,
        db: env.OPENMELD_DB,
        nowMs: retentionNowMs,
      })
    ).resolves.toMatchObject({ events: 7 });
    await expect(
      runAgentActivityRetention({
        batchLimit: 7,
        db: env.OPENMELD_DB,
        nowMs: retentionNowMs,
      })
    ).resolves.toMatchObject({ events: 6 });
    await expect(
      runAgentActivityRetention({
        batchLimit: 7,
        db: env.OPENMELD_DB,
        nowMs: retentionNowMs,
      })
    ).resolves.toMatchObject({ events: 0 });
  });

  it("turns abandoned digest claims into explicit failures instead of blocking a Project forever", async () => {
    const fixture = await seedFixture();
    const nowMs = Date.now();
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO agent_activity_digests (
          id, organization_id, project_id,
          source_cursor_accepted_sequence,
          window_started_at_ms,
          window_ended_at_ms, event_count, citations_json,
          summary, status, failure_reason,
          created_at_ms, expires_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, 1, '[]', NULL, 'pending', NULL, ?, ?)
      `
    )
      .bind(
        `digest_abandoned_${fixture.suffix}`,
        fixture.organizationId,
        fixture.projectId,
        1,
        nowMs - 2000,
        nowMs - 1000,
        nowMs - 20 * 60_000,
        nowMs + 24 * 60 * 60_000
      )
      .run();

    await expect(
      runAgentActivityDigestTick({
        db: env.OPENMELD_DB,
        nowMs,
        summarize: () => Promise.reject(new Error("must not be called")),
      })
    ).resolves.toMatchObject({ recoveredPending: 1 });
    const digest = await env.OPENMELD_DB.prepare(
      "SELECT status, failure_reason FROM agent_activity_digests WHERE id = ?"
    )
      .bind(`digest_abandoned_${fixture.suffix}`)
      .first<{ failure_reason: string; status: string }>();
    expect(digest).toEqual({
      failure_reason: "summarization_interrupted",
      status: "failed",
    });
  });

  it("materializes the previous UTC day's exact aggregate before raw retention", async () => {
    const fixture = await seedFixture();
    const nowMs = Date.now();
    const currentUtcDayStartedAtMs =
      Math.floor(nowMs / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
    const observedAtMs = currentUtcDayStartedAtMs - 1000;
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, [
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_daily_1`,
          observedAtMs,
        }),
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_daily_2`,
          observedAtMs: observedAtMs + 1,
        }),
      ])
    );

    await expect(
      runAgentActivityDailyAggregation({ db: env.OPENMELD_DB, nowMs })
    ).resolves.toMatchObject({ aggregates: 1, events: 2, sessionKeys: 1 });
    const aggregate = await env.OPENMELD_DB.prepare(
      "SELECT event_count, session_count FROM agent_activity_daily_aggregates WHERE organization_id = ?"
    )
      .bind(fixture.organizationId)
      .first<{
        event_count: number;
        session_count: number;
      }>();
    expect(aggregate).toEqual({
      event_count: 2,
      session_count: 1,
    });
  });

  it("adds active duration once for each unaggregated batch", async () => {
    const fixture = await seedFixture();
    const nowMs = Date.now();
    const currentUtcDayStartedAtMs =
      Math.floor(nowMs / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
    const observedAtMs = currentUtcDayStartedAtMs - 10 * 60_000;
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, [
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_duration_1`,
          observedAtMs,
        }),
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_duration_2`,
          observedAtMs: observedAtMs + 60_000,
        }),
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_duration_3`,
          observedAtMs: observedAtMs + 180_000,
        }),
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_duration_other_1`,
          observedAtMs: observedAtMs + 10_000,
          providerSessionId: `session_${fixture.suffix}_other`,
        }),
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_duration_other_2`,
          observedAtMs: observedAtMs + 40_000,
          providerSessionId: `session_${fixture.suffix}_other`,
        }),
      ])
    );

    await expect(
      runAgentActivityDailyAggregation({ db: env.OPENMELD_DB, nowMs })
    ).resolves.toMatchObject({ events: 5 });
    await expect(
      runAgentActivityDailyAggregation({ db: env.OPENMELD_DB, nowMs })
    ).resolves.toMatchObject({ events: 0 });

    const aggregate = await env.OPENMELD_DB.prepare(
      `
        SELECT active_duration_ms
        FROM agent_activity_daily_aggregates
        WHERE organization_id = ?
      `
    )
      .bind(fixture.organizationId)
      .first<{ active_duration_ms: number }>();
    expect(aggregate).toEqual({ active_duration_ms: 210_000 });
  });

  it("retries a pre-read batch when another aggregation consumes part of it", async () => {
    const fixture = await seedFixture();
    const nowMs = Date.now();
    const currentUtcDayStartedAtMs =
      Math.floor(nowMs / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
    const observedAtMs = currentUtcDayStartedAtMs - 15 * 60_000;
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(
        fixture,
        Array.from({ length: 11 }, (_, index) =>
          buildEvent(fixture, {
            eventId: `event_${fixture.suffix}_overlap_${index}`,
            observedAtMs: observedAtMs + index * 30_000,
          })
        )
      )
    );

    let interleaved = false;
    const interleavedDb = {
      batch: async (statements: D1PreparedStatement[]) => {
        if (!interleaved) {
          interleaved = true;
          await runAgentActivityDailyAggregation({
            batchLimit: 1,
            db: env.OPENMELD_DB,
            nowMs,
          });
        }
        return env.OPENMELD_DB.batch(statements);
      },
      prepare: env.OPENMELD_DB.prepare.bind(env.OPENMELD_DB),
    } as unknown as D1Database;

    await expect(
      runAgentActivityDailyAggregation({
        batchLimit: 11,
        db: interleavedDb,
        nowMs,
      })
    ).resolves.toMatchObject({ events: 1 });

    const aggregate = await env.OPENMELD_DB.prepare(
      `
        SELECT active_duration_ms, event_count
        FROM agent_activity_daily_aggregates
        WHERE organization_id = ?
      `
    )
      .bind(fixture.organizationId)
      .first<{ active_duration_ms: number; event_count: number }>();
    expect(aggregate).toEqual({ active_duration_ms: 0, event_count: 11 });
  });

  it("reads all-time organization stats and keeps only the latest 400 days", async () => {
    const fixture = await seedFixture();
    await env.OPENMELD_DB.prepare(
      `
        WITH RECURSIVE sequence(value) AS (
          SELECT 0
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 400
        )
        INSERT INTO agent_activity_daily_aggregates (
          id, organization_id, project_id, member_user_id, utc_date,
          active_duration_ms, session_count, event_count,
          first_observed_at_ms, last_observed_at_ms,
          provider_counts_json, updated_at_ms
        )
        SELECT
          'activity_stats_' || ? || '_' || value,
          ?, ?, ?, date('2025-01-01', '+' || value || ' days'),
          value + 1, 2, 2, value, value, '{}', 1
        FROM sequence
      `
    )
      .bind(
        fixture.suffix,
        fixture.organizationId,
        fixture.projectId,
        fixture.userId
      )
      .run();
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO agent_activity_daily_aggregates (
          id, organization_id, project_id, member_user_id, utc_date,
          active_duration_ms, session_count, event_count,
          first_observed_at_ms, last_observed_at_ms,
          provider_counts_json, updated_at_ms
        ) VALUES (?, ?, ?, ?, '2026-02-05', 99, 3, 3, 1, 1, '{}', 1)
      `
    )
      .bind(
        `activity_stats_${fixture.suffix}_second_scope`,
        fixture.organizationId,
        `${fixture.projectId}_second`,
        `${fixture.userId}_second`
      )
      .run();

    const stats = await readAgentActivityStats({
      db: env.OPENMELD_DB,
      organizationId: fixture.organizationId,
    });

    expect(stats).toMatchObject({
      dailyTruncated: true,
      organizationId: fixture.organizationId,
      sinceMs: Date.UTC(2025, 0, 1),
      totalActiveDurationMs: 80_700,
      totalSessions: 805,
    });
    expect(stats.daily).toHaveLength(400);
    expect(stats.daily[0]).toEqual({
      activeDurationMs: 2,
      sessionCount: 2,
      utcDate: "2025-01-02",
    });
    expect(stats.daily.at(-1)).toEqual({
      activeDurationMs: 500,
      sessionCount: 5,
      utcDate: "2026-02-05",
    });

    const projectStats = await readAgentActivityStats({
      db: env.OPENMELD_DB,
      organizationId: fixture.organizationId,
      projectId: fixture.projectId,
    });

    expect(projectStats).toMatchObject({
      dailyTruncated: true,
      organizationId: fixture.organizationId,
      sinceMs: Date.UTC(2025, 0, 1),
      totalActiveDurationMs: 80_601,
      totalSessions: 802,
    });
    expect(projectStats.daily.at(-1)).toEqual({
      activeDurationMs: 401,
      sessionCount: 2,
      utcDate: "2026-02-05",
    });
  });

  it("returns explicit empty stats through the member-authorized RPC", async () => {
    const fixture = await seedFixture();

    await expect(
      rpcReadAgentActivityStats(env as CoreBindings, {
        context: fixture.context,
      })
    ).resolves.toEqual({
      daily: [],
      dailyTruncated: false,
      organizationId: fixture.organizationId,
      sinceMs: null,
      totalActiveDurationMs: 0,
      totalSessions: 0,
    });
  });

  it("keeps exact daily session counts across late batches and separate devices", async () => {
    const fixture = await seedFixture();
    const nowMs = Date.now();
    const currentUtcDayStartedAtMs =
      Math.floor(nowMs / (24 * 60 * 60_000)) * 24 * 60 * 60_000;
    const observedAtMs = currentUtcDayStartedAtMs - 10_000;
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, [
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_daily_first`,
          observedAtMs,
        }),
      ])
    );
    await expect(
      runAgentActivityDailyAggregation({
        batchLimit: 1,
        db: env.OPENMELD_DB,
        nowMs,
      })
    ).resolves.toMatchObject({ events: 1, sessionKeys: 1 });

    const secondDeviceId = `${fixture.deviceId}_second`;
    const secondRegistration = await rpcSubmitRuntimeRegistration(
      env as CoreBindings,
      {
        context: fixture.context,
        deviceId: secondDeviceId,
        lane: "dev",
      }
    );
    if (!secondRegistration.openMeldServiceRuntimeId) {
      throw new Error("Second runtime registration did not return authority.");
    }
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, [
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_daily_late_same_device`,
          observedAtMs: observedAtMs + 1,
        }),
      ])
    );
    await rpcSubmitAgentActivityEvents(env as CoreBindings, {
      ...submission(fixture, [
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_daily_second_device`,
          observedAtMs: observedAtMs + 2,
        }),
      ]),
      deviceId: secondDeviceId,
      openMeldServiceRuntimeId: secondRegistration.openMeldServiceRuntimeId,
    });
    await expect(
      runAgentActivityDailyAggregation({
        batchLimit: 1,
        db: env.OPENMELD_DB,
        nowMs,
      })
    ).resolves.toMatchObject({ events: 2, sessionKeys: 1 });

    const aggregate = await env.OPENMELD_DB.prepare(
      `
        SELECT event_count, session_count
        FROM agent_activity_daily_aggregates
        WHERE organization_id = ?
      `
    )
      .bind(fixture.organizationId)
      .first<{ event_count: number; session_count: number }>();
    expect(aggregate).toEqual({ event_count: 3, session_count: 2 });
  });

  it("reports snapshot truncation instead of silently hiding the 501st session or digest", async () => {
    const fixture = await seedFixture();
    await env.OPENMELD_DB.prepare(
      `
        WITH RECURSIVE sequence(value) AS (
          SELECT 0
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 500
        )
        INSERT INTO projects (
          id, organization_id, name, slug, repository_fingerprint,
          created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms
        )
        SELECT
          'project_truncation_' || ? || '_' || value,
          ?, 'Project ' || value, 'project-' || value, NULL,
          ?, 1, 1, NULL
        FROM sequence
      `
    )
      .bind(fixture.suffix, fixture.organizationId, fixture.userId)
      .run();
    await env.OPENMELD_DB.prepare(
      `
        WITH RECURSIVE sequence(value) AS (
          SELECT 0
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 500
        )
        INSERT INTO agent_activity_sessions (
          id, organization_id, project_id, member_user_id, device_id,
          openmeld_service_runtime_id, provider, client_kind,
          provider_session_id, title, model, status, git_branch, git_commit,
          repository_fingerprint, started_at_ms, last_observed_at_ms,
          expires_at_ms, provider_metadata_json, last_event_id,
          last_accepted_sequence, created_at_ms, updated_at_ms
        )
        SELECT
          'activity_session_truncation_' || ? || '_' || value,
          ?, ?, ?, 'device-truncation-' || value,
          'runtime-truncation-' || value, 'codex', 'codex-cli',
          'provider-session-' || value, 'Session ' || value, NULL,
          'active', NULL, NULL, NULL, NULL, 1000 + value,
          2000 + value, '{}', 'event-truncation-' || value,
          value + 1, 1, 1
        FROM sequence
      `
    )
      .bind(
        fixture.suffix,
        fixture.organizationId,
        fixture.projectId,
        fixture.userId
      )
      .run();
    await env.OPENMELD_DB.prepare(
      `
        WITH RECURSIVE sequence(value) AS (
          SELECT 0
          UNION ALL
          SELECT value + 1 FROM sequence WHERE value < 500
        )
        INSERT INTO agent_activity_digests (
          id, organization_id, project_id, source_cursor_accepted_sequence,
          window_started_at_ms, window_ended_at_ms, event_count,
          citations_json, summary, status, failure_reason,
          created_at_ms, expires_at_ms
        )
        SELECT
          'activity_digest_truncation_' || ? || '_' || value,
          ?, 'project_truncation_' || ? || '_' || value, 1,
          value, value + 1, 1,
          '[{"eventId":"event-citation","observedAtMs":1}]',
          'Digest ' || value,
          'completed', NULL, 1000 + value, 10_000 + value
        FROM sequence
      `
    )
      .bind(fixture.suffix, fixture.organizationId, fixture.suffix)
      .run();

    const snapshot = await rpcReadAgentActivitySnapshot(env as CoreBindings, {
      context: fixture.context,
    });
    expect(snapshot.sessions).toHaveLength(500);
    expect(snapshot.sessionsTruncated).toBe(true);
    expect(snapshot.digests).toHaveLength(500);
    expect(snapshot.digestsTruncated).toBe(true);
  });

  it("cascades all organization-owned Agent Activity evidence on organization deletion", async () => {
    const fixture = await seedFixture();
    const observedAtMs = Date.now() - 24 * 60 * 60_000;
    await rpcSubmitAgentActivityEvents(
      env as CoreBindings,
      submission(fixture, [
        buildEvent(fixture, {
          eventId: `event_${fixture.suffix}_cascade`,
          observedAtMs,
        }),
      ])
    );
    await runAgentActivityDailyAggregation({
      db: env.OPENMELD_DB,
      nowMs: Date.now(),
    });
    await env.OPENMELD_DB.prepare(
      `
        INSERT INTO agent_activity_digests (
          id, organization_id, project_id, source_cursor_accepted_sequence,
          window_started_at_ms, window_ended_at_ms, event_count,
          citations_json, summary, status, failure_reason,
          created_at_ms, expires_at_ms
        ) VALUES (?, ?, ?, 1, ?, ?, 1, '[]', 'Cascade digest',
          'completed', NULL, ?, ?)
      `
    )
      .bind(
        `activity_digest_cascade_${fixture.suffix}`,
        fixture.organizationId,
        fixture.projectId,
        observedAtMs,
        observedAtMs,
        observedAtMs,
        observedAtMs + 30 * 24 * 60 * 60_000
      )
      .run();

    await env.OPENMELD_DB.prepare("DELETE FROM organizations WHERE id = ?")
      .bind(fixture.organizationId)
      .run();
    for (const table of [
      "projects",
      "agent_activity_events",
      "agent_activity_sessions",
      "agent_activity_digests",
      "agent_activity_daily_aggregates",
      "agent_activity_daily_session_keys",
      "agent_activity_execution_links",
    ]) {
      const row = await env.OPENMELD_DB.prepare(
        `SELECT count(*) AS count FROM ${table} WHERE organization_id = ?`
      )
        .bind(fixture.organizationId)
        .first<{ count: number }>();
      expect(row?.count, table).toBe(0);
    }
  });
});

type Fixture = Awaited<ReturnType<typeof seedFixture>>;

function buildEvent(
  fixture: Fixture,
  input: {
    eventId: string;
    observedAtMs: number;
    providerSessionId?: string;
    status?: AgentActivityEvent["status"];
    title?: string;
  }
): AgentActivityEvent {
  return {
    clientKind: "codex-app",
    eventId: input.eventId,
    eventType: input.status === "idle" ? "session_idle" : "session_active",
    expiresAtMs: input.observedAtMs + 60_000,
    gitBranch: "main",
    gitCommit: "f5ed74125265b042763b5b484e46bc033b759d98",
    model: "gpt-5.6-sol",
    observedAtMs: input.observedAtMs,
    organizationId: fixture.organizationId,
    projectId: fixture.projectId,
    provider: "codex",
    providerMetadata: {
      approvalPolicy: "never",
      cliVersion: "0.144.1",
      originator: "desktop",
      reasoningEffort: "xhigh",
      sandboxMode: "danger-full-access",
      source: "rollout",
    },
    providerSessionId: input.providerSessionId ?? `session_${fixture.suffix}`,
    repositoryFingerprint: fixture.repositoryFingerprint,
    source: "observed",
    startedAtMs: input.observedAtMs - 5000,
    status: input.status ?? "active",
    title: input.title ?? "Agent Activity",
  };
}

function submission(fixture: Fixture, events: unknown[]) {
  return {
    context: fixture.context,
    deviceId: fixture.deviceId,
    events,
    lane: "dev",
    openMeldServiceRuntimeId: fixture.openMeldServiceRuntimeId,
  };
}

async function seedFixture() {
  const suffix = crypto.randomUUID();
  owned.add(suffix);
  const organizationId = `org_activity_${suffix}`;
  const userId = `user_activity_${suffix}`;
  const memberId = `member_activity_${suffix}`;
  const profileId = crypto.randomUUID();
  const projectId = `project_activity_${suffix}`;
  const deviceId = `device_activity_${suffix}`;
  const repositoryFingerprint =
    "sha256:9e2ad4675834b2b34f92832dd05229bc9f99df436f958640d0fd916c8e73e0fd";
  await env.OPENMELD_DB.batch([
    env.OPENMELD_DB.prepare(
      "INSERT INTO users (id, name, email, email_verified, created_at, updated_at) VALUES (?, 'Activity User', ?, 1, 1, 1)"
    ).bind(userId, `${userId}@example.com`),
    env.OPENMELD_DB.prepare(
      "INSERT INTO organizations (id, name, slug, created_at) VALUES (?, 'Activity Org', ?, 1)"
    ).bind(organizationId, `activity-${suffix}`),
    env.OPENMELD_DB.prepare(
      "INSERT INTO members (id, organization_id, user_id, role, created_at) VALUES (?, ?, ?, 'member', 1)"
    ).bind(memberId, organizationId, userId),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO openmeld_profiles (
          profile_id, profile_name, profile_handle, profile_kind, is_default,
          status, organization_id, owner_user_id, created_by_user_id, source,
          created_at, updated_at
        ) VALUES (?, 'Activity User', ?, 'human', 1, 'active', NULL, ?, ?, 'auth_bootstrap', 1, 1)
      `
    ).bind(profileId, `activity-${suffix}`, userId, userId),
    env.OPENMELD_DB.prepare(
      `
        INSERT INTO projects (
          id, organization_id, name, slug, repository_fingerprint,
          created_by_user_id, created_at_ms, updated_at_ms, archived_at_ms
        ) VALUES (?, ?, 'OpenMeld', 'openmeld', ?, ?, 1, 1, NULL)
      `
    ).bind(projectId, organizationId, repositoryFingerprint, userId),
  ]);
  const context = {
    activeOrganizationId: organizationId,
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      profileKind: "human" as const,
      requestId: `request_${suffix}`,
      openMeldProfileId: profileId,
    },
  };
  const registration = await rpcSubmitRuntimeRegistration(env as CoreBindings, {
    context,
    deviceId,
    lane: "dev",
  });
  if (!registration.openMeldServiceRuntimeId) {
    throw new Error("Runtime registration did not return authority.");
  }
  return {
    context,
    deviceId,
    memberId,
    organizationId,
    projectId,
    repositoryFingerprint,
    suffix,
    userId,
    openMeldServiceRuntimeId: registration.openMeldServiceRuntimeId,
  };
}
