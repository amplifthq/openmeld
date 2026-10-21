import { PostgresDatabase } from "@openmeld/db/postgresql";
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
import {
  afterEach,
  describe,
  expect,
  it,
  type Mock,
  onTestFinished,
  vi,
} from "vitest";
import type {
  CoreBindings,
  RemoteAgentWorkerBindingRpc,
} from "../src/lib/bindings";
import { REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS } from "../src/remote-agent/application/native-delivery-admission-watchdog";
import {
  completeRemoteAgentNativeDelivery,
  processRemoteAgentNativeDeliveryDeadlineProbe,
  REMOTE_AGENT_EXECUTION_RECONCILIATION_PROCESSING_LEASE_MS,
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
import { SLACK_RICH_CONTEXT_LIMITATION_NOTE } from "../src/remote-agent/application/slack-rich-context";
import { decryptSlackSearchAuthorization } from "../src/remote-agent/application/slack-search-authorization";
import {
  processRemoteAgentSlackEvent,
  runSlackChannelIntroductionTick,
  submitRemoteAgentSlackChannelIntroduction,
} from "../src/remote-agent/application/slack-signal-service";
import { REMOTE_AGENT_SLACK_WORKING_STATUS_REFRESH_INTERVAL_SECONDS } from "../src/remote-agent/application/slack-working-status";
import {
  isLatestRemoteAgentNativeDeliveryActiveForSlackThread,
  markRemoteAgentNativeDeliveryAck,
  readRemoteAgentNativeDeliveryByDeliveryId,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  completeSlackChannelIntroductionAcknowledgement,
  createSlackChannelIntroductionManifest,
} from "../src/remote-agent/infrastructure/postgresql/slack-channel-introduction-repo";
import { readRemoteAgentSlackEventIngress } from "../src/remote-agent/infrastructure/postgresql/slack-event-ingress-repo";
import {
  advanceSlackThreadContextCursor,
  readSlackThreadContextCursor,
} from "../src/remote-agent/infrastructure/postgresql/slack-thread-context-cursor-repo";
import {
  claimSlackIdentityLinkTokenForUser,
  consumeSlackIdentityLinkTokenAndUpsertUserLink,
  insertSlackIdentityLinkToken,
  insertSlackUserIdentityLinkIfAbsent,
  readSlackIdentityLinkTokenForUser,
  readSlackUserIdentityLink,
} from "../src/remote-agent/infrastructure/postgresql/slack-user-identity-link-repo";
import { upsertRemoteAgentSlackWorkspaceBinding } from "../src/remote-agent/infrastructure/postgresql/slack-workspace-binding-repo";
import {
  rpcConnectCenterAgentSlackWorkspace,
  rpcConsumeSlackIdentityLink,
  rpcIssueSlackIdentityLinkFromOAuth,
  rpcPreviewSlackIdentityLink,
} from "../src/rpc/methods";
import {
  createAfterMatchingPostgresTransaction,
  createBeforeMatchingPostgresTransaction,
  createFaultInjectingPostgresDatabase,
  createPostgresHarness,
  installPostgresWriteFailure,
  observeNativePostgresQueries,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

const STATUS_ASSIGNMENT_PATTERN = /\bstatus\s*=\s*\$\d+/u;
const TOKEN_CONSUMPTION_PATTERN = /SET\s+consumed_at_ms/u;

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
  it("explains a private channel selection from a structured introduction failure", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
    const fetchMock = stubSlackFetch({
      conversationsListResponse: {
        channels: [
          {
            id: "C_PRIVATE",
            is_member: true,
            is_private: true,
            name: "leadership",
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
          env: buildEnv(harness.db),
          interactionId: "V_PRIVATE_CHANNEL",
          organizationInviteUrl: null,
          slackTeamId: "T123",
          slackUserId: "U123",
          targetSlackChannelIds: ["C_PRIVATE"],
        })
      ).resolves.toBeUndefined();
      expect(readSlackPostBodies(fetchMock)).toEqual([
        expect.objectContaining({
          text: "Choose public channels here. For a private channel, invite the OpenMeld app there first, then message me its name.",
        }),
      ]);
    } finally {
      await harness.close();
    }
  });
  it("does not expose an internal introduction error because its prose sounds user-facing", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
    const fetchMock = stubSlackFetch({
      conversationsListError: new Error(
        "I can’t expose this internal Slack failure"
      ),
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
          env: buildEnv(harness.db),
          interactionId: "V_INTERNAL_FAILURE",
          organizationInviteUrl: null,
          slackTeamId: "T123",
          slackUserId: "U123",
          targetSlackChannelIds: ["C_PRODUCT"],
        })
      ).resolves.toBeUndefined();
      expect(readSlackPostBodies(fetchMock)).toEqual([
        expect.objectContaining({
          text: "I couldn’t start learning those channels. Open the welcome message and try again. If it still doesn’t work, invite the OpenMeld app to the channel first.",
        }),
      ]);
    } finally {
      await harness.close();
    }
  });
  it("keeps a multi-channel introduction working until every delivery finishes", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await insertSlackUserIdentityLinkIfAbsent({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserId: "U123",
        source: "explicit",
        openmeldUserId: "user_member",
      });
      const env = buildEnv(harness.db, { workerSubmit });
      await expect(
        submitRemoteAgentSlackChannelIntroduction({
          env,
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
        await harness.queryAll({
          text: `SELECT slack_channel_id, status
            FROM "openmeld"."slack_channel_introduction_items"
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
      const [firstDelivery, secondDelivery] = await harness.queryAll<{
        idempotency_key: string;
      }>({
        text: `SELECT idempotency_key
          FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          WHERE idempotency_key ILIKE 'slack-channel-introduction:T123:V_CHANNELS:%'
          ORDER BY delivery_id DESC`,
      });
      const firstRequest = submissions.find(
        (request) => request.idempotencyKey === firstDelivery?.idempotency_key
      );
      const secondRequest = submissions.find(
        (request) => request.idempotencyKey === secondDelivery?.idempotency_key
      );
      expect(firstRequest).toBeDefined();
      expect(secondRequest).toBeDefined();
      if (!(firstRequest && secondRequest)) {
        throw new Error("Expected both channel introduction deliveries");
      }
      await completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallbackForSubmittedRequest({
          request: firstRequest,
          submissionId: `sub_${firstRequest.idempotencyKey}`,
        })
      );
      expect(readSlackThreadStatusBodies(fetchMock).at(-1)).toMatchObject({
        status: "is working on your request…",
      });
      await completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallbackForSubmittedRequest({
          request: secondRequest,
          submissionId: `sub_${secondRequest.idempotencyKey}`,
        })
      );
      expect(readSlackThreadStatusBodies(fetchMock).at(-1)).toMatchObject({
        status: "",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps a recovered mixed-version multi-channel introduction working across submission ticks", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
        nowMs: 900,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await createSlackChannelIntroductionManifest({
        channels: [
          {
            botWasChannelMember: true,
            slackChannelId: "C_PRODUCT",
            slackChannelName: "product",
          },
          {
            botWasChannelMember: true,
            slackChannelId: "C_DESIGN",
            slackChannelName: "design",
          },
        ],
        db: harness.db,
        dmChannelId: "D_OPENMELD",
        interactionId: "V_CHANNELS_RECOVERED",
        nowMs: 1000,
        organizationId: "org_1",
        organizationInviteUrl: null,
        requesterSlackUserId: "U123",
        slackTeamId: "T123",
      });
      await completeSlackChannelIntroductionAcknowledgement({
        acknowledgementTs: "1710000001.000200",
        db: harness.db,
        interactionId: "V_CHANNELS_RECOVERED",
        nowMs: 1100,
      });
      const env = buildEnv(harness.db, { workerSubmit });
      await expect(
        runSlackChannelIntroductionTick({
          db: harness.db,
          env,
          interactionId: "V_CHANNELS_RECOVERED",
          limit: 1,
          nowMs: 1200,
        })
      ).resolves.toEqual({ failed: 0, outcomeUnknown: 0, submitted: 1 });
      await harness.query({
        values: [
          "slack-channel-introduction:T123:V_CHANNELS_RECOVERED:C_PRODUCT",
        ],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET slack_working_status_turn_id = NULL
          WHERE idempotency_key = $1
        `,
      });
      await expect(
        runSlackChannelIntroductionTick({
          db: harness.db,
          env,
          interactionId: "V_CHANNELS_RECOVERED",
          limit: 1,
          nowMs: 2200,
        })
      ).resolves.toEqual({ failed: 0, outcomeUnknown: 0, submitted: 1 });
      const submissions = workerSubmit.mock.calls.map(([request]) => request);
      const firstRequest = submissions[0];
      const recoveredRequest = submissions[1];
      expect(firstRequest).toBeDefined();
      expect(recoveredRequest).toBeDefined();
      if (!(firstRequest && recoveredRequest)) {
        throw new Error(
          "Expected both recovered channel introduction deliveries"
        );
      }
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: firstRequest.bindingId,
        conversationKind: "slack",
        db: harness.db,
        deliveryId: "delivery_late_legacy_introduction_sibling",
        dispatchId: "dispatch_late_legacy_introduction_sibling",
        idempotencyKey:
          "slack-channel-introduction:T123:V_CHANNELS_RECOVERED:C_LATE",
        nowMs: 3200,
        organizationId: firstRequest.organizationId,
        profileId: firstRequest.agentProfileId,
        slackChannelId: "D_OPENMELD",
        slackTeamId: "T123",
        slackThreadTs: "1710000001.000200",
        spaceId: firstRequest.spaceId,
        status: "completed",
        triggerMessageId: "1710000001.000200",
      });
      await expect(
        isLatestRemoteAgentNativeDeliveryActiveForSlackThread({
          channelId: "D_OPENMELD",
          db: harness.db,
          organizationId: "org_1",
          teamId: "T123",
          threadTs: "1710000001.000200",
        })
      ).resolves.toBe(true);
      await completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallbackForSubmittedRequest({
          request: recoveredRequest,
          submissionId: `sub_${recoveredRequest.idempotencyKey}`,
        })
      );
      expect(readSlackThreadStatusBodies(fetchMock).at(-1)).toMatchObject({
        status: "is working on your request…",
      });
      await completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallbackForSubmittedRequest({
          request: firstRequest,
          submissionId: `sub_${firstRequest.idempotencyKey}`,
        })
      );
      expect(readSlackThreadStatusBodies(fetchMock).at(-1)).toMatchObject({
        status: "",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps a newer DM turn working when an older channel introduction finishes", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      await submitRemoteAgentSlackChannelIntroduction({
        env: buildEnv(harness.db, { workerSubmit }),
        interactionId: "V_CHANNEL_THEN_DM",
        organizationInviteUrl: "https://openmeld.ai/join/openmeld-test",
        slackTeamId: "T123",
        slackUserId: "U123",
        targetSlackChannelIds: ["C_PRODUCT"],
      });
      expect(workerSubmit).toHaveBeenCalledOnce();
      const introductionRequest = workerSubmit.mock.calls[0]?.[0];
      expect(introductionRequest).toBeDefined();
      if (!introductionRequest) {
        throw new Error("Expected the channel introduction to be submitted");
      }
      const newerTriggerMessageId = "1710000002.000300";
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: introductionRequest.bindingId,
        conversationKind: "slack",
        db: harness.db,
        dispatchId: "remote-agent-slack:EvAfterIntroduction",
        idempotencyKey: "remote-agent-slack:T123:EvAfterIntroduction",
        nowMs: 2000,
        organizationId: introductionRequest.organizationId,
        profileId: introductionRequest.agentProfileId,
        slackChannelId: "D_OPENMELD",
        slackTeamId: "T123",
        slackThreadTs: "1710000001.000200",
        spaceId: introductionRequest.spaceId,
        status: "submitted",
        triggerMessageId: newerTriggerMessageId,
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "remote-agent-slack:T123:EvAfterIntroduction",
        nowMs: 2100,
        submissionId: "sub_after_introduction",
        workerRequestId: "req_after_introduction",
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db, { workerSubmit }),
          createCompletedCallbackForSubmittedRequest({
            request: introductionRequest,
            submissionId: `sub_${introductionRequest.idempotencyKey}`,
          })
        )
      ).resolves.toMatchObject({ status: "accepted" });
      expect(readSlackThreadStatusBodies(fetchMock).at(-1)).toMatchObject({
        status: "is working on your request…",
      });
    } finally {
      await harness.close();
    }
  });
  it("continues channel introductions when the first acknowledgement checkpoint write fails", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      const db = createFaultInjectingPostgresDatabase({
        db: harness.db,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_channel_introduction_runs"') &&
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
        await harness.queryFirst({
          text: `SELECT status, acknowledgement_ts, failure_code
            FROM "openmeld"."slack_channel_introduction_runs"
            WHERE interaction_id = 'V_CHANNEL_CHECKPOINT'`,
        })
      ).toEqual({
        acknowledgement_ts: "1710000001.000200",
        failure_code: null,
        status: "ready",
      });
      expect(
        await harness.queryFirst({
          text: `SELECT status
            FROM "openmeld"."slack_channel_introduction_items"
            WHERE interaction_id = 'V_CHANNEL_CHECKPOINT'`,
        })
      ).toEqual({ status: "submitted" });
    } finally {
      await harness.close();
    }
  });
  it("recovers a submitted channel introduction when its item checkpoint stays unavailable", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      const db = createFaultInjectingPostgresDatabase({
        db: harness.db,
        failureCount: 2,
        matches: (sql) =>
          sql.includes(
            'UPDATE "openmeld"."slack_channel_introduction_items"'
          ) &&
          STATUS_ASSIGNMENT_PATTERN.test(sql) &&
          sql.includes("AND claim_id ="),
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
      const pendingCheckpoint = await harness.queryFirst<{
        status: string;
        updated_at_ms: number;
      }>({
        text: `SELECT status, updated_at_ms
          FROM "openmeld"."slack_channel_introduction_items"
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
        await harness.queryFirst({
          text: `SELECT status, failure_code
            FROM "openmeld"."slack_channel_introduction_items"
            WHERE interaction_id = 'V_CHANNEL_ITEM_CHECKPOINT'`,
        })
      ).toEqual({ failure_code: null, status: "submitted" });
    } finally {
      await harness.close();
    }
  });
  it("reconciles a confirmed acknowledgement after its checkpoint stays unavailable", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      const db = createFaultInjectingPostgresDatabase({
        db: harness.db,
        failureCount: 2,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_channel_introduction_runs"') &&
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
      const submittedAtMs = await readSlackChannelIntroductionCreatedAtMs(
        harness,
        "V_CHANNEL_DURABLE_RECOVERY"
      );
      expect(workerSubmit).not.toHaveBeenCalled();
      expect(
        await harness.queryFirst({
          text: `SELECT status, acknowledgement_ts, failure_code
            FROM "openmeld"."slack_channel_introduction_runs"
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
        await harness.queryFirst({
          text: `SELECT status, acknowledgement_ts, failure_code
            FROM "openmeld"."slack_channel_introduction_runs"
            WHERE interaction_id = 'V_CHANNEL_DURABLE_RECOVERY'`,
        })
      ).toEqual({
        acknowledgement_ts: "1710000001.000200",
        failure_code: null,
        status: "ready",
      });
      expect(readSlackPostBodies(fetchMock)).toHaveLength(1);
    } finally {
      await harness.close();
    }
  });
  it("publishes one durable retry action when concurrent ticks cannot find the acknowledgement", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      const db = createFaultInjectingPostgresDatabase({
        db: harness.db,
        failureCount: 2,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_channel_introduction_runs"') &&
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
      const submittedAtMs = await readSlackChannelIntroductionCreatedAtMs(
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
        await harness.queryFirst({
          text: `SELECT status, recovery_notice_ts
            FROM "openmeld"."slack_channel_introduction_runs"
            WHERE interaction_id = 'V_CHANNEL_MISSING_ACK'`,
        })
      ).toEqual({
        recovery_notice_ts: "1710000002.000300",
        status: "recovery_notice_delivered",
      });
    } finally {
      await harness.close();
    }
  });
  it("retries a recovery notice that Slack explicitly did not publish", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      const db = createFaultInjectingPostgresDatabase({
        db: harness.db,
        failureCount: 2,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_channel_introduction_runs"') &&
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
      const submittedAtMs = await readSlackChannelIntroductionCreatedAtMs(
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
        await harness.queryFirst({
          text: `SELECT status, recovery_notice_attempt_count
            FROM "openmeld"."slack_channel_introduction_runs"
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
        await harness.queryFirst({
          text: `SELECT status, recovery_notice_ts, recovery_notice_attempt_count
            FROM "openmeld"."slack_channel_introduction_runs"
            WHERE interaction_id = 'V_CHANNEL_RETRY_NOTICE'`,
        })
      ).toEqual({
        recovery_notice_attempt_count: 2,
        recovery_notice_ts: "1710000003.000400",
        status: "recovery_notice_delivered",
      });
    } finally {
      await harness.close();
    }
  });
  it("reconciles a confirmed recovery notice after its checkpoint stays unavailable", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      const acknowledgementCheckpointDb = createFaultInjectingPostgresDatabase({
        db: harness.db,
        failureCount: 2,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_channel_introduction_runs"') &&
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
      const submittedAtMs = await readSlackChannelIntroductionCreatedAtMs(
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
      const recoveryCheckpointDb = createFaultInjectingPostgresDatabase({
        db: harness.db,
        failureCount: 2,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_channel_introduction_runs"') &&
          sql.includes("status = 'recovery_notice_delivered'"),
      });
      await runSlackChannelIntroductionTick({
        db: recoveryCheckpointDb,
        env: buildEnv(recoveryCheckpointDb, { workerSubmit }),
        interactionId: "V_CHANNEL_RECOVERY_CHECKPOINT",
        nowMs: recoveryNowMs,
      });
      expect(
        await harness.queryFirst({
          text: `SELECT status, recovery_notice_ts
            FROM "openmeld"."slack_channel_introduction_runs"
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
        await harness.queryFirst({
          text: `SELECT status, recovery_notice_ts, recovery_notice_attempt_count
            FROM "openmeld"."slack_channel_introduction_runs"
            WHERE interaction_id = 'V_CHANNEL_RECOVERY_CHECKPOINT'`,
        })
      ).toEqual({
        recovery_notice_attempt_count: 1,
        recovery_notice_ts: "1710000004.000500",
        status: "recovery_notice_delivered",
      });
    } finally {
      await harness.close();
    }
  });
  it("does not replay a recovery notice when Slack publication is ambiguous", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      const acknowledgementCheckpointDb = createFaultInjectingPostgresDatabase({
        db: harness.db,
        failureCount: 2,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_channel_introduction_runs"') &&
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
      const submittedAtMs = await readSlackChannelIntroductionCreatedAtMs(
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
        await harness.queryFirst({
          text: `SELECT status, recovery_notice_attempt_count
            FROM "openmeld"."slack_channel_introduction_runs"
            WHERE interaction_id = 'V_CHANNEL_AMBIGUOUS_NOTICE'`,
        })
      ).toEqual({
        recovery_notice_attempt_count: 1,
        status: "recovery_notice_outcome_unknown",
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps each Slack thread context cursor monotonic", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
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
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      conversationsHistoryResponse: {
        ok: true,
        messages: [
          {
            ts: "1710000000.000100",
            text: "<@B123> create a Codex agent",
            user: "U123",
          },
        ],
      },
    });
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
      expect(queueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: "remote-agent-slack:Ev123",
          submissionId: "sub_slack_1",
        }),
        {
          delaySeconds:
            REMOTE_AGENT_SLACK_WORKING_STATUS_REFRESH_INTERVAL_SECONDS,
        }
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
        source: "explicit",
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
      await harness.close();
    }
  });
  it("accepts a human Slack app DM as a private Center Agent conversation", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("submits file-only Slack DMs with structured file and image evidence", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_dm_files",
        status: "pending" as const,
        submissionId: "sub_slack_dm_files",
      })
    );
    stubSlackFetch({
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
            eventId: "EvDmFiles",
            files: [
              {
                id: "F_DOCUMENT",
                mimetype: "text/markdown",
                name: "requirements.md",
                permalink:
                  "https://openmeld-dev.slack.com/files/U123/F_DOCUMENT/requirements",
                size: 321,
              },
              {
                id: "F_IMAGE",
                mimetype: "image/png",
                name: "wireframe.png",
                permalink:
                  "https://openmeld-dev.slack.com/files/U123/F_IMAGE/wireframe",
                size: 654,
              },
            ],
            subtype: "file_share",
            text: "",
          })
        )
      ).resolves.toEqual({ status: "processed" });
      const submitted = workerSubmit.mock.calls[0]?.[0];
      expect(submitted?.messages).toEqual([
        {
          content: expect.stringContaining(
            '"fileId":"F_DOCUMENT","mimeType":"text/markdown","name":"requirements.md"'
          ),
          role: "user",
        },
      ]);
      expect(submitted?.messages[0]?.content).toContain(
        '"fileId":"F_IMAGE","mimeType":"image/png","name":"wireframe.png"'
      );
      expect(submitted?.messages[0]?.content).toContain(
        "Slack attachment metadata (untrusted data"
      );
      expect(submitted?.messages[0]?.content).not.toContain(
        "Help me with this Slack thread."
      );
      expect(submitted?.turnEnvelope.trigger).toMatchObject({
        channelId: "D123",
        source: "slack",
      });
    } finally {
      await harness.close();
    }
  });
  it("recovers a content-empty app mention from an exact reply and logs only safe structure", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_forwarded",
        status: "pending" as const,
        submissionId: "sub_slack_forwarded",
      })
    );
    const fetchMock = stubSlackFetch({
      conversationsRepliesResponse: (url) => {
        if (url.searchParams.get("limit") !== "1") {
          return { ok: true, messages: [] };
        }
        expect(url.searchParams.get("channel")).toBe("C123");
        expect(url.searchParams.get("oldest")).toBe("1710000000.000100");
        expect(url.searchParams.get("latest")).toBe("1710000000.000100");
        expect(url.searchParams.get("ts")).toBe("1709999999.000050");
        expect(
          fetchMock.mock.calls.some(([request]) =>
            String(request).includes("/assistant.threads.setStatus")
          )
        ).toBe(true);
        expect(url.searchParams.get("inclusive")).toBe("true");
        expect(url.searchParams.get("limit")).toBe("1");
        return {
          messages: [
            {
              blocks: [{ type: "rich_text" }],
              files: [
                {
                  id: "F_FORWARD",
                  mimetype: "image/png",
                  name: "forwarded.png",
                  permalink:
                    "https://openmeld-dev.slack.com/files/U123/F_FORWARD/forwarded",
                  size: 2048,
                },
              ],
              text: "Forwarded launch details",
              ts: "1710000000.000100",
              user: "U123",
            },
          ],
          ok: true,
        };
      },
      email: "ari@example.test",
    });
    const consoleInfoSpy = vi
      .spyOn(console, "info")
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
          buildEnv(harness.db, {
            richContextReproEnabled: "true",
            workerSubmit,
          }),
          createAppMentionPayload({
            eventId: "EvForwarded",
            text: "",
            threadTs: "1709999999.000050",
          })
        )
      ).resolves.toEqual({ status: "processed" });
      const submitted = workerSubmit.mock.calls[0]?.[0];
      expect(submitted?.messages[0]?.content).toContain(
        "Forwarded launch details"
      );
      expect(submitted?.messages[0]?.content).toContain('"fileId":"F_FORWARD"');
      expect(consoleInfoSpy).toHaveBeenCalledWith(
        "[core.remote_agent.slack_ingest.rich_context_repro]",
        expect.objectContaining({
          channelId: "C123",
          event: "core.remote_agent.slack_ingest.rich_context_repro",
          eventId: "EvForwarded",
          history: expect.objectContaining({
            status: "complete",
            observation: expect.objectContaining({
              matchingMessageCount: 1,
              messageCount: 1,
            }),
          }),
          rawEvent: expect.objectContaining({
            filesCount: 0,
            hasPermalink: false,
            textLen: 0,
          }),
        })
      );
      const reproLog = consoleInfoSpy.mock.calls.find(
        ([prefix]) =>
          prefix === "[core.remote_agent.slack_ingest.rich_context_repro]"
      );
      expect(JSON.stringify(reproLog)).not.toContain(
        "Forwarded launch details"
      );
      expect(JSON.stringify(reproLog)).not.toContain(
        "https://openmeld-dev.slack.com/files"
      );
      expect(
        fetchMock.mock.calls
          .map(([request]) => new URL(String(request)))
          .filter(
            (url) =>
              url.pathname === "/api/conversations.replies" &&
              url.searchParams.get("limit") === "1"
          )
      ).toHaveLength(1);
    } finally {
      consoleInfoSpy.mockRestore();
      await harness.close();
    }
  });
  it("adds quoted Slack message text and files from an exact permalink lookup", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_quote",
        status: "pending" as const,
        submissionId: "sub_slack_quote",
      })
    );
    const mentionText =
      "<@B123> use <https://acme.slack.com/archives/C123/p1709999999000200|this quoted message>";
    const fetchMock = stubSlackFetch({
      conversationsHistoryResponse: (url) => {
        if (url.searchParams.get("oldest") === "1709999999.000200") {
          expect(url.searchParams.get("oldest")).toBe("1709999999.000200");
          return {
            messages: [
              {
                files: [
                  {
                    id: "F_QUOTED",
                    mimetype: "application/pdf",
                    name: "quoted-plan.pdf",
                    permalink:
                      "https://acme.slack.com/files/U_OTHER/F_QUOTED/quoted-plan",
                    size: 4096,
                  },
                ],
                text: "Quoted launch plan",
                ts: "1709999999.000200",
                user: "U_OTHER",
              },
            ],
            ok: true,
          };
        }
        return {
          messages: [
            {
              text: mentionText,
              ts: "1710000000.000100",
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
            eventId: "EvQuote",
            text: mentionText,
            threadTs: "1710000000.000100",
          })
        )
      ).resolves.toEqual({ status: "processed" });
      const submitted = workerSubmit.mock.calls[0]?.[0];
      expect(submitted?.messages[0]?.content).toContain(
        "Slack quoted message context (untrusted data)"
      );
      expect(submitted?.messages[0]?.content).toContain("Quoted launch plan");
      expect(submitted?.messages[0]?.content).toContain('"fileId":"F_QUOTED"');
      expect(submitted?.turnEnvelope.channelContext?.sync.status).toBe(
        "complete"
      );
      expect(
        fetchMock.mock.calls
          .map(([request]) => new URL(String(request)))
          .filter((url) => url.pathname === "/api/conversations.history")
          .map((url) => url.searchParams.get("channel"))
      ).toEqual(["C123", "C123"]);
    } finally {
      await harness.close();
    }
  });
  it("marks forwarded mention context incomplete when exact history is also empty", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_forward_empty",
        status: "pending" as const,
        submissionId: "sub_slack_forward_empty",
      })
    );
    stubSlackFetch({
      conversationsHistoryResponse: {
        messages: [
          {
            files: [],
            text: "",
            ts: "1710000000.000100",
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
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload({
            eventId: "EvForwardedEmpty",
            text: "",
            threadTs: "1709999999.000050",
          })
        )
      ).resolves.toEqual({ status: "processed" });
      const submitted = workerSubmit.mock.calls[0]?.[0];
      expect(submitted?.messages[0]?.content).toContain(
        "Help me with this Slack thread."
      );
      expect(submitted?.messages[0]?.content).toContain(
        SLACK_RICH_CONTEXT_LIMITATION_NOTE
      );
      expect(submitted?.turnEnvelope.channelContext).toMatchObject({
        messages: [],
        sync: { mode: "snapshot", status: "unavailable" },
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps the main mention processing and marks rich context unavailable when lookups fail", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_request: RemoteAgentWorkerSubmitTurnRequest) => ({
        accepted: true,
        createdAt: 1_710_000_001,
        requestId: "req_slack_quote_limited",
        status: "pending" as const,
        submissionId: "sub_slack_quote_limited",
      })
    );
    const mentionText =
      "<@B123> check https://acme.slack.com/archives/C_SOURCE/p1709999999000200";
    stubSlackFetch({
      conversationsHistoryResponse: new Response(
        JSON.stringify({ error: "missing_scope", ok: false }),
        { status: 403 }
      ),
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
            eventId: "EvQuoteLimited",
            text: mentionText,
            threadTs: "1709999999.000050",
          })
        )
      ).resolves.toEqual({ status: "processed" });
      const submitted = workerSubmit.mock.calls[0]?.[0];
      expect(submitted?.messages[0]?.content).toContain(mentionText);
      expect(submitted?.messages[0]?.content).toContain(
        SLACK_RICH_CONTEXT_LIMITATION_NOTE
      );
      expect(submitted?.turnEnvelope.channelContext).toMatchObject({
        messages: [],
        sync: { mode: "snapshot", status: "forbidden" },
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps follow-up fragments and Slack evidence in one durable Center Agent turn", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      await harness.close();
    }
  });
  it("keeps a Slack app DM reply inside the thread the user continued", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("continues routing an existing historical Personal Workspace Slack binding", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await harness.query({
      values: [JSON.stringify({ personal: true }), "org_1"],
      text: 'UPDATE "openmeld"."organizations" SET metadata = $1 WHERE id = $2',
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
      await harness.close();
    }
  });
  it("replies once when the selected Center Agent model is unavailable", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await harness.query({
      values: ["retired/provider-model", "binding_1"],
      text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET model_id = $1
        WHERE binding_id = $2
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
      await harness.close();
    }
  });
  it("does not route Slack work through a damaged hosted Binding", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await harness.query({
      values: ["wrong-thread", "binding_1"],
      text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET agent_controller_conversation_id = $1
        WHERE binding_id = $2
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
          text: "Center Agent is not connected for this OpenMeld organization yet.",
          thread_ts: "1710000000.000100",
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("keeps a top-level Slack DM failure in the request thread", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await harness.query({
      values: ["retired/provider-model", "binding_1"],
      text: `
        UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
        SET model_id = $1
        WHERE binding_id = $2
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
      await harness.close();
    }
  });
  it("keeps event-bound Slack search authorization inside the durable turn", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      await harness.close();
    }
  });
  it("syncs the root and unmentioned thread replies without duplicating the current mention", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_input: {
        turnEnvelope: {
          channelContext?: unknown;
        };
      }) => ({
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
        if (url.searchParams.get("limit") === "1") {
          return {
            ok: true,
            messages: [
              {
                ts: oldest,
                user: "U123",
                text:
                  oldest === firstMentionTs
                    ? "<@B123> diagnose the build above"
                    : "<@B123> turn this fix into a checklist",
              },
            ],
          };
        }
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
        .filter(
          (url) =>
            url.pathname === "/api/conversations.replies" &&
            url.searchParams.get("limit") !== "1"
        );
      expect(repliesUrls).toHaveLength(2);
      expect(repliesUrls[0]?.searchParams.get("latest")).toBe(firstMentionTs);
      expect(repliesUrls[0]?.searchParams.get("oldest")).toBeNull();
      expect(repliesUrls[1]?.searchParams.get("latest")).toBe(secondMentionTs);
      expect(repliesUrls[1]?.searchParams.get("oldest")).toBe(firstMentionTs);
    } finally {
      await harness.close();
    }
  });
  it("hydrates recent channel context for a root Slack mention", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_input: {
        turnEnvelope: {
          channelContext?: unknown;
        };
      }) => ({
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
          {
            files: [
              {
                id: "F_PLAN",
                mimetype: "image/png",
                name: "daily-loop.png",
                permalink:
                  "https://openmeld-dev.slack.com/files/U_OTHER/F_PLAN/daily-loop",
                size: 2048,
              },
            ],
            text: null,
            ts: "1710000010.000350",
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
            id: "1710000010.000350",
            author: { kind: "human", id: "U_OTHER" },
            sentAtMs: 1_710_000_010_000,
            text: "Slack file attached; fileId=F_PLAN; name=daily-loop.png; mimeType=image/png; sizeBytes=2048; permalink=https://openmeld-dev.slack.com/files/U_OTHER/F_PLAN/daily-loop",
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
      expect(historyUrls).toHaveLength(2);
      expect(historyUrls[0]?.searchParams.get("channel")).toBe("C123");
      expect(historyUrls[0]?.searchParams.get("oldest")).toBe(currentMentionTs);
      expect(historyUrls[0]?.searchParams.get("inclusive")).toBe("true");
      expect(historyUrls[0]?.searchParams.get("limit")).toBe("1");
      expect(historyUrls[1]?.searchParams.get("channel")).toBe("C123");
      expect(historyUrls[1]?.searchParams.get("latest")).toBe(currentMentionTs);
      expect(historyUrls[1]?.searchParams.get("limit")).toBe("8");
    } finally {
      await harness.close();
    }
  });
  it("continues the current request with explicit rate-limited context", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(
      async (_input: {
        turnEnvelope: {
          channelContext?: unknown;
        };
      }) => ({
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
      await harness.close();
    }
  });
  it("does not advance Slack thread context after failed worker admission", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("continues admitted work when Slack cannot show the thread status", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("lets only one concurrent delivery of the same Slack event enter model admission", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
        new Promise<{
          status: "timed_out";
        }>((resolve) => setTimeout(() => resolve({ status: "timed_out" }), 25)),
      ]);
      workerAck.resolve();
      await Promise.allSettled([first, second]);
      expect(secondBeforeFirstAck).toEqual({ status: "duplicate" });
      expect(workerSubmit).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("continues without a channel name when Slack denies conversation details", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("stops waiting for a Slack channel name without delaying message handling", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      consoleWarnSpy.mockRestore();
      await harness.close();
    }
  });
  it("retries identity lookup failures before durably settling the final attempt", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("redrives a failed ingress after its failure notice could not be published", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("does not redrive an admission failure when Slack publication is outcome unknown", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("keeps an unlinked same-email Slack workspace member anonymous", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1_710_000_001,
      requestId: "req_slack_guest",
      status: "pending" as const,
      submissionId: "sub_slack_guest",
    }));
    const fetchMock = stubSlackFetch({
      displayName: "Workspace member",
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
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toBeNull();
    } finally {
      await harness.close();
    }
  });
  it.each([
    { isRestricted: true, label: "multi-channel guest" },
    { isUltraRestricted: true, label: "single-channel guest" },
  ])("keeps a Slack $label outside self-join eligibility", async (identity) => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("keeps a Slack Connect participant external to the installed workspace", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("uses an explicit Slack identity link before falling back to Slack email", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("lets a verified Slack member request a fresh account-connection action", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await expect(
        completeRemoteAgentNativeDelivery(buildEnv(harness.db), {
          ...createCompletedCallbackBody(),
          navigationTarget: {
            kind: "message_channel_identity_link",
            purpose: "optional_setup",
          },
          text: "You can manage your connected Slack account from your profile.",
          triggerMessageId: "1710000000.000100",
        })
      ).resolves.toEqual({
        status: "accepted",
        publishedSignalId: "1710000001.000200",
      });
      const postBodies = readSlackPostBodies(fetchMock) as {
        blocks?: {
          elements?: {
            url?: string;
          }[];
        }[];
        channel?: string;
      }[];
      expect(postBodies).toHaveLength(2);
      expect(postBodies[0]).toMatchObject({ channel: "C123" });
      expect(postBodies[1]).toMatchObject({ channel: "U123" });
      const linkUrl = postBodies[1]?.blocks?.[1]?.elements?.[0]?.url;
      expect(linkUrl).toMatch(SLACK_IDENTITY_LINK_URL_PATTERN);
      const token = new URL(linkUrl ?? "").searchParams.get("token");
      await expect(
        harness.db
          .query({
            ...{
              text: `
              SELECT claimed_by_user_id, source_delivery_id
              FROM "openmeld"."slack_user_identity_link_tokens"
              WHERE token_hash = $1
            `,
              values: [],
            },
            values: [await digestSlackIdentityLinkToken(token ?? "")],
          })
          .then((result) => result.rows[0] ?? null)
      ).resolves.toEqual({
        claimed_by_user_id: null,
        source_delivery_id: null,
      });
    } finally {
      await harness.close();
    }
  });
  it.each([
    "metadata",
    "token_preparation",
    "not_published",
    "unknown",
  ] as const)("classifies private Plugin guidance %s without rerunning the task or public reply", async (mode) => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSlackIdentityLink(harness);
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
      await expect(
        processRemoteAgentSlackEvent(
          buildEnv(harness.db, { workerSubmit }),
          createAppMentionPayload()
        )
      ).resolves.toEqual({ status: "processed" });
      let preparationFailures = 0;
      let privateAttempts = 0;
      const faultDb = createFaultInjectingPostgresDatabase({
        db: harness.db,
        matches: (sql) => {
          if (
            mode !== "metadata" ||
            !sql.includes("SELECT plugin_connection_metadata_json FROM")
          ) {
            return false;
          }
          preparationFailures += 1;
          return true;
        },
      });
      const env = buildEnv(faultDb);
      vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
        const body =
          typeof init?.body === "string" ? JSON.parse(init.body) : null;
        if (
          String(url).includes("/chat.postMessage") &&
          body?.channel === "U123"
        ) {
          privateAttempts += 1;
          if (mode === "unknown") {
            throw new Error("response lost after request");
          }
          if (mode === "not_published") {
            return Response.json(
              { ok: false, error: "ratelimited" },
              { status: 429, headers: { "retry-after": "2" } }
            );
          }
        }
        const response = await fetchMock(url, init);
        if (
          mode === "token_preparation" &&
          String(url).includes("/chat.postMessage") &&
          body?.channel === "C123"
        ) {
          env.SLACK_OPENMELD_BOT_TOKEN = undefined;
        }
        return response;
      });
      const body = {
        ...createCompletedCallbackBody(),
        navigationTarget: {
          kind: "plugin_connection" as const,
          service: "github" as const,
          scope: "choose" as const,
        },
        text: "Connect GitHub to continue.",
        triggerMessageId: "1710000000.000100",
      };
      const result = await completeRemoteAgentNativeDelivery(env, body);
      const posts = readSlackPostBodies(fetchMock) as {
        channel?: string;
      }[];
      expect(posts.filter((post) => post.channel === "C123")).toHaveLength(1);
      expect(posts.filter((post) => post.channel === "U123")).toHaveLength(0);
      expect(preparationFailures).toBe(mode === "metadata" ? 1 : 0);
      expect(privateAttempts).toBe(
        mode === "unknown" || mode === "not_published" ? 1 : 0
      );
      expect(workerSubmit).toHaveBeenCalledOnce();
      if (mode === "unknown") {
        // The callback settles the public result, explicitly not private delivery;
        // it must not schedule a blind resend of a possibly published message.
        expect(result).toMatchObject({
          status: "accepted",
          reasonCode: "slack.private_navigation_outcome_unknown",
        });
        expect(result.retryAfterMs).toBeUndefined();
      } else {
        expect(result).toMatchObject({
          status: "retryable",
          reasonCode:
            mode === "not_published"
              ? "slack.private_navigation_ratelimited"
              : "slack.private_navigation_preparation_failed",
        });
        if (mode === "not_published") {
          expect(result.retryAfterMs).toBe(2000);
        }
        vi.stubGlobal("fetch", fetchMock);
        env.SLACK_OPENMELD_BOT_TOKEN = "xoxb-test";
        await expect(
          completeRemoteAgentNativeDelivery(env, body)
        ).resolves.toMatchObject({
          status: "duplicate_rejected",
          publishedSignalId: "1710000001.000200",
        });
        const recovered = readSlackPostBodies(fetchMock) as {
          channel?: string;
        }[];
        expect(
          recovered.filter((post) => post.channel === "C123")
        ).toHaveLength(1);
        expect(
          recovered.filter((post) => post.channel === "U123")
        ).toHaveLength(1);
        expect(workerSubmit).toHaveBeenCalledOnce();
      }
    } finally {
      await harness.close();
    }
  });
  it("privately gives the verified Slack requester the exact computer setup action", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("repairs a stale Slack identity link after its workspace moves to another organization", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("invalidates a stale Slack identity link when its user is not in the moved workspace organization", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedNonMemberUser(harness);
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
      await harness.close();
    }
  });
  it("keeps a removed linked Slack user as an anonymous member", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.query({
        values: ["member_1"],
        text: 'DELETE FROM "openmeld"."members" WHERE id = $1',
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
      await harness.close();
    }
  });
  it("pre-claims a Slack connection token for the account selected by Center Agent", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("issues a verified Slack identity link only for the Organization workspace", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      const result = await rpcIssueSlackIdentityLinkFromOAuth(
        buildEnv(harness.db),
        {
          actorProfileId: "22222222-2222-4222-8222-222222222222",
          organizationId: "org_1",
          slackAccountEmail: "ari@amplift.ai",
          slackTeamId: "T123",
          slackUserId: "U123",
          userId: "user_member",
        }
      );
      expect(result).toMatchObject({
        openMeldProfileId: "22222222-2222-4222-8222-222222222222",
        organizationSlug: "openmeld-labs",
      });
      await expect(
        rpcPreviewSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token: result.token,
        })
      ).resolves.toMatchObject({
        alreadyMember: true,
        organizationId: "org_1",
        slackAccountEmail: "ari@amplift.ai",
        slackTeamId: "T123",
        slackUserId: "U123",
      });
      await expect(
        rpcIssueSlackIdentityLinkFromOAuth(buildEnv(harness.db), {
          actorProfileId: "22222222-2222-4222-8222-222222222222",
          organizationId: "org_1",
          slackAccountEmail: "ari@amplift.ai",
          slackTeamId: "T_OTHER",
          slackUserId: "U123",
          userId: "user_member",
        })
      ).rejects.toMatchObject({
        code: "slack.identity_workspace_mismatch",
        status: 409,
      });
    } finally {
      await harness.close();
    }
  });
  it("moves a Slack account after the Slack user proves control with a private token", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    stubSlackFetch({ email: "ari@example.test" });
    const token = `slacklink_${"5".repeat(64)}`;
    const nowMs = Date.now();
    try {
      await harness.query({
        values: ["user_old", "Old member", "old@example.test", 1, 100, 100],
        text: `
          INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
      });
      await harness.query({
        values: ["member_old", "org_1", "user_old", "member", 100],
        text: `
          INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
          VALUES ($1, $2, $3, $4, $5)
        `,
      });
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
        openmeldUserId: "user_old",
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
        tokenHash: await digestSlackIdentityLinkToken(token),
      });
      await expect(
        rpcPreviewSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({ replacesExistingLink: true });
      await expect(
        rpcConsumeSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({
        linked: true,
        replacedExistingLink: true,
        openMeldUserId: "user_member",
      });
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toMatchObject({ openmeldUserId: "user_member" });
    } finally {
      await harness.close();
    }
  });
  it("derives Slack replacement audit from the canonical link inside the consume batch", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    stubSlackFetch({ email: "ari@example.test" });
    const token = `slacklink_${"7".repeat(64)}`;
    const nowMs = Date.now();
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
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: nowMs + 60_000,
        issuedAtMs: nowMs - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: await digestSlackIdentityLinkToken(token),
      });
      const racingDb = createBeforeMatchingPostgresTransaction({
        beforeTransaction: async () => {
          await harness.query({
            text: `
              UPDATE "openmeld"."slack_user_identity_links"
              SET openmeld_user_id = 'user_concurrent'
              WHERE slack_team_id = 'T123' AND slack_user_id = 'U123'
            `,
          });
        },
        db: harness.db,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_user_identity_link_tokens"') &&
          sql.includes("consume_nonce"),
      });
      await expect(
        rpcConsumeSlackIdentityLink(buildEnv(racingDb), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({
        linked: true,
        replacedExistingLink: true,
        openMeldUserId: "user_member",
      });
      expect(
        await harness.queryFirst<{
          audit_count: number;
        }>({
          text: `
            SELECT COUNT(*) AS audit_count
            FROM "openmeld"."center_agent_audit_journal"
            WHERE action = 'replace_message_channel_identity_link'
          `,
        })
      ).toEqual({ audit_count: 1 });
    } finally {
      await harness.close();
    }
  });
  it("rolls back a Slack identity replacement when its audit write fails", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    stubSlackFetch({ email: "ari@example.test" });
    const token = `slacklink_${"6".repeat(64)}`;
    const nowMs = Date.now();
    try {
      await harness.query({
        values: ["user_old", "Old member", "old@example.test", 1, 100, 100],
        text: `
          INSERT INTO "openmeld"."users" (id, name, email, email_verified, created_at, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `,
      });
      await harness.query({
        values: ["member_old", "org_1", "user_old", "member", 100],
        text: `
          INSERT INTO "openmeld"."members" (id, organization_id, user_id, role, created_at)
          VALUES ($1, $2, $3, $4, $5)
        `,
      });
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
        openmeldUserId: "user_old",
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
        tokenHash: await digestSlackIdentityLinkToken(token),
      });
      const removeAuditFault = await installPostgresWriteFailure({
        harness,
        table: "center_agent_audit_journal",
        operation: "INSERT",
        condition: "NEW.action = 'replace_message_channel_identity_link'",
        message: "injected identity-link audit failure",
      });
      await expect(
        rpcConsumeSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).rejects.toThrow("injected identity-link audit failure");
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toMatchObject({ openmeldUserId: "user_old" });
      await removeAuditFault();
      await expect(
        rpcConsumeSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({
        linked: true,
        replacedExistingLink: true,
        openMeldUserId: "user_member",
      });
      await expect(
        rpcConsumeSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).resolves.toMatchObject({ linked: true });
      expect(
        await harness.queryFirst<{
          audit_count: number;
        }>({
          text: `
            SELECT COUNT(*) AS audit_count
            FROM "openmeld"."center_agent_audit_journal"
            WHERE action = 'replace_message_channel_identity_link'
          `,
        })
      ).toEqual({ audit_count: 1 });
    } finally {
      await harness.close();
    }
  });
  it("rejects expired or publicly delivered Slack identity-link tokens and enrolls a verified non-member", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedNonMemberUser(harness);
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
      await harness.query({
        values: [publiclyDeliveredTokenHash],
        text: `
          UPDATE "openmeld"."slack_user_identity_link_tokens"
          SET delivery_scope = NULL
          WHERE token_hash = $1
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
      const ensureWorkspaceMember = vi.fn(async () => {
        await harness.query({
          values: [
            "member_non_member",
            "org_1",
            "user_non_member",
            "member",
            Date.now(),
          ],
          text: `
            INSERT INTO "openmeld"."members" (
              id,
              organization_id,
              user_id,
              role,
              created_at
            )
            VALUES ($1, $2, $3, $4, $5)
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
      await harness.close();
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
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedNonMemberUser(harness);
    const token =
      "slacklink_3434343434343434343434343434343434343434343434343434343434343434";
    stubSlackFetch({
      email: "new-member@example.test",
      ...identity,
      usersInfoResponse,
    });
    const ensureWorkspaceMember = vi.fn(async () => {
      await harness.query({
        values: [
          "member_non_member",
          "org_1",
          "user_non_member",
          "member",
          Date.now(),
        ],
        text: `
            INSERT INTO "openmeld"."members" (
              id,
              organization_id,
              user_id,
              role,
              created_at
            )
            VALUES ($1, $2, $3, $4, $5)
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
      await harness.close();
    }
  });
  it("claims an identity-link token before enrolling exactly one competing account", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedNonMemberUser(harness);
    stubSlackFetch({ email: "new-member@example.test" });
    await harness.query({
      values: [
        "user_competitor",
        "Competing User",
        "competitor@example.test",
        1,
        100,
        100,
      ],
      text: `
        INSERT INTO "openmeld"."users" (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6)
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
        async ({ userId }: { organizationId: string; userId: string }) => {
          await harness.query({
            values: [`member_${userId}`, "org_1", userId, "member", Date.now()],
            text: `
              INSERT INTO "openmeld"."members" (
                id,
                organization_id,
                user_id,
                role,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5)
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
        await harness.queryFirst<{
          enrolled_count: number;
        }>({
          values: ["org_1"],
          text: `
            SELECT COUNT(*) AS enrolled_count
            FROM "openmeld"."members"
            WHERE organization_id = $1
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
      await harness.close();
    }
  });
  it("reuses the same user's claim after Organization enrollment fails", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedNonMemberUser(harness);
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
        .mockImplementationOnce(async () => {
          await harness.query({
            values: [
              "member_non_member",
              "org_1",
              "user_non_member",
              "member",
              Date.now(),
            ],
            text: `
              INSERT INTO "openmeld"."members" (
                id,
                organization_id,
                user_id,
                role,
                created_at
              )
              VALUES ($1, $2, $3, $4, $5)
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
      await harness.close();
    }
  });
  it("lets a new private setup action supersede an abandoned claim", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedNonMemberUser(harness);
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
      await harness.close();
    }
  });
  it("lets a new user claim a fresh token after the previous user's token was consumed", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const firstTokenHash = await digestSlackIdentityLinkToken(
      `slacklink_${"1".repeat(64)}`
    );
    const replacementTokenHash = await digestSlackIdentityLinkToken(
      `slacklink_${"2".repeat(64)}`
    );
    const nowMs = Date.now();
    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        claimedByUserId: "user_member",
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: nowMs + 86_400_000,
        issuedAtMs: nowMs - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: firstTokenHash,
      });
      await expect(
        consumeSlackIdentityLinkTokenAndUpsertUserLink({
          audit: {
            action: "replace_message_channel_identity_link",
            actorProfileId: "profile_member",
            createdAtMs: nowMs,
            id: `replacement-audit:${firstTokenHash}`,
            organizationId: "org_1",
            resourceId: "slack-identity-link",
          },
          consumeNonce: "consume-first-token",
          consumedAtMs: nowMs,
          db: harness.db,
          openmeldUserId: "user_member",
          organizationId: "org_1",
          slackTeamId: "T123",
          slackUserId: "U123",
          tokenHash: firstTokenHash,
        })
      ).resolves.toMatchObject({ status: "linked" });
      await insertSlackIdentityLinkToken({
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: nowMs + 86_400_000,
        issuedAtMs: nowMs + 1,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash: replacementTokenHash,
      });
      await expect(
        claimSlackIdentityLinkTokenForUser({
          claimedAtMs: nowMs + 2,
          db: harness.db,
          openmeldUserId: "user_replacement",
          organizationId: "org_1",
          slackTeamId: "T123",
          slackUserId: "U123",
          tokenHash: replacementTokenHash,
        })
      ).resolves.toMatchObject({ status: "claimed" });
    } finally {
      await harness.close();
    }
  });
  it("returns the committed Slack link when a newer correction wins before response projection", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const tokenHash = await digestSlackIdentityLinkToken(
      `slacklink_${"3".repeat(64)}`
    );
    const nowMs = Date.now();
    try {
      await upsertRemoteAgentSlackWorkspaceBinding({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
      });
      await insertSlackIdentityLinkToken({
        claimedByUserId: "user_member",
        db: harness.db,
        deliveryScope: "slack_ephemeral",
        expiresAtMs: nowMs + 86_400_000,
        issuedAtMs: nowMs - 1000,
        organizationId: "org_1",
        slackTeamId: "T123",
        slackUserDisplayName: "Slack Ari",
        slackUserId: "U123",
        tokenHash,
      });
      const consumeDb = createAfterMatchingPostgresTransaction({
        afterTransaction: async () => {
          await harness.query({
            values: ["user_replacement", "T123", "U123"],
            text: `
              UPDATE "openmeld"."slack_user_identity_links"
              SET openmeld_user_id = $1
              WHERE slack_team_id = $2
                AND slack_user_id = $3
            `,
          });
        },
        db: harness.db,
        matches: (sql) =>
          sql.includes('UPDATE "openmeld"."slack_user_identity_link_tokens"') &&
          sql.includes("consume_nonce"),
      });
      await expect(
        consumeSlackIdentityLinkTokenAndUpsertUserLink({
          audit: {
            action: "replace_message_channel_identity_link",
            actorProfileId: "profile_member",
            createdAtMs: nowMs,
            id: `replacement-audit:${tokenHash}`,
            organizationId: "org_1",
            resourceId: "slack-identity-link",
          },
          consumeNonce: "post-commit-slack-consume",
          consumedAtMs: nowMs,
          db: consumeDb,
          openmeldUserId: "user_member",
          organizationId: "org_1",
          slackTeamId: "T123",
          slackUserId: "U123",
          tokenHash,
        })
      ).resolves.toMatchObject({
        link: { openmeldUserId: "user_member" },
        replacedExistingLink: false,
        status: "linked",
      });
      await expect(
        readSlackUserIdentityLink({
          db: harness.db,
          slackTeamId: "T123",
          slackUserId: "U123",
        })
      ).resolves.toMatchObject({ openmeldUserId: "user_replacement" });
    } finally {
      await harness.close();
    }
  });
  it("keeps a completed identity link when continuation source recovery throws", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it("rejects an identity-link token after its Slack workspace moves to another Organization", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSecondOrganization(harness);
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
      await harness.query({
        values: ["org_2", "T123"],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
          SET organization_id = $1
          WHERE slack_team_id = $2
        `,
      });
      await expect(
        rpcPreviewSlackIdentityLink(buildEnv(harness.db), {
          context: buildHumanContext(),
          token,
        })
      ).rejects.toMatchObject({ code: "slack.identity_link_token_invalid" });
    } finally {
      await harness.close();
    }
  });
  it("fails closed when the Slack workspace moves during identity-link consumption", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSecondOrganization(harness);
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
        moveWorkspace: async () => {
          await harness.query({
            values: ["org_2", "T123"],
            text: `
              UPDATE "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
              SET organization_id = $1
              WHERE slack_team_id = $2
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
        await harness.queryFirst<{
          consume_nonce: string | null;
          consumed_at_ms: number | null;
        }>({
          values: [await digestSlackIdentityLinkToken(token)],
          text: `
            SELECT consume_nonce, consumed_at_ms
            FROM "openmeld"."slack_user_identity_link_tokens"
            WHERE token_hash = $1
          `,
        })
      ).toEqual({
        consume_nonce: null,
        consumed_at_ms: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("guards Slack workspace binding from being claimed by another organization", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    await seedSecondOrganization(harness);
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
      await harness.close();
    }
  });
  it("publishes completed Slack callbacks to the original Slack thread as mrkdwn", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("keeps the canonical GitHub Navigation Action clickable in both Slack representations", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("does not invent a native Slack button for a generic Project Navigation Action", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
      await harness.close();
    }
  });
  it.each([
    {
      chatGetPermalinkResponse: undefined,
      expectedPermalink:
        "https://acme.slack.com/archives/C123/p1710000000000100",
      expectedVersion: 4 as const,
      permalinkCase: "available",
      sourceVersion: 4 as const,
    },
    {
      chatGetPermalinkResponse: undefined,
      expectedPermalink:
        "https://acme.slack.com/archives/C123/p1710000000000100",
      expectedVersion: 1 as const,
      permalinkCase: "available",
      sourceVersion: 1 as const,
    },
    {
      chatGetPermalinkResponse: { error: "missing_scope", ok: false },
      expectedPermalink: null,
      expectedVersion: 4 as const,
      permalinkCase: "unavailable",
      sourceVersion: 4 as const,
    },
  ])("issues an Organization-scoped one-time identity-link action and preserves the source v$sourceVersion worker semantics when the return target is $permalinkCase", async ({
    chatGetPermalinkResponse,
    expectedPermalink,
    expectedVersion,
    sourceVersion,
  }) => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
    const fetchMock = stubSlackFetch({
      chatGetPermalinkResponse,
      email: "new-member@example.test",
    });
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
      await harness.query({
        values: ["deepseek/deepseek-v4-flash", sourceDelivery.bindingId],
        text: `
          UPDATE "openmeld"."openMeldDaemon_agent_profile_bindings"
          SET model_id = $1
          WHERE binding_id = $2
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
        await harness.query({
          values: [
            JSON.stringify({ request: legacyRequest, storageVersion: 1 }),
          ],
          text: `
            UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            SET execution_recovery_submit_request_json = $1
            WHERE delivery_id = '${sourceDelivery.deliveryId}'
          `,
        });
      }
      const postBodies = readSlackPostBodies(fetchMock) as {
        blocks?: {
          elements?: {
            url?: string;
          }[];
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
        .query<{
          delivery_scope: string;
          organization_id: string;
          source_delivery_id: string;
        }>({
          ...{
            text: `
            SELECT delivery_scope, organization_id, source_delivery_id
            FROM "openmeld"."slack_user_identity_link_tokens"
            WHERE token_hash = $1
          `,
            values: [],
          },
          values: [await digestSlackIdentityLinkToken(token ?? "")],
        })
        .then((result) => result.rows[0] ?? null);
      expect(tokenRow).toEqual({
        delivery_scope: "slack_direct_message",
        organization_id: "org_1",
        source_delivery_id: sourceDelivery.deliveryId,
      });
      const consumeInput = {
        context: buildHumanContext(),
        includeReturnTarget: true as const,
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
          slackThreadPermalink: expectedPermalink,
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
                  modelId: "anthropic/claude-opus-5.5",
                  reasoningLevel: "medium",
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
      await harness.close();
    }
  });
  it("does not issue private identity guidance until source publication is confirmed", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
        .query<{
          count: number;
        }>({
          text: 'SELECT count(*) AS count FROM "openmeld"."slack_user_identity_link_tokens"',
          values: [],
        })
        .then((result) => result.rows[0] ?? null);
      expect(tokenCount?.count).toBe(0);
    } finally {
      await harness.close();
    }
  });
  it("retries a known failed continuation with one new deterministic attempt", async () => {
    const harness = await createPostgresHarness();

    await seedSlackOrganization(harness);
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
        blocks?: {
          elements?: {
            url?: string;
          }[];
        }[];
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
      await harness.close();
    }
  });
  it("keeps the Slack request timeout shorter than the publication claim lease", () => {
    expect(REMOTE_AGENT_SLACK_FINAL_PUBLICATION_TIMEOUT_MS).toBeLessThan(
      REMOTE_AGENT_SLACK_FINAL_PUBLICATION_CLAIM_LEASE_MS
    );
  });
  it("publishes concurrent completed Slack callbacks only once", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("publishes concurrent failed Slack callbacks only once", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("does not republish a failed callback when publication finalization is interrupted", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("returns retryable when a lost Slack publication claim was released before reread", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("marks interrupted Slack publication claims outcome unknown without republishing", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("requeues a due deadline probe while a Slack publication claim is active", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("rejects a due deadline probe when its active claim cannot be requeued", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("marks Slack ok responses without a timestamp as publication outcome unknown", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("does not retry an ambiguous Slack network failure", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("records outcome unknown when a successful Slack post cannot finalize in D1", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("keeps Slack callback publish failures retryable", async () => {
    const harness = await createPostgresHarness();

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
      await harness.close();
    }
  });
  it("reconciles and keeps accepted Slack deliveries open after a retired deadline probe", async () => {
    const harness = await createPostgresHarness();

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
      expect(readSlackThreadStatusBodies(fetchMock)).toEqual([
        {
          channel_id: "C123",
          status: "is working on your request…",
          thread_ts: "1710000000.000100",
        },
      ]);
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs:
            probe.deadlineAtMs +
            REMOTE_AGENT_SLACK_WORKING_STATUS_REFRESH_INTERVAL_SECONDS * 1000,
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
        delaySeconds:
          REMOTE_AGENT_SLACK_WORKING_STATUS_REFRESH_INTERVAL_SECONDS,
      });
      expect(readSlackThreadStatusBodies(fetchMock)).toHaveLength(2);
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
      await harness.close();
    }
  });
  it("does not let the Slack status refresh cadence expire an in-flight reconciliation lease", async () => {
    vi.useFakeTimers();
    const harness = await createPostgresHarness();

    const probe = createDeadlineProbe();
    const reconciliation = createDeferred({
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
    });
    const reconciliationStarted = createDeferred(undefined);
    const workerReconcile = vi.fn(() => {
      reconciliationStarted.resolve();
      return reconciliation.promise;
    });
    const queueSend = vi.fn(async () => undefined);
    stubSlackFetch({ email: "ari@example.test" });
    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: probe.idempotencyKey,
        submissionId: probe.submissionId,
      });
      const env = buildEnv(harness.db, { queueSend, workerReconcile });
      const firstProbe = processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: probe.deadlineAtMs,
        probe,
      });
      await reconciliationStarted.promise;
      expect(workerReconcile).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(30_000);
      await expect(firstProbe).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_unavailable",
        status: "skipped",
      });
      expect(queueSend).toHaveBeenCalledOnce();
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs:
            probe.deadlineAtMs +
            REMOTE_AGENT_SLACK_WORKING_STATUS_REFRESH_INTERVAL_SECONDS * 1000,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_already_claimed",
        status: "skipped",
      });
      expect(
        REMOTE_AGENT_EXECUTION_RECONCILIATION_PROCESSING_LEASE_MS
      ).toBeGreaterThan(
        REMOTE_AGENT_SLACK_WORKING_STATUS_REFRESH_INTERVAL_SECONDS * 1000
      );
      expect(workerReconcile).toHaveBeenCalledOnce();
      expect(queueSend).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: probe.idempotencyKey,
        })
      ).resolves.toMatchObject({
        acceptedProbeNextDueAtMs:
          probe.deadlineAtMs +
          REMOTE_AGENT_EXECUTION_RECONCILIATION_PROCESSING_LEASE_MS,
      });
    } finally {
      reconciliation.resolve();
      await harness.close();
      vi.useRealTimers();
    }
  });
  it("keeps a timed-out reconciliation lease when its recovery enqueue fails", async () => {
    vi.useFakeTimers();
    const harness = await createPostgresHarness();

    const probe = createDeadlineProbe();
    const firstReconciliation = createDeferred({
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
    });
    const reconciliationStarted = createDeferred(undefined);
    const workerReconcile = vi
      .fn()
      .mockImplementationOnce(() => {
        reconciliationStarted.resolve();
        return firstReconciliation.promise;
      })
      .mockResolvedValueOnce({
        execution: {
          acceptedAtMs: 1100,
          cancellationReason: null,
          completedAtMs: null,
          idempotencyKey: probe.idempotencyKey,
          lastProgressAtMs:
            probe.deadlineAtMs +
            REMOTE_AGENT_EXECUTION_RECONCILIATION_PROCESSING_LEASE_MS,
          lastProgressKind: "tool_started" as const,
          organizationId: probe.organizationId,
          spaceId: probe.spaceId,
          status: "running" as const,
          submissionId: probe.submissionId,
          v: 1 as const,
        },
        status: "found" as const,
      });
    const queueSend = vi
      .fn()
      .mockRejectedValueOnce(new Error("queue unavailable"))
      .mockResolvedValueOnce(undefined);
    stubSlackFetch({ email: "ari@example.test" });
    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: probe.idempotencyKey,
        submissionId: probe.submissionId,
      });
      const env = buildEnv(harness.db, { queueSend, workerReconcile });
      const firstProbe = processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: probe.deadlineAtMs,
        probe,
      });
      const firstProbeFailure = firstProbe.catch((error: unknown) => error);
      await reconciliationStarted.promise;
      await vi.advanceTimersByTimeAsync(30_000);
      expect(await firstProbeFailure).toEqual(
        expect.objectContaining({ message: "queue unavailable" })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: probe.idempotencyKey,
        })
      ).resolves.toMatchObject({
        acceptedProbeNextDueAtMs:
          probe.deadlineAtMs +
          REMOTE_AGENT_EXECUTION_RECONCILIATION_PROCESSING_LEASE_MS,
      });
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs:
            probe.deadlineAtMs +
            REMOTE_AGENT_SLACK_WORKING_STATUS_REFRESH_INTERVAL_SECONDS * 1000,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_already_claimed",
        status: "skipped",
      });
      expect(workerReconcile).toHaveBeenCalledOnce();
      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          nowMs:
            probe.deadlineAtMs +
            REMOTE_AGENT_EXECUTION_RECONCILIATION_PROCESSING_LEASE_MS,
          probe,
        })
      ).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciliation_scheduled",
        status: "skipped",
      });
      expect(workerReconcile).toHaveBeenCalledTimes(2);
      expect(queueSend).toHaveBeenCalledTimes(2);
    } finally {
      firstReconciliation.resolve();
      await harness.close();
      vi.useRealTimers();
    }
  });
  it("clears a late Slack working-status refresh after the final reply wins", async () => {
    const harness = await createPostgresHarness();

    const probe = createDeadlineProbe();
    const delayedWorkingStatus = createDeferred({ ok: true });
    let heldWorkingStatus = false;
    const fetchMock = stubSlackFetch({
      email: "ari@example.test",
      threadStatusResponse: (body) => {
        if (body.status !== "" && !heldWorkingStatus) {
          heldWorkingStatus = true;
          return delayedWorkingStatus.promise;
        }
        return { ok: true };
      },
    });
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
    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: probe.idempotencyKey,
        submissionId: probe.submissionId,
      });
      const env = buildEnv(harness.db, { workerReconcile });
      const refreshProbe = processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: probe.deadlineAtMs,
        probe,
      });
      await vi.waitFor(() =>
        expect(readSlackThreadStatusBodies(fetchMock)).toEqual([
          expect.objectContaining({ status: "is working on your request…" }),
        ])
      );
      await expect(
        completeRemoteAgentNativeDelivery(env, createCompletedCallbackBody())
      ).resolves.toEqual({
        publishedSignalId: "1710000001.000200",
        status: "accepted",
      });
      delayedWorkingStatus.resolve();
      await expect(refreshProbe).resolves.toEqual({
        reasonCode: "remote_agent.execution_reconciled_terminal",
        status: "skipped",
      });
      const statusBodies = readSlackThreadStatusBodies(fetchMock) as Array<{
        status?: unknown;
      }>;
      expect(statusBodies.at(-1)).toMatchObject({ status: "" });
      const firstClearIndex = statusBodies.findIndex(
        (body) => body.status === ""
      );
      expect(firstClearIndex).toBeGreaterThan(0);
      expect(
        statusBodies.slice(firstClearIndex).every((body) => body.status === "")
      ).toBe(true);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: probe.idempotencyKey,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "published",
        status: "completed",
      });
    } finally {
      await harness.close();
    }
  });
  it("does not let a later-admitted older Slack message clear the newer turn's working status", async () => {
    const harness = await createPostgresHarness();

    const oldProbe = createDeadlineProbe();
    const newProbe = {
      ...oldProbe,
      dispatchId: "remote-agent-slack:Ev124",
      idempotencyKey: "remote-agent-slack:T123:Ev124",
      submissionId: "sub_slack_2",
    };
    const fetchMock = stubSlackFetch({ email: "ari@example.test" });
    const workerReconcile = vi.fn(
      async (request: { idempotencyKey: string; submissionId: string }) => ({
        execution: {
          acceptedAtMs: 2100,
          cancellationReason: null,
          completedAtMs: null,
          idempotencyKey: request.idempotencyKey,
          lastProgressAtMs: newProbe.deadlineAtMs,
          lastProgressKind: "tool_started" as const,
          organizationId: newProbe.organizationId,
          spaceId: newProbe.spaceId,
          status: "running" as const,
          submissionId: request.submissionId,
          v: 1 as const,
        },
        status: "found" as const,
      })
    );
    const env = buildEnv(harness.db, { workerReconcile });
    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        dispatchId: newProbe.dispatchId,
        idempotencyKey: newProbe.idempotencyKey,
        nowMs: 1000,
        submissionId: newProbe.submissionId,
        triggerMessageId: "1710000002.000200",
      });
      await processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env,
        nowMs: newProbe.deadlineAtMs,
        probe: newProbe,
      });
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: oldProbe.idempotencyKey,
        nowMs: 2000,
        submissionId: oldProbe.submissionId,
        triggerMessageId: "1710000001.000100",
      });
      await completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallbackBody({
          triggerMessageId: "1710000001.000100",
        })
      );
      expect(readSlackThreadStatusBodies(fetchMock).at(-1)).toMatchObject({
        status: "is working on your request…",
      });
      expect(workerReconcile).toHaveBeenCalledOnce();
    } finally {
      await harness.close();
    }
  });
  it("converges a stale Slack status correction after a newer turn starts", async () => {
    const harness = await createPostgresHarness();

    const oldProbe = createDeadlineProbe();
    const newProbe = {
      ...oldProbe,
      dispatchId: "remote-agent-slack:Ev124",
      idempotencyKey: "remote-agent-slack:T123:Ev124",
      submissionId: "sub_slack_2",
    };
    const delayedWorkingStatus = createDeferred({ ok: true });
    const delayedClearStatus = createDeferred({ ok: true });
    let heldWorkingStatus = false;
    let heldClearStatus = false;
    const fetchMock = stubSlackFetch({
      email: "ari@example.test",
      threadStatusResponse: (body) => {
        if (body.status !== "" && !heldWorkingStatus) {
          heldWorkingStatus = true;
          return delayedWorkingStatus.promise;
        }
        if (body.status === "" && !heldClearStatus) {
          heldClearStatus = true;
          return delayedClearStatus.promise;
        }
        return { ok: true };
      },
    });
    const reconciliation = createDeferred({
      execution: {
        acceptedAtMs: 1100,
        cancellationReason: null,
        completedAtMs: null,
        idempotencyKey: oldProbe.idempotencyKey,
        lastProgressAtMs: oldProbe.deadlineAtMs,
        lastProgressKind: "tool_started" as const,
        organizationId: oldProbe.organizationId,
        spaceId: oldProbe.spaceId,
        status: "running" as const,
        submissionId: oldProbe.submissionId,
        v: 1 as const,
      },
      status: "found" as const,
    });
    const reconciliationStarted = createDeferred(undefined);
    const workerReconcile = vi.fn(() => {
      reconciliationStarted.resolve();
      return reconciliation.promise;
    });
    let refreshProbe: ReturnType<
      typeof processRemoteAgentNativeDeliveryDeadlineProbe
    > | null = null;
    try {
      await createAcceptedSlackDelivery({
        db: harness.db,
        idempotencyKey: oldProbe.idempotencyKey,
        submissionId: oldProbe.submissionId,
      });
      refreshProbe = processRemoteAgentNativeDeliveryDeadlineProbe({
        db: harness.db,
        env: buildEnv(harness.db, { workerReconcile }),
        nowMs: oldProbe.deadlineAtMs,
        probe: oldProbe,
      });
      await vi.waitFor(() =>
        expect(readSlackThreadStatusBodies(fetchMock)).toEqual([
          expect.objectContaining({ status: "is working on your request…" }),
        ])
      );
      await harness.query({
        values: [oldProbe.idempotencyKey],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            final_publication_state = 'published',
            published_signal_id = '1710000001.000200',
            status = 'completed',
            updated_at_ms = 1500
          WHERE idempotency_key = $1
        `,
      });
      delayedWorkingStatus.resolve();
      await vi.waitFor(() =>
        expect(readSlackThreadStatusBodies(fetchMock).at(-1)).toMatchObject({
          status: "",
        })
      );
      await createAcceptedSlackDelivery({
        db: harness.db,
        dispatchId: newProbe.dispatchId,
        idempotencyKey: newProbe.idempotencyKey,
        nowMs: 2000,
        submissionId: newProbe.submissionId,
      });
      delayedClearStatus.resolve();
      await reconciliationStarted.promise;
      expect(readSlackThreadStatusBodies(fetchMock).at(-1)).toMatchObject({
        status: "is working on your request…",
      });
      reconciliation.resolve();
      await refreshProbe;
      refreshProbe = null;
    } finally {
      reconciliation.resolve();
      await refreshProbe?.catch(() => undefined);
      await harness.close();
    }
  });
  it("releases a failed reconciliation enqueue for scheduled compensation", async () => {
    const harness = await createPostgresHarness();

    stubSlackFetch({ email: "ari@example.test" });
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
      await harness.close();
    }
  });
});
function moveSlackWorkspaceBeforeIdentityLinkConsume(input: {
  db: PostgresDatabase;
  moveWorkspace(): void | Promise<void>;
}): PostgresDatabase {
  return createBeforeMatchingPostgresTransaction({
    db: input.db,
    matches: (text) =>
      text.includes('UPDATE "openmeld"."slack_user_identity_link_tokens"') &&
      TOKEN_CONSUMPTION_PATTERN.test(text),
    beforeTransaction: async () => {
      await input.moveWorkspace();
    },
  });
}

async function seedNonMemberUser(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await input.query({
    values: [
      "user_non_member",
      "No Member",
      "no-member@example.test",
      1,
      100,
      100,
    ],
    text: `
      INSERT INTO "openmeld"."users" (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
  });
}
async function seedSlackIdentityLink(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await input.query({
    values: ["org_1", "T123", "U123", "user_member", "explicit", 100],
    text: `
      INSERT INTO "openmeld"."slack_user_identity_links" (
        organization_id,
        slack_team_id,
        slack_user_id,
        openmeld_user_id,
        source,
        created_at_ms
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
  });
}
async function seedSecondOrganization(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await input.query({
    values: [
      "org_2",
      "Second Org",
      "second-org",
      JSON.stringify({ personal: false }),
      100,
    ],
    text: `
      INSERT INTO "openmeld"."organizations" (
        id,
        name,
        slug,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
  });
  await input.query({
    values: ["member_2", "org_2", "user_member", "owner", 100],
    text: `
      INSERT INTO "openmeld"."members" (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
  });
}
async function seedSlackOrganization(
  input: Awaited<ReturnType<typeof createPostgresHarness>>
) {
  await input.query({
    text: "INSERT INTO \"openmeld\".\"users\" (id, name, email, created_at, updated_at) VALUES ('user_owner', 'Center Agent Creator', 'creator@example.test', 100, 100)",
  });
  await input.query({
    values: ["user_member", "Ari", "ari@example.test", 1, 100, 100],
    text: `
      INSERT INTO "openmeld"."users" (
        id,
        name,
        email,
        email_verified,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6)
    `,
  });
  await input.query({
    values: [
      "org_1",
      "OpenMeld Labs",
      "openmeld-labs",
      JSON.stringify({ personal: false }),
      100,
    ],
    text: `
      INSERT INTO "openmeld"."organizations" (
        id,
        name,
        slug,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
  });
  await input.query({
    values: ["member_1", "org_1", "user_member", "owner", 100],
    text: `
      INSERT INTO "openmeld"."members" (
        id,
        organization_id,
        user_id,
        role,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
  });
  await input.query({
    values: [
      "22222222-2222-4222-8222-222222222222",
      "Ari Human",
      "ari",
      "human",
      1,
      "active",
      null,
      "user_member",
      "auth_bootstrap",
      null,
      100,
      100,
    ],
    text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        source,
        managed_role,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
  });
  await input.query({
    values: [
      AGENT_PROFILE_ID,
      "Center Agent",
      "center-agent",
      "agent",
      0,
      "active",
      "org_1",
      null,
      "auth_bootstrap",
      "center_agent",
      100,
      100,
    ],
    text: `
      INSERT INTO "openmeld"."openmeld_profiles" (
        profile_id,
        profile_name,
        profile_handle,
        profile_kind,
        is_default,
        status,
        organization_id,
        owner_user_id,
        source,
        managed_role,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
  });
  await input.query({
    values: ["org_1", AGENT_PROFILE_ID, "user_owner", 100],
    text: `
      INSERT INTO "openmeld"."center_agent_designations" (
        organization_id,
        agent_profile_id,
        designated_by,
        created_at
      )
      VALUES ($1, $2, $3, $4)
    `,
  });
  await input.query({
    values: [
      "binding_1",
      "organization",
      "org_1",
      AGENT_PROFILE_ID,
      HOSTED_CENTER_AGENT_LOGICAL_RUNTIME_ID,
      "hosted_center_agent",
      JSON.stringify(HOSTED_CENTER_AGENT_RUNTIME_IDENTITY),
      HOSTED_CENTER_AGENT_CONTROLLER_REF,
      null,
      "enabled_primary",
      100,
      100,
    ],
    text: `
      INSERT INTO "openmeld"."openMeldDaemon_agent_profile_bindings" (
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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
  });
}
function buildEnv(
  db: PostgresDatabase,
  input: {
    cryptoKey?: string;
    ensureWorkspaceMember?: ReturnType<typeof vi.fn>;
    queueSend?: ReturnType<typeof vi.fn>;
    richContextReproEnabled?: string;
    workerReconcile?: Mock<
      NonNullable<RemoteAgentWorkerBindingRpc["reconcileExecution"]>
    >;
    workerSubmit?: Mock<
      NonNullable<RemoteAgentWorkerBindingRpc["submitConversationTurn"]>
    >;
  } = {}
): CoreBindings {
  return {
    OPENMELD_POSTGRESQL: postgresTestBinding(db),
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
    ...(input.richContextReproEnabled
      ? {
          OPENMELD_SLACK_RICH_CONTEXT_REPRO_ENABLED:
            input.richContextReproEnabled,
        }
      : {}),
    OPENMELD_AUTH_WORKER: {
      resolveOrganizationAccountIdentity: async (request) =>
        await resolveTestOrganizationAccountIdentity(db, request),
      ...(input.ensureWorkspaceMember
        ? {
            // Fixtures return loosely typed membership results.
            ensureSlackWorkspaceMemberOrganizationMembership:
              input.ensureWorkspaceMember as NonNullable<
                NonNullable<
                  CoreBindings["OPENMELD_AUTH_WORKER"]
                >["ensureSlackWorkspaceMemberOrganizationMembership"]
              >,
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
  db: PostgresDatabase,
  input: AuthRpcResolveOrganizationAccountIdentityInput
): Promise<AuthRpcResolveOrganizationAccountIdentityResult> {
  const organization = await db
    .query<{
      id: string;
      metadata: string | null;
      name: string;
      slug: string;
    }>({
      ...{
        text: `
        SELECT id, name, slug, metadata
        FROM "openmeld"."organizations"
        WHERE id = $1
        LIMIT 1
      `,
        values: [],
      },
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!organization) {
    return {
      code: "auth.organization_identity_unavailable",
      message: "Organization identity is unavailable.",
      ok: false,
    };
  }
  const memberCountRow = await db
    .query<{
      member_count: number;
    }>({
      ...{
        text: 'SELECT COUNT(*) AS member_count FROM "openmeld"."members" WHERE organization_id = $1',
        values: [],
      },
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  let account: Extract<
    AuthRpcResolveOrganizationAccountIdentityResult,
    {
      ok: true;
    }
  >["account"] = null;
  if (input.account) {
    let accountSelection: {
      sql: string;
      value: string;
    };
    if (input.account.kind === "email") {
      accountSelection = {
        sql: 'SELECT id, name, email FROM "openmeld"."users" WHERE lower(email) = lower($1) LIMIT 1',
        value: input.account.email,
      };
    } else if (input.account.kind === "user_id") {
      accountSelection = {
        sql: 'SELECT id, name, email FROM "openmeld"."users" WHERE id = $1 LIMIT 1',
        value: input.account.userId,
      };
    } else {
      accountSelection = {
        sql: `
          SELECT users.id, users.name, users.email
          FROM "openmeld"."users"
          INNER JOIN "openmeld"."openmeld_profiles" AS selected_profile
            ON selected_profile.owner_user_id = users.id
          WHERE selected_profile.profile_id = $1
            AND selected_profile.organization_id IS NULL
            AND selected_profile.profile_kind = 'human'
          LIMIT 1
        `,
        value: input.account.profileId,
      };
    }
    const user = await db
      .query<{
        email: string;
        id: string;
        name: string | null;
      }>({
        ...{
          text: accountSelection.sql,
          values: [],
        },
        values: [accountSelection.value],
      })
      .then((result) => result.rows[0] ?? null);
    if (user) {
      const [membership, profile] = await Promise.all([
        db
          .query<{
            id: string;
            role: "admin" | "member" | "owner";
          }>({
            ...{
              text: 'SELECT id, role FROM "openmeld"."members" WHERE organization_id = $1 AND user_id = $2 LIMIT 1',
              values: [],
            },
            values: [input.organizationId, user.id],
          })
          .then((result) => result.rows[0] ?? null),
        db
          .query<{
            profile_id: string;
            profile_name: string;
          }>({
            ...{
              text: `
              SELECT profile_id, profile_name
              FROM "openmeld"."openmeld_profiles"
              WHERE owner_user_id = $1
                AND organization_id IS NULL
                AND profile_kind = 'human'
                AND is_default = 1
                AND status = 'active'
              LIMIT 1
            `,
              values: [],
            },
            values: [user.id],
          })
          .then((result) => result.rows[0] ?? null),
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
  let metadata: {
    personal?: unknown;
  } = {};
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
function failSlackFinalPublicationFinalize(
  db: PostgresDatabase
): PostgresDatabase {
  const fault = observeNativePostgresQueries(({ text }) => {
    if (
      text
        .slice(0, text.indexOf("WHERE"))
        .includes("final_publication_state = 'published'")
    ) {
      throw new Error("simulated Slack publication finalize failure");
    }
  });
  onTestFinished(() => fault.mockRestore());
  return db;
}
function skipSlackFinalPublicationClaim(
  db: PostgresDatabase
): PostgresDatabase {
  // Another real connection owns the claim when our guarded UPDATE runs, then releases it before reread.
  const native = PostgresDatabase.prototype.query;
  let injected = false;
  const race = vi
    .spyOn(PostgresDatabase.prototype, "query")
    .mockImplementation(async function (this: PostgresDatabase, query, values) {
      const config =
        typeof query === "string" ? { text: query, values } : query;
      if (
        injected ||
        !config.text
          .slice(0, config.text.indexOf("WHERE"))
          .includes("final_publication_state = 'claimed'")
      ) {
        return native.call(this, query, values);
      }
      injected = true;
      await native.call(db, {
        text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
      SET final_publication_state = 'claimed', final_publication_claim_id = 'other-claim',
        final_publication_claimed_at_ms = 1000, final_publication_claim_expires_at_ms = 9007199254740991
      WHERE idempotency_key = $1`,
        values: ["remote-agent-slack:T123:Ev123"],
      });
      const result = await native.call(this, query, values);
      await native.call(db, {
        text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
      SET final_publication_state = NULL, final_publication_claim_id = NULL,
        final_publication_claimed_at_ms = NULL, final_publication_claim_expires_at_ms = NULL
      WHERE idempotency_key = $1 AND final_publication_claim_id = 'other-claim'`,
        values: ["remote-agent-slack:T123:Ev123"],
      });
      return result;
    });
  onTestFinished(() => race.mockRestore());
  return db;
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
  chatGetPermalinkResponse?: Record<string, unknown>;
  conversationsHistoryResponse?:
    | Record<string, unknown>
    | Response
    | ((url: URL) => Record<string, unknown> | Response);
  conversationsListError?: Error;
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
  threadStatusResponse?:
    | Record<string, unknown>
    | ((
        body: Record<string, unknown>
      ) => Promise<Record<string, unknown>> | Record<string, unknown>);
  usersInfoResponse?: UsersInfoResponse;
}) {
  const fetchMock = vi.fn(
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
        if (input.conversationsListError) {
          throw input.conversationsListError;
        }
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
      if (url.includes("/chat.getPermalink")) {
        return Response.json(
          input.chatGetPermalinkResponse ?? {
            ok: true,
            permalink: "https://acme.slack.com/archives/C123/p1710000000000100",
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
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<
          string,
          unknown
        >;
        const configured =
          typeof input.threadStatusResponse === "function"
            ? await input.threadStatusResponse(body)
            : input.threadStatusResponse;
        return Response.json(configured ?? { ok: true });
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
async function readSlackChannelIntroductionCreatedAtMs(
  harness: Awaited<ReturnType<typeof createPostgresHarness>>,
  interactionId: string
): Promise<number> {
  const row = await harness.queryFirst<{
    createdAtMs: number;
  }>({
    values: [interactionId],
    text: `SELECT created_at_ms AS "createdAtMs"
      FROM "openmeld"."slack_channel_introduction_runs"
      WHERE interaction_id = $1`,
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
  db: PostgresDatabase;
  dispatchId?: string;
  idempotencyKey: string;
  nowMs?: number;
  submissionId: string;
  triggerMessageId?: string;
}) {
  const nowMs = input.nowMs ?? 1000;
  await upsertRemoteAgentNativeDeliveryRecord({
    db: input.db,
    nowMs,
    organizationId: "org_1",
    conversationKind: "slack",
    spaceId: CONVERSATION_ID,
    profileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    triggerMessageId: input.triggerMessageId ?? CONVERSATION_ID,
    dispatchId: input.dispatchId ?? "remote-agent-slack:Ev123",
    attemptId: null,
    idempotencyKey: input.idempotencyKey,
    status: "submitted",
    slackTeamId: "T123",
    slackChannelId: "C123",
    slackThreadTs: "1710000000.000100",
  });
  await markRemoteAgentNativeDeliveryAck({
    db: input.db,
    nowMs: nowMs + 100,
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
    files?: Array<{
      id: string;
      mimetype?: string;
      name?: string;
      permalink?: string;
      size?: number;
    }>;
    subtype?: "file_share";
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
      ...(overrides.files ? { files: overrides.files } : {}),
      ...(overrides.subtype ? { subtype: overrides.subtype } : {}),
      ...(overrides.actionToken ? { action_token: overrides.actionToken } : {}),
      ...(overrides.threadTs ? { thread_ts: overrides.threadTs } : {}),
    },
  };
}
function createCompletedCallbackForSubmittedRequest(input: {
  request: RemoteAgentWorkerSubmitTurnRequest;
  submissionId: string;
}): Extract<
  RemoteAgentCoreCallbackBody,
  {
    text: string;
  }
> {
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
function createCompletedCallbackBody(
  input: { triggerMessageId?: string } = {}
): Extract<
  RemoteAgentCoreCallbackBody,
  {
    text: string;
  }
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
    triggerMessageId: input.triggerMessageId ?? CONVERSATION_ID,
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
