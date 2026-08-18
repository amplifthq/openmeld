import {
  buildOpenMeldNavigationAction,
  CENTER_AGENT_ACCOUNT_CONNECTION_REQUIRED_PUBLIC_COPY,
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
  HOSTED_CENTER_AGENT_RUNTIME_IDENTITY,
  remoteAgentWorkerSubmitTurnRequestSchema,
} from "@openmeld/schemas";
import type {
  AuthRpcResolveOrganizationAccountIdentityInput,
  AuthRpcResolveOrganizationAccountIdentityResult,
  RemoteAgentCoreCallbackBody,
  RemoteAgentNativeDeliveryDeadlineProbeQueueMessage,
  RemoteAgentWorkerSubmitTurnRequest,
} from "@openmeld/schemas/types";
import type { UsersInfoResponse } from "@slack/web-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS } from "../src/remote-agent/application/native-delivery-admission-watchdog";
import {
  completeRemoteAgentNativeDelivery,
  processRemoteAgentNativeDeliveryDeadlineProbe,
  REMOTE_AGENT_EXECUTION_RECONCILIATION_DELAY_MS,
  REMOTE_AGENT_SLACK_FINAL_PUBLICATION_CLAIM_LEASE_MS,
  REMOTE_AGENT_SLACK_FINAL_PUBLICATION_TIMEOUT_MS,
  retryMissingRemoteAgentAcceptedDeliveryProbes,
} from "../src/remote-agent/application/native-delivery-service";
import {
  isSlackFullWorkspaceMember,
  readSlackUserIdentity,
} from "../src/remote-agent/application/slack-client";
import { buildRemoteAgentSlackConversationId } from "../src/remote-agent/application/slack-conversation-id";
import { digestSlackIdentityLinkToken } from "../src/remote-agent/application/slack-identity-link-token";
import { decryptSlackSearchAuthorization } from "../src/remote-agent/application/slack-search-authorization";
import {
  processRemoteAgentSlackEvent,
  runSlackChannelIntroductionTick,
  submitRemoteAgentSlackChannelIntroduction,
} from "../src/remote-agent/application/slack-signal-service";
import {
  markRemoteAgentNativeDeliveryAck,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { readRemoteAgentSlackEventIngress } from "../src/remote-agent/infrastructure/d1/slack-event-ingress-repo";
import {
  advanceSlackThreadContextCursor,
  readSlackThreadContextCursor,
} from "../src/remote-agent/infrastructure/d1/slack-thread-context-cursor-repo";
import {
  claimSlackIdentityLinkTokenForUser,
  insertSlackIdentityLinkToken,
  insertSlackUserIdentityLinkIfAbsent,
  readSlackIdentityLinkTokenForUser,
  readSlackUserIdentityLink,
} from "../src/remote-agent/infrastructure/d1/slack-user-identity-link-repo";
import { upsertRemoteAgentSlackWorkspaceBinding } from "../src/remote-agent/infrastructure/d1/slack-workspace-binding-repo";
import {
  rpcConnectCenterAgentSlackWorkspace,
  rpcConsumeSlackIdentityLink,
  rpcPreviewSlackIdentityLink,
} from "../src/rpc/methods";
import {
  applyDrizzleMigrationsForTables,
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createFaultInjectingD1Database,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = buildRemoteAgentSlackConversationId({
  channelId: "C123",
  teamId: "T123",
  threadTs: "1710000000.000100",
});
const COMPLETED_SLACK_MARKDOWN =
  "**Done from Slack** with [docs](https://example.com/docs).\n\n```ts\nconst ok = true;\n```";
const SLACK_IDENTITY_LINK_URL_PATTERN =
  /^https:\/\/openmeld\.ai\/link-slack\?token=slacklink_[a-f0-9]{64}$/u;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Remote Agent Slack signal service", () => {
  it("checkpoints every selected channel as its own contextual Center Agent introduction", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: `req_${request.idempotencyKey}`,
        status: "pending" as const,
        submissionId: `sub_${request.idempotencyKey}`,
      })
    );
    const fetchMock = stubSlackFetch({
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRODUCT",
            is_member: false,
            is_private: false,
            name: "product",
          },
          {
            id: "C_DESIGN",
            is_member: true,
            is_private: false,
            name: "design",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await expect(
        submitRemoteAgentSlackChannelIntroduction({
          env: buildEnv(harness.db, { workerSubmit }),
          interactionId: "V_CHANNELS",
          organizationInviteUrl: "https://openmeld.ai/join/openmeld-test",
          slackTeamId: "T123",
          slackUserId: "U123",
          targetSlackChannelIds: ["C_PRODUCT", "C_DESIGN"],
        })
      ).resolves.toBeUndefined();

      expect(workerSubmit).toHaveBeenCalledTimes(2);
      const submissions = workerSubmit.mock.calls.map(([request]) => request);
      expect(submissions).toEqual([
        expect.objectContaining({
          idempotencyKey:
            "slack-channel-introduction:T123:V_CHANNELS:C_PRODUCT",
          messages: [
            expect.objectContaining({
              content: expect.stringContaining("selected #product"),
              role: "user",
            }),
          ],
          onBehalfOf: expect.objectContaining({ displayName: "Ari Human" }),
          turnEnvelope: expect.objectContaining({
            interactionEnvironment: "requester_private",
            sender: expect.objectContaining({ id: "member_1", verified: true }),
            space: expect.objectContaining({
              isCenterAgentDm: true,
              kind: "dm",
            }),
          }),
        }),
        expect.objectContaining({
          idempotencyKey: "slack-channel-introduction:T123:V_CHANNELS:C_DESIGN",
          messages: [
            expect.objectContaining({
              content: expect.stringContaining("selected #design"),
              role: "user",
            }),
          ],
        }),
      ]);
      expect(submissions[0]?.messages[0]?.content).not.toContain("#design");
      expect(submissions[1]?.messages[0]?.content).not.toContain("#product");
      expect(submissions[0]?.messages[0]?.content).toContain(
        "https://openmeld.ai/join/openmeld-test"
      );
      expect(
        harness.queryAll({
          sql: `SELECT slack_channel_id, status
            FROM slack_channel_introduction_items
            ORDER BY position`,
        })
      ).toEqual([
        { slack_channel_id: "C_PRODUCT", status: "submitted" },
        { slack_channel_id: "C_DESIGN", status: "submitted" },
      ]);
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/conversations.join")
        )
      ).toHaveLength(1);
      expect(readSlackPostBodies(fetchMock)).toContainEqual(
        expect.objectContaining({
          channel: "D_OPENMELD",
          metadata: {
            event_payload: { interaction_id: "V_CHANNELS" },
            event_type: "openmeld_channel_intro_acknowledged",
          },
          text: expect.stringContaining("#product and #design work"),
        })
      );
    } finally {
      harness.close();
    }
  });

  it("continues channel introductions when the first acknowledgement checkpoint write fails", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: `req_${request.idempotencyKey}`,
        status: "pending" as const,
        submissionId: `sub_${request.idempotencyKey}`,
      })
    );
    stubSlackFetch({
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRODUCT",
            is_member: true,
            is_private: false,
            name: "product",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const db = createFaultInjectingD1Database({
        db: harness.db,
        matches: (sql, operation) =>
          operation === "first" &&
          sql.includes("UPDATE slack_channel_introduction_runs") &&
          sql.includes("status = 'ready'"),
      });

      await expect(
        submitRemoteAgentSlackChannelIntroduction({
          env: buildEnv(db, { workerSubmit }),
          interactionId: "V_CHANNEL_CHECKPOINT",
          organizationInviteUrl: "https://openmeld.ai/join/openmeld-test",
          slackTeamId: "T123",
          slackUserId: "U123",
          targetSlackChannelIds: ["C_PRODUCT"],
        })
      ).resolves.toBeUndefined();

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(
        harness.queryFirst({
          sql: `SELECT status, acknowledgement_ts, failure_code
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_CHECKPOINT'`,
        })
      ).toEqual({
        acknowledgement_ts: "1710000001.000200",
        failure_code: null,
        status: "ready",
      });
      expect(
        harness.queryFirst({
          sql: `SELECT status
            FROM slack_channel_introduction_items
            WHERE interaction_id = 'V_CHANNEL_CHECKPOINT'`,
        })
      ).toEqual({ status: "submitted" });
    } finally {
      harness.close();
    }
  });

  it("recovers a submitted channel introduction when its item checkpoint stays unavailable", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: `req_${request.idempotencyKey}`,
        status: "pending" as const,
        submissionId: `sub_${request.idempotencyKey}`,
      })
    );
    const fetchMock = stubSlackFetch({
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRODUCT",
            is_member: true,
            is_private: false,
            name: "product",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const db = createFaultInjectingD1Database({
        db: harness.db,
        failureCount: 2,
        matches: (sql, operation) =>
          operation === "first" &&
          sql.includes("UPDATE slack_channel_introduction_items") &&
          sql.includes("status = ?") &&
          sql.includes("AND claim_id = ?"),
      });

      await submitRemoteAgentSlackChannelIntroduction({
        env: buildEnv(db, { workerSubmit }),
        interactionId: "V_CHANNEL_ITEM_CHECKPOINT",
        organizationInviteUrl: null,
        slackTeamId: "T123",
        slackUserId: "U123",
        targetSlackChannelIds: ["C_PRODUCT"],
      });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      const pendingCheckpoint = harness.queryFirst<{
        status: string;
        updated_at_ms: number;
      }>({
        sql: `SELECT status, updated_at_ms
          FROM slack_channel_introduction_items
          WHERE interaction_id = 'V_CHANNEL_ITEM_CHECKPOINT'`,
      });
      expect(pendingCheckpoint?.status).toBe("submitting");

      await runSlackChannelIntroductionTick({
        db: harness.db,
        env: buildEnv(harness.db, { workerSubmit }),
        interactionId: "V_CHANNEL_ITEM_CHECKPOINT",
        nowMs: (pendingCheckpoint?.updated_at_ms ?? 0) + 5 * 60_000 + 1,
      });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      expect(
        harness.queryFirst({
          sql: `SELECT status, failure_code
            FROM slack_channel_introduction_items
            WHERE interaction_id = 'V_CHANNEL_ITEM_CHECKPOINT'`,
        })
      ).toEqual({ failure_code: null, status: "submitted" });
    } finally {
      harness.close();
    }
  });

  it("reconciles a confirmed acknowledgement after its checkpoint stays unavailable", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: `req_${request.idempotencyKey}`,
        status: "pending" as const,
        submissionId: `sub_${request.idempotencyKey}`,
      })
    );
    const fetchMock = stubSlackFetch({
      conversationsHistoryResponse: {
        messages: [
          {
            metadata: {
              event_payload: {
                interaction_id: "V_CHANNEL_DURABLE_RECOVERY",
              },
              event_type: "openmeld_channel_intro_acknowledged",
            },
            ts: "1710000001.000200",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRODUCT",
            is_member: true,
            is_private: false,
            name: "product",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const db = createFaultInjectingD1Database({
        db: harness.db,
        failureCount: 2,
        matches: (sql, operation) =>
          operation === "first" &&
          sql.includes("UPDATE slack_channel_introduction_runs") &&
          sql.includes("status = 'ready'"),
      });
      await submitRemoteAgentSlackChannelIntroduction({
        env: buildEnv(db, { workerSubmit }),
        interactionId: "V_CHANNEL_DURABLE_RECOVERY",
        organizationInviteUrl: null,
        slackTeamId: "T123",
        slackUserId: "U123",
        targetSlackChannelIds: ["C_PRODUCT"],
      });
      const submittedAtMs = readSlackChannelIntroductionCreatedAtMs(
        harness,
        "V_CHANNEL_DURABLE_RECOVERY"
      );

      expect(workerSubmit).not.toHaveBeenCalled();
      expect(
        harness.queryFirst({
          sql: `SELECT status, acknowledgement_ts, failure_code
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_DURABLE_RECOVERY'`,
        })
      ).toEqual({
        acknowledgement_ts: null,
        failure_code: null,
        status: "ack_pending",
      });

      await runSlackChannelIntroductionTick({
        db: harness.db,
        env: buildEnv(harness.db, { workerSubmit }),
        interactionId: "V_CHANNEL_DURABLE_RECOVERY",
        nowMs: submittedAtMs + 5 * 60_000 + 1,
      });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(
        harness.queryFirst({
          sql: `SELECT status, acknowledgement_ts, failure_code
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_DURABLE_RECOVERY'`,
        })
      ).toEqual({
        acknowledgement_ts: "1710000001.000200",
        failure_code: null,
        status: "ready",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("publishes one durable retry action when concurrent ticks cannot find the acknowledgement", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn();
    stubSlackFetch({
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRODUCT",
            is_member: true,
            is_private: false,
            name: "product",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const db = createFaultInjectingD1Database({
        db: harness.db,
        failureCount: 2,
        matches: (sql, operation) =>
          operation === "first" &&
          sql.includes("UPDATE slack_channel_introduction_runs") &&
          sql.includes("status = 'ready'"),
      });
      await submitRemoteAgentSlackChannelIntroduction({
        env: buildEnv(db, { workerSubmit }),
        interactionId: "V_CHANNEL_MISSING_ACK",
        organizationInviteUrl: null,
        slackTeamId: "T123",
        slackUserId: "U123",
        targetSlackChannelIds: ["C_PRODUCT"],
      });
      const submittedAtMs = readSlackChannelIntroductionCreatedAtMs(
        harness,
        "V_CHANNEL_MISSING_ACK"
      );

      let historyRequests = 0;
      let releaseHistoryRequests!: () => void;
      const historyRequestsReady = new Promise<void>((resolve) => {
        releaseHistoryRequests = resolve;
      });
      const recoveryFetch = vi.fn(
        async (request: RequestInfo | URL): Promise<Response> => {
          const url = String(request);
          if (url.includes("/conversations.history")) {
            historyRequests += 1;
            if (historyRequests === 2) {
              releaseHistoryRequests();
            }
            await historyRequestsReady;
            return Response.json({
              messages: [],
              ok: true,
              response_metadata: { next_cursor: "" },
            });
          }
          if (url.includes("/chat.postMessage")) {
            return Response.json({ ok: true, ts: "1710000002.000300" });
          }
          return Response.json({ error: "unknown_method", ok: false });
        }
      );
      vi.stubGlobal("fetch", recoveryFetch);
      const recoveryNowMs = submittedAtMs + 5 * 60_000 + 1;

      await Promise.all([
        runSlackChannelIntroductionTick({
          db: harness.db,
          env: buildEnv(harness.db, { workerSubmit }),
          interactionId: "V_CHANNEL_MISSING_ACK",
          nowMs: recoveryNowMs,
        }),
        runSlackChannelIntroductionTick({
          db: harness.db,
          env: buildEnv(harness.db, { workerSubmit }),
          interactionId: "V_CHANNEL_MISSING_ACK",
          nowMs: recoveryNowMs,
        }),
      ]);

      const recoveryPosts = readSlackPostBodies(recoveryFetch);
      expect(recoveryPosts).toEqual([
        expect.objectContaining({
          channel: "D_OPENMELD",
          metadata: {
            event_payload: { interaction_id: "V_CHANNEL_MISSING_ACK" },
            event_type: "openmeld_channel_intro_recovery_notice",
          },
          text: expect.stringContaining("choose the channels again"),
        }),
      ]);
      expect(
        harness.queryFirst({
          sql: `SELECT status, recovery_notice_ts
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_MISSING_ACK'`,
        })
      ).toEqual({
        recovery_notice_ts: "1710000002.000300",
        status: "recovery_notice_delivered",
      });
    } finally {
      harness.close();
    }
  });

  it("retries a recovery notice that Slack explicitly did not publish", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn();
    stubSlackFetch({
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRODUCT",
            is_member: true,
            is_private: false,
            name: "product",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const db = createFaultInjectingD1Database({
        db: harness.db,
        failureCount: 2,
        matches: (sql, operation) =>
          operation === "first" &&
          sql.includes("UPDATE slack_channel_introduction_runs") &&
          sql.includes("status = 'ready'"),
      });
      await submitRemoteAgentSlackChannelIntroduction({
        env: buildEnv(db, { workerSubmit }),
        interactionId: "V_CHANNEL_RETRY_NOTICE",
        organizationInviteUrl: null,
        slackTeamId: "T123",
        slackUserId: "U123",
        targetSlackChannelIds: ["C_PRODUCT"],
      });
      const submittedAtMs = readSlackChannelIntroductionCreatedAtMs(
        harness,
        "V_CHANNEL_RETRY_NOTICE"
      );

      let postAttempt = 0;
      const recoveryFetch = vi.fn((request: RequestInfo | URL): Response => {
        const url = String(request);
        if (url.includes("/conversations.history")) {
          return Response.json({
            messages: [],
            ok: true,
            response_metadata: { next_cursor: "" },
          });
        }
        if (url.includes("/chat.postMessage")) {
          postAttempt += 1;
          return postAttempt === 1
            ? Response.json({ error: "internal_error", ok: false })
            : Response.json({ ok: true, ts: "1710000003.000400" });
        }
        return Response.json({ error: "unknown_method", ok: false });
      });
      vi.stubGlobal("fetch", recoveryFetch);
      const recoveryNowMs = submittedAtMs + 5 * 60_000 + 1;

      await runSlackChannelIntroductionTick({
        db: harness.db,
        env: buildEnv(harness.db, { workerSubmit }),
        interactionId: "V_CHANNEL_RETRY_NOTICE",
        nowMs: recoveryNowMs,
      });
      expect(
        harness.queryFirst({
          sql: `SELECT status, recovery_notice_attempt_count
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_RETRY_NOTICE'`,
        })
      ).toEqual({
        recovery_notice_attempt_count: 1,
        status: "recovery_notice_pending",
      });

      await runSlackChannelIntroductionTick({
        db: harness.db,
        env: buildEnv(harness.db, { workerSubmit }),
        interactionId: "V_CHANNEL_RETRY_NOTICE",
        nowMs: recoveryNowMs + 60_000,
      });

      expect(readSlackPostBodies(recoveryFetch)).toHaveLength(2);
      expect(
        harness.queryFirst({
          sql: `SELECT status, recovery_notice_ts, recovery_notice_attempt_count
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_RETRY_NOTICE'`,
        })
      ).toEqual({
        recovery_notice_attempt_count: 2,
        recovery_notice_ts: "1710000003.000400",
        status: "recovery_notice_delivered",
      });
    } finally {
      harness.close();
    }
  });

  it("reconciles a confirmed recovery notice after its checkpoint stays unavailable", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn();
    stubSlackFetch({
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRODUCT",
            is_member: true,
            is_private: false,
            name: "product",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const acknowledgementCheckpointDb = createFaultInjectingD1Database({
        db: harness.db,
        failureCount: 2,
        matches: (sql, operation) =>
          operation === "first" &&
          sql.includes("UPDATE slack_channel_introduction_runs") &&
          sql.includes("status = 'ready'"),
      });
      await submitRemoteAgentSlackChannelIntroduction({
        env: buildEnv(acknowledgementCheckpointDb, { workerSubmit }),
        interactionId: "V_CHANNEL_RECOVERY_CHECKPOINT",
        organizationInviteUrl: null,
        slackTeamId: "T123",
        slackUserId: "U123",
        targetSlackChannelIds: ["C_PRODUCT"],
      });
      const submittedAtMs = readSlackChannelIntroductionCreatedAtMs(
        harness,
        "V_CHANNEL_RECOVERY_CHECKPOINT"
      );

      let historyRequestCount = 0;
      const recoveryFetch = vi.fn((request: RequestInfo | URL): Response => {
        const url = String(request);
        if (url.includes("/conversations.history")) {
          historyRequestCount += 1;
          return Response.json({
            messages:
              historyRequestCount === 1
                ? []
                : [
                    {
                      metadata: {
                        event_payload: {
                          interaction_id: "V_CHANNEL_RECOVERY_CHECKPOINT",
                        },
                        event_type: "openmeld_channel_intro_recovery_notice",
                      },
                      ts: "1710000004.000500",
                    },
                  ],
            ok: true,
            response_metadata: { next_cursor: "" },
          });
        }
        if (url.includes("/chat.postMessage")) {
          return Response.json({ ok: true, ts: "1710000004.000500" });
        }
        return Response.json({ error: "unknown_method", ok: false });
      });
      vi.stubGlobal("fetch", recoveryFetch);
      const recoveryNowMs = submittedAtMs + 5 * 60_000 + 1;
      const recoveryCheckpointDb = createFaultInjectingD1Database({
        db: harness.db,
        failureCount: 2,
        matches: (sql, operation) =>
          operation === "first" &&
          sql.includes("UPDATE slack_channel_introduction_runs") &&
          sql.includes("status = 'recovery_notice_delivered'"),
      });

      await runSlackChannelIntroductionTick({
        db: recoveryCheckpointDb,
        env: buildEnv(recoveryCheckpointDb, { workerSubmit }),
        interactionId: "V_CHANNEL_RECOVERY_CHECKPOINT",
        nowMs: recoveryNowMs,
      });
      expect(
        harness.queryFirst({
          sql: `SELECT status, recovery_notice_ts
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_RECOVERY_CHECKPOINT'`,
        })
      ).toEqual({
        recovery_notice_ts: null,
        status: "recovery_notice_submitting",
      });

      await runSlackChannelIntroductionTick({
        db: harness.db,
        env: buildEnv(harness.db, { workerSubmit }),
        interactionId: "V_CHANNEL_RECOVERY_CHECKPOINT",
        nowMs: recoveryNowMs + 5 * 60_000 + 1,
      });

      expect(readSlackPostBodies(recoveryFetch)).toHaveLength(1);
      expect(
        harness.queryFirst({
          sql: `SELECT status, recovery_notice_ts, recovery_notice_attempt_count
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_RECOVERY_CHECKPOINT'`,
        })
      ).toEqual({
        recovery_notice_attempt_count: 1,
        recovery_notice_ts: "1710000004.000500",
        status: "recovery_notice_delivered",
      });
    } finally {
      harness.close();
    }
  });

  it("does not replay a recovery notice when Slack publication is ambiguous", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn();
    stubSlackFetch({
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRODUCT",
            is_member: true,
            is_private: false,
            name: "product",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const acknowledgementCheckpointDb = createFaultInjectingD1Database({
        db: harness.db,
        failureCount: 2,
        matches: (sql, operation) =>
          operation === "first" &&
          sql.includes("UPDATE slack_channel_introduction_runs") &&
          sql.includes("status = 'ready'"),
      });
      await submitRemoteAgentSlackChannelIntroduction({
        env: buildEnv(acknowledgementCheckpointDb, { workerSubmit }),
        interactionId: "V_CHANNEL_AMBIGUOUS_NOTICE",
        organizationInviteUrl: null,
        slackTeamId: "T123",
        slackUserId: "U123",
        targetSlackChannelIds: ["C_PRODUCT"],
      });
      const submittedAtMs = readSlackChannelIntroductionCreatedAtMs(
        harness,
        "V_CHANNEL_AMBIGUOUS_NOTICE"
      );

      let postAttemptCount = 0;
      const recoveryFetch = vi.fn((request: RequestInfo | URL): Response => {
        const url = String(request);
        if (url.includes("/conversations.history")) {
          return Response.json({
            messages: [],
            ok: true,
            response_metadata: { next_cursor: "" },
          });
        }
        if (url.includes("/chat.postMessage")) {
          postAttemptCount += 1;
          throw new TypeError("Slack connection closed before a response");
        }
        return Response.json({ error: "unknown_method", ok: false });
      });
      vi.stubGlobal("fetch", recoveryFetch);
      const recoveryNowMs = submittedAtMs + 5 * 60_000 + 1;

      await runSlackChannelIntroductionTick({
        db: harness.db,
        env: buildEnv(harness.db, { workerSubmit }),
        interactionId: "V_CHANNEL_AMBIGUOUS_NOTICE",
        nowMs: recoveryNowMs,
      });
      await runSlackChannelIntroductionTick({
        db: harness.db,
        env: buildEnv(harness.db, { workerSubmit }),
        interactionId: "V_CHANNEL_AMBIGUOUS_NOTICE",
        nowMs: recoveryNowMs + 60_000,
      });

      expect(postAttemptCount).toBe(1);
      expect(
        harness.queryFirst({
          sql: `SELECT status, recovery_notice_attempt_count
            FROM slack_channel_introduction_runs
            WHERE interaction_id = 'V_CHANNEL_AMBIGUOUS_NOTICE'`,
        })
      ).toEqual({
        recovery_notice_attempt_count: 1,
        status: "recovery_notice_outcome_unknown",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps each Slack thread context cursor monotonic", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const cursorKey = {
      connectionCreatedAtMs: 1000,
      organizationId: "org_1",
      slackChannelId: "C123",
      slackTeamId: "T123",
      slackThreadTs: "1710000000.000100",
    };

    try {
      await advanceSlackThreadContextCursor({
        db: harness.db,
        nowMs: 2000,
        syncedThroughEpochMicros: 1_710_000_015_000_400,
        syncedThroughTs: "1710000015.000400",
        ...cursorKey,
      });
      await advanceSlackThreadContextCursor({
        db: harness.db,
        nowMs: 3000,
        syncedThroughEpochMicros: 1_710_000_012_000_300,
        syncedThroughTs: "1710000012.000300",
        ...cursorKey,
      });

      await expect(
        readSlackThreadContextCursor({ db: harness.db, ...cursorKey })
      ).resolves.toBe("1710000015.000400");
      await expect(
        readSlackThreadContextCursor({
          db: harness.db,
          ...cursorKey,
          connectionCreatedAtMs: 1001,
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it.each<SlackMembershipStatusField>([
    "deleted",
    "is_restricted",
    "is_stranger",
    "is_ultra_restricted",
  ])("accepts a same-workspace Slack member when users.info omits $field", async (field) => {
    const fetchMock = stubSlackFetch({
      email: "ari@example.test",
      usersInfoResponse: buildSlackUsersInfoResponseWithout(
        field,
        "ari@example.test"
      ),
    });

    const identity = await readSlackUserIdentity({
      botToken: "xoxb-test",
      fetchImpl: fetchMock,
      userId: "U123",
    });

    expect(isSlackFullWorkspaceMember({ identity, slackTeamId: "T123" })).toBe(
      true
    );
  });

  it("matches Slack app_mention senders when Slack omits an optional membership status", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_1",
      status: "pending" as const,
      submissionId: "sub_slack_1",
    }));
    const queueSend = vi.fn(async () => undefined);
    const fetchMock = stubSlackFetch({
      email: "ari@example.test",
      usersInfoResponse: buildSlackUsersInfoResponseWithout(
        "is_stranger",
        "ari@example.test"
      ),
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { queueSend, workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          agentProfileId: AGENT_PROFILE_ID,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
          messages: [{ role: "user", content: "<@B123> create a Codex agent" }],
          spaceId: CONVERSATION_ID,
          turnEnvelope: expect.objectContaining({
            interactionEnvironment: "organization_shared",
            organization: expect.objectContaining({
              webUrl: "https://openmeld.ai/o/openmeld-labs",
            }),
            sender: expect.objectContaining({
              displayName: "Ari Human",
              id: "member_1",
              verified: true,
            }),
            space: expect.objectContaining({
              name: "#all",
            }),
            trigger: expect.objectContaining({
              channelId: "C123",
              channelName: "all",
              conversationId: CONVERSATION_ID,
              source: "slack",
              teamId: "T123",
              threadTs: "1710000000.000100",
            }),
          }),
        })
      );
      expect(queueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "remote-agent-slack:Ev123",
          idempotencyKey: "remote-agent-slack:T123:Ev123",
          spaceId: CONVERSATION_ID,
          submissionId: "admission_watchdog:remote-agent-slack:T123:Ev123",
        }),
        { delaySeconds: REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS }
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("users.info"),
        expect.any(Object)
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("conversations.info?channel=C123"),
        expect.objectContaining({ method: "GET" })
      );
      expect(readSlackThreadStatusBodies(fetchMock)).toEqual([
        {
          channel_id: "C123",
          status: "is working on your request…",
          thread_ts: "1710000000.000100",
        },
      ]);
      const statusCallIndex = fetchMock.mock.calls.findIndex(([request]) =>
        String(request).includes("/assistant.threads.setStatus")
      );
      expect(fetchMock.mock.invocationCallOrder[statusCallIndex]).toBeLessThan(
        workerSubmit.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        conversationKind: "slack",
        onBehalfOfProfileId: "22222222-2222-4222-8222-222222222222",
        onBehalfOfUserId: "user_member",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1710000000.000100",
        status: "accepted",
        submissionId: "sub_slack_1",
      });
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toMatchObject({
        organizationId: "org_1",
        source: "email_auto",
        openmeldUserId: "user_member",
      });

      await processRemoteAgentSlackEvent(
        buildEnv(harness.db, { queueSend, workerSubmit }),
        createAppMentionPayload()
      );
      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/users.info")
        )
      ).toHaveLength(1);
      expect(readSlackThreadStatusBodies(fetchMock)).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("accepts a human Slack app DM as a private Center Agent conversation", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_dm_1",
        status: "pending" as const,
        submissionId: "sub_slack_dm_1",
      })
    );
    const fetchMock = stubSlackFetch({
      conversationsInfoResponse: {
        channel: { id: "D123", is_im: true },
        ok: true,
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createDirectMessagePayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "user", content: "What do you know about my work?" },
          ],
          turnEnvelope: expect.objectContaining({
            interactionEnvironment: "requester_private",
            space: {
              id: expect.any(String),
              isCenterAgentDm: true,
              kind: "dm",
              name: "Slack direct message",
            },
          }),
        })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("conversations.history"),
        expect.objectContaining({ method: "GET" })
      );
      expect(readSlackThreadStatusBodies(fetchMock)).toEqual([
        {
          channel_id: "D123",
          status: "is working on your request…",
          thread_ts: "1710000000.000100",
        },
      ]);
      const submittedRequest = workerSubmit.mock.calls[0]?.[0];
      if (!submittedRequest) {
        throw new Error("expected the Slack DM worker request");
      }
      expect(submittedRequest.turnEnvelope.trigger).toMatchObject({
        replyPlacement: "thread",
        source: "slack",
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallbackForSubmittedRequest({
            request: submittedRequest,
            submissionId: "sub_slack_dm_1",
          })
        )
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      expect(readSlackPostBodies(fetchMock)).toEqual([
        expect.objectContaining({
          channel: "D123",
          metadata: expect.any(Object),
          reply_broadcast: true,
          text: expect.stringContaining("Done from Slack"),
          thread_ts: "1710000000.000100",
        }),
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps follow-up fragments and Slack evidence in one durable Center Agent turn", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_follow_up",
      status: "pending" as const,
      submissionId: "sub_slack_follow_up",
    }));
    const cryptoKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    const fetchMock = stubSlackFetch({
      conversationsInfoResponse: {
        channel: { id: "D123", is_im: true },
        ok: true,
      },
      conversationsHistoryResponse: {
        messages: [
          {
            bot_id: "B123",
            text: "你想邀请哪位同事？",
            ts: "1709999999.000200",
          },
          {
            text: "帮我邀请一个同事加入 OpenMeld。",
            ts: "1709999998.000100",
            user: "U123",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, {
            cryptoKey,
            workerSubmit,
          }),
          createDirectMessagePayload({
            actionToken: "dm-action-token",
            text: "Fangyuan",
          })
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ content: "Fangyuan", role: "user" }],
          turnEnvelope: expect.objectContaining({
            channelContext: expect.objectContaining({
              messages: expect.arrayContaining([
                expect.objectContaining({
                  text: "帮我邀请一个同事加入 OpenMeld。",
                }),
                expect.objectContaining({ text: "你想邀请哪位同事？" }),
              ]),
            }),
            trigger: expect.objectContaining({
              replyPlacement: "thread",
              searchAuthorization: {
                encryptedAuthorization:
                  expect.not.stringContaining("dm-action-token"),
              },
              source: "slack",
            }),
          }),
        })
      );
      expect(readSlackThreadStatusBodies(fetchMock)).toEqual([
        {
          channel_id: "D123",
          status: "is working on your request…",
          thread_ts: "1710000000.000100",
        },
      ]);
      expect(readSlackPostBodies(fetchMock)).toEqual([]);
      expect(readSlackEphemeralBodies(fetchMock)).toEqual([]);
      expect(
        readSlackPostBodies(fetchMock).some((body) =>
          JSON.stringify(body).includes("search_slack_messages")
        )
      ).toBe(false);
      expect(
        readSlackEphemeralBodies(fetchMock).some((body) =>
          JSON.stringify(body).includes("search_slack_messages")
        )
      ).toBe(false);
    } finally {
      harness.close();
    }
  });

  it("keeps a Slack app DM reply inside the thread the user continued", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_dm_thread_1",
        status: "pending" as const,
        submissionId: "sub_slack_dm_thread_1",
      })
    );
    const fetchMock = stubSlackFetch({
      conversationsInfoResponse: {
        channel: { id: "D123", is_im: true },
        ok: true,
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createDirectMessagePayload({
            eventId: "EvDmThread123",
            threadTs: "1710000000.000100",
            ts: "1710000000.000200",
          })
        )
      ).resolves.toEqual({ status: "processed" });

      const submittedRequest = workerSubmit.mock.calls[0]?.[0];
      if (!submittedRequest) {
        throw new Error("expected the threaded Slack DM worker request");
      }
      expect(submittedRequest.turnEnvelope.trigger).toMatchObject({
        replyPlacement: "thread",
        source: "slack",
        threadTs: "1710000000.000100",
      });
      expect(readSlackThreadStatusBodies(fetchMock)).toEqual([
        {
          channel_id: "D123",
          status: "is working on your request…",
          thread_ts: "1710000000.000100",
        },
      ]);
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallbackForSubmittedRequest({
            request: submittedRequest,
            submissionId: "sub_slack_dm_thread_1",
          })
        )
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      expect(readSlackPostBodies(fetchMock)).toEqual([
        expect.objectContaining({
          channel: "D123",
          thread_ts: "1710000000.000100",
        }),
      ]);
      expect(readSlackPostBodies(fetchMock)[0]).not.toHaveProperty(
        "reply_broadcast"
      );
    } finally {
      harness.close();
    }
  });

  it("continues routing an existing historical Personal Workspace Slack binding", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    harness.run({
      params: [JSON.stringify({ personal: true }), "org_1"],
      sql: "UPDATE organizations SET metadata = ? WHERE id = ?",
    });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_personal_slack_1",
      status: "pending" as const,
      submissionId: "sub_personal_slack_1",
    }));
    stubSlackFetch({ email: "ari@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org_1",
          turnEnvelope: expect.objectContaining({
            organization: expect.objectContaining({ id: "org_1" }),
            trigger: expect.objectContaining({
              source: "slack",
              teamId: "T123",
            }),
          }),
        })
      );
    } finally {
      harness.close();
    }
  });

  it("replies once when the selected Center Agent model is unavailable", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    harness.run({
      params: ["retired/provider-model", "binding_1"],
      sql: `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET model_id = ?
        WHERE binding_id = ?
      `,
    });
    const workerSubmit = vi.fn();
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "replied" });

      expect(workerSubmit).not.toHaveBeenCalled();
      expect(readSlackPostBodies(fetchMock)).toEqual([
        {
          channel: "C123",
          text: "Center Agent couldn't start because its selected model is unavailable. Ask an organization owner or admin to choose an available model in OpenMeld.",
          thread_ts: "1710000000.000100",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps a top-level Slack DM failure in the request thread", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    harness.run({
      params: ["retired/provider-model", "binding_1"],
      sql: `
        UPDATE openMeldDaemon_agent_profile_bindings
        SET model_id = ?
        WHERE binding_id = ?
      `,
    });
    const workerSubmit = vi.fn();
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createDirectMessagePayload()
        )
      ).resolves.toEqual({ status: "replied" });

      expect(workerSubmit).not.toHaveBeenCalled();
      expect(readSlackThreadStatusBodies(fetchMock)).toHaveLength(0);
      expect(readSlackPostBodies(fetchMock)).toEqual([
        {
          channel: "D123",
          reply_broadcast: true,
          text: "Center Agent couldn't start because its selected model is unavailable. Ask an organization owner or admin to choose an available model in OpenMeld.",
          thread_ts: "1710000000.000100",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("keeps event-bound Slack search authorization inside the durable turn", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async (_request: unknown) => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_search",
      status: "pending" as const,
      submissionId: "sub_slack_search",
    }));
    const cryptoKey = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    stubSlackFetch({ email: "ari@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, {
            cryptoKey,
            workerSubmit,
          }),
          createAppMentionPayload({ actionToken: "search-action-token" })
        )
      ).resolves.toEqual({ status: "processed" });

      const submittedRequest = workerSubmit.mock.calls[0]?.[0] as {
        turnEnvelope: {
          trigger: {
            searchAuthorization?: {
              encryptedAuthorization: string;
            };
          };
        };
      };
      const trigger = submittedRequest.turnEnvelope.trigger;
      expect(trigger).toMatchObject({
        searchAuthorization: {
          encryptedAuthorization: expect.not.stringContaining(
            "search-action-token"
          ),
        },
        source: "slack",
        teamId: "T123",
      });
      await expect(
        decryptSlackSearchAuthorization({
          cryptoKey,
          encryptedAuthorization:
            trigger.searchAuthorization?.encryptedAuthorization ?? "",
        })
      ).resolves.toEqual({
        actionToken: "search-action-token",
        memberId: "member_1",
        organizationId: "org_1",
        sourceChannelId: "C123",
        sourceThreadTs: "1710000000.000100",
        slackTeamId: "T123",
        slackUserId: "U123",
        openMeldUserId: "user_member",
      });
    } finally {
      harness.close();
    }
  });

  it("syncs the root and unmentioned thread replies without duplicating the current mention", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_input: { turnEnvelope: { channelContext?: unknown } }) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: `req_slack_${workerSubmit.mock.calls.length}`,
        status: "pending" as const,
        submissionId: `sub_slack_${workerSubmit.mock.calls.length}`,
      })
    );
    const firstMentionTs = "1710000010.000200";
    const secondMentionTs = "1710000020.000500";
    const fetchMock = stubSlackFetch({
      conversationsRepliesResponse: (url) => {
        const oldest = url.searchParams.get("oldest");
        if (!oldest) {
          return {
            has_more: false,
            messages: [
              {
                bot_id: "B_GITHUB",
                bot_profile: { name: "GitHub" },
                subtype: "bot_message",
                text: "Build failed in AmpliftHQ/openmeld.",
                ts: "1710000000.000100",
                username: "GitHub",
              },
              {
                text: "<@B123> diagnose the build above",
                ts: firstMentionTs,
                user: "U123",
              },
            ],
            ok: true,
          };
        }
        expect(oldest).toBe(firstMentionTs);
        return {
          has_more: false,
          messages: [
            {
              bot_id: "B_CENTER_AGENT",
              bot_profile: { name: "OpenMeld Center Agent" },
              subtype: "bot_message",
              text: "The failure comes from a stale release hash.",
              ts: "1710000012.000300",
              username: "OpenMeld Center Agent",
            },
            {
              text: "Please preserve the exact failing command.",
              ts: "1710000015.000400",
              user: "U_ASHLEY",
            },
            {
              text: "<@B123> turn this fix into a checklist",
              ts: secondMentionTs,
              user: "U123",
            },
          ],
          ok: true,
        };
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload({
            eventId: "EvThreadFirst",
            text: "<@B123> diagnose the build above",
            threadTs: "1710000000.000100",
            ts: firstMentionTs,
          })
        )
      ).resolves.toEqual({ status: "processed" });
      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload({
            eventId: "EvThreadSecond",
            text: "<@B123> turn this fix into a checklist",
            threadTs: "1710000000.000100",
            ts: secondMentionTs,
          })
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(
        workerSubmit.mock.calls[0]?.[0].turnEnvelope.channelContext
      ).toEqual({
        provider: "slack",
        conversationId: CONVERSATION_ID,
        currentMessageId: firstMentionTs,
        sync: { mode: "snapshot", status: "complete" },
        messages: [
          {
            id: "1710000000.000100",
            author: {
              kind: "bot",
              id: "B_GITHUB",
              displayName: "GitHub",
            },
            sentAtMs: 1_710_000_000_000,
            text: "Build failed in AmpliftHQ/openmeld.",
          },
        ],
      });
      expect(
        workerSubmit.mock.calls[1]?.[0].turnEnvelope.channelContext
      ).toEqual({
        provider: "slack",
        conversationId: CONVERSATION_ID,
        currentMessageId: secondMentionTs,
        sync: { mode: "delta", status: "complete" },
        messages: [
          {
            id: "1710000012.000300",
            author: {
              kind: "bot",
              id: "B_CENTER_AGENT",
              displayName: "OpenMeld Center Agent",
            },
            sentAtMs: 1_710_000_012_000,
            text: "The failure comes from a stale release hash.",
          },
          {
            id: "1710000015.000400",
            author: {
              kind: "human",
              id: "U_ASHLEY",
            },
            sentAtMs: 1_710_000_015_000,
            text: "Please preserve the exact failing command.",
          },
        ],
      });
      const repliesUrls = fetchMock.mock.calls
        .map(([request]) => new URL(String(request)))
        .filter((url) => url.pathname === "/api/conversations.replies");
      expect(repliesUrls).toHaveLength(2);
      expect(repliesUrls[0]?.searchParams.get("latest")).toBe(firstMentionTs);
      expect(repliesUrls[0]?.searchParams.get("oldest")).toBeNull();
      expect(repliesUrls[1]?.searchParams.get("latest")).toBe(secondMentionTs);
      expect(repliesUrls[1]?.searchParams.get("oldest")).toBe(firstMentionTs);
    } finally {
      harness.close();
    }
  });

  it("hydrates recent channel context for a root Slack mention", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_input: { turnEnvelope: { channelContext?: unknown } }) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_channel_context",
        status: "pending" as const,
        submissionId: "sub_slack_channel_context",
      })
    );
    const currentMentionTs = "1710000020.000500";
    const fetchMock = stubSlackFetch({
      conversationsHistoryResponse: {
        messages: [
          {
            text: "<@B123> open the daily loop you proposed",
            ts: currentMentionTs,
            user: "U123",
          },
          {
            bot_id: "B_CENTER_AGENT",
            bot_profile: { name: "OpenMeld Center Agent" },
            subtype: "bot_message",
            text: "Proposed loop: every weekday at 09:30 Asia/Taipei, post Linear feedback, open PRs, and two next actions to #ok8-okok.",
            ts: "1710000015.000400",
            username: "OpenMeld Center Agent",
          },
          {
            text: "Older planning noise.",
            ts: "1710000005.000300",
            user: "U_OTHER",
          },
        ],
        ok: true,
        response_metadata: { next_cursor: "" },
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload({
            eventId: "EvRootChannelContext",
            text: "<@B123> open the daily loop you proposed",
            ts: currentMentionTs,
          })
        )
      ).resolves.toEqual({ status: "processed" });

      expect(
        workerSubmit.mock.calls[0]?.[0].turnEnvelope.channelContext
      ).toEqual({
        provider: "slack",
        conversationId: buildRemoteAgentSlackConversationId({
          channelId: "C123",
          teamId: "T123",
          threadTs: currentMentionTs,
        }),
        currentMessageId: currentMentionTs,
        sync: { mode: "snapshot", status: "complete" },
        messages: [
          {
            id: "1710000005.000300",
            author: { kind: "human", id: "U_OTHER" },
            sentAtMs: 1_710_000_005_000,
            text: "Older planning noise.",
          },
          {
            id: "1710000015.000400",
            author: {
              kind: "bot",
              id: "B_CENTER_AGENT",
              displayName: "OpenMeld Center Agent",
            },
            sentAtMs: 1_710_000_015_000,
            text: "Proposed loop: every weekday at 09:30 Asia/Taipei, post Linear feedback, open PRs, and two next actions to #ok8-okok.",
          },
        ],
      });
      const historyUrls = fetchMock.mock.calls
        .map(([request]) => new URL(String(request)))
        .filter((url) => url.pathname === "/api/conversations.history");
      expect(historyUrls).toHaveLength(1);
      expect(historyUrls[0]?.searchParams.get("channel")).toBe("C123");
      expect(historyUrls[0]?.searchParams.get("latest")).toBe(currentMentionTs);
      expect(historyUrls[0]?.searchParams.get("limit")).toBe("8");
    } finally {
      harness.close();
    }
  });

  it("continues the current request with explicit rate-limited context", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_input: { turnEnvelope: { channelContext?: unknown } }) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_rate_limited",
        status: "pending" as const,
        submissionId: "sub_slack_rate_limited",
      })
    );
    stubSlackFetch({
      conversationsRepliesResponse: new Response(
        JSON.stringify({ error: "ratelimited", ok: false }),
        {
          headers: {
            "content-type": "application/json",
            "retry-after": "60",
          },
          status: 429,
        }
      ),
      email: "ari@example.test",
    });
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });
      expect(
        workerSubmit.mock.calls[0]?.[0].turnEnvelope.channelContext
      ).toEqual({
        provider: "slack",
        conversationId: CONVERSATION_ID,
        currentMessageId: "1710000000.000100",
        sync: { mode: "snapshot", status: "rate_limited" },
        messages: [],
      });
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[core.remote_agent.slack_thread_context.unavailable]",
        expect.objectContaining({
          channelId: "C123",
          errorCode: "ratelimited",
          retryAfterSeconds: 60,
          slackTeamId: "T123",
          status: "rate_limited",
          threadTs: "1710000000.000100",
        })
      );
    } finally {
      consoleWarnSpy.mockRestore();
      harness.close();
    }
  });

  it("does not advance Slack thread context after failed worker admission", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const currentMessageTs = "1710000010.000200";
    stubSlackFetch({
      conversationsRepliesResponse: {
        has_more: false,
        messages: [
          {
            bot_id: "B_GITHUB",
            text: "Build failed.",
            ts: "1710000000.000100",
          },
          {
            text: "<@B123> diagnose this",
            ts: currentMessageTs,
            user: "U123",
          },
        ],
        ok: true,
      },
      email: "ari@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db),
          createAppMentionPayload({
            eventId: "EvWorkerUnavailable",
            text: "<@B123> diagnose this",
            threadTs: "1710000000.000100",
            ts: currentMessageTs,
          })
        )
      ).resolves.toEqual({ status: "processed" });
      await expect(
        readSlackThreadContextCursor({
          connectionCreatedAtMs: 1000,
          db: harness.db,
          organizationId: "org_1",
          slackChannelId: "C123",
          slackTeamId: "T123",
          slackThreadTs: "1710000000.000100",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("continues admitted work when Slack cannot show the thread status", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_1",
      status: "pending" as const,
      submissionId: "sub_slack_1",
    }));
    const fetchMock = stubSlackFetch({
      email: "ari@example.test",
      threadStatusResponse: { error: "invalid_thread_ts", ok: false },
    });
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(readSlackThreadStatusBodies(fetchMock)).toHaveLength(1);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[core.remote_agent.slack_thread_status.unavailable]",
        expect.objectContaining({
          channelId: "C123",
          error: "Slack assistant.threads.setStatus failed: invalid_thread_ts",
          eventId: "Ev123",
          slackTeamId: "T123",
          threadTs: "1710000000.000100",
        })
      );
    } finally {
      consoleWarnSpy.mockRestore();
      harness.close();
    }
  });

  it("lets only one concurrent delivery of the same Slack event enter model admission", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerAck = createDeferred({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_1",
      status: "pending" as const,
      submissionId: "sub_slack_1",
    });
    const workerSubmit = vi.fn(() => workerAck.promise);
    stubSlackFetch({ email: "ari@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      const first = processRemoteAgentSlackEvent(
        buildEnv(harness.db, { workerSubmit }),
        createAppMentionPayload()
      );
      await vi.waitFor(() => expect(workerSubmit).toHaveBeenCalledOnce());
      const second = processRemoteAgentSlackEvent(
        buildEnv(harness.db, { workerSubmit }),
        createAppMentionPayload()
      );
      const secondBeforeFirstAck = await Promise.race([
        second,
        new Promise<{ status: "timed_out" }>((resolve) =>
          setTimeout(() => resolve({ status: "timed_out" }), 25)
        ),
      ]);

      workerAck.resolve();
      await Promise.allSettled([first, second]);

      expect(secondBeforeFirstAck).toEqual({ status: "duplicate" });
      expect(workerSubmit).toHaveBeenCalledOnce();
    } finally {
      harness.close();
    }
  });

  it("continues without a channel name when Slack denies conversation details", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_1",
      status: "pending" as const,
      submissionId: "sub_slack_1",
    }));
    stubSlackFetch({
      conversationsInfoResponse: { error: "missing_scope", ok: false },
      email: "ari@example.test",
    });
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          turnEnvelope: expect.objectContaining({
            interactionEnvironment: "externally_shared",
            space: expect.objectContaining({ name: "Slack channel" }),
            trigger: expect.objectContaining({ source: "slack" }),
          }),
        })
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[core.remote_agent.slack_conversation_info.unavailable]",
        expect.objectContaining({
          channelId: "C123",
          error: "Slack conversations.info failed: missing_scope",
          slackTeamId: "T123",
        })
      );
    } finally {
      consoleWarnSpy.mockRestore();
      harness.close();
    }
  });

  it("stops waiting for a Slack channel name without delaying message handling", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_1",
      status: "pending" as const,
      submissionId: "sub_slack_1",
    }));
    const fetchMock = stubSlackFetch({
      conversationsInfoNeverResolves: true,
      email: "ari@example.test",
    });
    const consoleWarnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    vi.useFakeTimers();

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      const processing = processRemoteAgentSlackEvent(
        buildEnv(harness.db, { workerSubmit }),
        createAppMentionPayload()
      );
      await vi.advanceTimersByTimeAsync(500);

      await expect(processing).resolves.toEqual({ status: "processed" });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          turnEnvelope: expect.objectContaining({
            interactionEnvironment: "externally_shared",
            space: expect.objectContaining({ name: "Slack channel" }),
            trigger: expect.objectContaining({ source: "slack" }),
          }),
        })
      );
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("conversations.info?channel=C123"),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        "[core.remote_agent.slack_conversation_info.unavailable]",
        expect.objectContaining({
          channelId: "C123",
          error: expect.any(String),
          slackTeamId: "T123",
        })
      );
    } finally {
      vi.useRealTimers();
      consoleWarnSpy.mockRestore();
      harness.close();
    }
  });

  it("retries identity lookup failures before durably settling the final attempt", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const fetchMock = stubSlackFetch({
      email: "ari@example.test",
      usersInfoResponse: { error: "slack_unavailable", ok: false },
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db),
          createAppMentionPayload()
        )
      ).rejects.toThrow("Slack users.info failed: slack_unavailable");
      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db),
          createAppMentionPayload(),
          { finalAttempt: true }
        )
      ).resolves.toEqual({ status: "failed" });
      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "duplicate" });

      expect(readSlackPostBodies(fetchMock)).toEqual([
        expect.objectContaining({
          channel: "C123",
          text: "I couldn't complete that request. Please try again. If it keeps happening, open OpenMeld diagnostics.",
          thread_ts: "1710000000.000100",
        }),
      ]);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toBeNull();
      await expect(
        readRemoteAgentSlackEventIngress({
          db: harness.db,
          eventKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        outcomeStatus: "failure_published",
        state: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("redrives a failed ingress after its failure notice could not be published", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    stubSlackFetch({
      chatPostResponse: { error: "ratelimited", ok: false },
      email: "ari@example.test",
      usersInfoResponse: { error: "slack_unavailable", ok: false },
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db),
          createAppMentionPayload(),
          { finalAttempt: true }
        )
      ).resolves.toEqual({ status: "recovery_pending" });
      await expect(
        readRemoteAgentSlackEventIngress({
          db: harness.db,
          eventKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({ state: "failed" });

      stubSlackFetch({
        email: "ari@example.test",
        usersInfoResponse: { error: "slack_unavailable", ok: false },
      });
      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db),
          createAppMentionPayload(),
          { finalAttempt: true }
        )
      ).resolves.toEqual({ status: "failed" });
      await expect(
        readRemoteAgentSlackEventIngress({
          db: harness.db,
          eventKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        outcomeStatus: "failure_published",
        state: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("does not redrive an admission failure when Slack publication is outcome unknown", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    stubSlackFetch({
      chatPostError: new TypeError("network connection reset"),
      email: "ari@example.test",
      usersInfoResponse: { error: "slack_unavailable", ok: false },
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db),
          createAppMentionPayload(),
          { finalAttempt: true }
        )
      ).resolves.toEqual({ status: "failed" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toBeNull();
      await expect(
        readRemoteAgentSlackEventIngress({
          db: harness.db,
          eventKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        outcomeStatus: "failure_publication_outcome_unknown",
        state: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("admits an unmatched Slack workspace member as an anonymous member", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_guest",
      status: "pending" as const,
      submissionId: "sub_slack_guest",
    }));
    const fetchMock = stubSlackFetch({
      displayName: "Workspace member",
      email: "outsider@example.test",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload({ actionToken: "must-not-be-forwarded" })
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          author: {
            displayName: "Workspace member",
            profileId: null,
            profileKind: null,
          },
          onBehalfOf: null,
          turnEnvelope: expect.objectContaining({
            sender: {
              displayName: "Workspace member",
              id: "slack:T123:U123",
              kind: "member",
              messageChannelIdentity: expect.objectContaining({
                connectionId: "T123",
                provider: "slack",
                providerUserId: "U123",
              }),
              verified: false,
            },
            trigger: expect.not.objectContaining({
              searchAuthorization: expect.anything(),
            }),
          }),
        })
      );
      expect(readSlackPostBodies(fetchMock)).toEqual([]);
      expect(readSlackThreadStatusBodies(fetchMock)).toHaveLength(1);
      expect(readSlackEphemeralBodies(fetchMock)).toEqual([]);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        onBehalfOfProfileId: null,
        onBehalfOfUserId: null,
      });
    } finally {
      harness.close();
    }
  });

  it.each([
    { isRestricted: true, label: "multi-channel guest" },
    { isUltraRestricted: true, label: "single-channel guest" },
  ])("keeps a Slack $label outside self-join eligibility", async (identity) => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_guest",
      status: "pending" as const,
      submissionId: "sub_slack_guest",
    }));
    stubSlackFetch({
      displayName: "Slack guest",
      email: "ari@example.test",
      ...identity,
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          onBehalfOf: null,
          turnEnvelope: expect.objectContaining({
            sender: expect.objectContaining({
              verified: false,
            }),
          }),
        })
      );
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("keeps a Slack Connect participant external to the installed workspace", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_external",
      status: "pending" as const,
      submissionId: "sub_slack_external",
    }));
    stubSlackFetch({
      displayName: "Outside collaborator",
      email: "ari@example.test",
      isStranger: false,
      teamId: "T_EXTERNAL",
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          onBehalfOf: null,
          turnEnvelope: expect.objectContaining({
            sender: {
              displayName: "Outside collaborator",
              id: "slack:T123:U123",
              kind: "member",
              verified: false,
            },
          }),
        })
      );
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("uses an explicit Slack identity link before falling back to Slack email", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_1",
      status: "pending" as const,
      submissionId: "sub_slack_1",
    }));
    const fetchMock = stubSlackFetch({ email: "wrong@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackUserIdentityLinkIfAbsent({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserId: "U123",
        source: "explicit",
        openmeldUserId: "user_member",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          turnEnvelope: expect.objectContaining({
            sender: expect.objectContaining({
              id: "member_1",
              messageChannelIdentity: {
                connectionId: "T123",
                provider: "slack",
                providerUserId: "U123",
              },
              ownerUserId: "user_member",
              profileId: "22222222-2222-4222-8222-222222222222",
              verified: true,
            }),
          }),
        })
      );
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/users.info")
        )
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("privately gives the verified Slack requester the exact computer setup action", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_1",
      status: "pending" as const,
      submissionId: "sub_slack_1",
    }));
    const fetchMock = stubSlackFetch({ email: "wrong@example.test" });
    const connectedComputerId = "019690bc-6f82-4ee0-9975-7360491fea69";

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackUserIdentityLinkIfAbsent({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserId: "U123",
        source: "explicit",
        openmeldUserId: "user_member",
      });
      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          ...createCompletedCallbackBody(),
          navigationTarget: {
            connectedComputerId,
            kind: "computer_setup",
            mode: "reconnect",
          },
          text: [
            "Your computer needs to reconnect.",
            `<openmeld_navigation_action_embed kind="computer_setup" mode="reconnect" connected_computer_id="${connectedComputerId}" />`,
          ].join("\n\n"),
          triggerMessageId: "1710000000.000100",
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      const publicReplies = readSlackPostBodies(fetchMock) as {
        channel?: string;
      }[];
      expect(publicReplies).toHaveLength(2);
      expect(publicReplies[0]).toMatchObject({ channel: "C123" });
      expect(JSON.stringify(publicReplies[0])).not.toContain(
        "openmeld_navigation_action_embed"
      );
      expect(JSON.stringify(publicReplies[0])).not.toContain(
        connectedComputerId
      );
      expect(publicReplies[1]).toEqual(
        expect.objectContaining({
          channel: "U123",
          blocks: [
            {
              text: expect.stringContaining("Reconnect this computer"),
              type: "markdown",
            },
            {
              elements: [
                expect.objectContaining({
                  text: {
                    emoji: true,
                    text: "Reconnect this computer",
                    type: "plain_text",
                  },
                  type: "button",
                  url: `https://openmeld.ai/o/openmeld-labs/connect?connectedComputerId=${connectedComputerId}&session=fresh`,
                }),
              ],
              type: "actions",
            },
          ],
        })
      );
      expect(readSlackEphemeralBodies(fetchMock)).toEqual([]);
    } finally {
      harness.close();
    }
  });

  it("repairs a stale Slack identity link after its workspace moves to another organization", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_1",
      status: "pending" as const,
      submissionId: "sub_slack_1",
    }));
    const fetchMock = stubSlackFetch({ email: "wrong@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackUserIdentityLinkIfAbsent({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_previous",
        slackTeamId: "T123",
        slackUserId: "U123",
        source: "explicit",
        openmeldUserId: "user_member",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/users.info")
        )
      ).toHaveLength(1);
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toMatchObject({
        organizationId: "org_1",
        source: "explicit",
        openmeldUserId: "user_member",
      });
    } finally {
      harness.close();
    }
  });

  it("invalidates a stale Slack identity link when its user is not in the moved workspace organization", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedNonMemberUser(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_stale_guest",
      status: "pending" as const,
      submissionId: "sub_stale_guest",
    }));
    const fetchMock = stubSlackFetch({ email: "no-member@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackUserIdentityLinkIfAbsent({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_previous",
        slackTeamId: "T123",
        slackUserId: "U123",
        source: "explicit",
        openmeldUserId: "user_non_member",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(readSlackPostBodies(fetchMock)).toEqual([]);
      expect(readSlackEphemeralBodies(fetchMock)).toEqual([]);
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("keeps a removed linked Slack user as an anonymous member", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_removed_guest",
      status: "pending" as const,
      submissionId: "sub_removed_guest",
    }));
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackUserIdentityLinkIfAbsent({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserId: "U123",
        source: "explicit",
        openmeldUserId: "user_member",
      });
      harness.run({
        params: ["member_1"],
        sql: "DELETE FROM members WHERE id = ?",
      });

      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });

      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          onBehalfOf: null,
          turnEnvelope: expect.objectContaining({
            sender: expect.objectContaining({ verified: false }),
          }),
        })
      );
      expect(readSlackPostBodies(fetchMock)).toEqual([]);
      expect(
        fetchMock.mock.calls.filter(([request]) =>
          String(request).includes("/users.info")
        )
      ).toHaveLength(1);
    } finally {
      harness.close();
    }
  });

  it("pre-claims a Slack connection token for the account selected by Center Agent", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const tokenHash = await digestSlackIdentityLinkToken(
        "slacklink_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      );
      await insertSlackIdentityLinkToken({
        claimedByUserId: "user_1",
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: 10_000,
        issuedAtMs: 3000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash,
      });

      await expect(
        readSlackIdentityLinkTokenForUser({
          db: harness.db,
          nowMs: 3500,
          tokenHash,
          openmeldUserId: "user_1",
        })
      ).resolves.toMatchObject({
        claimedAtMs: 3000,
        claimedByUserId: "user_1",
      });
      await expect(
        readSlackIdentityLinkTokenForUser({
          db: harness.db,
          nowMs: 3500,
          tokenHash,
          openmeldUserId: "user_2",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("rejects expired or publicly delivered Slack identity-link tokens and enrolls a verified non-member", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedNonMemberUser(harness);
    stubSlackFetch({ email: "new-member@example.test" });
    const expiredToken =
      "slacklink_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const activeToken =
      "slacklink_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const publiclyDeliveredToken =
      "slacklink_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: 1000,
        issuedAtMs: 100,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: await digestSlackIdentityLinkToken(expiredToken),
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: Date.now() + 60_000,
        issuedAtMs: Date.now() - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U999",
        tokenHash: await digestSlackIdentityLinkToken(activeToken),
      });
      const publiclyDeliveredTokenHash = await digestSlackIdentityLinkToken(
        publiclyDeliveredToken
      );
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: Date.now() + 60_000,
        issuedAtMs: Date.now() - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U888",
        tokenHash: publiclyDeliveredTokenHash,
      });
      harness.run({
        params: [publiclyDeliveredTokenHash],
        sql: `
          UPDATE slack_user_identity_link_tokens
          SET delivery_scope = NULL
          WHERE token_hash = ?
        `,
      });

      await expect(
        rpcPreviewSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token: expiredToken,
        })
      ).rejects.toMatchObject({ code: "slack.identity_link_token_invalid" });
      await expect(
        rpcPreviewSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token: publiclyDeliveredToken,
        })
      ).rejects.toMatchObject({ code: "slack.identity_link_token_invalid" });
      const ensureWorkspaceMember = vi.fn(() => {
        harness.run({
          params: [
            "member_non_member",
            "org_1",
            "user_non_member",
            "member",
            Date.now(),
          ],
          sql: `
            INSERT INTO members (
              id,
              organization_id,
              user_id,
              role,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `,
        });
        return {
          alreadyMember: false,
          ok: true as const,
          organizationId: "org_1",
          organizationName: "OpenMeld Labs",
          organizationSlug: "openmeld-labs",
          role: "member",
        };
      });
      const env = buildEnv(harness.db, { ensureWorkspaceMember });
      await expect(
        rpcPreviewSlackIdentityLink(env, {
          context: buildHumanContext({
            profileId: "33333333-3333-4333-8333-333333333333",
            userId: "user_non_member",
          }),
          token: activeToken,
        })
      ).resolves.toMatchObject({
        alreadyMember: false,
        organizationId: "org_1",
      });
      await expect(
        rpcConsumeSlackIdentityLink(env, {
          context: buildHumanContext({
            profileId: "33333333-3333-4333-8333-333333333333",
            userId: "user_non_member",
          }),
          token: activeToken,
        })
      ).resolves.toMatchObject({
        joinedOrganization: true,
        linked: true,
        organizationId: "org_1",
        openMeldUserId: "user_non_member",
      });
      expect(ensureWorkspaceMember).toHaveBeenCalledWith({
        organizationId: "org_1",
        userId: "user_non_member",
      });
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U999",
        })
      ).resolves.toMatchObject({
        organizationId: "org_1",
        openmeldUserId: "user_non_member",
      });
    } finally {
      harness.close();
    }
  });

  it.each([
    {
      identity: { isDeleted: true },
      label: "removed user",
      usersInfoResponse: undefined,
    },
    {
      identity: { isRestricted: true },
      label: "multi-channel guest",
      usersInfoResponse: undefined,
    },
    {
      identity: { isUltraRestricted: true },
      label: "single-channel guest",
      usersInfoResponse: undefined,
    },
    {
      identity: { isStranger: true },
      label: "Slack Connect participant",
      usersInfoResponse: undefined,
    },
    {
      identity: { teamId: "T_EXTERNAL" },
      label: "another workspace member",
      usersInfoResponse: undefined,
    },
  ])("rejects a $label before consuming a Slack identity link", async ({
    identity,
    usersInfoResponse,
  }) => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedNonMemberUser(harness);
    const token =
      "slacklink_3434343434343434343434343434343434343434343434343434343434343434";
    stubSlackFetch({
      email: "new-member@example.test",
      ...identity,
      usersInfoResponse,
    });
    const ensureWorkspaceMember = vi.fn(() => {
      harness.run({
        params: [
          "member_non_member",
          "org_1",
          "user_non_member",
          "member",
          Date.now(),
        ],
        sql: `
            INSERT INTO members (
              id,
              organization_id,
              user_id,
              role,
              created_at
            )
            VALUES (?, ?, ?, ?, ?)
          `,
      });
      return {
        alreadyMember: false,
        ok: true as const,
        organizationId: "org_1",
        organizationName: "OpenMeld Labs",
        organizationSlug: "openmeld-labs",
        role: "member",
      };
    });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: Date.now() + 60_000,
        issuedAtMs: Date.now() - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: await digestSlackIdentityLinkToken(token),
      });

      await expect(
        rpcConsumeSlackIdentityLink(
          buildEnv(harness.db, { ensureWorkspaceMember }),
          {
            context: buildHumanContext({
              profileId: "33333333-3333-4333-8333-333333333333",
              userId: "user_non_member",
            }),
            token,
          }
        )
      ).rejects.toMatchObject({
        code: "slack.identity_link_member_ineligible",
      });
      expect(ensureWorkspaceMember).not.toHaveBeenCalled();
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toBeNull();
    } finally {
      harness.close();
    }
  });

  it("claims an identity-link token before enrolling exactly one competing account", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedNonMemberUser(harness);
    stubSlackFetch({ email: "new-member@example.test" });
    harness.run({
      params: [
        "user_competitor",
        "Competing User",
        "competitor@example.test",
        1,
        100,
        100,
      ],
      sql: `
        INSERT INTO users (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `,
    });
    const token =
      "slacklink_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: Date.now() + 60_000,
        issuedAtMs: Date.now() - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: await digestSlackIdentityLinkToken(token),
      });
      const ensureWorkspaceMember = vi.fn(
        ({ userId }: { organizationId: string; userId: string }) => {
          harness.run({
            params: [`member_${userId}`, "org_1", userId, "member", Date.now()],
            sql: `
              INSERT INTO members (
                id,
                organization_id,
                user_id,
                role,
                created_at
              )
              VALUES (?, ?, ?, ?, ?)
            `,
          });
          return {
            alreadyMember: false,
            ok: true as const,
            organizationId: "org_1",
            organizationName: "OpenMeld Labs",
            organizationSlug: "openmeld-labs",
            role: "member" as const,
          };
        }
      );
      const env = buildEnv(harness.db, { ensureWorkspaceMember });
      const results = await Promise.allSettled([
        rpcConsumeSlackIdentityLink(env, {
          context: buildHumanContext({
            profileId: "33333333-3333-4333-8333-333333333333",
            userId: "user_non_member",
          }),
          token,
        }),
        rpcConsumeSlackIdentityLink(env, {
          context: buildHumanContext({
            profileId: "44444444-4444-4444-8444-444444444444",
            userId: "user_competitor",
          }),
          token,
        }),
      ]);

      expect(
        results.filter((result) => result.status === "fulfilled")
      ).toHaveLength(1);
      expect(
        results.filter((result) => result.status === "rejected")
      ).toHaveLength(1);
      expect(ensureWorkspaceMember).toHaveBeenCalledOnce();
      const enrolledUserId = ensureWorkspaceMember.mock.calls[0]?.[0].userId;
      expect(
        harness.queryFirst<{ enrolled_count: number }>({
          params: ["org_1"],
          sql: `
            SELECT COUNT(*) AS enrolled_count
            FROM members
            WHERE organization_id = ?
              AND user_id IN ('user_non_member', 'user_competitor')
          `,
        })
      ).toEqual({ enrolled_count: 1 });
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toMatchObject({ openmeldUserId: enrolledUserId });
    } finally {
      harness.close();
    }
  });

  it("reuses the same user's claim after Organization enrollment fails", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedNonMemberUser(harness);
    stubSlackFetch({ email: "new-member@example.test" });
    const token =
      "slacklink_1212121212121212121212121212121212121212121212121212121212121212";

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: Date.now() + 60_000,
        issuedAtMs: Date.now() - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: await digestSlackIdentityLinkToken(token),
      });
      const ensureWorkspaceMember = vi
        .fn()
        .mockRejectedValueOnce(new Error("Auth is temporarily unavailable"))
        .mockImplementationOnce(() => {
          harness.run({
            params: [
              "member_non_member",
              "org_1",
              "user_non_member",
              "member",
              Date.now(),
            ],
            sql: `
              INSERT INTO members (
                id,
                organization_id,
                user_id,
                role,
                created_at
              )
              VALUES (?, ?, ?, ?, ?)
            `,
          });
          return {
            alreadyMember: false,
            ok: true as const,
            organizationId: "org_1",
            organizationName: "OpenMeld Labs",
            organizationSlug: "openmeld-labs",
            role: "member" as const,
          };
        });
      const env = buildEnv(harness.db, { ensureWorkspaceMember });
      const consumeInput = {
        context: buildHumanContext({
          profileId: "33333333-3333-4333-8333-333333333333",
          userId: "user_non_member",
        }),
        token,
      };

      await expect(
        rpcConsumeSlackIdentityLink(env, consumeInput)
      ).rejects.toThrow("Auth is temporarily unavailable");
      await expect(
        rpcConsumeSlackIdentityLink(env, consumeInput)
      ).resolves.toMatchObject({
        joinedOrganization: true,
        linked: true,
        openMeldUserId: "user_non_member",
      });
      expect(ensureWorkspaceMember).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });

  it("lets a new private setup action supersede an abandoned claim", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedNonMemberUser(harness);
    const firstToken =
      "slacklink_1313131313131313131313131313131313131313131313131313131313131313";
    const replacementToken =
      "slacklink_1414141414141414141414141414141414141414141414141414141414141414";
    const nowMs = Date.now();
    const firstTokenHash = await digestSlackIdentityLinkToken(firstToken);
    const replacementTokenHash =
      await digestSlackIdentityLinkToken(replacementToken);

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: nowMs + 60_000,
        issuedAtMs: nowMs - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: firstTokenHash,
      });
      await expect(
        claimSlackIdentityLinkTokenForUser({
          claimedAtMs: nowMs,
          db: harness.db,
          organizationId: "org_1",
          slackTeamId: "T123",
          slackUserId: "U123",
          tokenHash: firstTokenHash,
          openmeldUserId: "user_non_member",
        })
      ).resolves.toMatchObject({ status: "claimed" });

      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: nowMs + 120_000,
        issuedAtMs: nowMs + 1,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: replacementTokenHash,
      });

      await expect(
        readSlackIdentityLinkTokenForUser({
          db: harness.db,
          nowMs: nowMs + 1,
          tokenHash: firstTokenHash,
          openmeldUserId: "user_non_member",
        })
      ).resolves.toBeNull();
      await expect(
        claimSlackIdentityLinkTokenForUser({
          claimedAtMs: nowMs + 1,
          db: harness.db,
          organizationId: "org_1",
          slackTeamId: "T123",
          slackUserId: "U123",
          tokenHash: replacementTokenHash,
          openmeldUserId: "user_member",
        })
      ).resolves.toMatchObject({ status: "claimed" });
    } finally {
      harness.close();
    }
  });

  it("keeps a completed identity link when continuation source recovery throws", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    stubSlackFetch({ email: "ari@example.test" });
    const token =
      "slacklink_1515151515151515151515151515151515151515151515151515151515151515";

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: Date.now() + 60_000,
        issuedAtMs: Date.now() - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        sourceDeliveryId: "missing_source_delivery",
        tokenHash: await digestSlackIdentityLinkToken(token),
      });

      await expect(
        rpcConsumeSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({
        continuationRetryable: true,
        continued: false,
        linked: true,
      });
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toMatchObject({ openmeldUserId: "user_member" });
    } finally {
      harness.close();
    }
  });

  it("rejects an identity-link token after its Slack workspace moves to another Organization", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedSecondOrganization(harness);
    const token =
      "slacklink_cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: Date.now() + 60_000,
        issuedAtMs: Date.now() - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: await digestSlackIdentityLinkToken(token),
      });
      harness.run({
        params: ["org_2", "T123"],
        sql: `
          UPDATE openMeldRemoteAgent_slack_workspace_bindings
          SET organization_id = ?
          WHERE slack_team_id = ?
        `,
      });

      await expect(
        rpcPreviewSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).rejects.toMatchObject({ code: "slack.identity_link_token_invalid" });
    } finally {
      harness.close();
    }
  });

  it("fails closed when the Slack workspace moves during identity-link consumption", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedSecondOrganization(harness);
    stubSlackFetch({ email: "ari@example.test" });
    const token =
      "slacklink_dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: Date.now() + 60_000,
        issuedAtMs: Date.now() - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: await digestSlackIdentityLinkToken(token),
      });
      const racingDb = moveSlackWorkspaceBeforeIdentityLinkConsume({
        db: harness.db,
        moveWorkspace: () => {
          harness.run({
            params: ["org_2", "T123"],
            sql: `
              UPDATE openMeldRemoteAgent_slack_workspace_bindings
              SET organization_id = ?
              WHERE slack_team_id = ?
            `,
          });
        },
      });

      await expect(
        rpcConsumeSlackIdentityLink(buildEnv(racingDb), {
          context: buildHumanContext(),
          token,
        })
      ).rejects.toMatchObject({ code: "slack.identity_link_token_invalid" });
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toBeNull();
      expect(
        harness.queryFirst<{
          consume_nonce: string | null;
          consumed_at_ms: number | null;
        }>({
          params: [await digestSlackIdentityLinkToken(token)],
          sql: `
            SELECT consume_nonce, consumed_at_ms
            FROM slack_user_identity_link_tokens
            WHERE token_hash = ?
          `,
        })
      ).toEqual({
        consume_nonce: null,
        consumed_at_ms: null,
      });
    } finally {
      harness.close();
    }
  });

  it("guards Slack workspace binding from being claimed by another organization", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    seedSecondOrganization(harness);

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });

      await expect(
        rpcConnectCenterAgentSlackWorkspace(buildEnv(harness.db), {
          context: buildHumanContext({ activeOrganizationId: "org_2" }),
          slackTeamId: "T123",
        })
      ).rejects.toMatchObject({
        code: "slack.workspace_already_bound",
      });
    } finally {
      harness.close();
    }
  });

  it("publishes completed Slack callbacks to the original Slack thread as mrkdwn", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallbackBody()
        )
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      expect(readSlackPostBodies(fetchMock)).toEqual([
        expect.objectContaining({
          blocks: [
            {
              text: COMPLETED_SLACK_MARKDOWN,
              type: "markdown",
            },
          ],
          channel: "C123",
          text: expect.stringContaining("​*Done from Slack*​"),
          thread_ts: "1710000000.000100",
        }),
      ]);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        completedAtMs: expect.any(Number),
        finalPublicationState: "published",
        publishedSignalId: "1710000001.000200",
        status: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps the canonical GitHub Navigation Action clickable in both Slack representations", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });
    const action = buildOpenMeldNavigationAction({
      organizationWebUrl: "https://openmeld.ai/o/amplift",
      target: { kind: "organization_app", service: "github" },
    });
    const markdown = `GitHub is not ready. [${action.label}](${action.url}) and try again.`;

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
      });
      if (!delivery) {
        throw new Error("expected accepted Slack delivery");
      }

      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          ...createCompletedCallbackBody(),
          text: markdown,
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      expect(readSlackPostBodies(fetchMock)).toEqual([
        {
          blocks: [{ text: markdown, type: "markdown" }],
          channel: "C123",
          metadata: {
            event_payload: {
              delivery_id: delivery.deliveryId,
            },
            event_type: "openmeld_remote_agent_final_publication",
          },
          text: `GitHub is not ready. <${action.url}|${action.label}> and try again.`,
          thread_ts: "1710000000.000100",
        },
      ]);
    } finally {
      harness.close();
    }
  });

  it("does not invent a native Slack button for a generic Project Navigation Action", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });

      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          ...createCompletedCallbackBody(),
          navigationTarget: {
            kind: "project",
            projectId: "project_123",
          },
          text: "Project created.",
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      expect(readSlackPostBodies(fetchMock)).toEqual([
        expect.objectContaining({
          blocks: [
            {
              text: "Project created.",
              type: "markdown",
            },
          ],
          channel: "C123",
          text: "Project created.",
          thread_ts: "1710000000.000100",
        }),
      ]);
    } finally {
      harness.close();
    }
  });

  it.each([
    { expectedVersion: 4 as const, sourceVersion: 4 as const },
    { expectedVersion: 1 as const, sourceVersion: 1 as const },
  ])("issues an Organization-scoped one-time identity-link action and preserves the source v$sourceVersion worker semantics", async ({
    expectedVersion,
    sourceVersion,
  }) => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const fetchMock = stubSlackFetch({ email: "new-member@example.test" });
    const workerSubmit = vi.fn(async (_request: unknown) => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: `req_slack_${workerSubmit.mock.calls.length}`,
      status: "pending" as const,
      submissionId: `sub_slack_${workerSubmit.mock.calls.length}`,
    }));
    const env = buildEnv(harness.db, { workerSubmit });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 900,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await expect(
        processRemoteAgentSlackEvent(env, createAppMentionPayload())
      ).resolves.toEqual({ status: "processed" });
      const sourceDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        });
      if (!sourceDelivery) {
        throw new Error("expected the anonymous Slack source delivery");
      }
      harness.run({
        params: ["deepseek/deepseek-v4-flash", sourceDelivery.bindingId],
        sql: `
          UPDATE openMeldDaemon_agent_profile_bindings
          SET model_id = ?
          WHERE binding_id = ?
        `,
      });

      await expect(
        completeRemoteAgentNativeDelivery(env, {
          ...createCompletedCallbackBody(),
          navigationTarget: { kind: "slack_identity_link" },
          text: "Link Slack before I perform that identity-owned action.",
          triggerMessageId: "1710000000.000100",
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      expect(
        await readRemoteAgentNativeDeliveryByDeliveryId({
          db: harness.db,
          deliveryId: sourceDelivery.deliveryId,
        })
      ).toMatchObject({
        anonymousMemberSpeaker: {
          messageChannelIdentity: {
            connectionId: "T123",
            provider: "slack",
            providerUserId: "U123",
          },
        },
        conversationKind: "slack",
        executionRecoverySubmitRequest: expect.any(Object),
        organizationId: "org_1",
        slackChannelId: "C123",
        slackTeamId: "T123",
        slackThreadTs: "1710000000.000100",
        status: "completed",
        triggerText: "<@B123> create a Codex agent",
        workerSubmitRequest: null,
      });
      if (sourceVersion === 1) {
        const sourceRequest = sourceDelivery.executionRecoverySubmitRequest;
        if (sourceRequest?.v !== 4) {
          throw new Error("expected the durable Slack source request");
        }
        const {
          continuityContext: _continuityContext,
          modelRoute: _modelRoute,
          runtimeConversation: _runtimeConversation,
          ...legacyRequestFields
        } = sourceRequest;
        const legacyRequest = remoteAgentWorkerSubmitTurnRequestSchema.parse({
          ...legacyRequestFields,
          v: 1,
        });
        harness.run({
          params: [
            JSON.stringify({ request: legacyRequest, storageVersion: 1 }),
          ],
          sql: `
            UPDATE openMeldRemoteAgent_native_delivery_ledger
            SET execution_recovery_submit_request_json = ?
            WHERE delivery_id = '${sourceDelivery.deliveryId}'
          `,
        });
      }

      const postBodies = readSlackPostBodies(fetchMock) as {
        blocks?: {
          elements?: { url?: string }[];
        }[];
        channel?: string;
        text?: string;
        thread_ts?: string;
      }[];
      expect(postBodies).toEqual([
        expect.objectContaining({
          channel: "C123",
          text: CENTER_AGENT_ACCOUNT_CONNECTION_REQUIRED_PUBLIC_COPY,
          thread_ts: "1710000000.000100",
        }),
        expect.objectContaining({
          channel: "U123",
        }),
      ]);
      expect(readSlackEphemeralBodies(fetchMock)).toEqual([]);
      const linkUrl = postBodies[1]?.blocks?.[1]?.elements?.[0]?.url;
      expect(linkUrl).toMatch(SLACK_IDENTITY_LINK_URL_PATTERN);
      const token = new URL(linkUrl ?? "").searchParams.get("token");
      expect(token).not.toBeNull();
      const tokenRow = await harness.db
        .prepare(
          `
            SELECT delivery_scope, organization_id, source_delivery_id
            FROM slack_user_identity_link_tokens
            WHERE token_hash = ?
          `
        )
        .bind(await digestSlackIdentityLinkToken(token ?? ""))
        .first<{
          delivery_scope: string;
          organization_id: string;
          source_delivery_id: string;
        }>();
      expect(tokenRow).toEqual({
        delivery_scope: "slack_direct_message",
        organization_id: "org_1",
        source_delivery_id: sourceDelivery.deliveryId,
      });
      const consumeInput = {
        context: buildHumanContext(),
        token: token ?? "",
      };
      await expect(
        Promise.all([
          rpcConsumeSlackIdentityLink(env, consumeInput),
          rpcConsumeSlackIdentityLink(env, consumeInput),
        ])
      ).resolves.toEqual([
        expect.objectContaining({
          continued: true,
          linked: true,
          organizationId: "org_1",
          slackUserId: "U123",
          openMeldUserId: "user_member",
        }),
        expect.objectContaining({
          continued: true,
          linked: true,
          organizationId: "org_1",
          slackUserId: "U123",
          openMeldUserId: "user_member",
        }),
      ]);
      expect(workerSubmit).toHaveBeenCalledTimes(2);
      expect(workerSubmit).toHaveBeenLastCalledWith(
        expect.objectContaining({
          author: {
            displayName: "Ari Human",
            profileId: "22222222-2222-4222-8222-222222222222",
            profileKind: "human",
          },
          idempotencyKey: `remote-agent-slack-identity-continuation:${sourceDelivery.deliveryId}:user_member`,
          messages: [
            {
              content:
                "Setup is complete. Continue my original request now without asking me to repeat it:\n\n<@B123> create a Codex agent",
              role: "user",
            },
          ],
          ...(sourceVersion === 4
            ? {
                modelRoute: expect.objectContaining({
                  modelId: "x-ai/grok-4.6",
                }),
              }
            : {}),
          onBehalfOf: {
            displayName: "Ari Human",
            profileId: "22222222-2222-4222-8222-222222222222",
            profileKind: "human",
          },
          turnEnvelope: expect.objectContaining({
            organization: expect.objectContaining({
              memberCount: 1,
            }),
            sender: expect.objectContaining({
              id: "member_1",
              ownerUserId: "user_member",
              verified: true,
            }),
          }),
          v: expectedVersion,
        })
      );
      if (sourceVersion === 1) {
        expect(workerSubmit.mock.calls.at(-1)?.[0]).not.toHaveProperty(
          "modelRoute"
        );
      }
      await expect(
        rpcConsumeSlackIdentityLink(env, consumeInput)
      ).resolves.toMatchObject({
        continued: true,
        linked: true,
      });
      expect(workerSubmit).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });

  it("does not issue private identity guidance until source publication is confirmed", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const fetchMock = stubSlackFetch({ email: "new-member@example.test" });
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: `req_slack_${workerSubmit.mock.calls.length}`,
      status: "pending" as const,
      submissionId: `sub_slack_${workerSubmit.mock.calls.length}`,
    }));
    const env = buildEnv(harness.db, { workerSubmit });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 900,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await processRemoteAgentSlackEvent(env, createAppMentionPayload());
      const sourceDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        });
      if (!sourceDelivery) {
        throw new Error("expected the anonymous Slack source delivery");
      }

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(failSlackFinalPublicationFinalize(harness.db), {
            workerSubmit,
          }),
          {
            ...createCompletedCallbackBody(),
            navigationTarget: { kind: "slack_identity_link" },
            text: "Link Slack before I perform that identity-owned action.",
            triggerMessageId: "1710000000.000100",
          }
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });
      await expect(
        readRemoteAgentNativeDeliveryByDeliveryId({
          db: harness.db,
          deliveryId: sourceDelivery.deliveryId,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "outcome_unknown",
        status: "accepted",
      });

      expect(readSlackEphemeralBodies(fetchMock)).toEqual([]);
      expect(workerSubmit).toHaveBeenCalledTimes(1);
      const tokenCount = await harness.db
        .prepare(
          "SELECT count(*) AS count FROM slack_user_identity_link_tokens"
        )
        .first<{ count: number }>();
      expect(tokenCount?.count).toBe(0);
    } finally {
      harness.close();
    }
  });

  it("retries a known failed continuation with one new deterministic attempt", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    seedSlackOrganization(harness);
    const fetchMock = stubSlackFetch({ email: "new-member@example.test" });
    const workerSubmit = vi.fn((request: { idempotencyKey: string }) => {
      if (workerSubmit.mock.calls.length === 2) {
        return Promise.resolve({
          idempotencyKey: request.idempotencyKey,
          message: "Worker rejected the first continuation attempt.",
          outcome: "rejected" as const,
          reasonCode: "remote_agent.turn_envelope_identity_mismatch" as const,
          v: 1 as const,
        });
      }
      return Promise.resolve({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: `req_slack_${workerSubmit.mock.calls.length}`,
        status: "pending" as const,
        submissionId: `sub_slack_${workerSubmit.mock.calls.length}`,
      });
    });
    const env = buildEnv(harness.db, { workerSubmit });

    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 900,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await processRemoteAgentSlackEvent(env, createAppMentionPayload());
      await completeRemoteAgentNativeDelivery(env, {
        ...createCompletedCallbackBody(),
        navigationTarget: { kind: "slack_identity_link" },
        text: "Link Slack before I perform that identity-owned action.",
        triggerMessageId: "1710000000.000100",
      });
      const privateMessages = readSlackPostBodies(fetchMock) as {
        blocks?: { elements?: { url?: string }[] }[];
        channel?: string;
      }[];
      const linkUrl = privateMessages.find(
        (message) => message.channel === "U123"
      )?.blocks?.[1]?.elements?.[0]?.url;
      const token = new URL(linkUrl ?? "").searchParams.get("token");
      if (!token) {
        throw new Error("expected a private Slack identity-link token");
      }
      const consumeInput = { context: buildHumanContext(), token };

      await expect(
        rpcConsumeSlackIdentityLink(env, consumeInput)
      ).resolves.toMatchObject({
        continuationRetryable: true,
        continued: false,
        linked: true,
      });
      await expect(
        rpcConsumeSlackIdentityLink(env, consumeInput)
      ).resolves.toMatchObject({
        continuationRetryable: false,
        continued: true,
        linked: true,
      });

      expect(workerSubmit).toHaveBeenCalledTimes(3);
      const continuationIdentity = `remote-agent-slack-identity-continuation:${
        (
          await readRemoteAgentNativeDeliveryByIdempotencyKey({
            db: harness.db,
            idempotencyKey: "remote-agent-slack:T123:Ev123",
          })
        )?.deliveryId
      }:user_member`;
      expect(workerSubmit.mock.calls[1]?.[0]).toMatchObject({
        idempotencyKey: continuationIdentity,
      });
      expect(workerSubmit.mock.calls[2]?.[0]).toMatchObject({
        idempotencyKey: `${continuationIdentity}:retry:1`,
      });
    } finally {
      harness.close();
    }
  });

  it("keeps the Slack request timeout shorter than the publication claim lease", () => {
    expect(REMOTE_AGENT_SLACK_FINAL_PUBLICATION_TIMEOUT_MS).toBeLessThan(
      REMOTE_AGENT_SLACK_FINAL_PUBLICATION_CLAIM_LEASE_MS
    );
  });

  it("publishes concurrent completed Slack callbacks only once", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      const env = buildEnv(harness.db);

      const results = await Promise.all([
        completeRemoteAgentNativeDelivery(env, createCompletedCallbackBody()),
        completeRemoteAgentNativeDelivery(env, createCompletedCallbackBody()),
      ]);

      expect(results).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            publishedSignalId: "1710000001.000200",
            status: "accepted",
          }),
          expect.objectContaining({
            reasonCode: "remote_agent.callback_publication_in_progress",
            status: "retryable",
          }),
        ])
      );
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        finalPublicationState: "published",
        publishedSignalId: "1710000001.000200",
        status: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("publishes concurrent failed Slack callbacks only once", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      const env = buildEnv(harness.db);

      const results = await Promise.all([
        completeRemoteAgentNativeDelivery(env, createFailedCallbackBody()),
        completeRemoteAgentNativeDelivery(env, {
          ...createFailedCallbackBody(),
          callbackAttempt: 2,
        }),
      ]);

      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      expect(results).toContainEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_not_completed",
        finalPublicationState: "published",
        publishedSignalId: "1710000001.000200",
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("does not republish a failed callback when publication finalization is interrupted", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      const finalizeFailingDb = failSlackFinalPublicationFinalize(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(finalizeFailingDb),
          createFailedCallbackBody()
        )
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createFailedCallbackBody()
        )
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn_not_completed",
        finalPublicationState: "outcome_unknown",
        publishedSignalId: null,
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("returns retryable when a lost Slack publication claim was released before reread", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      const claimLosingDb = skipSlackFinalPublicationClaim(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(claimLosingDb),
          createCompletedCallbackBody()
        )
      ).resolves.toEqual({
        status: "retryable",
        reasonCode: "remote_agent.callback_publication_in_progress",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(0);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        finalPublicationState: null,
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("marks interrupted Slack publication claims outcome unknown without republishing", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>(() => undefined)
    );
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(2000);

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      const env = buildEnv(harness.db);

      const pendingCallback = completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallbackBody()
      );
      expect(pendingCallback).toBeInstanceOf(Promise);
      await vi.waitFor(() => {
        expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      });

      const claimedDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        });
      expect(claimedDelivery).toMatchObject({
        completedAtMs: null,
        finalPublicationClaimExpiresAtMs: expect.any(Number),
        finalPublicationClaimId: expect.any(String),
        finalPublicationState: "claimed",
        status: "accepted",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          ...createCompletedCallbackBody(),
          callbackAttempt: 2,
        })
      ).resolves.toEqual({
        status: "retryable",
        reasonCode: "remote_agent.callback_publication_in_progress",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);

      const claimExpiresAtMs = (
        claimedDelivery as {
          finalPublicationClaimExpiresAtMs?: number | null;
        } | null
      )?.finalPublicationClaimExpiresAtMs;
      if (typeof claimExpiresAtMs !== "number") {
        throw new Error("Slack publication claim expiry was not persisted");
      }
      const probe = createDeadlineProbe();
      nowSpy.mockReturnValue(
        Math.max(probe.deadlineAtMs, claimExpiresAtMs + 1)
      );

      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: Date.now(),
          probe,
        })
      ).resolves.toEqual({
        reasonCode:
          "remote_agent.delivery_deadline_probe_publication_outcome_unknown",
        status: "expired",
      });
      await expect(
        completeRemoteAgentNativeDelivery(env, {
          ...createCompletedCallbackBody(),
          callbackAttempt: 3,
        })
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        finalPublicationClaimExpiresAtMs: claimExpiresAtMs,
        finalPublicationClaimId: expect.any(String),
        finalPublicationState: "outcome_unknown",
        publishedSignalId: null,
        status: "accepted",
      });
    } finally {
      nowSpy.mockRestore();
      harness.close();
    }
  });

  it("requeues a due deadline probe while a Slack publication claim is active", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>(() => undefined)
    );
    const probe = createDeadlineProbe();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(probe.deadlineAtMs);
    const queueSend = vi.fn(async () => undefined);

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: probe.idempotencyKey,
        submissionId: probe.submissionId,
      });
      const env = buildEnv(harness.db, { queueSend });

      const pendingCallback = completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallbackBody()
      );
      expect(pendingCallback).toBeInstanceOf(Promise);
      await vi.waitFor(() => {
        expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      });

      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({
        reasonCode:
          "remote_agent.delivery_deadline_probe_publication_in_progress",
        status: "skipped",
      });
      expect(queueSend).toHaveBeenCalledWith(probe, {
        delaySeconds:
          REMOTE_AGENT_SLACK_FINAL_PUBLICATION_CLAIM_LEASE_MS / 1000,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: probe.idempotencyKey,
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        finalPublicationState: "claimed",
        status: "accepted",
      });
    } finally {
      nowSpy.mockRestore();
      harness.close();
    }
  });

  it("rejects a due deadline probe when its active claim cannot be requeued", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });
    fetchMock.mockImplementationOnce(
      () => new Promise<Response>(() => undefined)
    );
    const probe = createDeadlineProbe();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(probe.deadlineAtMs);
    const queueSend = vi.fn(() =>
      Promise.reject(new Error("queue unavailable"))
    );

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: probe.idempotencyKey,
        submissionId: probe.submissionId,
      });
      const env = buildEnv(harness.db, { queueSend });

      const pendingCallback = completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallbackBody()
      );
      expect(pendingCallback).toBeInstanceOf(Promise);
      await vi.waitFor(() => {
        expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      });

      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).rejects.toThrow("queue unavailable");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: probe.idempotencyKey,
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        finalPublicationState: "claimed",
        status: "accepted",
      });
    } finally {
      nowSpy.mockRestore();
      harness.close();
    }
  });

  it("marks Slack ok responses without a timestamp as publication outcome unknown", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({
      chatPostResponse: { ok: true },
      email: "ari@example.test",
    });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallbackBody()
        )
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        failureCode: "remote_agent.callback_publication_outcome_unknown",
        finalPublicationState: "outcome_unknown",
        publishedSignalId: null,
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("does not retry an ambiguous Slack network failure", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });
    fetchMock.mockRejectedValueOnce(new TypeError("network connection reset"));

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallbackBody()
        )
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        failureCode: "remote_agent.callback_publication_outcome_unknown",
        finalPublicationState: "outcome_unknown",
        publishedSignalId: null,
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("records outcome unknown when a successful Slack post cannot finalize in D1", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      const finalizeFailingDb = failSlackFinalPublicationFinalize(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(finalizeFailingDb),
          createCompletedCallbackBody()
        )
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      const claimedDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        });
      expect(claimedDelivery).toMatchObject({
        completedAtMs: null,
        failureCode: "remote_agent.callback_publication_outcome_unknown",
        finalPublicationClaimExpiresAtMs: expect.any(Number),
        finalPublicationState: "outcome_unknown",
        publishedSignalId: null,
        status: "accepted",
      });

      const probe = createDeadlineProbe();
      const claimExpiresAtMs =
        claimedDelivery?.finalPublicationClaimExpiresAtMs;
      if (typeof claimExpiresAtMs !== "number") {
        throw new Error("Slack publication claim expiry was not persisted");
      }
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env: buildEnv(harness.db),
          nowMs: Math.max(probe.deadlineAtMs, claimExpiresAtMs + 1),
          probe,
        })
      ).resolves.toEqual({
        reasonCode:
          "remote_agent.delivery_deadline_probe_publication_outcome_unknown",
        status: "skipped",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        finalPublicationState: "outcome_unknown",
        publishedSignalId: null,
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps Slack callback publish failures retryable", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({
      chatPostResponse: { error: "ratelimited", ok: false },
      email: "ari@example.test",
    });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallbackBody()
        )
      ).resolves.toEqual({
        status: "retryable",
        reasonCode: "remote_agent.callback_publish_failed",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        completedAtMs: null,
        failureCode: "remote_agent.callback_publish_failed",
        finalPublicationClaimId: null,
        finalPublicationState: null,
        status: "accepted",
      });

      fetchMock.mockImplementation(() =>
        Promise.resolve(Response.json({ ok: true, ts: "1710000001.000200" }))
      );
      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          ...createCompletedCallbackBody(),
          callbackAttempt: 2,
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(2);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        finalPublicationState: "published",
        publishedSignalId: "1710000001.000200",
        status: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("reconciles and keeps accepted Slack deliveries open after a retired deadline probe", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:Ev123",
        submissionId: "sub_slack_1",
      });
      const probe = createDeadlineProbe();
      const queueSend = vi.fn(async () => undefined);
      const workerReconcile = vi.fn(async () => ({
        execution: {
          acceptedAtMs: 1100,
          cancellationReason: null,
          completedAtMs: null,
          idempotencyKey: probe.idempotencyKey,
          lastProgressAtMs: probe.deadlineAtMs,
          lastProgressKind: "tool_started" as const,
          organizationId: probe.organizationId,
          spaceId: probe.spaceId,
          status: "running" as const,
          submissionId: probe.submissionId,
          v: 1 as const,
        },
        status: "found" as const,
      }));
      const env = buildEnv(harness.db, { queueSend, workerReconcile });

      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_scheduled",
        status: "skipped",
      });
      expect(readSlackPostBodies(fetchMock)).toEqual([]);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs: probe.deadlineAtMs + 100,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_already_claimed",
        status: "skipped",
      });
      expect(workerReconcile).toHaveBeenCalledOnce();
      expect(queueSend).toHaveBeenCalledOnce();

      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs:
            probe.deadlineAtMs + REMOTE_AGENT_EXECUTION_RECONCILIATION_DELAY_MS,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_scheduled",
        status: "skipped",
      });
      expect(workerReconcile).toHaveBeenCalledTimes(2);
      expect(workerReconcile).toHaveBeenLastCalledWith({
        idempotencyKey: probe.idempotencyKey,
        organizationId: probe.organizationId,
        spaceId: probe.spaceId,
        submissionId: probe.submissionId,
        v: 1,
      });
      expect(queueSend).toHaveBeenCalledTimes(2);
      expect(queueSend).toHaveBeenLastCalledWith(probe, {
        delaySeconds: 300,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "remote-agent-slack:T123:Ev123",
        })
      ).resolves.toMatchObject({
        failureCode: null,
        status: "accepted",
        submissionId: "sub_slack_1",
      });
    } finally {
      harness.close();
    }
  });

  it("releases a failed reconciliation enqueue for scheduled compensation", async () => {
    const harness = createSqliteD1Harness();
    applySlackMigrations(harness);
    const probe = createDeadlineProbe();
    const workerReconcile = vi.fn(async () => ({
      execution: {
        acceptedAtMs: 1100,
        cancellationReason: null,
        completedAtMs: null,
        idempotencyKey: probe.idempotencyKey,
        lastProgressAtMs: probe.deadlineAtMs,
        lastProgressKind: "tool_started" as const,
        organizationId: probe.organizationId,
        spaceId: probe.spaceId,
        status: "running" as const,
        submissionId: probe.submissionId,
        v: 1 as const,
      },
      status: "found" as const,
    }));
    const failedQueueSend = vi.fn(() =>
      Promise.reject(new Error("queue unavailable"))
    );

    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: probe.idempotencyKey,
        submissionId: probe.submissionId,
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env: buildEnv(harness.db, {
            queueSend: failedQueueSend,
            workerReconcile,
          }),
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).rejects.toThrow("queue unavailable");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: probe.idempotencyKey,
        })
      ).resolves.toMatchObject({ acceptedProbeNextDueAtMs: null });

      const recoveredQueueSend = vi.fn(async () => undefined);
      await expect(
        retryMissingRemoteAgentAcceptedDeliveryProbes({
          db: harness.db,
          env: buildEnv(harness.db, { queueSend: recoveredQueueSend }),
          nowMs: probe.deadlineAtMs,
        })
      ).resolves.toEqual({ enqueued: 1, errors: 0, scanned: 1 });
      expect(recoveredQueueSend).toHaveBeenCalledOnce();
    } finally {
      harness.close();
    }
  });
});

function moveSlackWorkspaceBeforeIdentityLinkConsume(input: {
  db: D1Database;
  moveWorkspace(): void;
}): D1Database {
  const delegateByStatement = new WeakMap<object, D1PreparedStatement>();
  const sqlByStatement = new WeakMap<object, string>();
  let moved = false;
  const moveOnceForConsume = (sql: string): void => {
    const normalizedSql = sql.replace(/\s+/gu, " ").trim().toLowerCase();
    if (
      moved ||
      !normalizedSql.includes("update slack_user_identity_link_tokens") ||
      !normalizedSql.includes("set consumed_at_ms")
    ) {
      return;
    }
    moved = true;
    input.moveWorkspace();
  };
  const wrapStatement = (
    delegate: D1PreparedStatement,
    sql: string
  ): D1PreparedStatement => {
    const wrapped = {
      all: <TRow>() => delegate.all<TRow>(),
      bind: (...values: unknown[]) =>
        wrapStatement(delegate.bind(...values), sql),
      first: <TRow>(columnName?: string) =>
        columnName === undefined
          ? delegate.first<TRow>()
          : delegate.first<TRow>(columnName),
      run: async () => {
        moveOnceForConsume(sql);
        return await delegate.run();
      },
    } as D1PreparedStatement;
    delegateByStatement.set(wrapped, delegate);
    sqlByStatement.set(wrapped, sql);
    return wrapped;
  };

  return {
    batch: async (statements: D1PreparedStatement[]) => {
      for (const statement of statements) {
        moveOnceForConsume(sqlByStatement.get(statement) ?? "");
      }
      return await input.db.batch(
        statements.map(
          (statement) => delegateByStatement.get(statement) ?? statement
        )
      );
    },
    prepare: (sql: string) => wrapStatement(input.db.prepare(sql), sql),
  } as D1Database;
}

function applySlackMigrations(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  applyMigrationForTable(input, "openMeldRemoteAgent_native_delivery_ledger");
  applyMigrationForTable(input, "openMeldRemoteAgent_daily_admissions");
  applyMigrationForTable(input, "openMeldRemoteAgent_conversation_generations");
  applyMigrationForTable(input, "openMeldRemoteAgent_slack_event_ingress");
  applyMigrationForTable(
    input,
    "openMeldRemoteAgent_slack_thread_context_cursors"
  );
  applyMigrationForTable(input, "openMeldRemoteAgent_slack_workspace_bindings");
  applyMigrationForTable(input, "slack_channel_introduction_runs");
  applyMigrationForTable(input, "slack_channel_introduction_items");
  applyMigrationForTable(input, "slack_workspace_tokens");
  applyMigrationForTable(input, "slack_user_identity_links");
  applyMigrationForTable(input, "slack_user_identity_link_tokens");
  applyMigrationForTable(input, "organization_join_links");
  applyMigrationForTable(input, "openMeldDaemon_agent_profile_bindings");
  applyMigrationForTable(input, "agent_delegation_children");
  applyMigrationForTable(input, "agent_delegations");
  applyMigrationForTable(input, "agent_task_completion_subscriptions");
  applyMigrationForTable(input, "agent_task_terminal_outcomes");
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS center_agent_designations (
        organization_id TEXT PRIMARY KEY,
        agent_profile_id TEXT NOT NULL,
        duty TEXT,
        designated_by TEXT NOT NULL,
        operating_state TEXT NOT NULL DEFAULT 'active',
        paused_at INTEGER,
        paused_by_user_id TEXT,
        created_at INTEGER NOT NULL
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        email_verified INTEGER DEFAULT false NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        normalized_email TEXT
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        metadata TEXT,
        created_at INTEGER NOT NULL
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `,
  });
  input.run({
    sql: `
      CREATE TABLE IF NOT EXISTS openmeld_profiles (
        profile_id TEXT PRIMARY KEY,
        profile_name TEXT NOT NULL,
        profile_handle TEXT NOT NULL,
        profile_kind TEXT NOT NULL,
        is_default INTEGER DEFAULT false NOT NULL,
        status TEXT DEFAULT 'active' NOT NULL,
        organization_id TEXT,
        owner_user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        CONSTRAINT openmeld_profiles_organization_profile_kind_check
          CHECK (
            (profile_kind = 'agent' AND organization_id IS NOT NULL)
            OR (profile_kind IN ('human', 'system') AND organization_id IS NULL)
          )
      )
    `,
  });
  applyDrizzleMigrationsForTables(input, [
    "organization_skill_releases",
    "organization_skills",
  ]);
}

function seedNonMemberUser(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  input.run({
    params: [
      "user_non_member",
      "No Member",
      "no-member@example.test",
      1,
      100,
      100,
    ],
    sql: `
      INSERT INTO users (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  });
}

function seedSecondOrganization(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  input.run({
    params: [
      "org_2",
      "Second Org",
      "second-org",
      JSON.stringify({ personal: false }),
      100,
    ],
    sql: `
      INSERT INTO organizations (
        id,
        name,
        slug,
        metadata,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: ["member_2", "org_2", "user_member", "owner", 100],
    sql: `
      INSERT INTO members (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
}

function seedSlackOrganization(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  input.run({
    params: ["user_member", "Ari", "ari@example.test", 1, 100, 100],
    sql: `
      INSERT INTO users (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: [
      "org_1",
      "OpenMeld Labs",
      "openmeld-labs",
      JSON.stringify({ personal: false }),
      100,
    ],
    sql: `
      INSERT INTO organizations (
        id,
        name,
        slug,
        metadata,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: ["member_1", "org_1", "user_member", "owner", 100],
    sql: `
      INSERT INTO members (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES (?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: [
      "22222222-2222-4222-8222-222222222222",
      "Ari Human",
      "ari",
      "human",
      1,
      "active",
      null,
      "user_member",
      100,
      100,
    ],
    sql: `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: [
      AGENT_PROFILE_ID,
      "Center Agent",
      "center-agent",
      "agent",
      0,
      "active",
      "org_1",
      "user_owner",
      100,
      100,
    ],
    sql: `
      INSERT INTO openmeld_profiles (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        created_at,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
  input.run({
    params: ["org_1", AGENT_PROFILE_ID, "user_owner", 100],
    sql: `
      INSERT INTO center_agent_designations (
        organization_id,
        agent_profile_id,
        designated_by,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `,
  });
  input.run({
    params: [
      "binding_1",
      "owner_account",
      "user_owner",
      AGENT_PROFILE_ID,
      HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      "hosted_center_agent",
      JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      "center-agent",
      "enabled_primary",
      100,
      100,
    ],
    sql: `
      INSERT INTO openMeldDaemon_agent_profile_bindings (
        binding_id,
        owner_kind,
        owner_id,
        agent_profile_id,
        openmeld_service_runtime_id,
        runtime_kind,
        hosted_runtime_identity_json,
        agent_controller_ref,
        agent_controller_conversation_id,
        binding_state,
        created_at_ms,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  });
}

function buildEnv(
  db: D1Database,
  input: {
    cryptoKey?: string;
    ensureWorkspaceMember?: ReturnType<typeof vi.fn>;
    queueSend?: ReturnType<typeof vi.fn>;
    workerReconcile?: ReturnType<typeof vi.fn>;
    workerSubmit?: ReturnType<typeof vi.fn>;
  } = {}
): CoreBindings {
  return {
    OPENMELD_DB: db,
    OPENMELD_LOCAL_STATE_DB: db,
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
    OPENMELD_AUTH_WORKER: {
      resolveOrganizationAccountIdentity: (request) =>
        resolveTestOrganizationAccountIdentity(db, request),
      ...(input.ensureWorkspaceMember
        ? {
            ensureSlackWorkspaceMemberOrganizationMembership:
              input.ensureWorkspaceMember,
          }
        : {}),
    },
    OPENMELD_REMOTE_AGENT_WORKER:
      input.workerSubmit || input.workerReconcile
        ? {
            ...(input.workerReconcile
              ? { reconcileExecution: input.workerReconcile }
              : {}),
            ...(input.workerSubmit
              ? { submitConversationTurn: input.workerSubmit }
              : {}),
          }
        : undefined,
    SLACK_OPENMELD_BOT_TOKEN: "xoxb-test",
    ...(input.cryptoKey
      ? { SLACK_OPENMELD_TOKEN_CRYPTO_KEY: input.cryptoKey }
      : {}),
    OPENMELD_DAEMON_DISPATCH_QUEUE: {
      send: input.queueSend ?? vi.fn(async () => undefined),
    } as unknown as CoreBindings["OPENMELD_DAEMON_DISPATCH_QUEUE"],
    WEB_APP_URL: "https://openmeld.ai",
    OPENMELD_SPACES: {
      get: () => null,
      idFromString: () => ({ toString: () => "unused" }),
    } as unknown as CoreBindings["OPENMELD_SPACES"],
  };
}

async function resolveTestOrganizationAccountIdentity(
  db: D1Database,
  input: AuthRpcResolveOrganizationAccountIdentityInput
): Promise<AuthRpcResolveOrganizationAccountIdentityResult> {
  const organization = await db
    .prepare(
      `
        SELECT id, name, slug, metadata
        FROM organizations
        WHERE id = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<{
      id: string;
      metadata: string | null;
      name: string;
      slug: string;
    }>();
  if (!organization) {
    return {
      code: "auth.organization_identity_unavailable",
      message: "Organization identity is unavailable.",
      ok: false,
    };
  }
  const memberCountRow = await db
    .prepare(
      "SELECT COUNT(*) AS member_count FROM members WHERE organization_id = ?"
    )
    .bind(input.organizationId)
    .first<{ member_count: number }>();
  let account: Extract<
    AuthRpcResolveOrganizationAccountIdentityResult,
    { ok: true }
  >["account"] = null;
  if (input.account) {
    let accountSelection: { sql: string; value: string };
    if (input.account.kind === "email") {
      accountSelection = {
        sql: "SELECT id, name, email FROM users WHERE lower(email) = lower(?) LIMIT 1",
        value: input.account.email,
      };
    } else if (input.account.kind === "user_id") {
      accountSelection = {
        sql: "SELECT id, name, email FROM users WHERE id = ? LIMIT 1",
        value: input.account.userId,
      };
    } else {
      accountSelection = {
        sql: `
          SELECT users.id, users.name, users.email
          FROM users
          INNER JOIN openmeld_profiles AS selected_profile
            ON selected_profile.owner_user_id = users.id
          WHERE selected_profile.profile_id = ?
            AND selected_profile.organization_id IS NULL
            AND selected_profile.profile_kind = 'human'
          LIMIT 1
        `,
        value: input.account.profileId,
      };
    }
    const user = await db
      .prepare(accountSelection.sql)
      .bind(accountSelection.value)
      .first<{ email: string; id: string; name: string | null }>();
    if (user) {
      const [membership, profile] = await Promise.all([
        db
          .prepare(
            "SELECT id, role FROM members WHERE organization_id = ? AND user_id = ? LIMIT 1"
          )
          .bind(input.organizationId, user.id)
          .first<{ id: string; role: "admin" | "member" | "owner" }>(),
        db
          .prepare(
            `
              SELECT profile_id, profile_name
              FROM openmeld_profiles
              WHERE owner_user_id = ?
                AND organization_id IS NULL
                AND profile_kind = 'human'
                AND is_default = 1
                AND status = 'active'
              LIMIT 1
            `
          )
          .bind(user.id)
          .first<{ profile_id: string; profile_name: string }>(),
      ]);
      account = {
        defaultHumanProfile: profile
          ? {
              profileId: profile.profile_id,
              profileName: profile.profile_name,
            }
          : null,
        displayName: profile?.profile_name ?? user.name ?? user.email,
        email: user.email,
        membership: membership
          ? { memberId: membership.id, role: membership.role }
          : null,
        userId: user.id,
      };
    }
  }
  let metadata: { personal?: unknown } = {};
  try {
    metadata = JSON.parse(organization.metadata ?? "{}") as {
      personal?: unknown;
    };
  } catch {
    metadata = {};
  }
  return {
    account,
    ok: true,
    organization: {
      id: organization.id,
      memberCount: Number(memberCountRow?.member_count) || 0,
      name: organization.name,
      personal: metadata.personal === true,
      slug: organization.slug,
    },
  };
}

function failSlackFinalPublicationFinalize(db: D1Database): D1Database {
  return overridePreparedStatementRun({
    db,
    run: () =>
      Promise.reject(new Error("simulated Slack publication finalize failure")),
    sqlIncludes: "final_publication_state = 'published'",
  });
}

function skipSlackFinalPublicationClaim(db: D1Database): D1Database {
  return overridePreparedStatementRun({
    db,
    run: () =>
      Promise.resolve({ success: true, meta: { changes: 0 } } as D1Result),
    sqlIncludes: "final_publication_state = 'claimed'",
  });
}

function overridePreparedStatementRun(input: {
  db: D1Database;
  run: () => Promise<unknown>;
  sqlIncludes: string;
}): D1Database {
  return new Proxy(input.db, {
    get(target, property, receiver) {
      if (property !== "prepare") {
        const value = Reflect.get(target, property, receiver) as unknown;
        return typeof value === "function" ? value.bind(target) : value;
      }
      return (sql: string) => {
        const statement = target.prepare(sql);
        return sql.includes(input.sqlIncludes)
          ? replacePreparedStatementRun(statement, input.run)
          : statement;
      };
    },
  });
}

function replacePreparedStatementRun(
  statement: D1PreparedStatement,
  run: () => Promise<unknown>
): D1PreparedStatement {
  return new Proxy(statement, {
    get(target, property, receiver) {
      if (property === "bind") {
        return (...values: unknown[]) =>
          replacePreparedStatementRun(target.bind(...values), run);
      }
      if (property === "run") {
        return run;
      }
      const value = Reflect.get(target, property, receiver) as unknown;
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

type SlackMembershipStatusField =
  | "deleted"
  | "is_restricted"
  | "is_stranger"
  | "is_ultra_restricted";

function buildSlackUsersInfoResponseWithout(
  missingStatusField: SlackMembershipStatusField,
  email = "new-member@example.test"
): UsersInfoResponse {
  const user: NonNullable<UsersInfoResponse["user"]> = {
    deleted: false,
    id: "U123",
    is_restricted: false,
    is_stranger: false,
    is_ultra_restricted: false,
    name: "ari",
    profile: {
      display_name: "ari",
      email,
    },
    team_id: "T123",
  };
  delete user[missingStatusField];
  return { ok: true, user };
}

function stubSlackFetch(input: {
  assistantSearchResponse?: Record<string, unknown>;
  chatEphemeralResponse?: Record<string, unknown>;
  chatPostError?: Error;
  chatPostResponse?: Record<string, unknown>;
  conversationsHistoryResponse?:
    | Record<string, unknown>
    | Response
    | ((url: URL) => Record<string, unknown> | Response);
  conversationsListResponse?: Record<string, unknown>;
  conversationsInfoNeverResolves?: boolean;
  conversationsInfoResponse?: Record<string, unknown>;
  conversationsRepliesResponse?:
    | Record<string, unknown>
    | Response
    | ((url: URL) => Record<string, unknown> | Response);
  displayName?: string;
  email: string;
  isDeleted?: boolean;
  isStranger?: boolean;
  isRestricted?: boolean;
  isUltraRestricted?: boolean;
  teamId?: string;
  threadStatusResponse?: Record<string, unknown>;
  usersInfoResponse?: UsersInfoResponse;
}) {
  const fetchMock = vi.fn(
    // biome-ignore lint/suspicious/useAwait: Fetch mocks intentionally preserve the asynchronous FetchLike contract.
    async (
      request: RequestInfo | URL,
      init?: RequestInit
    ): Promise<Response> => {
      const url = String(request);
      if (url.includes("/users.info")) {
        if (input.usersInfoResponse) {
          return Response.json(input.usersInfoResponse);
        }
        const usersInfoResponse = {
          ok: true,
          user: {
            deleted: input.isDeleted ?? false,
            is_restricted: input.isRestricted ?? false,
            is_stranger: input.isStranger ?? false,
            is_ultra_restricted: input.isUltraRestricted ?? false,
            name: input.displayName ?? "ari",
            profile: {
              display_name: input.displayName ?? "",
              email: input.email,
            },
            team_id: input.teamId ?? "T123",
          },
        } satisfies UsersInfoResponse;
        return Response.json(usersInfoResponse);
      }
      if (url.includes("/conversations.info")) {
        if (input.conversationsInfoNeverResolves) {
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason ?? new Error("aborted")),
              { once: true }
            );
          });
        }
        return Response.json(
          input.conversationsInfoResponse ?? {
            channel: { id: "C123", name: "all" },
            ok: true,
          }
        );
      }
      if (url.includes("/conversations.list")) {
        return Response.json(
          input.conversationsListResponse ?? {
            channels: [],
            ok: true,
            response_metadata: { next_cursor: "" },
          }
        );
      }
      if (url.includes("/conversations.open")) {
        return Response.json({ channel: { id: "D_OPENMELD" }, ok: true });
      }
      if (url.includes("/conversations.join")) {
        return Response.json({ ok: true });
      }
      if (url.includes("/conversations.replies")) {
        const configured =
          typeof input.conversationsRepliesResponse === "function"
            ? input.conversationsRepliesResponse(new URL(url))
            : input.conversationsRepliesResponse;
        if (configured instanceof Response) {
          return configured;
        }
        return Response.json(
          configured ?? {
            has_more: false,
            messages: [],
            ok: true,
          }
        );
      }
      if (url.includes("/conversations.history")) {
        const configured =
          typeof input.conversationsHistoryResponse === "function"
            ? input.conversationsHistoryResponse(new URL(url))
            : input.conversationsHistoryResponse;
        if (configured instanceof Response) {
          return configured;
        }
        return Response.json(
          configured ?? {
            messages: [],
            ok: true,
            response_metadata: { next_cursor: "" },
          }
        );
      }
      if (url.includes("/chat.postMessage")) {
        if (input.chatPostError) {
          return Promise.reject(input.chatPostError);
        }
        return Response.json(
          input.chatPostResponse ?? {
            ok: true,
            ts: "1710000001.000200",
          }
        );
      }
      if (url.includes("/chat.postEphemeral")) {
        return Response.json(
          input.chatEphemeralResponse ?? {
            ok: true,
            message_ts: "1710000001.000300",
          }
        );
      }
      if (url.includes("/assistant.threads.setStatus")) {
        return Response.json(input.threadStatusResponse ?? { ok: true });
      }
      if (url.includes("/assistant.search.context")) {
        return Response.json(
          input.assistantSearchResponse ?? {
            ok: true,
            results: { messages: [] },
          }
        );
      }
      return Response.json({ error: "unknown_method", ok: false });
    }
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function readSlackPostBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([request]) => String(request).includes("/chat.postMessage"))
    .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as unknown);
}

function readSlackChannelIntroductionCreatedAtMs(
  harness: ReturnType<typeof createSqliteD1Harness>,
  interactionId: string
): number {
  const row = harness.queryFirst<{ createdAtMs: number }>({
    params: [interactionId],
    sql: `SELECT created_at_ms AS createdAtMs
      FROM slack_channel_introduction_runs
      WHERE interaction_id = ?`,
  });
  if (!(row && Number.isFinite(row.createdAtMs))) {
    throw new Error(
      `Missing Slack channel introduction run for ${interactionId}.`
    );
  }
  return row.createdAtMs;
}

function readSlackEphemeralBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([request]) => String(request).includes("/chat.postEphemeral"))
    .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as unknown);
}

function readSlackThreadStatusBodies(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls
    .filter(([request]) =>
      String(request).includes("/assistant.threads.setStatus")
    )
    .map(([, init]) => JSON.parse(String(init?.body ?? "{}")) as unknown);
}

function buildHumanContext(
  input: {
    activeOrganizationId?: string;
    profileId?: string;
    userId?: string;
  } = {}
) {
  const userId = input.userId ?? "user_member";
  return {
    activeOrganizationId: input.activeOrganizationId ?? "org_1",
    actorContext: {
      callerPrincipalId: userId,
      ownerUserId: userId,
      profileKind: "human" as const,
      profileName: userId === "user_member" ? "Ari Human" : "No Member",
      requestId: "req_slack_link_test",
      openMeldProfileId:
        input.profileId ?? "22222222-2222-4222-8222-222222222222",
    },
  };
}

async function createAcceptedSlackDelivery(input: {
  db: D1Database;
  idempotencyKey: string;
  submissionId: string;
}) {
  await upsertRemoteAgentNativeDeliveryRecord({
    db: input.db,
    nowMs: 1000,
    organizationId: "org_1",
    conversationKind: "slack",
    spaceId: CONVERSATION_ID,
    profileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    triggerMessageId: CONVERSATION_ID,
    dispatchId: "remote-agent-slack:Ev123",
    attemptId: null,
    idempotencyKey: input.idempotencyKey,
    status: "submitted",
    slackTeamId: "T123",
    slackChannelId: "C123",
    slackThreadTs: "1710000000.000100",
  });
  await markRemoteAgentNativeDeliveryAck({
    db: input.db,
    nowMs: 1100,
    accepted: true,
    idempotencyKey: input.idempotencyKey,
    submissionId: input.submissionId,
    workerRequestId: "req_slack_1",
  });
}

function createAppMentionPayload(
  overrides: {
    actionToken?: string;
    eventId?: string;
    text?: string;
    threadTs?: string;
    ts?: string;
  } = {}
) {
  const ts = overrides.ts ?? "1710000000.000100";
  return {
    token: "verification-token",
    type: "event_callback",
    team_id: "T123",
    api_app_id: "A123",
    event_id: overrides.eventId ?? "Ev123",
    event_time: 1_710_000_000,
    event: {
      type: "app_mention",
      user: "U123",
      text: overrides.text ?? "<@B123> create a Codex agent",
      ts,
      channel: "C123",
      event_ts: ts,
      ...(overrides.actionToken ? { action_token: overrides.actionToken } : {}),
      ...(overrides.threadTs ? { thread_ts: overrides.threadTs } : {}),
    },
  };
}

function createDirectMessagePayload(
  overrides: {
    actionToken?: string;
    eventId?: string;
    text?: string;
    threadTs?: string;
    ts?: string;
  } = {}
) {
  const ts = overrides.ts ?? "1710000000.000100";
  return {
    type: "event_callback",
    team_id: "T123",
    event_id: overrides.eventId ?? "EvDm123",
    event_time: 1_710_000_000,
    event: {
      type: "message",
      channel_type: "im",
      user: "U123",
      text: overrides.text ?? "What do you know about my work?",
      ts,
      channel: "D123",
      event_ts: ts,
      ...(overrides.actionToken ? { action_token: overrides.actionToken } : {}),
      ...(overrides.threadTs ? { thread_ts: overrides.threadTs } : {}),
    },
  };
}

function createCompletedCallbackForSubmittedRequest(input: {
  request: RemoteAgentWorkerSubmitTurnRequest;
  submissionId: string;
}): Extract<RemoteAgentCoreCallbackBody, { text: string }> {
  return {
    agentProfileId: input.request.agentProfileId,
    bindingId: input.request.bindingId,
    dispatchId: input.request.dispatchId,
    idempotencyKey: input.request.idempotencyKey,
    organizationId: input.request.organizationId,
    spaceId: input.request.spaceId,
    status: "completed",
    submissionId: input.submissionId,
    text: COMPLETED_SLACK_MARKDOWN,
    triggerMessageId: input.request.triggerMessageId,
  };
}

function createDeferred<T>(value: T): {
  promise: Promise<T>;
  resolve: () => void;
} {
  let resolvePromise!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: () => resolvePromise(value),
  };
}

function createCompletedCallbackBody(): Extract<
  RemoteAgentCoreCallbackBody,
  { text: string }
> {
  return {
    agentProfileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    dispatchId: "remote-agent-slack:Ev123",
    idempotencyKey: "remote-agent-slack:T123:Ev123",
    organizationId: "org_1",
    spaceId: CONVERSATION_ID,
    status: "completed",
    submissionId: "sub_slack_1",
    text: COMPLETED_SLACK_MARKDOWN,
    triggerMessageId: CONVERSATION_ID,
  };
}

function createFailedCallbackBody(): RemoteAgentCoreCallbackBody {
  return {
    agentProfileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    callbackAttempt: 1,
    dispatchId: "remote-agent-slack:Ev123",
    failureCode: "remote_agent.turn_not_completed",
    failureMessage:
      "Center Agent could not finish this request. Please try again.",
    idempotencyKey: "remote-agent-slack:T123:Ev123",
    organizationId: "org_1",
    spaceId: CONVERSATION_ID,
    status: "failed",
    submissionId: "sub_slack_1",
    triggerMessageId: CONVERSATION_ID,
  };
}

function createDeadlineProbe(): RemoteAgentNativeDeliveryDeadlineProbeQueueMessage {
  return {
    deadlineAtMs: 1000 + REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS * 1000,
    dispatchId: "remote-agent-slack:Ev123",
    enqueuedAtMs: 1000,
    idempotencyKey: "remote-agent-slack:T123:Ev123",
    kind: "remote_agent_native_delivery_deadline_probe",
    organizationId: "org_1",
    spaceId: CONVERSATION_ID,
    submissionId: "sub_slack_1",
    v: 3,
  };
}
