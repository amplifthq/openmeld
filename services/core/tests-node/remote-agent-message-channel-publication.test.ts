import type {
  MessageChannelConversationLocator,
  RemoteAgentCoreCallbackBody,
  RemoteAgentNativeDeliveryDeadlineProbeQueueMessage,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  readAgentTaskCompletionSubscription,
  registerAgentTaskCompletionSubscription,
} from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import type { CoreBindings } from "../src/lib/bindings";
import {
  createMessageChannelProviderRegistry,
  type MessageChannelProviderAdapter,
} from "../src/remote-agent/application/message-channel-adapters";
import {
  publishRemoteAgentMessageChannelCallback,
  REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS,
  REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS,
  REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_CLAIM_LEASE_MS,
} from "../src/remote-agent/application/message-channel-publication-coordinator";
import {
  buildRemoteAgentAdmissionWatchdogSubmissionId,
  REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS,
} from "../src/remote-agent/application/native-delivery-admission-watchdog";
import {
  completeRemoteAgentNativeDelivery,
  processRemoteAgentNativeDeliveryDeadlineProbe,
} from "../src/remote-agent/application/native-delivery-service";
import {
  claimRemoteAgentMessageChannelProviderCardCreation,
  claimRemoteAgentMessageChannelProviderCardSend,
  markRemoteAgentMessageChannelProviderCardCreated,
  markRemoteAgentMessageChannelProviderCardSendOutcomeUnknown,
  markRemoteAgentMessageChannelProviderCardSent,
} from "../src/remote-agent/infrastructure/d1/message-channel-provider-progress-repo";
import {
  markRemoteAgentNativeDeliveryAck,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "lark:connection_lark_1:chat_lark_1:message_root_1";
const IDEMPOTENCY_KEY = "message_channel_delivery_1";
const PROVIDER_PUBLICATION_KEY = "message_channel_publication_1";
const SUBMISSION_ID = "submission_message_channel_1";

describe("Remote Agent Message Channel publication", () => {
  it("publishes a hung admission failure once to only the frozen provider", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const publishFailure = vi.fn(async () => ({
      resultId: "message_admission_failure_lark_1",
      status: "published" as const,
    }));
    const larkAdapter = createAdapter("lark", { publishFailure });
    const feishuAdapter = createAdapter("feishu");
    const spacesGet = vi.fn();
    const probe = createAdmissionWatchdogProbe();
    const env = buildEnv(harness.db, spacesGet);
    const messageChannelProviderRegistry = createMessageChannelProviderRegistry(
      [larkAdapter, feishuAdapter]
    );
    try {
      await createSubmittedMessageChannelDelivery(harness.db);

      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          messageChannelProviderRegistry,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({ status: "expired" });

      expect(publishFailure).toHaveBeenCalledWith({
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
          organizationId: "org_1",
          provider: "lark",
        }),
        failureCode: "remote_agent.admission_timeout",
        locator: createLocator(),
        providerPublicationIdempotencyKey: PROVIDER_PUBLICATION_KEY,
        text: "Center Agent did not accept this request in time. Please try again.",
      });
      expect(feishuAdapter.publishFailure).not.toHaveBeenCalled();
      expect(spacesGet).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.admission_timeout",
        finalPublicationState: "published",
        providerPublicationResultId: "message_admission_failure_lark_1",
        publishedSignalId: null,
        status: "failed",
        submissionId: null,
      });

      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env,
          messageChannelProviderRegistry,
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toMatchObject({ status: "skipped" });
      expect(publishFailure).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("publishes and terminalizes a completed callback through only the frozen provider adapter", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const larkAdapter = createAdapter("lark", {
      publishReply: vi.fn(async () => ({
        resultId: "message_result_lark_1",
        status: "published" as const,
      })),
    });
    const feishuAdapter = createAdapter("feishu");
    const spacesGet = vi.fn();
    const taskTableReads: string[] = [];
    const inboxTableReads: string[] = [];
    try {
      await createAcceptedMessageChannelDelivery(harness.db);
      const subscriptionId = await registerMessageChannelDeliverySubscription(
        harness.db,
        "success"
      );
      const env = buildEnv(harness.db, spacesGet);
      env.OPENMELD_LOCAL_STATE_DB = {
        prepare: (sql: string) => {
          if (sql.includes("center_agent_task")) {
            taskTableReads.push(sql);
            throw new Error(
              "ordinary Message Channel callback read a Center Agent Task table"
            );
          }
          return harness.db.prepare(sql);
        },
      } as unknown as D1Database;
      env.OPENMELD_DB = {
        prepare: (sql: string) => {
          if (sql.includes("inbox_items")) {
            inboxTableReads.push(sql);
            throw new Error(
              "ordinary Message Channel callback read an Inbox table"
            );
          }
          return harness.db.prepare(sql);
        },
      } as unknown as D1Database;

      await expect(
        completeRemoteAgentNativeDelivery(env, createCompletedCallback(), {
          messageChannelNowMs: () => 2000,
          messageChannelProviderRegistry: createMessageChannelProviderRegistry([
            larkAdapter,
            feishuAdapter,
          ]),
        })
      ).resolves.toEqual({
        publishedSignalId: "message_result_lark_1",
        status: "accepted",
      });

      expect(larkAdapter.publishReply).toHaveBeenCalledWith({
        attachments: [],
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
          organizationId: "org_1",
          provider: "lark",
        }),
        locator: createLocator(),
        providerPublicationIdempotencyKey: PROVIDER_PUBLICATION_KEY,
        text: "The launch plan is ready.",
      });
      expect(feishuAdapter.publishReply).not.toHaveBeenCalled();
      expect(spacesGet).not.toHaveBeenCalled();
      expect(taskTableReads).toEqual([]);
      expect(inboxTableReads).toEqual([]);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationClaimId: null,
        finalPublicationState: "published",
        providerPublicationResultId: "message_result_lark_1",
        publishedSignalId: null,
        status: "completed",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({
        outcome: {
          publishedSignalId: "message_result_lark_1",
          status: "succeeded",
        },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("replaces an internal identity-boundary explanation with novice-safe copy", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const publishReply = vi.fn(async () => ({
      resultId: "message_identity_boundary_lark_1",
      status: "published" as const,
    }));
    const adapter = createAdapter("lark", { publishReply });
    try {
      await createAcceptedMessageChannelDelivery(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          {
            ...createCompletedCallback(),
            navigationTarget: {
              kind: "message_channel_identity_link",
              purpose: "continue_request",
            },
            text: "This turn's active tool catalog does not include Space management tools.",
          },
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toMatchObject({
        reasonCode: "message_channel.identity_link_context_unavailable",
        status: "retryable",
      });

      expect(publishReply).toHaveBeenCalledWith(
        expect.objectContaining({
          text: "I need your OpenMeld account before I can continue. OpenMeld will send you a private message with a “Connect my account and continue” button. After you connect, I’ll continue this request automatically.",
        })
      );
    } finally {
      harness.close();
    }
  });

  it("publishes an explicit notice instead of retrying an unsupported generated image forever", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const publishReply = vi.fn(async () => ({
      resultId: "message_result_lark_with_image_notice",
      status: "published" as const,
    }));
    const adapter = createAdapter("lark", { publishReply });
    try {
      await createAcceptedMessageChannelDelivery(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          {
            ...createCompletedCallback(),
            attachments: [createImageAttachment()],
          },
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "message_result_lark_with_image_notice",
        status: "accepted",
      });

      expect(publishReply).toHaveBeenCalledWith(
        expect.objectContaining({
          attachments: [],
          locator: createLocator(),
          text: expect.stringContaining(
            "this channel cannot deliver generated images yet"
          ),
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "published",
        providerPublicationResultId: "message_result_lark_with_image_notice",
        status: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("finalizes the visible working card instead of publishing a second reply", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const finalizeWorkingCard = vi.fn(async () => ({
      status: "published" as const,
    }));
    const adapter = createAdapter("lark", { finalizeWorkingCard });
    try {
      await createAcceptedMessageChannelDeliveryWithSentWorkingCard(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "message_working_lark_1",
        status: "accepted",
      });

      expect(adapter.publishReply).not.toHaveBeenCalled();
      expect(adapter.publishFailure).not.toHaveBeenCalled();
      expect(finalizeWorkingCard).toHaveBeenCalledWith({
        cardId: "card_working_lark_1",
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
          organizationId: "org_1",
          provider: "lark",
        }),
        locator: createLocator(),
        providerPublicationIdempotencyKey: PROVIDER_PUBLICATION_KEY,
        sequence: 1,
        text: "The launch plan is ready.",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "published",
        providerProgressPendingSequence: null,
        providerProgressSequence: 1,
        providerProgressState: "finalized",
        providerPublicationResultId: "message_working_lark_1",
        status: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps an ambiguous CardKit finalization fail-closed without guessing a retry window", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const finalizeWorkingCard = vi.fn(async () => ({
      reasonCode: "lark.card_finalize_outcome_unknown",
      status: "outcome_unknown" as const,
    }));
    const adapter = createAdapter("lark", { finalizeWorkingCard });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: () => 2000,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDeliveryWithSentWorkingCard(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });

      expect(finalizeWorkingCard).toHaveBeenCalledTimes(1);
      expect(adapter.publishReply).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationAmbiguityDeadlineAtMs: null,
        finalPublicationState: "outcome_unknown",
        providerPublicationResultId: null,
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("freezes a CardKit sequence before provider I/O and never replays an expired claim", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    let nowMs = 2000;
    const publication = createDeferred({
      status: "published" as const,
    });
    const finalizeWorkingCard = vi.fn(() => publication.promise);
    const adapter = createAdapter("lark", { finalizeWorkingCard });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: () => nowMs,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDeliveryWithSentWorkingCard(harness.db);

      const firstCallback = completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallback(),
        options
      );
      await vi.waitFor(() => {
        expect(finalizeWorkingCard).toHaveBeenCalledTimes(1);
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationProviderProgressSequence: 1,
        finalPublicationState: "claimed",
      });

      nowMs =
        2000 + REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_CLAIM_LEASE_MS;
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });

      publication.resolve();
      await expect(firstCallback).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });
      expect(finalizeWorkingCard).toHaveBeenCalledTimes(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationAmbiguityDeadlineAtMs: null,
        finalPublicationState: "outcome_unknown",
        providerPublicationResultId: null,
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("does not start CardKit provider I/O after the final publication claim expires", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    let clockCallCount = 0;
    const claimStartedAtMs = 2000;
    const claimExpiresAtMs =
      claimStartedAtMs +
      REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_CLAIM_LEASE_MS;
    const finalizeWorkingCard = vi.fn(async () => ({
      status: "published" as const,
    }));
    const adapter = createAdapter("lark", { finalizeWorkingCard });
    const options = {
      messageChannelNowMs: () => {
        clockCallCount += 1;
        return clockCallCount <= 2 ? claimStartedAtMs : claimExpiresAtMs;
      },
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDeliveryWithSentWorkingCard(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });

      expect(finalizeWorkingCard).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "outcome_unknown",
        providerPublicationResultId: null,
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("finalizes a visible card with an explicit unsupported generated-image notice", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const finalizeWorkingCard = vi.fn(async () => ({
      status: "published" as const,
    }));
    const adapter = createAdapter("lark", { finalizeWorkingCard });
    try {
      await createAcceptedMessageChannelDeliveryWithSentWorkingCard(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          {
            ...createCompletedCallback(),
            attachments: [createImageAttachment()],
          },
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "message_working_lark_1",
        status: "accepted",
      });

      expect(adapter.publishReply).not.toHaveBeenCalled();
      expect(finalizeWorkingCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardId: "card_working_lark_1",
          text: expect.stringContaining(
            "this channel cannot deliver generated images yet"
          ),
        })
      );
    } finally {
      harness.close();
    }
  });

  it("rolls a long final callback into a follow-up card without truncation", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const finalizeWorkingCard = vi.fn(async () => ({
      status: "published" as const,
    }));
    const createWorkingCard = vi.fn(async () => ({
      cardId: "card_final_continued",
      status: "created" as const,
    }));
    const publishWorkingCard = vi.fn(async () => ({
      resultId: "message_final_continued",
      status: "published" as const,
    }));
    const adapter = createAdapter("lark", {
      createWorkingCard,
      finalizeWorkingCard,
      publishWorkingCard,
    });
    const text = `${"A".repeat(29_900)}\n${"B".repeat(2000)}`;
    try {
      await createAcceptedMessageChannelDeliveryWithSentWorkingCard(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          { ...createCompletedCallback(), text },
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "message_working_lark_1",
        status: "accepted",
      });

      expect(finalizeWorkingCard).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          cardId: "card_working_lark_1",
          sequence: 1,
          text: `${"A".repeat(29_900)}\n`,
        })
      );
      expect(createWorkingCard).toHaveBeenCalledWith({
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
        }),
        initialText: "B".repeat(2000),
        locator: createLocator(),
      });
      expect(publishWorkingCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardId: "card_final_continued",
          locator: createLocator(),
        })
      );
      expect(finalizeWorkingCard).toHaveBeenNthCalledWith(2, {
        cardId: "card_final_continued",
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
          organizationId: "org_1",
          provider: "lark",
        }),
        locator: createLocator(),
        providerPublicationIdempotencyKey: PROVIDER_PUBLICATION_KEY,
        sequence: 2,
        text: "B".repeat(2000),
      });
      expect(adapter.publishReply).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "published",
        providerProgressCardId: "card_final_continued",
        providerProgressMessageId: "message_working_lark_1",
        providerProgressRolloverIndex: 1,
        providerProgressSequence: 2,
        providerProgressSourceOffset: 29_901,
        providerProgressState: "finalized",
        providerPublicationResultId: "message_working_lark_1",
        status: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("preserves a near-limit callback across three provider cards", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const finalizeWorkingCard = vi.fn<
      MessageChannelProviderAdapter["finalizeWorkingCard"]
    >(async () => ({
      status: "published" as const,
    }));
    let continuedCardIndex = 0;
    const createWorkingCard = vi.fn(() => {
      continuedCardIndex += 1;
      return Promise.resolve({
        cardId: `card_final_continued_${continuedCardIndex}`,
        status: "created" as const,
      });
    });
    const publishWorkingCard = vi.fn((input) =>
      Promise.resolve({
        resultId: `message_${input.cardId}`,
        status: "published" as const,
      })
    );
    const adapter = createAdapter("lark", {
      createWorkingCard,
      finalizeWorkingCard,
      publishWorkingCard,
    });
    const text = "A".repeat(89_500);
    try {
      await createAcceptedMessageChannelDeliveryWithSentWorkingCard(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          { ...createCompletedCallback(), text },
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "message_working_lark_1",
        status: "accepted",
      });

      expect(finalizeWorkingCard).toHaveBeenCalledTimes(3);
      expect(createWorkingCard).toHaveBeenCalledTimes(2);
      expect(publishWorkingCard).toHaveBeenCalledTimes(2);
      expect(
        finalizeWorkingCard.mock.calls
          .map(([publication]) => publication.text)
          .join("")
      ).toBe(text);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "published",
        providerProgressCardId: "card_final_continued_2",
        providerProgressRolloverIndex: 2,
        providerProgressSourceOffset: 59_992,
        providerProgressState: "finalized",
        providerPublicationResultId: "message_working_lark_1",
        status: "completed",
      });
    } finally {
      harness.close();
    }
  });

  it("never publishes a standalone reply when working-card visibility is unknown", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const finalizeWorkingCard = vi.fn(async () => ({
      status: "published" as const,
    }));
    const adapter = createAdapter("lark", { finalizeWorkingCard });
    try {
      await createAcceptedMessageChannelDeliveryWithUnknownWorkingCardSend(
        harness.db
      );

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });

      expect(adapter.publishReply).not.toHaveBeenCalled();
      expect(adapter.publishFailure).not.toHaveBeenCalled();
      expect(finalizeWorkingCard).toHaveBeenCalledWith(
        expect.objectContaining({
          cardId: "card_working_lark_1",
          providerPublicationIdempotencyKey: PROVIDER_PUBLICATION_KEY,
          sequence: 1,
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationState: "outcome_unknown",
        providerProgressSequence: 1,
        providerProgressState: "finalized",
        providerPublicationResultId: null,
      });
    } finally {
      harness.close();
    }
  });

  it("records safe diagnostics when terminal card rollover throws", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const sensitiveProviderDetail =
      "Authorization: Bearer provider-secret-token";
    const finalizeWorkingCard = vi.fn(() =>
      Promise.reject(new Error(sensitiveProviderDetail))
    );
    const adapter = createAdapter("lark", { finalizeWorkingCard });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await createAcceptedMessageChannelDeliveryWithSentWorkingCard(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          {
            ...createCompletedCallback(),
            text: "A".repeat(30_500),
          },
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });

      expect(warn).toHaveBeenCalledWith(
        "[core.remote_agent.message_channel.card_rollover_exception]",
        {
          deliveryId: expect.any(String),
          dispatchId: "dispatch_message_channel_1",
          errorName: "Error",
          provider: "lark",
          reasonCode: "remote_agent.message_channel.card_rollover_exception",
        }
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        "provider-secret-token"
      );
    } finally {
      warn.mockRestore();
      harness.close();
    }
  });

  it("finalizes the working card when admission times out", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const finalizeWorkingCard = vi.fn(async () => ({
      status: "published" as const,
    }));
    const adapter = createAdapter("lark", { finalizeWorkingCard });
    const probe = createAdmissionWatchdogProbe();
    try {
      await createSubmittedMessageChannelDelivery(harness.db);
      await createSentWorkingCard(harness.db);

      await expect(
        processRemoteAgentNativeDeliveryDeadlineProbe({
          db: harness.db,
          env: buildEnv(harness.db),
          messageChannelProviderRegistry: createMessageChannelProviderRegistry([
            adapter,
          ]),
          nowMs: probe.deadlineAtMs,
          probe,
        })
      ).resolves.toEqual({ status: "expired" });

      expect(adapter.publishFailure).not.toHaveBeenCalled();
      expect(adapter.publishReply).not.toHaveBeenCalled();
      expect(finalizeWorkingCard).toHaveBeenCalledWith({
        cardId: "card_working_lark_1",
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
          organizationId: "org_1",
          provider: "lark",
        }),
        locator: createLocator(),
        providerPublicationIdempotencyKey: PROVIDER_PUBLICATION_KEY,
        sequence: 1,
        text: "Center Agent did not accept this request in time. Please try again.",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.admission_timeout",
        finalPublicationState: "published",
        providerProgressSequence: 1,
        providerProgressState: "finalized",
        providerPublicationResultId: "message_working_lark_1",
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("lets only one concurrent callback publish to the frozen provider", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const publication = createDeferred({
      resultId: "message_result_concurrent_1",
      status: "published" as const,
    });
    const publishReply = vi.fn(() => publication.promise);
    const adapter = createAdapter("lark", { publishReply });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: () => 2000,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);

      const firstCallback = completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallback(),
        options
      );
      await vi.waitFor(() => {
        expect(publishReply).toHaveBeenCalledTimes(1);
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_in_progress",
        retryAfterMs:
          REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_CLAIM_LEASE_MS,
        status: "retryable",
      });
      publication.resolve();
      await expect(firstCallback).resolves.toEqual({
        publishedSignalId: "message_result_concurrent_1",
        status: "accepted",
      });

      expect(publishReply).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("publishes a failed callback without changing its frozen destination", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const adapter = createAdapter("lark", {
      publishFailure: vi.fn(async () => ({
        resultId: "message_failure_lark_1",
        status: "published" as const,
      })),
    });
    try {
      await createAcceptedMessageChannelDelivery(harness.db);
      const subscriptionId = await registerMessageChannelDeliverySubscription(
        harness.db,
        "failure"
      );

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          {
            ...createFailedCallback(),
            failureCode: "provider.some_new_failure",
            failureMessage:
              "This turn's active tool catalog does not include Space management tools.",
          },
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        publishedSignalId: "message_failure_lark_1",
        status: "accepted",
      });

      expect(adapter.publishFailure).toHaveBeenCalledWith(
        expect.objectContaining({
          failureCode: "provider.some_new_failure",
          locator: createLocator(),
          text: "Center Agent couldn't finish this request. Try again. If it keeps happening, open diagnostics in OpenMeld.",
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        failureCode: "provider.some_new_failure",
        finalPublicationState: "published",
        providerPublicationResultId: "message_failure_lark_1",
        status: "failed",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({
        outcome: {
          errorCode: "provider.some_new_failure",
          publishedSignalId: "message_failure_lark_1",
          status: "failed",
        },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("keeps an ambiguous provider outcome retryable and nonterminal inside the provider deduplication window", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    let nowMs = 2000;
    const publishReply = vi.fn(() => {
      nowMs = 12_000;
      return Promise.resolve({
        reasonCode: "lark.message_reply_outcome_unknown",
        status: "outcome_unknown" as const,
      });
    });
    const adapter = createAdapter("lark", { publishReply });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: () => nowMs,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);
      const subscriptionId = await registerMessageChannelDeliverySubscription(
        harness.db,
        "provider-ambiguity"
      );

      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "lark.message_reply_outcome_unknown",
        retryAfterMs: 1000,
        status: "retryable",
      });

      expect(publishReply).toHaveBeenCalledTimes(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationAmbiguityDeadlineAtMs:
          2000 + REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS,
        finalPublicationState: null,
        providerPublicationResultId: null,
        status: "accepted",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({
        outcome: null,
        state: "pending",
      });
    } finally {
      harness.close();
    }
  });

  it("does not copy provider exception details into publication diagnostics", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const sensitiveProviderDetail = `Authorization: Bearer provider-secret-token\n${"raw provider response ".repeat(80)}`;
    const publishReply = vi.fn(() =>
      Promise.reject(new Error(sensitiveProviderDetail))
    );
    const adapter = createAdapter("lark", { publishReply });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await createAcceptedMessageChannelDelivery(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        reasonCode: "lark.final_publication_outcome_unknown",
        retryAfterMs:
          REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS,
        status: "retryable",
      });

      expect(warn).toHaveBeenCalledWith(
        "[core.remote_agent.message_channel.final_publication_exception]",
        {
          dispatchId: "dispatch_message_channel_1",
          provider: "lark",
          reasonCode:
            "remote_agent.message_channel.final_publication_exception",
          submissionId: SUBMISSION_ID,
        }
      );
      const diagnostics = JSON.stringify(warn.mock.calls);
      expect(diagnostics).not.toContain("provider-secret-token");
      expect(diagnostics).not.toContain("raw provider response");
      expect(diagnostics.length).toBeLessThan(512);
    } finally {
      warn.mockRestore();
      harness.close();
    }
  });

  it("retries the exact frozen provider publication and settles only after confirmation", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    let nowMs = 2000;
    const publishReply = vi
      .fn()
      .mockResolvedValueOnce({
        reasonCode: "lark.message_reply_outcome_unknown",
        status: "outcome_unknown" as const,
      })
      .mockResolvedValueOnce({
        resultId: "message_result_after_ambiguous_retry",
        status: "published" as const,
      });
    const adapter = createAdapter("lark", { publishReply });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: () => nowMs,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);
      const subscriptionId = await registerMessageChannelDeliverySubscription(
        harness.db,
        "provider-ambiguity-recovery"
      );

      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "lark.message_reply_outcome_unknown",
        retryAfterMs:
          REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS,
        status: "retryable",
      });
      nowMs +=
        REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS / 2;
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          {
            ...createCompletedCallback(),
            text: "A callback replay tried to replace the frozen result.",
          },
          options
        )
      ).resolves.toEqual({
        reasonCode: "lark.message_reply_outcome_unknown",
        retryAfterMs:
          REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS / 2,
        status: "retryable",
      });
      expect(publishReply).toHaveBeenCalledTimes(1);
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({ outcome: null, state: "pending" });

      nowMs =
        2000 +
        REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS;
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          {
            ...createCompletedCallback(),
            text: "A callback replay tried to replace the frozen result.",
          },
          options
        )
      ).resolves.toEqual({
        publishedSignalId: "message_result_after_ambiguous_retry",
        status: "accepted",
      });

      expect(publishReply).toHaveBeenCalledTimes(2);
      expect(publishReply.mock.calls[0]?.[0]).toEqual(
        publishReply.mock.calls[1]?.[0]
      );
      expect(publishReply).toHaveBeenLastCalledWith({
        attachments: [],
        connection: expect.objectContaining({
          connectionId: "connection_lark_1",
          organizationId: "org_1",
          provider: "lark",
        }),
        locator: createLocator(),
        providerPublicationIdempotencyKey: PROVIDER_PUBLICATION_KEY,
        text: "The launch plan is ready.",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationAmbiguityDeadlineAtMs:
          2000 + REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS,
        finalPublicationAttemptCount: 2,
        finalPublicationPayload: null,
        finalPublicationState: "published",
        providerPublicationResultId: "message_result_after_ambiguous_retry",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({
        outcome: {
          publishedSignalId: "message_result_after_ambiguous_retry",
          status: "succeeded",
        },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("lets only one callback retry an ambiguous publication inside the deduplication window", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    let nowMs = 2000;
    const retryPublication = createDeferred({
      resultId: "message_result_after_concurrent_ambiguous_retry",
      status: "published" as const,
    });
    const publishReply = vi
      .fn()
      .mockResolvedValueOnce({
        reasonCode: "lark.message_reply_outcome_unknown",
        status: "outcome_unknown" as const,
      })
      .mockImplementationOnce(() => retryPublication.promise);
    const adapter = createAdapter("lark", { publishReply });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: () => nowMs,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toMatchObject({ status: "retryable" });

      nowMs +=
        REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS;
      const firstRetry = completeRemoteAgentNativeDelivery(
        env,
        createCompletedCallback(),
        options
      );
      await vi.waitFor(() => {
        expect(publishReply).toHaveBeenCalledTimes(2);
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_in_progress",
        retryAfterMs:
          REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_CLAIM_LEASE_MS,
        status: "retryable",
      });

      retryPublication.resolve();
      await expect(firstRetry).resolves.toEqual({
        publishedSignalId: "message_result_after_concurrent_ambiguous_retry",
        status: "accepted",
      });
      expect(publishReply).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });

  it("stops provider retries exactly at the official sixty-minute deduplication boundary", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    let nowMs = 2000;
    const ambiguityDeadlineAtMs =
      nowMs + REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS;
    const publishReply = vi.fn(async () => ({
      reasonCode: "lark.message_reply_outcome_unknown",
      status: "outcome_unknown" as const,
    }));
    const adapter = createAdapter("lark", { publishReply });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: () => nowMs,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);
      const subscriptionId = await registerMessageChannelDeliverySubscription(
        harness.db,
        "provider-ambiguity-expiry"
      );

      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toMatchObject({
        retryAfterMs:
          REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS,
        status: "retryable",
      });

      nowMs = ambiguityDeadlineAtMs - 1;
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "lark.message_reply_outcome_unknown",
        retryAfterMs: 1,
        status: "retryable",
      });
      expect(publishReply).toHaveBeenCalledTimes(2);
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({ outcome: null, state: "pending" });

      nowMs = ambiguityDeadlineAtMs;
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });
      nowMs += 1;
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });

      expect(publishReply).toHaveBeenCalledTimes(2);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationAmbiguityDeadlineAtMs: ambiguityDeadlineAtMs,
        finalPublicationAttemptCount: 2,
        finalPublicationPayload: null,
        finalPublicationState: "outcome_unknown",
        providerPublicationResultId: null,
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({
        outcome: {
          status: "publication_failed",
        },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("does not start standalone provider I/O when its fresh claim fence reaches the deduplication deadline", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const ambiguityStartedAtMs = 2000;
    const ambiguityDeadlineAtMs =
      ambiguityStartedAtMs +
      REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS;
    let raceStarted = false;
    let raceClockCalls = 0;
    const clock = () => {
      if (!raceStarted) {
        return ambiguityStartedAtMs;
      }
      raceClockCalls += 1;
      return raceClockCalls <= 2
        ? ambiguityDeadlineAtMs - 1
        : ambiguityDeadlineAtMs;
    };
    const publishReply = vi
      .fn()
      .mockResolvedValueOnce({
        reasonCode: "lark.message_reply_outcome_unknown",
        status: "outcome_unknown" as const,
      })
      .mockResolvedValue({
        resultId: "message_result_after_expired_pre_io_fence",
        status: "published" as const,
      });
    const adapter = createAdapter("lark", { publishReply });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: clock,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);
      const subscriptionId = await registerMessageChannelDeliverySubscription(
        harness.db,
        "provider-pre-io-fence-expiry"
      );
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toMatchObject({ status: "retryable" });

      raceStarted = true;
      publishReply.mockClear();
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });

      expect(publishReply).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationAmbiguityDeadlineAtMs: ambiguityDeadlineAtMs,
        finalPublicationAttemptCount: 2,
        finalPublicationPayload: null,
        finalPublicationState: "outcome_unknown",
        providerPublicationResultId: null,
        status: "failed",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({
        outcome: { status: "publication_failed" },
        state: "settled",
      });
    } finally {
      harness.close();
    }
  });

  it("fences a stale-projection reply retry at the official deduplication deadline", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    let nowMs = 2000;
    const ambiguityDeadlineAtMs =
      nowMs + REMOTE_AGENT_LARK_PLATFORM_REPLY_DEDUPLICATION_WINDOW_MS;
    const retryPublication = createDeferred({
      resultId: "message_result_after_expired_retry",
      status: "published" as const,
    });
    const publishReply = vi
      .fn()
      .mockResolvedValueOnce({
        reasonCode: "lark.message_reply_outcome_unknown",
        status: "outcome_unknown" as const,
      })
      .mockImplementationOnce(() => retryPublication.promise);
    const adapter = createAdapter("lark", { publishReply });
    const env = buildEnv(harness.db);
    const options = {
      messageChannelNowMs: () => nowMs,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);
      const staleDelivery = await readRemoteAgentNativeDeliveryByIdempotencyKey(
        {
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        }
      );
      if (
        !staleDelivery ||
        (staleDelivery.status !== "accepted" &&
          staleDelivery.status !== "retry_observed")
      ) {
        throw new Error("Expected an accepted Message Channel delivery");
      }
      const staleAcceptedDelivery = {
        ...staleDelivery,
        status: staleDelivery.status,
      } satisfies typeof staleDelivery & {
        status: "accepted" | "retry_observed";
      };
      const subscriptionId = await registerMessageChannelDeliverySubscription(
        harness.db,
        "provider-active-retry-expiry"
      );
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toMatchObject({ status: "retryable" });

      nowMs = ambiguityDeadlineAtMs - 1;
      const activeRetry = publishRemoteAgentMessageChannelCallback({
        body: createCompletedCallback(),
        clock: options.messageChannelNowMs,
        db: harness.db,
        delivery: staleAcceptedDelivery,
        registry: options.messageChannelProviderRegistry,
      });
      await vi.waitFor(() => {
        expect(publishReply).toHaveBeenCalledTimes(2);
      });

      nowMs = ambiguityDeadlineAtMs;
      await expect(
        completeRemoteAgentNativeDelivery(
          env,
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.callback_publication_outcome_unknown",
        status: "rejected",
      });
      await expect(
        readAgentTaskCompletionSubscription({
          db: harness.db,
          subscriptionId,
        })
      ).resolves.toMatchObject({
        outcome: { status: "publication_failed" },
        state: "settled",
      });

      retryPublication.resolve();
      await expect(activeRetry).resolves.toEqual({ status: "outcome_unknown" });
      expect(publishReply).toHaveBeenCalledTimes(2);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationAmbiguityDeadlineAtMs: ambiguityDeadlineAtMs,
        finalPublicationState: "outcome_unknown",
        providerPublicationResultId: null,
      });
    } finally {
      harness.close();
    }
  });

  it("retries with the same provider identity after its local claim fence expires", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    let nowMs = 2000;
    let publicationAttempt = 0;
    const publishReply = vi.fn<MessageChannelProviderAdapter["publishReply"]>(
      () => {
        publicationAttempt += 1;
        if (publicationAttempt === 1) {
          nowMs =
            2000 +
            REMOTE_AGENT_MESSAGE_CHANNEL_FINAL_PUBLICATION_CLAIM_LEASE_MS +
            1;
        }
        return Promise.resolve({
          resultId: "message_result_after_expiry",
          status: "published" as const,
        });
      }
    );
    const adapter = createAdapter("lark", { publishReply });
    const options = {
      messageChannelNowMs: () => nowMs,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode:
          "message_channel.final_publication_confirmation_outcome_unknown",
        retryAfterMs:
          REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS,
        status: "retryable",
      });
      nowMs +=
        REMOTE_AGENT_MESSAGE_CHANNEL_AMBIGUOUS_PUBLICATION_RETRY_DELAY_MS;
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        publishedSignalId: "message_result_after_expiry",
        status: "accepted",
      });

      expect(publishReply).toHaveBeenCalledTimes(2);
      expect(publishReply.mock.calls[0]?.[0]).toEqual(
        publishReply.mock.calls[1]?.[0]
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationAttemptCount: 2,
        finalPublicationState: "published",
        providerPublicationResultId: "message_result_after_expiry",
      });
    } finally {
      harness.close();
    }
  });

  it("releases a confirmed provider failure so the callback can retry", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "connected");
    const publishReply = vi
      .fn()
      .mockResolvedValueOnce({
        reasonCode: "lark.rate_limited",
        retryAfterMs: 7000,
        status: "failed" as const,
      })
      .mockResolvedValueOnce({
        resultId: "message_result_after_retry",
        status: "published" as const,
      });
    const adapter = createAdapter("lark", { publishReply });
    let nowMs = 2000;
    const options = {
      messageChannelNowMs: () => nowMs,
      messageChannelProviderRegistry: createMessageChannelProviderRegistry([
        adapter,
      ]),
    };
    try {
      await createAcceptedMessageChannelDelivery(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "lark.rate_limited",
        retryAfterMs: 7000,
        status: "retryable",
      });
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        reasonCode: "lark.rate_limited",
        retryAfterMs: 7000,
        status: "retryable",
      });
      expect(publishReply).toHaveBeenCalledTimes(1);

      nowMs += 7000;
      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          options
        )
      ).resolves.toEqual({
        publishedSignalId: "message_result_after_retry",
        status: "accepted",
      });

      expect(publishReply).toHaveBeenCalledTimes(2);
    } finally {
      harness.close();
    }
  });

  it("does not claim publication while the frozen connection is unavailable", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelPublicationMigrations(harness);
    seedConnection(harness, "disconnected");
    const adapter = createAdapter("lark");
    try {
      await createAcceptedMessageChannelDelivery(harness.db);

      await expect(
        completeRemoteAgentNativeDelivery(
          buildEnv(harness.db),
          createCompletedCallback(),
          {
            messageChannelNowMs: () => 2000,
            messageChannelProviderRegistry:
              createMessageChannelProviderRegistry([adapter]),
          }
        )
      ).resolves.toEqual({
        reasonCode: "remote_agent.message_channel_connection_unavailable",
        status: "retryable",
      });

      expect(adapter.publishReply).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: IDEMPOTENCY_KEY,
        })
      ).resolves.toMatchObject({
        finalPublicationClaimId: null,
        finalPublicationState: null,
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });
});

function applyMessageChannelPublicationMigrations(
  harness: Parameters<typeof applyDrizzleMigrationForTable>[0]
): void {
  harness.run({
    sql: `
      CREATE TABLE users (
        id TEXT PRIMARY KEY NOT NULL
      )
    `,
  });
  harness.run({
    sql: `
      CREATE TABLE organizations (
        id TEXT PRIMARY KEY NOT NULL
      )
    `,
  });
  harness.run({
    sql: "INSERT INTO users (id) VALUES ('user_owner')",
  });
  harness.run({
    sql: "INSERT INTO organizations (id) VALUES ('org_1')",
  });
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_native_delivery_ledger"
  );
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_channel_connections"
  );
  applyDrizzleMigrationForTable(harness, "agent_delegation_children");
  applyDrizzleMigrationForTable(harness, "agent_delegations");
  applyDrizzleMigrationForTable(harness, "agent_task_completion_subscriptions");
  applyDrizzleMigrationForTable(harness, "agent_task_terminal_outcomes");
}

function seedConnection(
  harness: ReturnType<typeof createSqliteD1Harness>,
  status: "connected" | "disconnected"
): void {
  harness.run({
    params: [status],
    sql: `
      INSERT INTO openMeldRemoteAgent_lark_platform_channel_connections (
        connection_id,
        organization_id,
        provider,
        app_id,
        tenant_key,
        bot_open_id,
        bot_name,
        transport,
        status,
        installed_by_user_id,
        permission_bundle_version,
        granted_capability_groups_json,
        connection_generation,
        last_verified_at_ms,
        failure_reason_code,
        created_at_ms,
        updated_at_ms
      ) VALUES (
        'connection_lark_1',
        'org_1',
        'lark',
        'app_lark_1',
        'tenant_lark_1',
        'bot_open_id_1',
        'Center Agent',
        'webhook',
        ?,
        'user_owner',
        'channel-preset-v1',
        '["messaging"]',
        1,
        1000,
        NULL,
        1000,
        1000
      )
    `,
  });
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

async function createAcceptedMessageChannelDelivery(
  db: D1Database
): Promise<void> {
  await createSubmittedMessageChannelDelivery(db);
  await acceptMessageChannelDelivery(db);
}

async function registerMessageChannelDeliverySubscription(
  db: D1Database,
  suffix: string
): Promise<string> {
  const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
    db,
    idempotencyKey: IDEMPOTENCY_KEY,
  });
  if (!delivery) {
    throw new Error("Expected the Message Channel delivery fixture");
  }
  const subscriptionId = `subscription-message-channel-publication-${suffix}`;
  await registerAgentTaskCompletionSubscription({
    completionCondition: "terminal",
    continuation: null,
    db,
    idempotencyKey: `subscription-key:message-channel-publication-${suffix}`,
    nowMs: 1150,
    observerTask: {
      deliveryId: `observer-message-channel-delivery-${suffix}`,
      kind: "native_delivery",
      v: 1,
    },
    organizationId: "org_1",
    subscriptionId,
    watchedTask: {
      deliveryId: delivery.deliveryId,
      kind: "native_delivery",
      v: 1,
    },
  });
  return subscriptionId;
}

async function createAcceptedMessageChannelDeliveryWithSentWorkingCard(
  db: D1Database
): Promise<void> {
  await createSubmittedMessageChannelDelivery(db);
  await createSentWorkingCard(db);
  await acceptMessageChannelDelivery(db);
}

async function createAcceptedMessageChannelDeliveryWithUnknownWorkingCardSend(
  db: D1Database
): Promise<void> {
  await createSubmittedMessageChannelDelivery(db);
  await createWorkingCard(db);
  const sendClaim = await claimRemoteAgentMessageChannelProviderCardSend({
    claimExpiresAtMs: 1600,
    claimId: "provider_send_claim_1",
    db,
    idempotencyKey: IDEMPOTENCY_KEY,
    nowMs: 1300,
    providerPublicationIdempotencyKey: "working_card_publication_1",
  });
  if (sendClaim.status !== "claimed") {
    throw new Error("Failed to claim the working card send");
  }
  const outcomeUnknown =
    await markRemoteAgentMessageChannelProviderCardSendOutcomeUnknown({
      claimId: "provider_send_claim_1",
      db,
      failureCode: "lark.card_send_outcome_unknown",
      idempotencyKey: IDEMPOTENCY_KEY,
      nowMs: 1400,
    });
  if (outcomeUnknown?.providerProgressState !== "send_outcome_unknown") {
    throw new Error("Failed to record an unknown working card send outcome");
  }
  await acceptMessageChannelDelivery(db);
}

async function createWorkingCard(db: D1Database): Promise<void> {
  const createClaim = await claimRemoteAgentMessageChannelProviderCardCreation({
    claimExpiresAtMs: 1400,
    claimId: "provider_create_claim_1",
    db,
    idempotencyKey: IDEMPOTENCY_KEY,
    nowMs: 1200,
  });
  if (createClaim.status !== "claimed") {
    throw new Error("Failed to claim the working card creation");
  }
  const created = await markRemoteAgentMessageChannelProviderCardCreated({
    cardId: "card_working_lark_1",
    claimId: "provider_create_claim_1",
    db,
    idempotencyKey: IDEMPOTENCY_KEY,
    nowMs: 1250,
  });
  if (
    created?.providerProgressCardId !== "card_working_lark_1" ||
    created.providerProgressState !== "created"
  ) {
    throw new Error("Failed to persist the working card identity");
  }
}

async function createSentWorkingCard(db: D1Database): Promise<void> {
  await createWorkingCard(db);
  const sendClaim = await claimRemoteAgentMessageChannelProviderCardSend({
    claimExpiresAtMs: 1600,
    claimId: "provider_send_claim_1",
    db,
    idempotencyKey: IDEMPOTENCY_KEY,
    nowMs: 1300,
    providerPublicationIdempotencyKey: "working_card_publication_1",
  });
  if (sendClaim.status !== "claimed") {
    throw new Error("Failed to claim the working card send");
  }
  const sent = await markRemoteAgentMessageChannelProviderCardSent({
    claimId: "provider_send_claim_1",
    db,
    idempotencyKey: IDEMPOTENCY_KEY,
    messageId: "message_working_lark_1",
    nowMs: 1400,
    providerPublicationIdempotencyKey: "working_card_publication_1",
  });
  if (
    sent?.providerProgressMessageId !== "message_working_lark_1" ||
    sent.providerProgressState !== "sent"
  ) {
    throw new Error("Failed to persist the working card message identity");
  }
}

async function acceptMessageChannelDelivery(db: D1Database): Promise<void> {
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db,
    idempotencyKey: IDEMPOTENCY_KEY,
    nowMs: 1100,
    submissionId: SUBMISSION_ID,
    workerRequestId: "worker_request_1",
  });
}

async function createSubmittedMessageChannelDelivery(
  db: D1Database
): Promise<void> {
  await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: null,
    bindingId: "binding_1",
    conversationKind: "message_channel",
    db,
    dispatchId: "dispatch_message_channel_1",
    idempotencyKey: IDEMPOTENCY_KEY,
    messageChannelLocator: createLocator(),
    nowMs: 1000,
    onBehalfOfDisplayName: "Ari",
    onBehalfOfProfileId: "22222222-2222-4222-8222-222222222222",
    onBehalfOfUserId: "user_1",
    organizationId: "org_1",
    profileId: AGENT_PROFILE_ID,
    providerPublicationIdempotencyKey: PROVIDER_PUBLICATION_KEY,
    spaceId: CONVERSATION_ID,
    status: "submitted",
    triggerMessageId: "message_trigger_1",
    triggerText: "Please prepare the launch plan.",
  });
}

function createAdmissionWatchdogProbe(): RemoteAgentNativeDeliveryDeadlineProbeQueueMessage {
  return {
    deadlineAtMs: 1000 + REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS * 1000,
    dispatchId: "dispatch_message_channel_1",
    enqueuedAtMs: 1000,
    idempotencyKey: IDEMPOTENCY_KEY,
    kind: "remote_agent_native_delivery_deadline_probe",
    organizationId: "org_1",
    spaceId: CONVERSATION_ID,
    submissionId:
      buildRemoteAgentAdmissionWatchdogSubmissionId(IDEMPOTENCY_KEY),
    v: 3,
  };
}

function createAdapter(
  provider: "feishu" | "lark",
  overrides: Partial<MessageChannelProviderAdapter> = {}
): MessageChannelProviderAdapter {
  return {
    createWorkingCard: vi.fn(),
    downloadResource: vi.fn(),
    finalizeWorkingCard: vi.fn(),
    provider,
    publishIdentityLinkGuidance: vi.fn(),
    publishPrivateNavigationGuidance: vi.fn(),
    publishFailure: vi.fn(),
    publishReply: vi.fn(),
    publishWorkingCard: vi.fn(),
    readChannelContext: vi.fn(),
    updateWorkingCard: vi.fn(),
    ...overrides,
  };
}

function createLocator(): Extract<
  MessageChannelConversationLocator,
  { provider: "lark" }
> {
  return {
    appId: "app_lark_1",
    chatId: "chat_lark_1",
    connectionId: "connection_lark_1",
    provider: "lark",
    rootMessageId: "message_root_1",
    tenantKey: "tenant_lark_1",
    threadId: null,
  };
}

function createCompletedCallback(): Exclude<
  RemoteAgentCoreCallbackBody,
  { status: "failed" }
> {
  return {
    agentProfileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    dispatchId: "dispatch_message_channel_1",
    idempotencyKey: IDEMPOTENCY_KEY,
    organizationId: "org_1",
    spaceId: CONVERSATION_ID,
    submissionId: SUBMISSION_ID,
    text: "The launch plan is ready.",
    triggerMessageId: "message_trigger_1",
  };
}

function createImageAttachment() {
  return {
    id: "attachment_generated_1",
    mimeType: "image/png" as const,
    sizeBytes: 2048,
  };
}

function createFailedCallback(): Extract<
  RemoteAgentCoreCallbackBody,
  { status: "failed" }
> {
  return {
    agentProfileId: AGENT_PROFILE_ID,
    bindingId: "binding_1",
    dispatchId: "dispatch_message_channel_1",
    failureCode: "remote_agent.turn_not_completed",
    failureMessage: "Center Agent could not finish this request.",
    idempotencyKey: IDEMPOTENCY_KEY,
    organizationId: "org_1",
    spaceId: CONVERSATION_ID,
    status: "failed",
    submissionId: SUBMISSION_ID,
    triggerMessageId: "message_trigger_1",
  };
}

function buildEnv(
  db: D1Database,
  spacesGet: ReturnType<typeof vi.fn> = vi.fn()
): CoreBindings {
  return {
    OPENMELD_DB: db,
    OPENMELD_WAKE_EVIDENCE_DB: db,
    OPENMELD_SPACES: {
      get: spacesGet,
    } as unknown as CoreBindings["OPENMELD_SPACES"],
  } as CoreBindings;
}
