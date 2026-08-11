import { describe, expect, it } from "vitest";
import {
  claimRemoteAgentMessageChannelProviderCardCreation,
  claimRemoteAgentMessageChannelProviderCardRolloverCreation,
  claimRemoteAgentMessageChannelProviderCardRolloverFinalize,
  claimRemoteAgentMessageChannelProviderCardRolloverSend,
  claimRemoteAgentMessageChannelProviderCardSend,
  claimRemoteAgentMessageChannelProviderCardUpdate,
  expireRemoteAgentMessageChannelProviderProgressClaim,
  markRemoteAgentMessageChannelProviderCardCreated,
  markRemoteAgentMessageChannelProviderCardCreationOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardRolloverCreated,
  markRemoteAgentMessageChannelProviderCardRolloverCreationFailed,
  markRemoteAgentMessageChannelProviderCardRolloverFinalizePublished,
  markRemoteAgentMessageChannelProviderCardRolloverSendOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardRolloverSent,
  markRemoteAgentMessageChannelProviderCardSendOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardSent,
  markRemoteAgentMessageChannelProviderCardUnavailable,
  markRemoteAgentMessageChannelProviderCardUpdateFailed,
  markRemoteAgentMessageChannelProviderCardUpdateOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardUpdatePublished,
} from "../src/remote-agent/infrastructure/d1/message-channel-provider-progress-repo";
import {
  claimRemoteAgentFinalPublication,
  markRemoteAgentNativeDeliveryAck,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

describe("Message Channel provider progress repo", () => {
  it("claims card creation once and fences every transition", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createMessageChannelDelivery(harness.db, "delivery_create");

      await expect(
        claimRemoteAgentMessageChannelProviderCardCreation({
          claimExpiresAtMs: 2000,
          claimId: "create_claim_1",
          db: harness.db,
          idempotencyKey: "delivery_create",
          nowMs: 1000,
        })
      ).resolves.toMatchObject({
        delivery: {
          providerProgressClaimId: "create_claim_1",
          providerProgressState: "create_claimed",
        },
        status: "claimed",
      });
      await expect(
        claimRemoteAgentMessageChannelProviderCardCreation({
          claimExpiresAtMs: 2100,
          claimId: "create_claim_2",
          db: harness.db,
          idempotencyKey: "delivery_create",
          nowMs: 1100,
        })
      ).resolves.toMatchObject({
        delivery: {
          providerProgressClaimId: "create_claim_1",
          providerProgressState: "create_claimed",
        },
        status: "not_claimed",
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardCreated({
          cardId: "card_wrong",
          claimId: "create_claim_2",
          db: harness.db,
          idempotencyKey: "delivery_create",
          nowMs: 1200,
        })
      ).resolves.toBeNull();
      await expect(
        markRemoteAgentMessageChannelProviderCardCreated({
          cardId: "card_1",
          claimId: "create_claim_1",
          db: harness.db,
          idempotencyKey: "delivery_create",
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        providerProgressCardId: "card_1",
        providerProgressClaimId: null,
        providerProgressSequence: 0,
        providerProgressState: "created",
      });
    } finally {
      harness.close();
    }
  });

  it("never retries a card creation whose outcome is unknown", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createMessageChannelDelivery(harness.db, "delivery_create_unknown");
      await claimRemoteAgentMessageChannelProviderCardCreation({
        claimExpiresAtMs: 2000,
        claimId: "create_claim_1",
        db: harness.db,
        idempotencyKey: "delivery_create_unknown",
        nowMs: 1000,
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardCreationOutcomeUnknown({
          claimId: "create_claim_1",
          db: harness.db,
          failureCode: "lark.card_create_outcome_unknown",
          idempotencyKey: "delivery_create_unknown",
          nowMs: 1100,
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode: "lark.card_create_outcome_unknown",
        providerProgressState: "create_outcome_unknown",
      });
      await expect(
        claimRemoteAgentMessageChannelProviderCardCreation({
          claimExpiresAtMs: 2200,
          claimId: "create_claim_retry",
          db: harness.db,
          idempotencyKey: "delivery_create_unknown",
          nowMs: 1200,
        })
      ).resolves.toMatchObject({
        delivery: {
          providerProgressState: "create_outcome_unknown",
        },
        status: "not_claimed",
      });
    } finally {
      harness.close();
    }
  });

  it("persists the card before sending its reference and records the visible message", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createCreatedCard(harness.db, "delivery_send");

      await expect(
        claimRemoteAgentMessageChannelProviderCardSend({
          claimExpiresAtMs: 3000,
          claimId: "send_claim_1",
          db: harness.db,
          idempotencyKey: "delivery_send",
          nowMs: 2000,
          providerPublicationIdempotencyKey:
            "646ba516-4f8d-5f5e-a179-210e76fd244f",
        })
      ).resolves.toMatchObject({
        delivery: {
          providerProgressCardId: "card_delivery_send",
          providerProgressPublicationIdempotencyKey:
            "646ba516-4f8d-5f5e-a179-210e76fd244f",
          providerProgressState: "send_claimed",
        },
        status: "claimed",
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardSent({
          claimId: "send_claim_1",
          db: harness.db,
          idempotencyKey: "delivery_send",
          messageId: "om_working_1",
          nowMs: 2100,
          providerPublicationIdempotencyKey:
            "646ba516-4f8d-5f5e-a179-210e76fd244f",
        })
      ).resolves.toMatchObject({
        providerProgressMessageId: "om_working_1",
        providerProgressState: "sent",
      });
    } finally {
      harness.close();
    }
  });

  it("turns abandoned create and send claims into non-retryable ambiguous outcomes", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createMessageChannelDelivery(harness.db, "delivery_expired_create");
      await claimRemoteAgentMessageChannelProviderCardCreation({
        claimExpiresAtMs: 1100,
        claimId: "create_claim_expired",
        db: harness.db,
        idempotencyKey: "delivery_expired_create",
        nowMs: 1000,
      });
      await expect(
        expireRemoteAgentMessageChannelProviderProgressClaim({
          db: harness.db,
          idempotencyKey: "delivery_expired_create",
          nowMs: 1100,
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode:
          "message_channel.card_create_outcome_unknown",
        providerProgressState: "create_outcome_unknown",
      });

      await createCreatedCard(harness.db, "delivery_expired_send");
      await claimRemoteAgentMessageChannelProviderCardSend({
        claimExpiresAtMs: 2100,
        claimId: "send_claim_expired",
        db: harness.db,
        idempotencyKey: "delivery_expired_send",
        nowMs: 2000,
        providerPublicationIdempotencyKey:
          "646ba516-4f8d-5f5e-a179-210e76fd244f",
      });
      await expect(
        expireRemoteAgentMessageChannelProviderProgressClaim({
          db: harness.db,
          idempotencyKey: "delivery_expired_send",
          nowMs: 2100,
        })
      ).resolves.toMatchObject({
        providerProgressCardId: "card_delivery_expired_send",
        providerProgressFailureCode:
          "message_channel.card_send_outcome_unknown",
        providerProgressState: "send_outcome_unknown",
      });
    } finally {
      harness.close();
    }
  });

  it("records confirmed provider failures without fabricating progress", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createMessageChannelDelivery(harness.db, "delivery_unavailable");
      await claimRemoteAgentMessageChannelProviderCardCreation({
        claimExpiresAtMs: 2000,
        claimId: "create_claim_1",
        db: harness.db,
        idempotencyKey: "delivery_unavailable",
        nowMs: 1000,
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardUnavailable({
          claimId: "create_claim_1",
          db: harness.db,
          expectedState: "create_claimed",
          failureCode: "lark.card_create_http_403",
          idempotencyKey: "delivery_unavailable",
          nowMs: 1100,
        })
      ).resolves.toMatchObject({
        providerProgressCardId: null,
        providerProgressFailureCode: "lark.card_create_http_403",
        providerProgressState: "unavailable",
      });
    } finally {
      harness.close();
    }
  });

  it("deduplicates card updates without treating provider bookkeeping as worker evidence", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createSentCard(harness.db, "delivery_updates");
      const updateInput = {
        claimExpiresAtMs: 4000,
        claimId: "update_3",
        db: harness.db,
        idempotencyKey: "delivery_updates",
        nowMs: 3000,
        providerPublicationIdempotencyKey:
          "de35818c-1ce6-57d0-9032-7e2e57b28f2c",
        sequence: 3,
      };

      await expect(
        claimRemoteAgentMessageChannelProviderCardUpdate(updateInput)
      ).resolves.toMatchObject({
        delivery: {
          executionEvidenceAtMs: 2200,
          executionEvidenceSequence: null,
          providerProgressPendingSequence: 3,
          providerProgressState: "update_claimed",
        },
        status: "claimed",
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardUpdateOutcomeUnknown({
          ...updateInput,
          failureCode: "lark.card_update_outcome_unknown",
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode: "lark.card_update_outcome_unknown",
        providerProgressPendingSequence: 3,
        providerProgressState: "update_claimed",
      });
      await expect(
        claimRemoteAgentMessageChannelProviderCardUpdate({
          ...updateInput,
          claimExpiresAtMs: 4100,
          nowMs: 3100,
        })
      ).resolves.toMatchObject({
        delivery: {
          executionEvidenceAtMs: 2200,
          executionEvidenceSequence: null,
        },
        status: "claimed",
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardUpdatePublished({
          ...updateInput,
          nowMs: 3200,
        })
      ).resolves.toMatchObject({
        executionEvidenceAtMs: 2200,
        executionEvidenceSequence: null,
        providerProgressPendingSequence: null,
        providerProgressSequence: 3,
        providerProgressState: "sent",
      });
      await expect(
        claimRemoteAgentMessageChannelProviderCardUpdate({
          ...updateInput,
          claimExpiresAtMs: 4300,
          nowMs: 3300,
        })
      ).resolves.toMatchObject({
        delivery: {
          executionEvidenceAtMs: 2200,
          executionEvidenceSequence: null,
          providerProgressSequence: 3,
          providerProgressState: "sent",
        },
        status: "not_claimed",
      });
    } finally {
      harness.close();
    }
  });

  it("releases confirmed update failures for an exact safe retry", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createSentCard(harness.db, "delivery_update_failure");
      const updateInput = {
        claimExpiresAtMs: 4000,
        claimId: "update_2",
        db: harness.db,
        idempotencyKey: "delivery_update_failure",
        nowMs: 3000,
        providerPublicationIdempotencyKey:
          "ac92ade7-4c10-521a-b55c-a908c40bdd51",
        sequence: 2,
      };
      await claimRemoteAgentMessageChannelProviderCardUpdate(updateInput);
      await expect(
        markRemoteAgentMessageChannelProviderCardUpdateFailed({
          ...updateInput,
          failureCode: "lark.card_update_http_429",
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode: "lark.card_update_http_429",
        providerProgressPendingSequence: null,
        providerProgressSequence: 0,
        providerProgressState: "sent",
      });
      await expect(
        claimRemoteAgentMessageChannelProviderCardUpdate({
          ...updateInput,
          claimExpiresAtMs: 4100,
          nowMs: 3100,
        })
      ).resolves.toMatchObject({ status: "claimed" });
    } finally {
      harness.close();
    }
  });

  it("stops new stream updates as soon as final publication is claimed", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createSentCard(harness.db, "delivery_final", "submission_final");
      await claimRemoteAgentFinalPublication({
        claimExpiresAtMs: 5000,
        claimId: "final_claim_1",
        db: harness.db,
        idempotencyKey: "delivery_final",
        nowMs: 4000,
        payload: {
          failureCode: null,
          failureDetail: null,
          resumeStatus: "accepted",
          storageVersion: 1,
          text: "Final result.",
        },
        submissionId: "submission_final",
      });

      await expect(
        claimRemoteAgentMessageChannelProviderCardUpdate({
          claimExpiresAtMs: 5100,
          claimId: "update_after_final",
          db: harness.db,
          idempotencyKey: "delivery_final",
          nowMs: 4100,
          providerPublicationIdempotencyKey:
            "1b420fb6-e63a-591b-9e04-c173ac41b095",
          sequence: 1,
        })
      ).resolves.toMatchObject({
        delivery: {
          finalPublicationState: "claimed",
          providerProgressState: "sent",
        },
        status: "not_claimed",
      });
    } finally {
      harness.close();
    }
  });

  it("does not confuse a send ambiguity with a confirmed failure", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createCreatedCard(harness.db, "delivery_send_unknown");
      const sendInput = {
        claimExpiresAtMs: 3000,
        claimId: "send_claim_1",
        db: harness.db,
        idempotencyKey: "delivery_send_unknown",
        nowMs: 2000,
        providerPublicationIdempotencyKey:
          "646ba516-4f8d-5f5e-a179-210e76fd244f",
      };
      await claimRemoteAgentMessageChannelProviderCardSend(sendInput);
      await expect(
        markRemoteAgentMessageChannelProviderCardSendOutcomeUnknown({
          ...sendInput,
          failureCode: "lark.card_send_outcome_unknown",
        })
      ).resolves.toMatchObject({
        providerProgressCardId: "card_delivery_send_unknown",
        providerProgressFailureCode: "lark.card_send_outcome_unknown",
        providerProgressMessageId: null,
        providerProgressState: "send_outcome_unknown",
      });
    } finally {
      harness.close();
    }
  });

  it("moves a long response to a new card through durable rollover phases", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createSentCard(harness.db, "delivery_rollover");
      const finalizeInput = {
        claimExpiresAtMs: 4000,
        claimId: "rollover_finalize_1",
        db: harness.db,
        idempotencyKey: "delivery_rollover",
        nowMs: 3000,
        pendingSourceOffset: 29_900,
        pendingTextHash: "a".repeat(64),
        providerPublicationIdempotencyKey:
          "9548597d-6fc0-5ab3-985a-61a85b09a55a",
        sequence: 8,
      };

      await expect(
        claimRemoteAgentMessageChannelProviderCardRolloverFinalize(
          finalizeInput
        )
      ).resolves.toMatchObject({
        delivery: {
          providerProgressPendingSequence: 8,
          providerProgressPendingSourceOffset: 29_900,
          providerProgressPendingTextHash: "a".repeat(64),
          providerProgressState: "rollover_finalize_claimed",
        },
        status: "claimed",
      });
      await expect(
        claimRemoteAgentMessageChannelProviderCardRolloverFinalize({
          ...finalizeInput,
          pendingTextHash: "b".repeat(64),
        })
      ).resolves.toMatchObject({ status: "not_claimed" });
      await expect(
        markRemoteAgentMessageChannelProviderCardRolloverFinalizePublished({
          ...finalizeInput,
          nowMs: 3100,
        })
      ).resolves.toMatchObject({
        providerProgressState: "rollover_finalized",
      });

      await expect(
        claimRemoteAgentMessageChannelProviderCardRolloverCreation({
          claimExpiresAtMs: 4200,
          claimId: "rollover_create_1",
          db: harness.db,
          idempotencyKey: "delivery_rollover",
          nowMs: 3200,
        })
      ).resolves.toMatchObject({
        delivery: {
          providerProgressState: "rollover_create_claimed",
        },
        status: "claimed",
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardRolloverCreationFailed({
          claimId: "rollover_create_1",
          db: harness.db,
          failureCode: "lark.card_create_outcome_unknown",
          idempotencyKey: "delivery_rollover",
          nowMs: 3300,
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode: "lark.card_create_outcome_unknown",
        providerProgressState: "rollover_finalized",
      });

      await claimRemoteAgentMessageChannelProviderCardRolloverCreation({
        claimExpiresAtMs: 4400,
        claimId: "rollover_create_2",
        db: harness.db,
        idempotencyKey: "delivery_rollover",
        nowMs: 3400,
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardRolloverCreated({
          cardId: "card_rollover_1",
          claimId: "rollover_create_2",
          db: harness.db,
          idempotencyKey: "delivery_rollover",
          nowMs: 3500,
        })
      ).resolves.toMatchObject({
        providerProgressPendingCardId: "card_rollover_1",
        providerProgressState: "rollover_created",
      });

      const sendInput = {
        claimExpiresAtMs: 4700,
        claimId: "rollover_send_1",
        db: harness.db,
        idempotencyKey: "delivery_rollover",
        nowMs: 3600,
        providerPublicationIdempotencyKey:
          "82e3520e-ae22-58f0-94b5-79aaa1331a90",
      };
      await expect(
        claimRemoteAgentMessageChannelProviderCardRolloverSend(sendInput)
      ).resolves.toMatchObject({
        delivery: {
          providerProgressState: "rollover_send_claimed",
        },
        status: "claimed",
      });
      await expect(
        markRemoteAgentMessageChannelProviderCardRolloverSendOutcomeUnknown({
          ...sendInput,
          failureCode: "lark.card_send_outcome_unknown",
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode: "lark.card_send_outcome_unknown",
        providerProgressState: "rollover_send_claimed",
      });
      await expect(
        claimRemoteAgentMessageChannelProviderCardRolloverSend({
          ...sendInput,
          claimExpiresAtMs: 4800,
          nowMs: 3700,
        })
      ).resolves.toMatchObject({ status: "claimed" });
      await expect(
        markRemoteAgentMessageChannelProviderCardRolloverSent({
          ...sendInput,
          messageId: "message_rollover_1",
          nowMs: 3800,
        })
      ).resolves.toMatchObject({
        providerProgressCardId: "card_rollover_1",
        providerProgressMessageId: "message_delivery_rollover",
        providerProgressPendingCardId: null,
        providerProgressPendingSequence: null,
        providerProgressPendingSourceOffset: null,
        providerProgressPendingTextHash: null,
        providerProgressRolloverIndex: 1,
        providerProgressSequence: 8,
        providerProgressSourceOffset: 29_900,
        providerProgressState: "sent",
      });
    } finally {
      harness.close();
    }
  });

  it("lets the fenced final publisher resume a card rollover", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createSentCard(
        harness.db,
        "delivery_final_rollover",
        "submission_final_rollover"
      );
      await claimRemoteAgentFinalPublication({
        claimExpiresAtMs: 5000,
        claimId: "final_rollover_claim",
        db: harness.db,
        idempotencyKey: "delivery_final_rollover",
        nowMs: 3000,
        payload: {
          failureCode: null,
          failureDetail: null,
          resumeStatus: "accepted",
          storageVersion: 1,
          text: "Final result.",
        },
        submissionId: "submission_final_rollover",
      });

      await expect(
        claimRemoteAgentMessageChannelProviderCardRolloverFinalize({
          claimExpiresAtMs: 4500,
          claimId: "rollover_finalize_final",
          db: harness.db,
          finalPublicationClaimId: "final_rollover_claim",
          idempotencyKey: "delivery_final_rollover",
          nowMs: 3100,
          pendingSourceOffset: 29_900,
          pendingTextHash: "c".repeat(64),
          providerPublicationIdempotencyKey:
            "b60f2600-b7cc-54b1-b7f2-41c5662290bc",
          sequence: 1,
        })
      ).resolves.toMatchObject({
        delivery: {
          finalPublicationClaimId: "final_rollover_claim",
          providerProgressState: "rollover_finalize_claimed",
        },
        status: "claimed",
      });
      await expect(
        claimRemoteAgentMessageChannelProviderCardRolloverFinalize({
          claimExpiresAtMs: 4600,
          claimId: "rollover_finalize_wrong",
          db: harness.db,
          finalPublicationClaimId: "wrong_final_claim",
          idempotencyKey: "delivery_final_rollover",
          nowMs: 3200,
          pendingSourceOffset: 29_900,
          pendingTextHash: "c".repeat(64),
          providerPublicationIdempotencyKey:
            "b60f2600-b7cc-54b1-b7f2-41c5662290bc",
          sequence: 1,
        })
      ).resolves.toMatchObject({ status: "not_claimed" });
    } finally {
      harness.close();
    }
  });

  it("expires only the retry-safe rollover phases", async () => {
    const harness = createSqliteD1Harness();
    applyLedgerMigration(harness);
    try {
      await createSentCard(harness.db, "delivery_rollover_expiry");
      const finalizeInput = {
        claimExpiresAtMs: 4000,
        claimId: "rollover_finalize_expiry",
        db: harness.db,
        idempotencyKey: "delivery_rollover_expiry",
        nowMs: 3000,
        pendingSourceOffset: 29_900,
        pendingTextHash: "d".repeat(64),
        providerPublicationIdempotencyKey:
          "acbf9c43-f2bb-53f1-9fcf-5565a9dc2ab2",
        sequence: 9,
      };
      await claimRemoteAgentMessageChannelProviderCardRolloverFinalize(
        finalizeInput
      );
      await markRemoteAgentMessageChannelProviderCardRolloverFinalizePublished(
        finalizeInput
      );
      await claimRemoteAgentMessageChannelProviderCardRolloverCreation({
        claimExpiresAtMs: 3200,
        claimId: "rollover_create_expiry",
        db: harness.db,
        idempotencyKey: "delivery_rollover_expiry",
        nowMs: 3100,
      });

      await expect(
        expireRemoteAgentMessageChannelProviderProgressClaim({
          db: harness.db,
          idempotencyKey: "delivery_rollover_expiry",
          nowMs: 3200,
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode:
          "message_channel.rollover_card_create_outcome_unknown",
        providerProgressState: "rollover_finalized",
      });

      await claimRemoteAgentMessageChannelProviderCardRolloverCreation({
        claimExpiresAtMs: 3400,
        claimId: "rollover_create_after_expiry",
        db: harness.db,
        idempotencyKey: "delivery_rollover_expiry",
        nowMs: 3300,
      });
      await markRemoteAgentMessageChannelProviderCardRolloverCreated({
        cardId: "card_rollover_expiry",
        claimId: "rollover_create_after_expiry",
        db: harness.db,
        idempotencyKey: "delivery_rollover_expiry",
        nowMs: 3300,
      });
      await claimRemoteAgentMessageChannelProviderCardRolloverSend({
        claimExpiresAtMs: 3500,
        claimId: "rollover_send_expiry",
        db: harness.db,
        idempotencyKey: "delivery_rollover_expiry",
        nowMs: 3400,
        providerPublicationIdempotencyKey:
          "d4939e68-8348-576c-89ca-1e2dcb5ebf04",
      });

      await expect(
        expireRemoteAgentMessageChannelProviderProgressClaim({
          db: harness.db,
          idempotencyKey: "delivery_rollover_expiry",
          nowMs: 3500,
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode:
          "message_channel.rollover_card_send_outcome_unknown",
        providerProgressState: "rollover_send_outcome_unknown",
      });
    } finally {
      harness.close();
    }
  });
});

function applyLedgerMigration(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_native_delivery_ledger"
  );
}

async function createMessageChannelDelivery(
  db: D1Database,
  idempotencyKey: string
): Promise<void> {
  await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: "attempt_1",
    bindingId: "binding_1",
    conversationKind: "message_channel",
    db,
    dispatchId: `dispatch_${idempotencyKey}`,
    idempotencyKey,
    messageChannelLocator: {
      appId: "cli_lark_test",
      chatId: "oc_chat_test",
      connectionId: "connection_lark_test",
      provider: "lark",
      rootMessageId: "om_root_test",
      tenantKey: "tenant_lark_test",
      threadId: null,
    },
    nowMs: 500,
    organizationId: "org_1",
    profileId: "profile_agent_1",
    providerPublicationIdempotencyKey: `final_${idempotencyKey}`,
    spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
    status: "submitted",
    triggerMessageId: "om_trigger_test",
  });
}

async function createCreatedCard(
  db: D1Database,
  idempotencyKey: string
): Promise<void> {
  await createMessageChannelDelivery(db, idempotencyKey);
  await claimRemoteAgentMessageChannelProviderCardCreation({
    claimExpiresAtMs: 1500,
    claimId: `create_${idempotencyKey}`,
    db,
    idempotencyKey,
    nowMs: 1000,
  });
  await markRemoteAgentMessageChannelProviderCardCreated({
    cardId: `card_${idempotencyKey}`,
    claimId: `create_${idempotencyKey}`,
    db,
    idempotencyKey,
    nowMs: 1100,
  });
}

async function createSentCard(
  db: D1Database,
  idempotencyKey: string,
  submissionId = `submission_${idempotencyKey}`
): Promise<void> {
  await createCreatedCard(db, idempotencyKey);
  const providerPublicationIdempotencyKey =
    "646ba516-4f8d-5f5e-a179-210e76fd244f";
  await claimRemoteAgentMessageChannelProviderCardSend({
    claimExpiresAtMs: 2500,
    claimId: `send_${idempotencyKey}`,
    db,
    idempotencyKey,
    nowMs: 2000,
    providerPublicationIdempotencyKey,
  });
  await markRemoteAgentMessageChannelProviderCardSent({
    claimId: `send_${idempotencyKey}`,
    db,
    idempotencyKey,
    messageId: `message_${idempotencyKey}`,
    nowMs: 2100,
    providerPublicationIdempotencyKey,
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db,
    idempotencyKey,
    nowMs: 2200,
    submissionId,
  });
}
