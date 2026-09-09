import {
  buildMessageChannelConversationId,
  buildSpaceAttachmentObjectKey,
} from "@openmeld/schemas";
import type {
  MessageChannelConversationLocator,
  RemoteAgentTurnEnvelope,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_REASON_CODE } from "../src/remote-agent/application/daily-admission-policy";
import {
  createMessageChannelProviderRegistry,
  type MessageChannelProviderAdapter,
} from "../src/remote-agent/application/message-channel-adapters";
import {
  type RemoteAgentMessageChannelNativeDeliveryInput,
  RemoteAgentMessageChannelSubmissionOutcomeUnknownError,
  submitRemoteAgentMessageChannelNativeDelivery,
} from "../src/remote-agent/application/message-channel-native-delivery-service";
import type { MessageChannelTurnTarget } from "../src/remote-agent/application/message-channel-turn-resolution";
import { REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS } from "../src/remote-agent/application/native-delivery-admission-watchdog";
import {
  claimRemoteAgentMessageChannelAdmissionFailurePublication,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import { TEST_CENTER_AGENT_MODEL_ROUTE } from "./helpers/center-agent-model-route.test-support";
import {
  applyDrizzleMigrationForTable,
  applyDrizzleMigrationsForTables,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const RFC_4122_VERSION_5_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("Remote Agent Message Channel native delivery", () => {
  it("publishes one durable receipt before slow input preparation and skips preparation on accepted replay", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const order: string[] = [];
    const request = createMessageChannelDeliveryInput();
    const workerSubmit = vi.fn(() => {
      order.push("worker");
      return Promise.resolve({
        accepted: true,
        createdAt: 1001,
        requestId: "request_lark_1",
        status: "pending" as const,
        submissionId: "submission_lark_1",
      });
    });
    const registry = createWorkingCardRegistry({
      publishWorkingCard: vi.fn(() => {
        order.push("receipt");
        return Promise.resolve({
          resultId: "message_working_1",
          status: "published" as const,
        });
      }),
    });
    const prepareInput = vi.fn(() => {
      expect(order).toEqual(["receipt"]);
      order.push("context_and_files");
      return Promise.resolve({ turnEnvelope: request.turnEnvelope });
    });
    try {
      const input = {
        db: harness.db,
        env: buildEnv({
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
        }),
        memoryService: null,
        nowMs: 1000,
        registry,
        request,
        prepareInput,
      };
      await submitRemoteAgentMessageChannelNativeDelivery(input);
      expect(order).toEqual(["receipt", "context_and_files", "worker"]);
      await submitRemoteAgentMessageChannelNativeDelivery({
        ...input,
        nowMs: 2000,
      });
      expect(prepareInput).toHaveBeenCalledOnce();
      expect(workerSubmit).toHaveBeenCalledOnce();
    } finally {
      harness.close();
    }
  });
  it("keeps a receipt recoverable when input preparation fails before worker submission", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const queueSend = vi.fn(() => Promise.resolve());
    const workerSubmit = vi.fn();
    const registry = createWorkingCardRegistry();
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env: buildEnv({
            queueSend,
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          memoryService: null,
          nowMs: 1000,
          registry,
          request: createMessageChannelDeliveryInput(),
          prepareInput: () => {
            expect(queueSend).toHaveBeenCalledWith(
              expect.objectContaining({
                kind: "remote_agent_native_delivery_deadline_probe",
              }),
              expect.anything()
            );
            return Promise.reject(
              new Error("Attachment temporarily unavailable")
            );
          },
        })
      ).rejects.toThrow("Attachment temporarily unavailable");
      expect(workerSubmit).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("uses the shared worker, ledger, quota, and admission watchdog", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    seedEnabledOrganizationSkill(harness);
    const workerSubmit = vi.fn(async (_input: unknown) => ({
      accepted: true,
      createdAt: 1001,
      requestId: "request_lark_1",
      status: "pending" as const,
      submissionId: "submission_lark_1",
    }));
    const queueSend = vi.fn(async () => undefined);
    const request = createMessageChannelDeliveryInput();
    try {
      const result = await submitRemoteAgentMessageChannelNativeDelivery({
        db: harness.db,
        env: buildEnv({
          queueSend,
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
        }),
        memoryService: null,
        nowMs: 1000,
        registry: createWorkingCardRegistry(),
        request,
      });

      expect(result).toMatchObject({
        shouldAck: true,
        status: "submitted",
      });
      expect(result.providerPublicationIdempotencyKey).toMatch(
        RFC_4122_VERSION_5_UUID
      );
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          agentProfileId: AGENT_PROFILE_ID,
          agentProfileOwnerUserId: "user_center_agent",
          author: {
            displayName: "Ari",
            profileId: "22222222-2222-4222-8222-222222222222",
            profileKind: "human",
          },
          bindingId: "binding_1",
          messages: [
            { content: "Please summarize the launch plan.", role: "user" },
          ],
          modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
          organizationId: "org_1",
          organizationSkillReleases: [
            {
              digest: "a".repeat(64),
              name: "release-review",
              releaseId: "release_1",
              skillId: "skill_1",
            },
          ],
          spaceId: request.turnEnvelope.space.id,
          turnEnvelope: request.turnEnvelope,
          v: 4,
        })
      );
      const submittedRequest = workerSubmit.mock.calls[0]?.[0];
      expect(submittedRequest).toMatchObject({
        dispatchId: result.dispatchId,
        idempotencyKey: result.idempotencyKey,
      });
      expect(queueSend).toHaveBeenCalledWith(
        expect.objectContaining({
          dispatchId: result.dispatchId,
          idempotencyKey: result.idempotencyKey,
          spaceId: request.turnEnvelope.space.id,
          submissionId: `admission_watchdog:${result.idempotencyKey}`,
        }),
        { delaySeconds: REMOTE_AGENT_ADMISSION_WATCHDOG_DELAY_SECONDS }
      );

      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: result.idempotencyKey,
        })
      ).resolves.toMatchObject({
        conversationKind: "message_channel",
        messageChannelLocator: request.locator,
        onBehalfOfUserId: "user_1",
        providerPublicationIdempotencyKey:
          result.providerPublicationIdempotencyKey,
        providerProgressCardId: "card_working_1",
        providerProgressMessageId: "message_working_1",
        providerProgressSequence: 0,
        providerProgressState: "sent",
        status: "accepted",
        triggerText: "Please summarize the launch plan.",
      });

      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env: buildEnv({
            queueSend,
            remoteAgentWorker: { submitConversationTurn: workerSubmit },
          }),
          memoryService: null,
          nowMs: 2000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).resolves.toMatchObject({
        dispatchId: result.dispatchId,
        idempotencyKey: result.idempotencyKey,
        shouldAck: true,
        status: "submitted",
      });
      expect(workerSubmit).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("submits an anonymous member without OpenMeld identity authority", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "request_lark_external_1",
      status: "pending" as const,
      submissionId: "submission_lark_external_1",
    }));
    const request = createExternalMessageChannelDeliveryInput();
    try {
      const result = await submitRemoteAgentMessageChannelNativeDelivery({
        db: harness.db,
        env: buildEnv({
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
        }),
        memoryService: null,
        nowMs: 1000,
        registry: createWorkingCardRegistry(),
        request,
      });

      expect(result).toMatchObject({ status: "submitted" });
      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          author: {
            displayName: "Guest Ari",
            profileId: null,
            profileKind: null,
          },
          onBehalfOf: null,
          turnEnvelope: expect.objectContaining({
            sender: expect.objectContaining({
              id: "lark:connection_lark_1:ou_guest_1",
              verified: false,
            }),
          }),
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: result.idempotencyKey,
        })
      ).resolves.toMatchObject({
        onBehalfOfUserId: null,
      });
    } finally {
      harness.close();
    }
  });

  it("persists provider images in the exact durable worker request", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const workerSubmit = vi.fn(async (_input: unknown) => ({
      accepted: true,
      createdAt: 1001,
      requestId: "request_lark_image_1",
      status: "pending" as const,
      submissionId: "submission_lark_image_1",
    }));
    try {
      await submitRemoteAgentMessageChannelNativeDelivery({
        db: harness.db,
        env: buildEnv({
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
        }),
        memoryService: null,
        nowMs: 1000,
        registry: createWorkingCardRegistry(),
        request: createMessageChannelDeliveryInput({
          attachments: [
            {
              fileName: "launch.png",
              id: "message-channel-image-1",
              mimeType: "image/png",
              removeAfterAdmission: true,
              sizeBytes: 128,
            },
          ],
        }),
      });

      expect(workerSubmit).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            {
              attachments: [
                {
                  fileName: "launch.png",
                  id: "message-channel-image-1",
                  mimeType: "image/png",
                  removeAfterAdmission: true,
                  sizeBytes: 128,
                },
              ],
              content: "Please summarize the launch plan.",
              role: "user",
            },
          ],
        })
      );
    } finally {
      harness.close();
    }
  });

  it("deletes provider images when no Remote Agent worker can receive them", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const attachmentDelete = vi.fn(async () => undefined);
    const request = createMessageChannelDeliveryInput({
      attachments: [
        {
          fileName: "launch.png",
          id: "message-channel-image-orphan",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: 128,
        },
      ],
    });
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env: buildEnv({
            attachmentDelete,
            remoteAgentWorker: undefined,
          }),
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.worker_unavailable",
        status: "failed",
      });

      expect(attachmentDelete).toHaveBeenCalledWith(
        buildSpaceAttachmentObjectKey({
          id: "message-channel-image-orphan",
          organizationId: "org_1",
          spaceId: request.turnEnvelope.space.id,
        })
      );
    } finally {
      harness.close();
    }
  });

  it("keeps provider images when the delivery ledger state is unavailable", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const attachmentDelete = vi.fn(async () => undefined);
    const request = createMessageChannelDeliveryInput({
      attachments: [
        {
          fileName: "launch.png",
          id: "message-channel-image-ledger-read-failed",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: 128,
        },
      ],
    });
    harness.close();

    await expect(
      submitRemoteAgentMessageChannelNativeDelivery({
        db: harness.db,
        env: buildEnv({
          attachmentDelete,
          remoteAgentWorker: { submitConversationTurn: vi.fn() },
        }),
        memoryService: null,
        nowMs: 1000,
        registry: createWorkingCardRegistry(),
        request,
      })
    ).rejects.toThrow();

    expect(attachmentDelete).not.toHaveBeenCalled();
  });

  it("deletes provider images when the delivery ledger cannot be created", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    harness.run({
      sql: `
        CREATE TRIGGER reject_message_channel_delivery_insert
        BEFORE INSERT ON openMeldRemoteAgent_native_delivery_ledger
        BEGIN
          SELECT RAISE(FAIL, 'D1 delivery insert unavailable');
        END
      `,
    });
    const attachmentDelete = vi.fn(async () => undefined);
    const request = createMessageChannelDeliveryInput({
      attachments: [
        {
          fileName: "launch.png",
          id: "message-channel-image-ledger-write-failed",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: 128,
        },
      ],
    });
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env: buildEnv({
            attachmentDelete,
            remoteAgentWorker: { submitConversationTurn: vi.fn() },
          }),
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).rejects.toThrow("D1 delivery insert unavailable");

      expect(attachmentDelete).toHaveBeenCalledWith(
        buildSpaceAttachmentObjectKey({
          id: "message-channel-image-ledger-write-failed",
          organizationId: "org_1",
          spaceId: request.turnEnvelope.space.id,
        })
      );
    } finally {
      harness.close();
    }
  });

  it("deletes provider images when Working Card preparation throws", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const attachmentDelete = vi.fn(async () => undefined);
    const request = createMessageChannelDeliveryInput({
      attachments: [
        {
          fileName: "launch.png",
          id: "message-channel-image-working-card-failed",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: 128,
        },
      ],
    });
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env: buildEnv({
            attachmentDelete,
            remoteAgentWorker: { submitConversationTurn: vi.fn() },
          }),
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry({
            createWorkingCard: vi.fn(() =>
              Promise.reject(new Error("Working Card preparation unavailable"))
            ),
          }),
          request,
        })
      ).rejects.toThrow("Working Card preparation unavailable");

      expect(attachmentDelete).toHaveBeenCalledWith(
        buildSpaceAttachmentObjectKey({
          id: "message-channel-image-working-card-failed",
          organizationId: "org_1",
          spaceId: request.turnEnvelope.space.id,
        })
      );
    } finally {
      harness.close();
    }
  });

  it("keeps worker admission available when CardKit creation is unavailable", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "request_lark_without_card",
      status: "pending" as const,
      submissionId: "submission_lark_without_card",
    }));
    try {
      const result = await submitRemoteAgentMessageChannelNativeDelivery({
        db: harness.db,
        env: buildEnv({
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
        }),
        memoryService: null,
        nowMs: 1000,
        registry: createWorkingCardRegistry({
          createWorkingCard: vi.fn(async () => ({
            reasonCode: "lark.card_create_http_403",
            status: "failed" as const,
          })),
        }),
        request: createMessageChannelDeliveryInput(),
      });

      expect(result.status).toBe("submitted");
      expect(workerSubmit).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: result.idempotencyKey,
        })
      ).resolves.toMatchObject({
        providerProgressFailureCode: "lark.card_create_http_403",
        providerProgressState: "unavailable",
        status: "accepted",
      });
    } finally {
      harness.close();
    }
  });

  it("records an authorized input failure without calling the worker", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const workerSubmit = vi.fn();
    try {
      const result = await submitRemoteAgentMessageChannelNativeDelivery({
        db: harness.db,
        env: buildEnv({
          remoteAgentWorker: { submitConversationTurn: workerSubmit },
        }),
        memoryService: null,
        nowMs: 1000,
        registry: createWorkingCardRegistry(),
        request: createMessageChannelDeliveryInput({
          inputFailure: {
            failureCode: "message_channel.input_resource_type_unsupported",
            text: "Center Agent cannot read that file yet.",
          },
        }),
      });

      expect(result).toMatchObject({
        failureCode: "message_channel.input_resource_type_unsupported",
        status: "failed",
        text: "Center Agent cannot read that file yet.",
      });
      expect(workerSubmit).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: result.idempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "message_channel.input_resource_type_unsupported",
        status: "failed",
      });
    } finally {
      harness.close();
    }
  });

  it("replays the exact durable request after an ambiguous worker outcome", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const submittedRequests: unknown[] = [];
    const workerSubmit = vi
      .fn()
      .mockImplementationOnce((request: unknown) => {
        submittedRequests.push(request);
        throw new Error("RPC disconnected after worker admission");
      })
      .mockImplementationOnce((request: unknown) => {
        submittedRequests.push(request);
        return {
          accepted: true,
          createdAt: 2001,
          requestId: "request_lark_replay",
          status: "pending" as const,
          submissionId: "submission_lark_replay",
        };
      });
    const attachmentDelete = vi.fn(async () => undefined);
    const request = createMessageChannelDeliveryInput({
      attachments: [
        {
          fileName: "launch.png",
          id: "message-channel-image-ambiguous",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: 128,
        },
      ],
    });
    const env = buildEnv({
      attachmentDelete,
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).rejects.toBeInstanceOf(
        RemoteAgentMessageChannelSubmissionOutcomeUnknownError
      );

      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 2000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).resolves.toMatchObject({ shouldAck: true, status: "submitted" });

      expect(submittedRequests).toHaveLength(2);
      expect(submittedRequests[1]).toEqual(submittedRequests[0]);
      expect(attachmentDelete).not.toHaveBeenCalled();
      expect(
        harness.queryAll<{ count: number }>({
          sql: "SELECT COUNT(*) AS count FROM openMeldRemoteAgent_daily_admissions",
        })
      ).toEqual([{ count: 1 }]);
    } finally {
      harness.close();
    }
  });

  it("rejects a conflicting frozen Lark origin before card or worker effects", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "request_lark_frozen_origin",
      status: "pending" as const,
      submissionId: "submission_lark_frozen_origin",
    }));
    const firstCreateWorkingCard = vi.fn(async () => ({
      cardId: "card_working_1",
      status: "created" as const,
    }));
    const conflictingCreateWorkingCard = vi.fn(async () => ({
      cardId: "card_working_conflict",
      status: "created" as const,
    }));
    const request = createMessageChannelDeliveryInput();
    const env = buildEnv({
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      const first = await submitRemoteAgentMessageChannelNativeDelivery({
        db: harness.db,
        env,
        memoryService: null,
        nowMs: 1000,
        registry: createWorkingCardRegistry({
          createWorkingCard: firstCreateWorkingCard,
        }),
        request,
      });
      expect(first).toMatchObject({ shouldAck: true, status: "submitted" });
      const frozenDelivery =
        await readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: first.idempotencyKey,
        });
      const conflictingLocator = createLocator({
        chatId: "chat_lark_conflict",
        rootMessageId: "message_root_conflict",
      });

      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 2000,
          registry: createWorkingCardRegistry({
            createWorkingCard: conflictingCreateWorkingCard,
          }),
          request: createMessageChannelDeliveryInput({
            locator: conflictingLocator,
          }),
        })
      ).rejects.toThrow("immutable admission identity conflict");

      expect(workerSubmit).toHaveBeenCalledOnce();
      expect(firstCreateWorkingCard).toHaveBeenCalledOnce();
      expect(conflictingCreateWorkingCard).not.toHaveBeenCalled();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: first.idempotencyKey,
        })
      ).resolves.toEqual(frozenDelivery);
    } finally {
      harness.close();
    }
  });

  it("deletes a newly prepared provider image when an accepted delivery is replayed", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "request_lark_accepted_replay",
      status: "pending" as const,
      submissionId: "submission_lark_accepted_replay",
    }));
    const attachmentDelete = vi.fn(async () => undefined);
    const request = createMessageChannelDeliveryInput({
      attachments: [
        {
          fileName: "launch.png",
          id: "message-channel-image-accepted-replay",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: 128,
        },
      ],
    });
    const env = buildEnv({
      attachmentDelete,
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).resolves.toMatchObject({ shouldAck: true, status: "submitted" });

      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 2000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).resolves.toMatchObject({ shouldAck: true, status: "submitted" });

      expect(workerSubmit).toHaveBeenCalledTimes(1);
      expect(attachmentDelete).toHaveBeenCalledOnce();
      expect(attachmentDelete).toHaveBeenCalledWith(
        buildSpaceAttachmentObjectKey({
          id: "message-channel-image-accepted-replay",
          organizationId: "org_1",
          spaceId: request.turnEnvelope.space.id,
        })
      );
    } finally {
      harness.close();
    }
  });

  it("preserves an accepted delivery when replay attachment cleanup fails", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "request_lark_accepted_cleanup_failure",
      status: "pending" as const,
      submissionId: "submission_lark_accepted_cleanup_failure",
    }));
    const sensitiveStorageDetail = "R2 authorization token secret";
    const attachmentDelete = vi.fn(async () => undefined);
    const request = createMessageChannelDeliveryInput({
      attachments: [
        {
          fileName: "launch.png",
          id: "message-channel-image-accepted-cleanup-failure",
          mimeType: "image/png",
          removeAfterAdmission: true,
          sizeBytes: 128,
        },
      ],
    });
    const env = buildEnv({
      attachmentDelete,
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).resolves.toMatchObject({ shouldAck: true, status: "submitted" });
      attachmentDelete.mockRejectedValueOnce(new Error(sensitiveStorageDetail));

      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 2000,
          registry: createWorkingCardRegistry(),
          request,
        })
      ).resolves.toMatchObject({ shouldAck: true, status: "submitted" });

      expect(workerSubmit).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        "[core.message_channel.input_attachment_cleanup_degraded]",
        {
          errorName: "Error",
          objectKey: expect.stringContaining(
            "message-channel-image-accepted-cleanup-failure"
          ),
          reasonCode: "message_channel.input_attachment_cleanup_degraded",
        }
      );
      expect(JSON.stringify(warn.mock.calls)).not.toContain(
        sensitiveStorageDetail
      );
    } finally {
      warn.mockRestore();
      harness.close();
    }
  });

  it("shares one Organization quota across Message Channel connections", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const workerSubmit = vi.fn(async () => ({
      accepted: true,
      createdAt: 1001,
      requestId: "request_quota_1",
      status: "pending" as const,
      submissionId: "submission_quota_1",
    }));
    const attachmentDelete = vi.fn(async () => undefined);
    const env = buildEnv({
      attachmentDelete,
      dailyAdmissionLimit: "1",
      remoteAgentWorker: { submitConversationTurn: workerSubmit },
    });
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry(),
          request: createMessageChannelDeliveryInput(),
        })
      ).resolves.toMatchObject({ status: "submitted" });

      const secondRequest = createMessageChannelDeliveryInput({
        locator: createLocator({
          connectionId: "connection_lark_2",
          rootMessageId: "message_root_2",
        }),
        attachments: [
          {
            fileName: "quota.png",
            id: "message-channel-image-quota",
            mimeType: "image/png",
            removeAfterAdmission: true,
            sizeBytes: 128,
          },
        ],
        triggerMessageId: "message_trigger_2",
      });
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env,
          memoryService: null,
          nowMs: 2000,
          registry: createWorkingCardRegistry(),
          request: secondRequest,
        })
      ).resolves.toMatchObject({
        failureCode: REMOTE_AGENT_DAILY_QUOTA_EXCEEDED_REASON_CODE,
        shouldAck: true,
        status: "failed",
      });
      expect(workerSubmit).toHaveBeenCalledTimes(1);
      expect(attachmentDelete).toHaveBeenCalledWith(
        buildSpaceAttachmentObjectKey({
          id: "message-channel-image-quota",
          organizationId: "org_1",
          spaceId: secondRequest.turnEnvelope.space.id,
        })
      );
    } finally {
      harness.close();
    }
  });

  it("maps a structured worker rejection to Core-owned public copy", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const request = createMessageChannelDeliveryInput();
    const channelContext = request.turnEnvelope.channelContext;
    if (!channelContext) {
      throw new Error("Expected Message Channel context");
    }
    const requestWithContinuity = {
      ...request,
      turnEnvelope: {
        ...request.turnEnvelope,
        channelContext: {
          ...channelContext,
          messages: [
            {
              author: {
                displayName: "Ari",
                id: "member_1",
                kind: "human" as const,
              },
              id: "message_previous_1",
              sentAtMs: 900,
              text: "Continue our launch investigation.",
            },
          ],
        },
      },
    };
    const spaceGet = vi.fn();
    try {
      const result = await submitRemoteAgentMessageChannelNativeDelivery({
        db: harness.db,
        env: buildEnv({
          remoteAgentWorker: {
            submitConversationTurn: vi.fn(async () => ({
              idempotencyKey: "ignored_by_fixture",
              message: "Worker diagnostic detail only.",
              outcome: "rejected" as const,
              reasonCode:
                "remote_agent.conversation_history_limit_exceeded" as const,
              v: 1 as const,
            })),
          },
          spaceGet,
        }),
        memoryService: null,
        nowMs: 1000,
        registry: createWorkingCardRegistry(),
        request: requestWithContinuity,
      });

      expect(result).toMatchObject({
        failureCode: "remote_agent.conversation_history_limit_exceeded",
        shouldAck: true,
        status: "failed",
        text: "Center Agent could not continue this conversation automatically. Try again or open diagnostics.",
      });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: result.idempotencyKey,
        })
      ).resolves.toMatchObject({
        failureCode: "remote_agent.conversation_history_limit_exceeded",
        failureDetail: "Worker diagnostic detail only.",
        status: "failed",
      });
      await expect(
        claimRemoteAgentMessageChannelAdmissionFailurePublication({
          claimExpiresAtMs: 31_000,
          claimId: "claim_message_channel_failure_1",
          db: harness.db,
          failureCode: "remote_agent.conversation_history_limit_exceeded",
          failureDetail: "Worker diagnostic detail only.",
          idempotencyKey: result.idempotencyKey,
          nowMs: 1000,
          status: "failed",
        })
      ).resolves.toMatchObject({
        finalPublicationClaimId: "claim_message_channel_failure_1",
        finalPublicationState: "claimed",
        status: "failed",
      });
      expect(spaceGet).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("rejects locator and turn-envelope drift before writing a delivery", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const request = createMessageChannelDeliveryInput();
    const channelContext = request.turnEnvelope.channelContext;
    if (!channelContext) {
      throw new Error("Expected Message Channel context");
    }
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env: buildEnv({
            remoteAgentWorker: {
              submitConversationTurn: vi.fn(),
            },
          }),
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry(),
          request: {
            ...request,
            turnEnvelope: {
              ...request.turnEnvelope,
              trigger: {
                source: "message_channel",
                provider: "feishu",
                connectionId: request.locator.connectionId,
                conversationId: request.turnEnvelope.space.id,
              },
              channelContext: {
                ...channelContext,
                provider: "feishu",
              },
            },
          },
        })
      ).rejects.toThrow(
        "Message Channel locator does not match its turn envelope"
      );
      expect(
        harness.queryAll<{ count: number }>({
          sql: "SELECT COUNT(*) AS count FROM openMeldRemoteAgent_native_delivery_ledger",
        })
      ).toEqual([{ count: 0 }]);
    } finally {
      harness.close();
    }
  });

  it("rejects target identity and turn-envelope drift before writing a delivery", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelNativeDeliveryMigrations(harness);
    const request = createMessageChannelDeliveryInput();
    const sender = request.turnEnvelope.sender;
    if (sender.kind !== "member") {
      throw new Error("Expected member sender");
    }
    try {
      await expect(
        submitRemoteAgentMessageChannelNativeDelivery({
          db: harness.db,
          env: buildEnv({
            remoteAgentWorker: {
              submitConversationTurn: vi.fn(),
            },
          }),
          memoryService: null,
          nowMs: 1000,
          registry: createWorkingCardRegistry(),
          request: {
            ...request,
            turnEnvelope: {
              ...request.turnEnvelope,
              sender: {
                ...sender,
                displayName: "Impersonated member",
              },
            },
          },
        })
      ).rejects.toThrow(
        "Message Channel target does not match its turn envelope"
      );
      expect(
        harness.queryAll<{ count: number }>({
          sql: "SELECT COUNT(*) AS count FROM openMeldRemoteAgent_native_delivery_ledger",
        })
      ).toEqual([{ count: 0 }]);
    } finally {
      harness.close();
    }
  });
});

function applyMessageChannelNativeDeliveryMigrations(
  harness: Parameters<typeof applyDrizzleMigrationForTable>[0]
): void {
  applyDrizzleMigrationsForTables(harness, [
    "organization_skill_releases",
    "organization_skills",
  ]);
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_native_delivery_ledger"
  );
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_daily_admissions"
  );
  applyDrizzleMigrationForTable(
    harness,
    "openMeldRemoteAgent_conversation_generations"
  );
}

function seedEnabledOrganizationSkill(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({
    sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)",
  });
  harness.run({
    sql: "CREATE TABLE users (id TEXT PRIMARY KEY)",
  });
  harness.run({
    sql: "INSERT INTO organizations (id) VALUES ('org_1')",
  });
  harness.run({
    sql: "INSERT INTO users (id) VALUES ('user_1')",
  });
  harness.run({
    sql: `
      INSERT INTO organization_skills (
        active_release_id,
        created_at,
        created_by_user_id,
        description,
        enabled,
        id,
        name,
        organization_id,
        source_kind,
        updated_at,
        version
      ) VALUES (
        'release_1',
        900,
        'user_1',
        'Review a release.',
        1,
        'skill_1',
        'release-review',
        'org_1',
        'created',
        900,
        1
      )
    `,
  });
  harness.run({
    params: ["a".repeat(64)],
    sql: `
      INSERT INTO organization_skill_releases (
        created_at,
        created_by_user_id,
        digest,
        id,
        manifest_json,
        object_key,
        organization_id,
        skill_id,
        source_kind
      ) VALUES (
        900,
        'user_1',
        ?,
        'release_1',
        '{"runtimeBytes":0}',
        'organizations/org_1/skills/skill_1/releases/release_1.json',
        'org_1',
        'skill_1',
        'created'
      )
    `,
  });
}

function createWorkingCardRegistry(
  overrides: Partial<MessageChannelProviderAdapter> = {}
) {
  const adapter: MessageChannelProviderAdapter = {
    createWorkingCard: vi.fn(async () => ({
      cardId: "card_working_1",
      status: "created" as const,
    })),
    downloadResource: vi.fn(),
    finalizeWorkingCard: vi.fn(),
    provider: "lark",
    publishFailure: vi.fn(),
    publishIdentityLinkGuidance: vi.fn(),
    publishPrivateNavigationGuidance: vi.fn(),
    publishReply: vi.fn(),
    publishWorkingCard: vi.fn(async () => ({
      resultId: "message_working_1",
      status: "published" as const,
    })),
    readChannelContext: vi.fn(),
    updateWorkingCard: vi.fn(),
    ...overrides,
  };
  return createMessageChannelProviderRegistry([adapter]);
}

function buildEnv(input: {
  attachmentDelete?: ReturnType<typeof vi.fn>;
  dailyAdmissionLimit?: string;
  queueSend?: ReturnType<typeof vi.fn>;
  remoteAgentWorker: CoreBindings["OPENMELD_REMOTE_AGENT_WORKER"];
  spaceGet?: ReturnType<typeof vi.fn>;
}): CoreBindings {
  return {
    OPENMELD_DAEMON_DISPATCH_QUEUE: {
      send: input.queueSend ?? vi.fn(async () => undefined),
    } as unknown as CoreBindings["OPENMELD_DAEMON_DISPATCH_QUEUE"],
    OPENMELD_REMOTE_AGENT_DAILY_ADMISSION_LIMIT: input.dailyAdmissionLimit,
    OPENMELD_REMOTE_AGENT_RUNTIME_ENABLED: "true",
    OPENMELD_REMOTE_AGENT_WORKER: input.remoteAgentWorker,
    OPENMELD_SPACE_ATTACHMENTS: input.attachmentDelete
      ? ({
          delete: input.attachmentDelete,
        } as unknown as R2Bucket)
      : undefined,
    OPENMELD_SPACES: input.spaceGet
      ? ({
          get: input.spaceGet,
        } as unknown as CoreBindings["OPENMELD_SPACES"])
      : undefined,
  } as CoreBindings;
}

function createMessageChannelDeliveryInput(
  overrides: Partial<RemoteAgentMessageChannelNativeDeliveryInput> = {}
): RemoteAgentMessageChannelNativeDeliveryInput {
  const locator = overrides.locator ?? createLocator();
  const triggerMessageId = overrides.triggerMessageId ?? "message_trigger_1";
  const conversationId = buildMessageChannelConversationId(locator);
  return {
    locator,
    sourceText: "Please summarize the launch plan.",
    target: createMessageChannelTarget(locator),
    triggerMessageId,
    turnEnvelope: createTurnEnvelope(locator, conversationId, triggerMessageId),
    ...overrides,
  };
}

function createExternalMessageChannelDeliveryInput(): RemoteAgentMessageChannelNativeDeliveryInput {
  const request = createMessageChannelDeliveryInput();
  return {
    ...request,
    target: {
      ...request.target,
      participant: {
        kind: "anonymous_member",
        organization: {
          memberCount: 2,
          organizationId: "org_1",
          organizationName: "OpenMeld Labs",
          organizationPersonal: false,
          organizationSlug: "openmeld-labs",
        },
        providerUserDisplayName: "Guest Ari",
        providerUserId: "ou_guest_1",
      },
    },
    turnEnvelope: {
      ...request.turnEnvelope,
      sender: {
        displayName: "Guest Ari",
        id: "lark:connection_lark_1:ou_guest_1",
        kind: "member",
        verified: false,
      },
    },
  };
}

function createMessageChannelTarget(
  locator: Extract<
    MessageChannelConversationLocator,
    { provider: "lark" | "feishu" }
  >
): MessageChannelTurnTarget {
  return {
    centerAgent: {
      agentProfileId: AGENT_PROFILE_ID,
      bindingId: "binding_1",
      modelRoute: TEST_CENTER_AGENT_MODEL_ROUTE,
      ownerUserId: "user_center_agent",
      profileHandle: "center-agent",
      profileName: "Center Agent",
    },
    connection: {
      appId: locator.appId,
      botName: "Center Agent",
      botOpenId: "open_bot_1",
      callbacksWebhookVerifiedAtMs: 950,
      connectionGeneration: 1,
      connectionId: locator.connectionId,
      createdAtMs: 900,
      eventsWebhookVerifiedAtMs: 950,
      failureReasonCode: null,
      grantedCapabilityGroups: ["channel"],
      installedByUserId: "user_1",
      lastVerifiedAtMs: 950,
      organizationId: "org_1",
      permissionBundleVersion: "lark-platform-channel-v1",
      provider: locator.provider,
      status: "connected",
      tenantKey: locator.tenantKey,
      transport: "webhook",
      updatedAtMs: 950,
    },
    participant: {
      kind: "member",
      member: {
        humanProfileId: "22222222-2222-4222-8222-222222222222",
        memberCount: 2,
        memberId: "member_1",
        organizationId: "org_1",
        organizationName: "OpenMeld Labs",
        organizationPersonal: false,
        organizationSlug: "openmeld-labs",
        role: "member",
        userDisplayName: "Ari",
        userEmail: "ari@example.com",
        userId: "user_1",
      },
    },
  };
}

function createLocator(
  overrides: Partial<
    Extract<MessageChannelConversationLocator, { provider: "lark" }>
  > = {}
): Extract<MessageChannelConversationLocator, { provider: "lark" }> {
  return {
    appId: "app_lark_1",
    chatId: "chat_lark_1",
    connectionId: "connection_lark_1",
    provider: "lark",
    rootMessageId: "message_root_1",
    tenantKey: "tenant_lark_1",
    threadId: null,
    ...overrides,
  };
}

function createTurnEnvelope(
  locator: Extract<
    MessageChannelConversationLocator,
    { provider: "lark" | "feishu" }
  >,
  conversationId: string,
  currentMessageId: string
): RemoteAgentTurnEnvelope {
  return {
    centerAgent: {
      profileHandle: "center-agent",
      profileName: "Center Agent",
    },
    channelContext: {
      conversationId,
      currentMessageId,
      messages: [],
      provider: locator.provider,
      sync: { mode: "snapshot", status: "complete" },
    },
    organization: {
      id: "org_1",
      memberCount: 2,
      name: "OpenMeld Labs",
      personal: false,
    },
    sender: {
      displayName: "Ari",
      id: "member_1",
      kind: "member",
      ownerUserId: "user_1",
      profileId: "22222222-2222-4222-8222-222222222222",
      role: "member",
      verified: true,
    },
    space: {
      id: conversationId,
      isCenterAgentDm: false,
      kind: "space",
      name: "Launch planning",
    },
    trigger: {
      connectionId: locator.connectionId,
      conversationId,
      provider: locator.provider,
      source: "message_channel",
    },
  };
}
