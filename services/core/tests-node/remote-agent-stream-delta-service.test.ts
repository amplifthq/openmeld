import type {
  RemoteAgentStreamDeltaCallbackBody,
  RemoteAgentStreamPartCallbackBody,
} from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  encryptLarkPlatformCredential,
  LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION,
} from "../src/remote-agent/application/lark-platform-credential-crypto";
import { submitRemoteAgentStreamDelta } from "../src/remote-agent/application/stream-delta-service";
import { submitRemoteAgentStreamPart } from "../src/remote-agent/application/stream-part-service";
import {
  claimRemoteAgentMessageChannelProviderCardCreation,
  claimRemoteAgentMessageChannelProviderCardSend,
  markRemoteAgentMessageChannelProviderCardCreated,
  markRemoteAgentMessageChannelProviderCardSent,
} from "../src/remote-agent/infrastructure/d1/message-channel-provider-progress-repo";
import {
  claimRemoteAgentMessageChannelFinalPublication,
  markRemoteAgentNativeDeliveryAck,
  markRemoteAgentNativeDeliveryCompleted,
  readRemoteAgentNativeDeliveryByIdempotencyKey,
  upsertRemoteAgentNativeDeliveryRecord,
} from "../src/remote-agent/infrastructure/d1/native-delivery-ledger-repo";
import {
  applyDrizzleMigrationForTable as applyMigrationForTable,
  createSqliteD1Harness,
} from "./helpers/sqlite-d1-harness.test-support";

const SPACE_ID =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";
const CRYPTO_KEY = btoa("0123456789abcdef0123456789abcdef");
type LegacyRemoteAgentStreamDeltaCallbackBody = Extract<
  RemoteAgentStreamDeltaCallbackBody,
  { v: 1 }
>;

describe("Remote Agent stream delta service", () => {
  it("forwards typed thinking snapshots to Space without relabeling them as text", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    const rpcApplyAgentStreamDelta = vi.fn(async () => ({
      status: "accepted" as const,
      lastSequence: 1,
    }));
    try {
      await createAcceptedDelivery(harness.db);

      await expect(
        submitRemoteAgentStreamDelta(
          buildEnv(harness.db, rpcApplyAgentStreamDelta),
          createThinkingDelta()
        )
      ).resolves.toEqual({ status: "accepted", lastSequence: 1 });
      expect(rpcApplyAgentStreamDelta).toHaveBeenCalledWith({
        dispatchId: "dispatch_1",
        kind: "thinking",
        profileId: PROFILE_ID,
        sequence: 1,
        spaceId: SPACE_ID,
        streamId: "stream:sub_1",
        thinkingSnapshot: "Checking the current Space state",
        triggerMessageId: "signal_trigger_1",
        v: 1,
      });
    } finally {
      harness.close();
    }
  });

  it("validates native-delivery identity before applying a Space projection", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    const rpcApplyAgentStreamDelta = vi.fn(async () => ({
      status: "accepted" as const,
      lastSequence: 1,
    }));
    try {
      await createAcceptedDelivery(harness.db);

      await expect(
        submitRemoteAgentStreamDelta(
          buildEnv(harness.db, rpcApplyAgentStreamDelta),
          createDelta()
        )
      ).resolves.toEqual({ status: "accepted", lastSequence: 1 });
      expect(rpcApplyAgentStreamDelta).toHaveBeenCalledWith(
        expect.objectContaining({
          streamId: "stream:sub_1",
          sequence: 1,
          textSnapshot: "Hello",
        })
      );

      await expect(
        submitRemoteAgentStreamDelta(
          buildEnv(harness.db, rpcApplyAgentStreamDelta),
          createDelta({ bindingId: "binding_other" })
        )
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "agent_stream.binding_mismatch",
        lastSequence: 0,
      });
      expect(rpcApplyAgentStreamDelta).toHaveBeenCalledTimes(1);
    } finally {
      harness.close();
    }
  });

  it("refreshes execution evidence only for a new validated stream sequence", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    const rpcApplyAgentStreamDelta = vi.fn(async () => ({
      status: "accepted" as const,
      lastSequence: 1,
    }));
    vi.useFakeTimers();
    try {
      await createAcceptedDelivery(harness.db);
      const env = buildEnv(harness.db, rpcApplyAgentStreamDelta);

      vi.setSystemTime(5000);
      await expect(
        submitRemoteAgentStreamDelta(env, createDelta())
      ).resolves.toMatchObject({ status: "accepted" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        executionEvidenceAtMs: 5000,
        executionEvidenceSequence: 1,
      });

      vi.setSystemTime(6000);
      await expect(
        submitRemoteAgentStreamDelta(env, createDelta())
      ).resolves.toMatchObject({ status: "accepted" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        executionEvidenceAtMs: 5000,
        executionEvidenceSequence: 1,
      });

      vi.setSystemTime(7000);
      await expect(
        submitRemoteAgentStreamDelta(
          env,
          createDelta({
            sequence: 2,
            textDelta: " world",
            textSnapshot: "Hello world",
          })
        )
      ).resolves.toMatchObject({ status: "accepted" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        executionEvidenceAtMs: 7000,
        executionEvidenceSequence: 2,
      });
    } finally {
      vi.useRealTimers();
      harness.close();
    }
  });

  it("counts a validated tool lifecycle part as worker forward progress", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    const rpcApplyAgentStreamPart = vi.fn(async () => ({
      status: "accepted" as const,
      lastSequence: 1,
    }));
    vi.useFakeTimers();
    try {
      await createAcceptedDelivery(harness.db);
      vi.setSystemTime(5000);

      await expect(
        submitRemoteAgentStreamPart(
          buildEnv(harness.db, vi.fn(), rpcApplyAgentStreamPart),
          createToolPart()
        )
      ).resolves.toEqual({ status: "accepted", lastSequence: 1 });
      expect(rpcApplyAgentStreamPart).toHaveBeenCalledOnce();
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "idem_1",
        })
      ).resolves.toMatchObject({
        executionEvidenceAtMs: 5000,
        executionEvidenceSequence: 1,
      });
    } finally {
      vi.useRealTimers();
      harness.close();
    }
  });

  it("rejects Slack, unstable stream ids, and terminal native deliveries", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    const rpcApplyAgentStreamDelta = vi.fn(async () => ({
      status: "accepted" as const,
      lastSequence: 1,
    }));
    try {
      await createAcceptedDelivery(harness.db, { conversationKind: "slack" });
      const env = buildEnv(harness.db, rpcApplyAgentStreamDelta);
      await expect(
        submitRemoteAgentStreamDelta(env, createDelta())
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "agent_stream.unsupported_conversation",
        lastSequence: 0,
      });

      await createAcceptedDelivery(harness.db, {
        conversationKind: "space",
        idempotencyKey: "idem_2",
        submissionId: "sub_2",
      });
      await expect(
        submitRemoteAgentStreamDelta(
          env,
          createDelta({
            idempotencyKey: "idem_2",
            submissionId: "sub_2",
            streamId: "stream:not-sub-2",
          })
        )
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "agent_stream.stream_id_mismatch",
        lastSequence: 0,
      });

      await markRemoteAgentNativeDeliveryCompleted({
        db: harness.db,
        nowMs: 2000,
        submissionId: "sub_2",
        publishedSignalId: "signal_final_1",
      });
      await expect(
        submitRemoteAgentStreamDelta(
          env,
          createDelta({
            idempotencyKey: "idem_2",
            submissionId: "sub_2",
            streamId: "stream:sub_2",
          })
        )
      ).resolves.toEqual({
        status: "rejected",
        reasonCode: "agent_stream.terminal",
        lastSequence: 0,
      });
      expect(rpcApplyAgentStreamDelta).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("accepts Routine deltas without projecting a fabricated trigger frame", async () => {
    const harness = createSqliteD1Harness();
    applyMigrationForTable(
      harness,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    const rpcApplyAgentStreamDelta = vi.fn(async () => ({
      status: "accepted" as const,
      lastSequence: 1,
    }));
    try {
      await createAcceptedDelivery(harness.db, {
        routineRunId: "routine_run_1",
      });

      await expect(
        submitRemoteAgentStreamDelta(
          buildEnv(harness.db, rpcApplyAgentStreamDelta),
          createDelta({ triggerMessageId: "routine_run_1" })
        )
      ).resolves.toEqual({ status: "accepted", lastSequence: 1 });
      expect(rpcApplyAgentStreamDelta).not.toHaveBeenCalled();
    } finally {
      harness.close();
    }
  });

  it("accepts an in-flight card delta superseded by the canonical final publication", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelStreamMigrations(harness);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockImplementationOnce(async () => {
        const claimed = await claimRemoteAgentMessageChannelFinalPublication({
          claimExpiresAtMs: Date.now() + 30_000,
          claimId: "final-claim",
          db: harness.db,
          idempotencyKey: "message_channel_idem_1",
          nowMs: Date.now(),
          payload: {
            storageVersion: 1,
            text: "Complete answer",
            failureCode: null,
            failureDetail: null,
            resumeStatus: "accepted",
          },
          providerPublicationIdempotencyKey:
            "e86df165-338e-562b-8e35-b9b29b1c239b",
          submissionId: "sub_1",
        });
        expect(claimed?.finalPublicationState).toBe("claimed");
        return Response.json({ code: 0, data: {} });
      });
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await seedLarkConnection(harness);
      await createAcceptedMessageChannelDelivery(harness.db);
      await expect(
        submitRemoteAgentStreamDelta(
          {
            ...buildEnv(harness.db, vi.fn()),
            OPENMELD_LARK_CHANNEL_ENABLED: "true",
            LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
          } as CoreBindings,
          createDelta({
            idempotencyKey: "message_channel_idem_1",
            spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
            triggerMessageId: "om_trigger_test",
          })
        )
      ).resolves.toEqual({ lastSequence: 1, status: "duplicate_accepted" });
      const delivery = await readRemoteAgentNativeDeliveryByIdempotencyKey({
        db: harness.db,
        idempotencyKey: "message_channel_idem_1",
      });
      expect(delivery).toMatchObject({
        finalPublicationState: "claimed",
        finalPublicationClaimId: "final-claim",
        finalPublicationPayload: { text: "Complete answer" },
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("streams a Message Channel text snapshot into the exact durable CardKit card", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelStreamMigrations(harness);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(Response.json({ code: 0, data: {} }));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await seedLarkConnection(harness);
      await createAcceptedMessageChannelDelivery(harness.db);
      const env = {
        ...buildEnv(harness.db, vi.fn()),
        OPENMELD_LARK_CHANNEL_ENABLED: "true",
        LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
      } as CoreBindings;
      const delta = createDelta({
        idempotencyKey: "message_channel_idem_1",
        spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
        triggerMessageId: "om_trigger_test",
      });

      await expect(submitRemoteAgentStreamDelta(env, delta)).resolves.toEqual({
        lastSequence: 1,
        status: "accepted",
      });
      expect(fetchImpl).toHaveBeenNthCalledWith(
        2,
        "https://open.larksuite.com/open-apis/cardkit/v1/cards/card_stream_test/elements/stream_md/content",
        expect.objectContaining({
          body: expect.stringContaining('"content":"Hello"'),
          method: "PUT",
        })
      );
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "message_channel_idem_1",
        })
      ).resolves.toMatchObject({
        providerProgressPendingSequence: null,
        providerProgressSequence: 1,
        providerProgressState: "sent",
      });
      await expect(submitRemoteAgentStreamDelta(env, delta)).resolves.toEqual({
        lastSequence: 1,
        status: "duplicate_accepted",
      });
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("reads provider connections from local state while writing progress to native evidence", async () => {
    const evidenceStore = createSqliteD1Harness();
    const providerStore = createSqliteD1Harness();
    applyMigrationForTable(
      evidenceStore,
      "openMeldRemoteAgent_native_delivery_ledger"
    );
    applyMessageChannelProviderMigrations(providerStore);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(Response.json({ code: 0, data: {} }));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await seedLarkConnection(providerStore);
      await createAcceptedMessageChannelDelivery(evidenceStore.db);
      const env = {
        ...buildSplitEnv(evidenceStore.db, providerStore.db, vi.fn()),
        OPENMELD_LARK_CHANNEL_ENABLED: "true",
        LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
      } as CoreBindings;

      await expect(
        submitRemoteAgentStreamDelta(
          env,
          createDelta({
            idempotencyKey: "message_channel_idem_1",
            spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
            triggerMessageId: "om_trigger_test",
          })
        )
      ).resolves.toEqual({ lastSequence: 1, status: "accepted" });
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: evidenceStore.db,
          idempotencyKey: "message_channel_idem_1",
        })
      ).resolves.toMatchObject({
        executionEvidenceSequence: 1,
        providerProgressSequence: 1,
        providerProgressState: "sent",
      });
    } finally {
      vi.unstubAllGlobals();
      evidenceStore.close();
      providerStore.close();
    }
  });

  it("returns provider Retry-After for a rate-limited CardKit stream", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelStreamMigrations(harness);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(
        Response.json(
          { msg: "rate limited" },
          {
            headers: { "Retry-After": "7" },
            status: 429,
          }
        )
      );
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await seedLarkConnection(harness);
      await createAcceptedMessageChannelDelivery(harness.db);
      const env = {
        ...buildEnv(harness.db, vi.fn()),
        OPENMELD_LARK_CHANNEL_ENABLED: "true",
        LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
      } as CoreBindings;

      await expect(
        submitRemoteAgentStreamDelta(
          env,
          createDelta({
            idempotencyKey: "message_channel_idem_1",
            spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
            triggerMessageId: "om_trigger_test",
          })
        )
      ).resolves.toEqual({
        lastSequence: 0,
        reasonCode: "lark.card_update_http_429",
        retryAfterMs: 7000,
        status: "retryable",
      });
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("retries one ambiguous CardKit update with the same sequence and UUID", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelStreamMigrations(harness);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockRejectedValueOnce(new TypeError("socket closed after write"))
      .mockResolvedValueOnce(Response.json({ code: 0, data: {} }));
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await seedLarkConnection(harness);
      await createAcceptedMessageChannelDelivery(harness.db);
      const env = {
        ...buildEnv(harness.db, vi.fn()),
        OPENMELD_LARK_CHANNEL_ENABLED: "true",
        LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
      } as CoreBindings;
      const delta = createDelta({
        idempotencyKey: "message_channel_idem_1",
        spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
        triggerMessageId: "om_trigger_test",
      });

      await expect(
        submitRemoteAgentStreamDelta(env, delta)
      ).resolves.toMatchObject({
        lastSequence: 0,
        reasonCode: "lark.card_update_outcome_unknown",
        status: "retryable",
      });
      await expect(submitRemoteAgentStreamDelta(env, delta)).resolves.toEqual({
        lastSequence: 1,
        status: "accepted",
      });
      const firstBody = String(
        (fetchImpl.mock.calls[1]?.[1] as RequestInit | undefined)?.body
      );
      const retryBody = String(
        (fetchImpl.mock.calls[2]?.[1] as RequestInit | undefined)?.body
      );
      expect(retryBody).toBe(firstBody);
      expect(
        fetchImpl.mock.calls.filter(([request]) =>
          String(request).endsWith(
            "/open-apis/auth/v3/tenant_access_token/internal"
          )
        )
      ).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });

  it("rolls a long Message Channel snapshot into a durable follow-up card", async () => {
    const harness = createSqliteD1Harness();
    applyMessageChannelStreamMigrations(harness);
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          expire: 7200,
          tenant_access_token: "tenant-token",
        })
      )
      .mockResolvedValueOnce(Response.json({ code: 0, data: {} }))
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { card_id: "card_stream_continued" },
        })
      )
      .mockRejectedValueOnce(new TypeError("socket closed after card send"))
      .mockResolvedValueOnce(
        Response.json({
          code: 0,
          data: { message_id: "om_stream_continued" },
        })
      );
    vi.stubGlobal("fetch", fetchImpl);
    try {
      await seedLarkConnection(harness);
      await createAcceptedMessageChannelDelivery(harness.db);
      const env = {
        ...buildEnv(harness.db, vi.fn()),
        OPENMELD_LARK_CHANNEL_ENABLED: "true",
        LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY: CRYPTO_KEY,
      } as CoreBindings;
      const textSnapshot = `${"A".repeat(29_900)}\n${"B".repeat(2000)}`;

      const delta = createDelta({
        idempotencyKey: "message_channel_idem_1",
        spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
        textDelta: "B",
        textSnapshot,
        triggerMessageId: "om_trigger_test",
      });
      await expect(submitRemoteAgentStreamDelta(env, delta)).resolves.toEqual({
        lastSequence: 0,
        reasonCode: "lark.card_send_outcome_unknown",
        status: "retryable",
      });
      const firstSendBody = readRequestJson(fetchImpl, 3);
      await expect(submitRemoteAgentStreamDelta(env, delta)).resolves.toEqual({
        lastSequence: 1,
        status: "accepted",
      });

      const finalizedBody = readRequestJson(fetchImpl, 1) as {
        card: { data: string };
      };
      expect(
        JSON.parse(finalizedBody.card.data) as {
          body: { elements: [{ content: string }] };
        }
      ).toMatchObject({
        body: {
          elements: [{ content: `${"A".repeat(29_900)}\n` }],
        },
      });
      const createdBody = readRequestJson(fetchImpl, 2) as {
        data: string;
      };
      expect(
        JSON.parse(createdBody.data) as {
          body: { elements: [{ content: string }] };
        }
      ).toMatchObject({
        body: {
          elements: [{ content: "B".repeat(2000) }],
        },
      });
      const sentBody = readRequestJson(fetchImpl, 4) as {
        content: string;
      };
      expect(sentBody).toEqual(firstSendBody);
      expect(JSON.parse(sentBody.content)).toEqual({
        data: { card_id: "card_stream_continued" },
        type: "card",
      });
      expect(
        fetchImpl.mock.calls.filter(([request]) =>
          String(request).endsWith(
            "/open-apis/auth/v3/tenant_access_token/internal"
          )
        )
      ).toHaveLength(1);
      await expect(
        readRemoteAgentNativeDeliveryByIdempotencyKey({
          db: harness.db,
          idempotencyKey: "message_channel_idem_1",
        })
      ).resolves.toMatchObject({
        providerProgressCardId: "card_stream_continued",
        providerProgressMessageId: "om_working_test",
        providerProgressPendingCardId: null,
        providerProgressRolloverIndex: 1,
        providerProgressSequence: 1,
        providerProgressSourceOffset: 29_901,
        providerProgressState: "sent",
      });
    } finally {
      vi.unstubAllGlobals();
      harness.close();
    }
  });
});

function readRequestJson(
  fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>,
  index: number
): unknown {
  return JSON.parse(
    String((fetchImpl.mock.calls[index]?.[1] as RequestInit | undefined)?.body)
  );
}

async function createAcceptedDelivery(
  db: D1Database,
  options: {
    conversationKind?: "slack" | "space";
    idempotencyKey?: string;
    routineRunId?: string;
    submissionId?: string;
  } = {}
): Promise<void> {
  const idempotencyKey = options.idempotencyKey ?? "idem_1";
  const submissionId = options.submissionId ?? "sub_1";
  await upsertRemoteAgentNativeDeliveryRecord({
    db,
    nowMs: 1000,
    organizationId: "org_1",
    conversationKind: options.conversationKind ?? "space",
    spaceId: SPACE_ID,
    profileId: PROFILE_ID,
    bindingId: "binding_1",
    triggerMessageId: options.routineRunId ?? "signal_trigger_1",
    routineRunId: options.routineRunId ?? null,
    dispatchId: "dispatch_1",
    attemptId: "attempt_1",
    idempotencyKey,
    status: "submitted",
    ...(options.conversationKind === "slack"
      ? {
          slackChannelId: "C123",
          slackTeamId: "T123",
          slackThreadTs: "1700000000.000100",
        }
      : {}),
  });
  await markRemoteAgentNativeDeliveryAck({
    db,
    nowMs: 1100,
    idempotencyKey,
    submissionId,
    workerRequestId: "request_1",
    accepted: true,
  });
}

function createDelta(
  overrides: Partial<LegacyRemoteAgentStreamDeltaCallbackBody> = {}
): LegacyRemoteAgentStreamDeltaCallbackBody {
  return {
    v: 1,
    streamId: "stream:sub_1",
    sequence: 1,
    submissionId: "sub_1",
    idempotencyKey: "idem_1",
    organizationId: "org_1",
    spaceId: SPACE_ID,
    agentProfileId: PROFILE_ID,
    bindingId: "binding_1",
    triggerMessageId: "signal_trigger_1",
    dispatchId: "dispatch_1",
    source: "flue.text_delta",
    textDelta: "Hello",
    textSnapshot: "Hello",
    observedAtMs: 1200,
    ...overrides,
  };
}

function createThinkingDelta(): RemoteAgentStreamDeltaCallbackBody {
  return {
    v: 2,
    streamId: "stream:sub_1",
    sequence: 1,
    submissionId: "sub_1",
    idempotencyKey: "idem_1",
    organizationId: "org_1",
    spaceId: SPACE_ID,
    agentProfileId: PROFILE_ID,
    bindingId: "binding_1",
    triggerMessageId: "signal_trigger_1",
    dispatchId: "dispatch_1",
    delta: "Checking",
    kind: "thinking",
    snapshot: "Checking the current Space state",
    source: "flue.thinking_delta",
    observedAtMs: 1200,
  };
}

function createToolPart(): RemoteAgentStreamPartCallbackBody {
  return {
    agentProfileId: PROFILE_ID,
    bindingId: "binding_1",
    dispatchId: "dispatch_1",
    idempotencyKey: "idem_1",
    observedAtMs: 1200,
    organizationId: "org_1",
    part: {
      state: "output-available",
      toolCallId: "tool_call_1",
      toolName: "openmeld_list_spaces",
      type: "tool",
    },
    sequence: 1,
    source: "flue.tool",
    spaceId: SPACE_ID,
    streamId: "stream:sub_1",
    submissionId: "sub_1",
    triggerMessageId: "signal_trigger_1",
    v: 1,
  };
}

function buildEnv(
  db: D1Database,
  rpcApplyAgentStreamDelta: ReturnType<typeof vi.fn>,
  rpcApplyAgentStreamPart: ReturnType<typeof vi.fn> = vi.fn()
): CoreBindings {
  const spaceStub = { rpcApplyAgentStreamDelta, rpcApplyAgentStreamPart };
  return {
    OPENMELD_DB: db,
    OPENMELD_LOCAL_STATE_DB: db,
    OPENMELD_WAKE_EVIDENCE_DB: db,
    OPENMELD_SPACES: {
      get: () => spaceStub,
      idFromString: () => ({ toString: () => SPACE_ID }),
    } as unknown as CoreBindings["OPENMELD_SPACES"],
  } as CoreBindings;
}

function buildSplitEnv(
  evidenceDb: D1Database,
  providerDb: D1Database,
  rpcApplyAgentStreamDelta: ReturnType<typeof vi.fn>
): CoreBindings {
  return {
    ...buildEnv(evidenceDb, rpcApplyAgentStreamDelta),
    OPENMELD_DB: providerDb,
    OPENMELD_LOCAL_STATE_DB: providerDb,
    OPENMELD_WAKE_EVIDENCE_DB: evidenceDb,
  } as CoreBindings;
}

function applyMessageChannelStreamMigrations(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  applyMigrationForTable(harness, "openMeldRemoteAgent_native_delivery_ledger");
  applyMessageChannelProviderMigrations(harness);
}

function applyMessageChannelProviderMigrations(
  harness: ReturnType<typeof createSqliteD1Harness>
): void {
  harness.run({ sql: "CREATE TABLE users (id TEXT PRIMARY KEY)" });
  harness.run({ sql: "CREATE TABLE organizations (id TEXT PRIMARY KEY)" });
  harness.run({ sql: "INSERT INTO users (id) VALUES ('user_1')" });
  harness.run({ sql: "INSERT INTO organizations (id) VALUES ('org_1')" });
  applyMigrationForTable(
    harness,
    "openMeldRemoteAgent_lark_platform_channel_connections"
  );
}

async function seedLarkConnection(
  harness: ReturnType<typeof createSqliteD1Harness>
): Promise<void> {
  const encryptedAppSecret = await encryptLarkPlatformCredential({
    credential: "app-secret",
    credentialName: "app secret",
    cryptoKey: CRYPTO_KEY,
  });
  harness.run({
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
        'connection_lark_test',
        'org_1',
        'lark',
        'cli_lark_test',
        'tenant_lark_test',
        'ou_bot_test',
        'Center Agent',
        'webhook',
        'connected',
        'user_1',
        'channel-v1',
        '["messages","cards"]',
        1,
        1000,
        NULL,
        1000,
        1000
      )
    `,
  });
  harness.run({
    params: [encryptedAppSecret, LARK_PLATFORM_CREDENTIAL_FORMAT_VERSION],
    sql: `
      INSERT INTO openMeldRemoteAgent_lark_platform_channel_credentials (
        connection_id,
        encrypted_app_secret,
        encrypted_verification_token,
        encrypted_event_encrypt_key,
        credential_format_version,
        created_at_ms,
        updated_at_ms
      ) VALUES (
        'connection_lark_test',
        ?,
        NULL,
        NULL,
        ?,
        1000,
        1000
      )
    `,
  });
}

async function createAcceptedMessageChannelDelivery(
  db: D1Database
): Promise<void> {
  await upsertRemoteAgentNativeDeliveryRecord({
    attemptId: "attempt_1",
    bindingId: "binding_1",
    conversationKind: "message_channel",
    db,
    dispatchId: "dispatch_1",
    idempotencyKey: "message_channel_idem_1",
    messageChannelLocator: {
      appId: "cli_lark_test",
      chatId: "oc_chat_test",
      connectionId: "connection_lark_test",
      provider: "lark",
      rootMessageId: "om_root_test",
      tenantKey: "tenant_lark_test",
      threadId: null,
    },
    nowMs: 1000,
    organizationId: "org_1",
    profileId: PROFILE_ID,
    providerPublicationIdempotencyKey: "e86df165-338e-562b-8e35-b9b29b1c239b",
    spaceId: "lark:connection_lark_test:oc_chat_test:om_root_test",
    status: "submitted",
    triggerMessageId: "om_trigger_test",
  });
  await claimRemoteAgentMessageChannelProviderCardCreation({
    claimExpiresAtMs: 2100,
    claimId: "create_claim_1",
    db,
    idempotencyKey: "message_channel_idem_1",
    nowMs: 2000,
  });
  await markRemoteAgentMessageChannelProviderCardCreated({
    cardId: "card_stream_test",
    claimId: "create_claim_1",
    db,
    idempotencyKey: "message_channel_idem_1",
    nowMs: 2000,
  });
  await claimRemoteAgentMessageChannelProviderCardSend({
    claimExpiresAtMs: 2200,
    claimId: "send_claim_1",
    db,
    idempotencyKey: "message_channel_idem_1",
    nowMs: 2100,
    providerPublicationIdempotencyKey: "646ba516-4f8d-5f5e-a179-210e76fd244f",
  });
  await markRemoteAgentMessageChannelProviderCardSent({
    claimId: "send_claim_1",
    db,
    idempotencyKey: "message_channel_idem_1",
    messageId: "om_working_test",
    nowMs: 2100,
    providerPublicationIdempotencyKey: "646ba516-4f8d-5f5e-a179-210e76fd244f",
  });
  await markRemoteAgentNativeDeliveryAck({
    accepted: true,
    db,
    idempotencyKey: "message_channel_idem_1",
    nowMs: 2200,
    submissionId: "sub_1",
    workerRequestId: "request_1",
  });
}
