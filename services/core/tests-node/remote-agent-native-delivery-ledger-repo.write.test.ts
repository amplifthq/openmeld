import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { describe, expect, it } from "vitest";
import {
  clearCoreCenterAgentMemberNativeDeliveryData,
  clearCoreCenterAgentOrganizationNativeDeliveryData,
  createCoreCenterAgentMemoryService,
} from "../src/center-agent-memory/core-memory-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  claimRemoteAgentFinalPublication,
  claimRemoteAgentWorkerSubmission,
  clearRemoteAgentNativeDeliveryTriggerTextForOrganization,
  insertRemoteAgentRejectedCallbackRecord,
  isLatestRemoteAgentNativeDeliveryActiveForSlackThread,
  listRemoteAgentNativeDeliveryTurnDiagnostics,
  markRemoteAgentCallbackRejected,
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  projectRemoteAgentNativeDeliveryTurnDiagnostic,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  readRemoteAgentNativeDeliveryBySubmissionId,
  releaseRemoteAgentWorkerSubmission,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  createPostgresHarness,
  postgresTestBinding,
} from "./helpers/postgresql-harness.test-support";

describe("Remote Agent native delivery ledger repo", () => {
  it("reclaims an expired submission mutex without letting the old claimant release its replacement", async () => {
    const harness = await createPostgresHarness();
    const admission = buildImmutableAdmissionInput({
      db: harness.db,
      surface: "slack",
    });
    await upsertRemoteAgentNativeDeliveryRecord(admission);
    const requestJson = JSON.stringify({
      v: 1,
      idempotencyKey: admission.idempotencyKey,
    });
    await harness.query({
      text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET worker_submit_request_json = $1 WHERE idempotency_key = $2',
      values: [requestJson, admission.idempotencyKey],
    });
    const claim = (claimId: string, nowMs: number, expiresAtMs: number) =>
      claimRemoteAgentWorkerSubmission({
        db: harness.db,
        idempotencyKey: admission.idempotencyKey,
        claimId,
        nowMs,
        expiresAtMs,
      });
    const winners = await Promise.all([
      claim("first", 1000, 2000),
      claim("overlap", 1000, 2000),
    ]);
    expect(winners.filter(Boolean)).toHaveLength(1);
    const oldClaim = winners[0] ? "first" : "overlap";
    expect(await claim("early", 1999, 3000)).toBe(false);
    expect(await claim("replacement", 2000, 3000)).toBe(true);
    await releaseRemoteAgentWorkerSubmission({
      db: harness.db,
      idempotencyKey: admission.idempotencyKey,
      claimId: oldClaim,
    });
    expect(
      await harness.queryAll({
        text: 'SELECT worker_submit_claim_id, worker_submit_claim_expires_at_ms, status, submission_id, worker_submit_request_json FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE idempotency_key = $1',
        values: [admission.idempotencyKey],
      })
    ).toEqual([
      {
        worker_submit_claim_id: "replacement",
        worker_submit_claim_expires_at_ms: 3000,
        status: "submitted",
        submission_id: null,
        worker_submit_request_json: requestJson,
      },
    ]);
    await releaseRemoteAgentWorkerSubmission({
      db: harness.db,
      idempotencyKey: admission.idempotencyKey,
      claimId: "replacement",
    });
    expect(await claim("same-request-replay", 2001, 4000)).toBe(true);
    await markRemoteAgentNativeDeliveryAck({
      db: harness.db,
      idempotencyKey: admission.idempotencyKey,
      nowMs: 2002,
      accepted: true,
      submissionId: "acknowledged",
    });
    expect(await claim("after-ack", 4001, 5000)).toBe(false);
    await harness.close();
  });
  it.each([
    "worker_submit_claim_id = 'orphan'",
    "worker_submit_claim_expires_at_ms = 2000",
  ])("rejects an incomplete submission claim pair: %s", async (assignment) => {
    const harness = await createPostgresHarness();
    const admission = buildImmutableAdmissionInput({
      db: harness.db,
      surface: "slack",
    });
    await upsertRemoteAgentNativeDeliveryRecord(admission);
    await expect(
      harness.query({
        text: `UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET ${assignment} WHERE idempotency_key = $1`,
        values: [admission.idempotencyKey],
      })
    ).rejects.toMatchObject({ code: "23514" });
    await harness.close();
  });
  it("lists only the same requester's recent turns on the current Slack conversation surface", async () => {
    const harness = await createPostgresHarness();
    try {
      const current = await createSlackTurnDiagnosticFixture({
        channelId: "D_CURRENT",
        db: harness.db,
        deliveryId: "delivery_current",
        nowMs: 5000,
        submissionId: "submission_current",
        threadTs: "5000.1",
        triggerMessageId: "5000.1",
        userId: "user_1",
      });
      await createSlackTurnDiagnosticFixture({
        channelId: "D_CURRENT",
        db: harness.db,
        deliveryId: "delivery_previous_1",
        nowMs: 3000,
        publicationState: "published",
        publishedResultId: "3100.1",
        status: "completed",
        submissionId: "submission_previous_1",
        threadTs: "3000.1",
        triggerMessageId: "3000.1",
        userId: "user_1",
      });
      await createSlackTurnDiagnosticFixture({
        channelId: "D_CURRENT",
        db: harness.db,
        deliveryId: "delivery_other_member",
        nowMs: 4000,
        submissionId: "submission_other_member",
        threadTs: "4000.1",
        triggerMessageId: "4000.1",
        userId: "user_2",
      });
      await createSlackTurnDiagnosticFixture({
        channelId: "D_OTHER",
        db: harness.db,
        deliveryId: "delivery_other_channel",
        nowMs: 4500,
        submissionId: "submission_other_channel",
        threadTs: "4500.1",
        triggerMessageId: "4500.1",
        userId: "user_1",
      });
      await expect(
        listRemoteAgentNativeDeliveryTurnDiagnostics({
          currentDelivery: current,
          db: harness.db,
          limit: 10,
        })
      ).resolves.toMatchObject([
        {
          conversationSource: {
            channelId: "D_CURRENT",
            isCurrentConversation: false,
            kind: "slack",
            teamId: "T1",
            threadTs: "3000.1",
          },
          deliveryId: "delivery_previous_1",
          publicationState: "published",
          publishedResultId: "3100.1",
          status: "completed",
          submissionId: "submission_previous_1",
          triggerMessageId: "3000.1",
        },
      ]);
      expect(
        projectRemoteAgentNativeDeliveryTurnDiagnostic({
          ...current,
          conversationKind: "message_channel",
          messageChannelLocator: {
            channelId: "D_CURRENT",
            connectionId: "connection_1",
            provider: "slack",
            rootMessageId: "5000.1",
            teamId: "T_CURRENT",
          },
          providerPublicationResultId: "om_provider_result_1",
          publishedSignalId: null,
        })
      ).toMatchObject({
        conversationSource: {
          isCurrentConversation: true,
          kind: "message_channel",
          locator: {
            channelId: "D_CURRENT",
            rootMessageId: "5000.1",
          },
        },
        publishedResultId: "om_provider_result_1",
      });
      expect(
        projectRemoteAgentNativeDeliveryTurnDiagnostic({
          ...current,
          failureDetail: "x".repeat(2001),
        })
      ).toMatchObject({
        failureDetail: "x".repeat(2000),
        failureDetailTruncated: true,
      });
    } finally {
      await harness.close();
    }
  });
  it.each([
    "space",
    "slack",
    "lark",
  ] as const)("keeps the first %s admission byte-for-byte stable on an exact replay", async (surface) => {
    const harness = await createPostgresHarness();
    try {
      const firstInput = buildImmutableAdmissionInput({
        db: harness.db,
        surface,
      });
      const first = await upsertRemoteAgentNativeDeliveryRecord(firstInput);
      const replay = await upsertRemoteAgentNativeDeliveryRecord({
        ...firstInput,
        nowMs: 2000,
      });
      expect(replay).toEqual(first);
    } finally {
      await harness.close();
    }
  });
  it("replays a Slack admission created with a legacy null working-status turn identity", async () => {
    const harness = await createPostgresHarness();
    try {
      const input = buildImmutableAdmissionInput({
        db: harness.db,
        surface: "slack",
      });
      await upsertRemoteAgentNativeDeliveryRecord(input);
      await harness.query({
        values: [input.idempotencyKey],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET slack_working_status_turn_id = NULL
          WHERE idempotency_key = $1
        `,
      });
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          ...input,
          nowMs: 2000,
        })
      ).resolves.toMatchObject({
        idempotencyKey: input.idempotencyKey,
        slackWorkingStatusTurnId: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("backfills only siblings inside the explicit Slack fan-out lineage", async () => {
    const harness = await createPostgresHarness();
    try {
      const base = buildImmutableAdmissionInput({
        db: harness.db,
        surface: "slack",
      });
      const sharedTurnId = "slack-fanout:T1:turn_1";
      await upsertRemoteAgentNativeDeliveryRecord({
        ...base,
        deliveryId: "delivery_fanout_legacy",
        dispatchId: "dispatch_fanout_legacy",
        idempotencyKey: `${sharedTurnId}:first`,
      });
      await upsertRemoteAgentNativeDeliveryRecord({
        ...base,
        deliveryId: "delivery_independent_continuation",
        dispatchId: "dispatch_independent_continuation",
        idempotencyKey: "remote-agent-task-continuation:independent",
      });
      await upsertRemoteAgentNativeDeliveryRecord({
        ...base,
        deliveryId: "delivery_fanout_current",
        dispatchId: "dispatch_fanout_current",
        idempotencyKey: `${sharedTurnId}:second`,
        slackWorkingStatusTurnId: sharedTurnId,
      });
      expect(
        await harness.queryAll({
          text: `
            SELECT idempotency_key, slack_working_status_turn_id
            FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            ORDER BY idempotency_key
          `,
        })
      ).toEqual([
        {
          idempotency_key: "remote-agent-task-continuation:independent",
          slack_working_status_turn_id: null,
        },
        {
          idempotency_key: `${sharedTurnId}:first`,
          slack_working_status_turn_id: sharedTurnId,
        },
        {
          idempotency_key: `${sharedTurnId}:second`,
          slack_working_status_turn_id: sharedTurnId,
        },
      ]);
    } finally {
      await harness.close();
    }
  });
  it("fails closed when one Slack delivery matches conflicting fan-out lineages", async () => {
    const harness = await createPostgresHarness();
    try {
      const base = buildImmutableAdmissionInput({
        db: harness.db,
        surface: "slack",
      });
      const outerTurnId = "slack-fanout:T1";
      const nestedTurnId = `${outerTurnId}:turn_1`;
      await upsertRemoteAgentNativeDeliveryRecord({
        ...base,
        deliveryId: "delivery_outer_fanout",
        dispatchId: "dispatch_outer_fanout",
        idempotencyKey: `${outerTurnId}:member_a`,
        nowMs: 1000,
        slackWorkingStatusTurnId: outerTurnId,
      });
      await upsertRemoteAgentNativeDeliveryRecord({
        ...base,
        deliveryId: "delivery_nested_fanout",
        dispatchId: "dispatch_nested_fanout",
        idempotencyKey: `${nestedTurnId}:member_b`,
        nowMs: 2000,
        slackWorkingStatusTurnId: nestedTurnId,
      });
      await upsertRemoteAgentNativeDeliveryRecord({
        ...base,
        deliveryId: "delivery_ambiguous_legacy_sibling",
        dispatchId: "dispatch_ambiguous_legacy_sibling",
        idempotencyKey: `${nestedTurnId}:late_legacy_member`,
        nowMs: 3000,
      });
      await expect(
        isLatestRemoteAgentNativeDeliveryActiveForSlackThread({
          channelId: base.slackChannelId ?? "",
          db: harness.db,
          organizationId: base.organizationId,
          teamId: base.slackTeamId ?? "",
          threadTs: base.slackThreadTs ?? "",
        })
      ).rejects.toThrow(
        "Slack working-status turn lineage is ambiguous for the latest trigger"
      );
    } finally {
      await harness.close();
    }
  });
  it.each([
    ["organizationId", { organizationId: "org_other" }],
    ["profileId", { profileId: "profile_agent_other" }],
    ["bindingId", { bindingId: "binding_other" }],
    ["dispatchId", { dispatchId: "dispatch_other" }],
    ["triggerMessageId", { triggerMessageId: "trigger_other" }],
    ["sourceClientMessageId", { sourceClientMessageId: "client_other" }],
    ["spaceId", { spaceId: "space_other" }],
    ["attemptId", { attemptId: "attempt_other" }],
    ["deliveryId", { deliveryId: "delivery_other" }],
    ["onBehalfOfProfileId", { onBehalfOfProfileId: "profile_human_other" }],
    ["onBehalfOfUserId", { onBehalfOfUserId: "user_other" }],
    ["onBehalfOfDisplayName", { onBehalfOfDisplayName: "Other User" }],
    ["triggerText", { triggerText: "Different immutable trigger text" }],
  ] as const)("rejects a replay whose common admission %s changed without mutating any surface row", async (_field, mutation) => {
    for (const surface of ["space", "slack", "lark"] as const) {
      const harness = await createPostgresHarness();
      try {
        const firstInput = buildImmutableAdmissionInput({
          db: harness.db,
          surface,
        });
        const first = await upsertRemoteAgentNativeDeliveryRecord(firstInput);
        await expect(
          upsertRemoteAgentNativeDeliveryRecord({
            ...firstInput,
            ...mutation,
            nowMs: 2000,
          })
        ).rejects.toThrow("immutable admission identity");
        await expect(
          readRemoteAgentNativeDeliveryByIdempotencyKey({
            db: harness.db,
            idempotencyKey: firstInput.idempotencyKey,
          })
        ).resolves.toEqual(first);
      } finally {
        await harness.close();
      }
    }
  });
  it.each([
    [
      "space thread",
      "space",
      {
        threadContext: {
          rootSignalId: "signal_thread_root_other",
          threadId: "thr_22222222-2222-4222-8222-222222222222",
        },
      },
    ],
    ["Slack team", "slack", { slackTeamId: "T_OTHER" }],
    ["Slack channel", "slack", { slackChannelId: "C_OTHER" }],
    ["Slack thread", "slack", { slackThreadTs: "200.2" }],
    [
      "Lark locator",
      "lark",
      {
        messageChannelLocator: {
          appId: "cli_lark_1",
          chatId: "oc_other_chat",
          connectionId: "connection_lark_1",
          provider: "lark",
          rootMessageId: "om_other_root",
          tenantKey: "tenant_lark_1",
          threadId: "omt_other_thread",
        },
      },
    ],
    [
      "provider publication identity",
      "lark",
      { providerPublicationIdempotencyKey: "publication_other" },
    ],
  ] as const)("rejects a replay whose %s changed and leaves the original origin locator untouched", async (_field, surface, mutation) => {
    const harness = await createPostgresHarness();
    try {
      const firstInput = buildImmutableAdmissionInput({
        db: harness.db,
        surface,
      });
      const first = await upsertRemoteAgentNativeDeliveryRecord(firstInput);
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          ...firstInput,
          ...mutation,
          nowMs: 2000,
        })
      ).rejects.toThrow("immutable admission identity");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: firstInput.idempotencyKey,
        })
      ).resolves.toEqual(first);
    } finally {
      await harness.close();
    }
  });
  it("does not downgrade a completed delivery when the same trigger is retried", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_1",
      });
      await markRemoteAgentNativeDeliveryCompleted({
        db: harness.db,
        nowMs: 1200,
        submissionId: "sub_1",
        publishedSignalId: "signal_reply_1",
      });
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          db: harness.db,
          nowMs: 1300,
          organizationId: "org_1",
          spaceId: "space_1",
          profileId: "profile_agent_1",
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          attemptId: "attempt_retry",
          idempotencyKey: "space_1:dispatch_1",
          status: "submitted",
        })
      ).rejects.toThrow("immutable admission identity");
      await markRemoteAgentNativeDeliveryAck({
        db: harness.db,
        nowMs: 1400,
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_1",
        workerRequestId: "req_retry",
        accepted: false,
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        status: "completed",
        publishedSignalId: "signal_reply_1",
        workerRequestId: "req_1",
      });
    } finally {
      await harness.close();
    }
  });
  it("freezes a typed Lark locator without dual-writing legacy Slack columns", async () => {
    const harness = await createPostgresHarness();
    try {
      const locator = {
        provider: "lark" as const,
        connectionId: "connection_lark_1",
        appId: "cli_lark_1",
        tenantKey: "tenant_lark_1",
        chatId: "oc_chat_1",
        rootMessageId: "om_root_1",
        threadId: "omt_thread_1",
      };
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          db: harness.db,
          nowMs: 1000,
          organizationId: "org_1",
          conversationKind: "message_channel",
          spaceId: "space_1",
          profileId: "profile_agent_1",
          bindingId: "binding_1",
          triggerMessageId: "om_trigger_1",
          dispatchId: "dispatch_lark_1",
          attemptId: "attempt_lark_1",
          idempotencyKey: "lark_delivery_1",
          status: "submitted",
          messageChannelLocator: locator,
          providerPublicationIdempotencyKey: "lark_publication_1",
        })
      ).resolves.toMatchObject({
        conversationKind: "message_channel",
        messageChannelLocator: locator,
        providerPublicationIdempotencyKey: "lark_publication_1",
        providerPublicationResultId: null,
        providerProgressCardId: null,
        providerProgressClaimExpiresAtMs: null,
        providerProgressClaimId: null,
        providerProgressClaimedAtMs: null,
        providerProgressFailureCode: null,
        providerProgressMessageId: null,
        providerProgressPendingSequence: null,
        providerProgressPendingCardId: null,
        providerProgressPendingSourceOffset: null,
        providerProgressPendingTextHash: null,
        providerProgressPublicationIdempotencyKey: null,
        providerProgressRolloverIndex: 0,
        providerProgressSequence: null,
        providerProgressSourceOffset: 0,
        providerProgressState: null,
        slackTeamId: null,
        slackChannelId: null,
        slackThreadTs: null,
      });
      expect(
        await harness.queryFirst<{
          message_channel_connection_id: string | null;
          message_channel_provider: string | null;
          slack_team_id: string | null;
        }>({
          text: `
            SELECT
              message_channel_provider,
              message_channel_connection_id,
              slack_team_id
            FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
            WHERE idempotency_key = 'lark_delivery_1'
          `,
        })
      ).toEqual({
        message_channel_connection_id: "connection_lark_1",
        message_channel_provider: "lark",
        slack_team_id: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("adapts complete legacy Slack columns into the typed locator", async () => {
    const harness = await createPostgresHarness();
    try {
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          db: harness.db,
          nowMs: 1000,
          organizationId: "org_1",
          conversationKind: "slack",
          spaceId: "space_1",
          profileId: "profile_agent_1",
          bindingId: "binding_1",
          triggerMessageId: "1700000000.000100",
          dispatchId: "dispatch_slack_1",
          attemptId: "attempt_slack_1",
          idempotencyKey: "slack_delivery_1",
          status: "submitted",
          slackTeamId: "T123",
          slackChannelId: "C123",
          slackThreadTs: "1700000000.000100",
        })
      ).resolves.toMatchObject({
        conversationKind: "slack",
        messageChannelLocator: {
          provider: "slack",
          connectionId: "T123",
          teamId: "T123",
          channelId: "C123",
          rootMessageId: "1700000000.000100",
        },
      });
    } finally {
      await harness.close();
    }
  });
  it("refuses to reroute a submitted Message Channel delivery", async () => {
    const harness = await createPostgresHarness();
    try {
      const baseInput = {
        attemptId: "attempt_lark_1",
        bindingId: "binding_1",
        conversationKind: "message_channel" as const,
        db: harness.db,
        dispatchId: "dispatch_lark_1",
        idempotencyKey: "lark_delivery_frozen",
        nowMs: 1000,
        organizationId: "org_1",
        profileId: "profile_agent_1",
        providerPublicationIdempotencyKey: "lark_publication_frozen",
        spaceId: "lark:connection_lark_1:oc_chat_1:om_root_1",
        status: "submitted" as const,
        triggerMessageId: "om_trigger_1",
      };
      await upsertRemoteAgentNativeDeliveryRecord({
        ...baseInput,
        messageChannelLocator: {
          provider: "lark",
          connectionId: "connection_lark_1",
          appId: "cli_lark_1",
          tenantKey: null,
          chatId: "oc_chat_1",
          rootMessageId: "om_root_1",
          threadId: null,
        },
      });
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          ...baseInput,
          nowMs: 1100,
          messageChannelLocator: {
            provider: "lark",
            connectionId: "connection_lark_1",
            appId: "cli_lark_1",
            tenantKey: null,
            chatId: "oc_other_chat",
            rootMessageId: "om_other_root",
            threadId: null,
          },
        })
      ).rejects.toThrow("immutable admission identity");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "lark_delivery_frozen",
        })
      ).resolves.toMatchObject({
        messageChannelLocator: {
          chatId: "oc_chat_1",
          rootMessageId: "om_root_1",
        },
        updatedAtMs: 1000,
      });
    } finally {
      await harness.close();
    }
  });
  it("freezes the conversation kind before any delivery is accepted", async () => {
    const harness = await createPostgresHarness();
    try {
      const sharedInput = {
        attemptId: "attempt_1",
        bindingId: "binding_1",
        db: harness.db,
        dispatchId: "dispatch_1",
        nowMs: 1000,
        organizationId: "org_1",
        profileId: "profile_agent_1",
        spaceId: "space_1",
        status: "submitted" as const,
        triggerMessageId: "trigger_1",
      };
      await upsertRemoteAgentNativeDeliveryRecord({
        ...sharedInput,
        conversationKind: "space",
        idempotencyKey: "frozen_space_delivery",
      });
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          ...sharedInput,
          conversationKind: "message_channel",
          idempotencyKey: "frozen_space_delivery",
          messageChannelLocator: {
            provider: "lark",
            connectionId: "connection_lark_1",
            appId: "cli_lark_1",
            tenantKey: null,
            chatId: "oc_chat_1",
            rootMessageId: "om_root_1",
            threadId: null,
          },
          nowMs: 1100,
          providerPublicationIdempotencyKey: "publication_1",
        })
      ).rejects.toThrow("immutable admission identity");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "frozen_space_delivery",
        })
      ).resolves.toMatchObject({
        conversationKind: "space",
        messageChannelLocator: null,
        updatedAtMs: 1000,
      });
      await upsertRemoteAgentNativeDeliveryRecord({
        ...sharedInput,
        conversationKind: "message_channel",
        idempotencyKey: "frozen_message_channel_delivery",
        messageChannelLocator: {
          provider: "lark",
          connectionId: "connection_lark_1",
          appId: "cli_lark_1",
          tenantKey: null,
          chatId: "oc_chat_1",
          rootMessageId: "om_root_1",
          threadId: null,
        },
        providerPublicationIdempotencyKey: "publication_2",
      });
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          ...sharedInput,
          conversationKind: "space",
          idempotencyKey: "frozen_message_channel_delivery",
          nowMs: 1100,
        })
      ).rejects.toThrow("immutable admission identity");
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "frozen_message_channel_delivery",
        })
      ).resolves.toMatchObject({
        conversationKind: "message_channel",
        providerPublicationIdempotencyKey: "publication_2",
        updatedAtMs: 1000,
      });
    } finally {
      await harness.close();
    }
  });
  it("fails closed for missing or malformed durable Message Channel locators", async () => {
    const harness = await createPostgresHarness();
    try {
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          db: harness.db,
          nowMs: 1000,
          organizationId: "org_1",
          conversationKind: "message_channel",
          spaceId: "space_1",
          profileId: "profile_agent_1",
          bindingId: "binding_1",
          triggerMessageId: "om_trigger_1",
          dispatchId: "dispatch_lark_missing",
          attemptId: "attempt_lark_missing",
          idempotencyKey: "lark_delivery_missing",
          status: "submitted",
          providerPublicationIdempotencyKey: "lark_publication_missing",
        })
      ).rejects.toThrow("requires a typed conversation locator");
      await upsertRemoteAgentNativeDeliveryRecord({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        conversationKind: "message_channel",
        spaceId: "space_1",
        profileId: "profile_agent_1",
        bindingId: "binding_1",
        triggerMessageId: "om_trigger_2",
        dispatchId: "dispatch_lark_malformed",
        attemptId: "attempt_lark_malformed",
        idempotencyKey: "lark_delivery_malformed",
        status: "submitted",
        messageChannelLocator: {
          provider: "lark",
          connectionId: "connection_lark_1",
          appId: "cli_lark_1",
          tenantKey: null,
          chatId: "oc_chat_1",
          rootMessageId: "om_root_1",
          threadId: null,
        },
        providerPublicationIdempotencyKey: "lark_publication_malformed",
      });
      await harness.query({
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET message_channel_locator_json = '{"provider":"lark"}'
          WHERE idempotency_key = 'lark_delivery_malformed'
        `,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "lark_delivery_malformed",
        })
      ).rejects.toThrow("invalid durable Message Channel locator");
    } finally {
      await harness.close();
    }
  });
  it("rejects a corrupt conversation kind or provider publication identity", async () => {
    const harness = await createPostgresHarness();
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        conversationKind: "message_channel",
        spaceId: "space_1",
        profileId: "profile_agent_1",
        bindingId: "binding_1",
        triggerMessageId: "om_trigger_1",
        dispatchId: "dispatch_lark_corrupt",
        attemptId: "attempt_lark_corrupt",
        idempotencyKey: "lark_delivery_corrupt",
        status: "submitted",
        messageChannelLocator: {
          provider: "lark",
          connectionId: "connection_lark_1",
          appId: "cli_lark_1",
          tenantKey: null,
          chatId: "oc_chat_1",
          rootMessageId: "om_root_1",
          threadId: null,
        },
        providerPublicationIdempotencyKey: "publication_corrupt",
      });
      await harness.query({
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET provider_publication_idempotency_key = NULL
          WHERE idempotency_key = 'lark_delivery_corrupt'
        `,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "lark_delivery_corrupt",
        })
      ).rejects.toThrow("invalid provider publication identity");
      await harness.query({
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET
            conversation_kind = 'unknown',
            provider_publication_idempotency_key = 'publication_corrupt'
          WHERE idempotency_key = 'lark_delivery_corrupt'
        `,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "lark_delivery_corrupt",
        })
      ).rejects.toThrow("invalid conversation kind");
    } finally {
      await harness.close();
    }
  });
  it("records unknown callback submissions as rejected ledger roots", async () => {
    const harness = await createPostgresHarness();
    try {
      await expect(
        insertRemoteAgentRejectedCallbackRecord({
          db: harness.db,
          nowMs: 1000,
          organizationId: "org_1",
          spaceId: "space_1",
          profileId: "profile_agent_1",
          bindingId: "binding_1",
          triggerMessageId: "signal_1",
          dispatchId: "dispatch_1",
          idempotencyKey: "space_1:dispatch_1",
          submissionId: "sub_unknown",
          failureCode: "remote_agent.callback_unknown_submission",
        })
      ).resolves.toMatchObject({
        status: "callback_rejected",
        failureCode: "remote_agent.callback_unknown_submission",
        callbackReceivedAtMs: 1000,
      });
    } finally {
      await harness.close();
    }
  });
  it("keeps durable two-way Routine Run tracing across idempotent retries", async () => {
    const harness = await createPostgresHarness();
    try {
      const first = await upsertRemoteAgentNativeDeliveryRecord({
        db: harness.db,
        nowMs: 1000,
        organizationId: "org_1",
        spaceId: "space_1",
        profileId: "profile_agent_1",
        bindingId: "binding_1",
        triggerMessageId: "run_1",
        dispatchId: "run_1",
        attemptId: null,
        idempotencyKey: "run_1",
        routineRunId: "run_1",
        routineNameSnapshot: "Daily feedback review",
        status: "submitted",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "run_1",
        nowMs: 1100,
        submissionId: "sub_routine_1",
      });
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          db: harness.db,
          nowMs: 1200,
          organizationId: "org_1",
          spaceId: "space_1",
          profileId: "profile_agent_1",
          bindingId: "binding_1",
          triggerMessageId: "run_1",
          dispatchId: "run_1",
          attemptId: null,
          idempotencyKey: "run_1",
          routineRunId: "run_other",
          routineNameSnapshot: "Changed name",
          status: "submitted",
        })
      ).rejects.toThrow("immutable admission identity");
      expect(first.deliveryId).toBeTruthy();
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_routine_1",
        })
      ).resolves.toMatchObject({
        deliveryId: first.deliveryId,
        routineNameSnapshot: "Daily feedback review",
        routineRunId: "run_1",
      });
      await expect(
        upsertRemoteAgentNativeDeliveryRecord({
          db: harness.db,
          nowMs: 1300,
          organizationId: "org_1",
          spaceId: "space_1",
          profileId: "profile_agent_1",
          bindingId: "binding_1",
          triggerMessageId: "run_1",
          dispatchId: "run_1_second_delivery",
          attemptId: null,
          idempotencyKey: "run_1_second_delivery",
          routineRunId: "run_1",
          routineNameSnapshot: "Daily feedback review",
          status: "submitted",
        })
      ).resolves.toMatchObject({
        routineRunId: "run_1",
        idempotencyKey: "run_1_second_delivery",
        dispatchId: "run_1_second_delivery",
      });
      // Migration 0063 permits linked continuation deliveries; immutable
      // admission identity above still prevents reassigning an existing one.
      expect(
        await harness.queryAll({
          text: 'SELECT delivery_id FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE routine_run_id = \'run_1\'',
        })
      ).toHaveLength(2);
    } finally {
      await harness.close();
    }
  });
  it("records completed callback retries without changing the completed outcome", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_1",
      });
      await markRemoteAgentNativeDeliveryCompleted({
        db: harness.db,
        nowMs: 1200,
        submissionId: "sub_1",
        publishedSignalId: "signal_reply_1",
      });
      await markRemoteAgentCallbackRejected({
        db: harness.db,
        nowMs: 1300,
        submissionId: "sub_1",
        idempotencyKey: "space_1:dispatch_1",
        failureCode: "remote_agent.callback_completed_submission",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        status: "completed",
        failureCode: null,
        callbackReceivedAtMs: 1200,
        publishedSignalId: "signal_reply_1",
      });
    } finally {
      await harness.close();
    }
  });
  it("persists a terminal callback failure detail for hosted diagnostics", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_context_window",
        submissionId: "sub_context_window",
      });
      const failureDetail =
        "This endpoint's maximum context length is 500000 tokens. However, you requested about 516153 tokens.";
      await claimRemoteAgentFinalPublication({
        claimExpiresAtMs: 2000,
        claimId: "claim_context_window",
        db: harness.db,
        idempotencyKey: "space_1:dispatch_context_window",
        nowMs: 1200,
        payload: {
          failureCode: "remote_agent.turn.context_window_exceeded",
          failureDetail,
          resumeStatus: "accepted",
          storageVersion: 1,
          text: "The hosted turn exceeded its context window.",
        },
        submissionId: "sub_context_window",
        terminalFailureCode: "remote_agent.turn.context_window_exceeded",
        terminalFailureDetail: failureDetail,
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_context_window",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.turn.context_window_exceeded",
        failureDetail,
        status: "failed",
      });
    } finally {
      await harness.close();
    }
  });
  it("does not reopen a failed delivery when a late ACK or callback arrives", async () => {
    const harness = await createPostgresHarness();
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding_1",
        db: harness.db,
        dispatchId: "routine_run_1",
        failureCode: "remote_agent.worker_ack_recovery_expired",
        idempotencyKey: "routine_run_1",
        nowMs: 1000,
        organizationId: "org_1",
        profileId: "profile_agent_1",
        routineNameSnapshot: "Daily review",
        routineRunId: "routine_run_1",
        spaceId: "space_1",
        status: "failed",
        triggerMessageId: "routine_run_1",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "routine_run_1",
        nowMs: 2000,
        submissionId: "sub_late",
      });
      await markRemoteAgentCallbackRejected({
        db: harness.db,
        failureCode: "remote_agent.callback_unknown_submission",
        idempotencyKey: "routine_run_1",
        nowMs: 3000,
        submissionId: null,
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "routine_run_1",
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.worker_ack_recovery_expired",
        status: "failed",
        submissionId: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("retains Routine requests through ACK and clears all requests at their privacy boundaries", async () => {
    const harness = await createPostgresHarness();
    try {
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: "attempt_ordinary_1",
        bindingId: "binding_1",
        db: harness.db,
        dispatchId: "dispatch_ordinary_1",
        idempotencyKey: "space_1:dispatch_ordinary_1",
        nowMs: 900,
        organizationId: "org_1",
        profileId: "profile_agent_1",
        spaceId: "space_1",
        status: "submitted",
        triggerMessageId: "signal_ordinary_1",
      });
      await harness.query({
        values: [
          '{"sensitive":"ordinary instructions"}',
          "space_1:dispatch_ordinary_1",
        ],
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET worker_submit_request_json = $1 WHERE idempotency_key = $2',
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "space_1:dispatch_ordinary_1",
        nowMs: 950,
        submissionId: "sub_ordinary_1",
      });
      expect(
        await harness.queryFirst<{
          worker_submit_request_json: string | null;
        }>({
          values: ["space_1:dispatch_ordinary_1"],
          text: 'SELECT worker_submit_request_json FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE idempotency_key = $1',
        })
      ).toEqual({ worker_submit_request_json: null });
      await upsertRemoteAgentNativeDeliveryRecord({
        attemptId: null,
        bindingId: "binding_1",
        db: harness.db,
        dispatchId: "routine_run_1",
        idempotencyKey: "routine_run_1",
        nowMs: 1000,
        organizationId: "org_1",
        profileId: "profile_agent_1",
        routineNameSnapshot: "Daily review",
        routineRunId: "routine_run_1",
        spaceId: "space_1",
        status: "submitted",
        triggerMessageId: "routine_run_1",
      });
      await harness.query({
        values: ['{"sensitive":"instructions and memory"}', "routine_run_1"],
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET worker_submit_request_json = $1 WHERE idempotency_key = $2',
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "routine_run_1",
        nowMs: 1100,
        submissionId: "sub_routine_1",
      });
      expect(
        await harness.queryFirst<{
          worker_submit_request_json: string | null;
        }>({
          values: ["routine_run_1"],
          text: 'SELECT worker_submit_request_json FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE idempotency_key = $1',
        })
      ).toEqual({
        worker_submit_request_json: '{"sensitive":"instructions and memory"}',
      });
      await markRemoteAgentNativeDeliveryCompleted({
        db: harness.db,
        nowMs: 1200,
        publishedSignalId: null,
        submissionId: "sub_routine_1",
      });
      expect(
        await harness.queryFirst<{
          worker_submit_request_json: string | null;
        }>({
          values: ["routine_run_1"],
          text: 'SELECT worker_submit_request_json FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE idempotency_key = $1',
        })
      ).toEqual({ worker_submit_request_json: null });
      await harness.query({
        values: ['{"sensitive":"new memory"}', "routine_run_1"],
        text: 'UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger" SET worker_submit_request_json = $1 WHERE idempotency_key = $2',
      });
      const coreEnv = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      expect(createCoreCenterAgentMemoryService(coreEnv)).toBeNull();
      await expect(
        clearCoreCenterAgentOrganizationNativeDeliveryData(coreEnv, "org_1")
      ).resolves.toBe(true);
      expect(
        await harness.queryFirst<{
          worker_submit_request_json: string | null;
        }>({
          values: ["routine_run_1"],
          text: 'SELECT worker_submit_request_json FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" WHERE idempotency_key = $1',
        })
      ).toEqual({ worker_submit_request_json: null });
    } finally {
      await harness.close();
    }
  });
  it("rejects unknown final publication states instead of hiding ledger corruption", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_1",
      });
      await harness.query({
        values: ["sub_1"],
        text: `
          UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
          SET final_publication_state = 'unexpected'
          WHERE submission_id = $1
        `,
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).rejects.toThrow(
        "Invalid Remote Agent final publication state: unexpected"
      );
    } finally {
      await harness.close();
    }
  });
  it("clears member trigger text without changing other ledger metadata", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        onBehalfOfUserId: "user_1",
        submissionId: "sub_1",
        triggerText: "Remember this private member text.",
      });
      const before = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "sub_1",
      });
      if (!before) {
        throw new Error("Expected native delivery row before cleanup");
      }
      const coreEnv = {
        OPENMELD_POSTGRESQL: postgresTestBinding(harness.db),
      } as unknown as CoreBindings;
      expect(createCoreCenterAgentMemoryService(coreEnv)).toBeNull();
      await expect(
        clearCoreCenterAgentMemberNativeDeliveryData(coreEnv, "org_1", "user_1")
      ).resolves.toBe(true);
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        ...before,
        triggerText: null,
      });
    } finally {
      await harness.close();
    }
  });
  it("clears organization trigger text without changing other ledger metadata", async () => {
    const harness = await createPostgresHarness();
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        onBehalfOfUserId: "user_1",
        submissionId: "sub_1",
        triggerText: "Remember this organization text.",
      });
      const before = await readRemoteAgentNativeDeliveryBySubmissionId({
        db: harness.db,
        submissionId: "sub_1",
      });
      if (!before) {
        throw new Error("Expected native delivery row before cleanup");
      }
      await clearRemoteAgentNativeDeliveryTriggerTextForOrganization({
        db: harness.db,
        organizationId: "org_1",
      });
      await expect(
        readRemoteAgentNativeDeliveryBySubmissionId({
          db: harness.db,
          submissionId: "sub_1",
        })
      ).resolves.toMatchObject({
        ...before,
        triggerText: null,
      });
    } finally {
      await harness.close();
    }
  });
});
function buildImmutableAdmissionInput(input: {
  db: PostgresDatabase;
  surface: "lark" | "slack" | "space";
}): Parameters<typeof upsertRemoteAgentNativeDeliveryRecord>[0] {
  const common = {
    attemptId: "attempt_immutable_1",
    bindingId: "binding_immutable_1",
    db: input.db,
    deliveryId: `delivery_immutable_${input.surface}`,
    dispatchId: `dispatch_immutable_${input.surface}`,
    idempotencyKey: `delivery_immutable_${input.surface}`,
    nowMs: 1000,
    onBehalfOfDisplayName: "Ari",
    onBehalfOfProfileId: "profile_human_1",
    onBehalfOfUserId: "user_1",
    organizationId: "org_immutable_1",
    profileId: "profile_agent_immutable_1",
    sourceClientMessageId: "client_immutable_1",
    status: "submitted" as const,
    triggerMessageId: `trigger_immutable_${input.surface}`,
    triggerText: "Original immutable trigger text",
  };
  if (input.surface === "space") {
    return {
      ...common,
      conversationKind: "space",
      spaceId: "space_immutable_1",
      threadContext: {
        rootSignalId: "signal_thread_root",
        threadId: "thr_11111111-1111-4111-8111-111111111111",
      },
    };
  }
  if (input.surface === "slack") {
    return {
      ...common,
      conversationKind: "slack",
      slackChannelId: "C1",
      slackTeamId: "T1",
      slackThreadTs: "100.1",
      spaceId: "slack:T1:C1:100.1",
    };
  }
  return {
    ...common,
    conversationKind: "message_channel",
    messageChannelLocator: {
      appId: "cli_lark_1",
      chatId: "oc_chat_1",
      connectionId: "connection_lark_1",
      provider: "lark",
      rootMessageId: "om_root_1",
      tenantKey: "tenant_lark_1",
      threadId: "omt_thread_1",
    },
    providerPublicationIdempotencyKey: "publication_immutable_lark",
    spaceId: "lark:connection_lark_1:oc_chat_1:om_root_1",
  };
}
async function createAcceptedDelivery(input: {
  db: PostgresDatabase;
  idempotencyKey: string;
  onBehalfOfUserId?: string | null;
  submissionId: string;
  triggerText?: string | null;
}): Promise<void> {
  await upsertRemoteAgentNativeDeliveryRecord({
    db: input.db,
    nowMs: 1000,
    organizationId: "org_1",
    spaceId: "space_1",
    profileId: "profile_agent_1",
    bindingId: "binding_1",
    triggerMessageId: "signal_1",
    dispatchId: "dispatch_1",
    attemptId: "attempt_1",
    idempotencyKey: input.idempotencyKey,
    status: "submitted",
    onBehalfOfProfileId: "profile_human_1",
    onBehalfOfUserId: input.onBehalfOfUserId ?? null,
    onBehalfOfDisplayName: "Ari",
    triggerText: input.triggerText ?? null,
  });
  await markRemoteAgentNativeDeliveryAck({
    db: input.db,
    nowMs: 1100,
    idempotencyKey: input.idempotencyKey,
    submissionId: input.submissionId,
    workerRequestId: "req_1",
    accepted: true,
  });
}
async function createSlackTurnDiagnosticFixture(input: {
  channelId: string;
  db: PostgresDatabase;
  deliveryId: string;
  nowMs: number;
  publicationState?: "claimed" | "outcome_unknown" | "published";
  publishedResultId?: string;
  status?: "accepted" | "completed";
  submissionId: string;
  threadTs: string;
  triggerMessageId: string;
  userId: string;
}) {
  await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: `attempt_${input.deliveryId}`,
    bindingId: "binding_1",
    conversationKind: "slack",
    db: input.db,
    deliveryId: input.deliveryId,
    dispatchId: `dispatch_${input.deliveryId}`,
    idempotencyKey: `idempotency_${input.deliveryId}`,
    nowMs: input.nowMs,
    onBehalfOfDisplayName: input.userId,
    onBehalfOfProfileId: `profile_${input.userId}`,
    onBehalfOfUserId: input.userId,
    organizationId: "org_1",
    profileId: "profile_agent_1",
    slackChannelId: input.channelId,
    slackTeamId: "T1",
    slackThreadTs: input.threadTs,
    spaceId: `slack:T1:${input.channelId}:${input.threadTs}`,
    status: "submitted",
    triggerMessageId: input.triggerMessageId,
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db: input.db,
    idempotencyKey: `idempotency_${input.deliveryId}`,
    nowMs: input.nowMs + 10,
    submissionId: input.submissionId,
    workerRequestId: `worker_${input.deliveryId}`,
  });
  await harnessUpdateTurnDiagnostic({
    db: input.db,
    deliveryId: input.deliveryId,
    nowMs: input.nowMs + 20,
    publicationState: input.publicationState ?? null,
    publishedResultId: input.publishedResultId ?? null,
    status: input.status ?? "accepted",
  });
  const delivery = await readRemoteAgentNativeDeliveryBySubmissionId({
    db: input.db,
    submissionId: input.submissionId,
  });
  if (!delivery) {
    throw new Error("expected Slack turn diagnostic fixture");
  }
  return delivery;
}
async function harnessUpdateTurnDiagnostic(input: {
  db: PostgresDatabase;
  deliveryId: string;
  nowMs: number;
  publicationState: "claimed" | "outcome_unknown" | "published" | null;
  publishedResultId: string | null;
  status: "accepted" | "completed";
}) {
  return await input.db.query({
    ...{
      text: `
        UPDATE "openmeld"."openMeldRemoteAgent_native_delivery_ledger"
        SET
          status = $1,
          final_publication_state = $2,
          published_signal_id = $3,
          completed_at_ms = CASE WHEN $4 = 'completed' THEN $5::bigint ELSE NULL END,
          updated_at_ms = $6
        WHERE delivery_id = $7
      `,
      values: [],
    },
    values: [
      input.status,
      input.publicationState,
      input.publishedResultId,
      input.status,
      input.nowMs,
      input.nowMs,
      input.deliveryId,
    ],
  });
}
