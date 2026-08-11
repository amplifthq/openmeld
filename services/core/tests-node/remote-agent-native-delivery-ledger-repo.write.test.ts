import { describe, expect, it } from "vitest";
import {
  clearCoreCenterAgentMemberNativeDeliveryData,
  clearCoreCenterAgentOrganizationNativeDeliveryData,
  createCoreCenterAgentMemoryService,
} from "../src/center-agent-memory/core-memory-service";
import type { CoreBindings } from "../src/lib/bindings";
import {
  claimRemoteAgentFinalPublication,
  clearRemoteAgentNativeDeliveryTriggerTextForOrganization,
  insertRemoteAgentRejectedCallbackRecord,
  markRemoteAgentCallbackRejected,
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  readRemoteAgentNativeDeliveryBySubmissionId,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Remote Agent native delivery ledger repo", () => {
  it.each([
    "space",
    "slack",
    "lark",
  ] as const)("keeps the first %s admission byte-for-byte stable on an exact replay", async (surface) => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
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
      const harness = createSqliteD1Harness();
      applyRemoteAgentLedgerMigration(harness);
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
        harness.close();
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
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("does not downgrade a completed delivery when the same trigger is retried", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("freezes a typed Lark locator without dual-writing legacy Slack columns", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
        harness.queryFirst<{
          message_channel_connection_id: string | null;
          message_channel_provider: string | null;
          slack_team_id: string | null;
        }>({
          sql: `
            SELECT
              message_channel_provider,
              message_channel_connection_id,
              slack_team_id
            FROM openMeldRemoteAgent_native_delivery_ledger
            WHERE idempotency_key = 'lark_delivery_1'
          `,
        })
      ).toEqual({
        message_channel_connection_id: "connection_lark_1",
        message_channel_provider: "lark",
        slack_team_id: null,
      });
    } finally {
      harness.close();
    }
  });

  it("adapts complete legacy Slack columns into the typed locator", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("refuses to reroute a submitted Message Channel delivery", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("freezes the conversation kind before any delivery is accepted", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("fails closed for missing or malformed durable Message Channel locators", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.run({
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
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
      harness.close();
    }
  });

  it("rejects a corrupt conversation kind or provider publication identity", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.run({
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
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

      harness.run({
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
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
      harness.close();
    }
  });

  it("records unknown callback submissions as rejected ledger roots", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("keeps durable two-way Routine Run tracing across idempotent retries", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      ).rejects.toThrow();
    } finally {
      harness.close();
    }
  });

  it("records completed callback retries without changing the completed outcome", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("persists a terminal callback failure detail for hosted diagnostics", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("does not reopen a failed delivery when a late ACK or callback arrives", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });

  it("retains Routine requests through ACK and clears all requests at their privacy boundaries", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.run({
        params: [
          '{"sensitive":"ordinary instructions"}',
          "space_1:dispatch_ordinary_1",
        ],
        sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET worker_submit_request_json = ? WHERE idempotency_key = ?",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "space_1:dispatch_ordinary_1",
        nowMs: 950,
        submissionId: "sub_ordinary_1",
      });
      expect(
        harness.queryFirst<{ worker_submit_request_json: string | null }>({
          params: ["space_1:dispatch_ordinary_1"],
          sql: "SELECT worker_submit_request_json FROM openMeldRemoteAgent_native_delivery_ledger WHERE idempotency_key = ?",
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
      harness.run({
        params: ['{"sensitive":"instructions and memory"}', "routine_run_1"],
        sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET worker_submit_request_json = ? WHERE idempotency_key = ?",
      });
      await markRemoteAgentNativeDeliveryAck({
        accepted: true,
        db: harness.db,
        idempotencyKey: "routine_run_1",
        nowMs: 1100,
        submissionId: "sub_routine_1",
      });
      expect(
        harness.queryFirst<{ worker_submit_request_json: string | null }>({
          params: ["routine_run_1"],
          sql: "SELECT worker_submit_request_json FROM openMeldRemoteAgent_native_delivery_ledger WHERE idempotency_key = ?",
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
        harness.queryFirst<{ worker_submit_request_json: string | null }>({
          params: ["routine_run_1"],
          sql: "SELECT worker_submit_request_json FROM openMeldRemoteAgent_native_delivery_ledger WHERE idempotency_key = ?",
        })
      ).toEqual({ worker_submit_request_json: null });

      harness.run({
        params: ['{"sensitive":"new memory"}', "routine_run_1"],
        sql: "UPDATE openMeldRemoteAgent_native_delivery_ledger SET worker_submit_request_json = ? WHERE idempotency_key = ?",
      });
      const coreEnv = {
        OPENMELD_DB: harness.db,
      } as unknown as CoreBindings;
      expect(createCoreCenterAgentMemoryService(coreEnv)).toBeNull();
      await expect(
        clearCoreCenterAgentOrganizationNativeDeliveryData(coreEnv, "org_1")
      ).resolves.toBe(true);
      expect(
        harness.queryFirst<{ worker_submit_request_json: string | null }>({
          params: ["routine_run_1"],
          sql: "SELECT worker_submit_request_json FROM openMeldRemoteAgent_native_delivery_ledger WHERE idempotency_key = ?",
        })
      ).toEqual({ worker_submit_request_json: null });
    } finally {
      harness.close();
    }
  });

  it("rejects unknown final publication states instead of hiding ledger corruption", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
    try {
      await createAcceptedDelivery({
        db: harness.db,
        idempotencyKey: "space_1:dispatch_1",
        submissionId: "sub_1",
      });
      harness.run({
        params: ["sub_1"],
        sql: `
          UPDATE openMeldRemoteAgent_native_delivery_ledger
          SET final_publication_state = 'unexpected'
          WHERE submission_id = ?
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
      harness.close();
    }
  });

  it("clears member trigger text without changing other ledger metadata", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
        OPENMELD_DB: harness.db,
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
      harness.close();
    }
  });

  it("clears organization trigger text without changing other ledger metadata", async () => {
    const harness = createSqliteD1Harness();
    applyRemoteAgentLedgerMigration(harness);
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
      harness.close();
    }
  });
});

function buildImmutableAdmissionInput(input: {
  db: D1Database;
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

function applyRemoteAgentLedgerMigration(
  input: Parameters<typeof applyMigrationForTable>[0]
) {
  applyMigrationForTable(input, "openMeldRemoteAgent_native_delivery_ledger");
}

async function createAcceptedDelivery(input: {
  db: D1Database;
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
