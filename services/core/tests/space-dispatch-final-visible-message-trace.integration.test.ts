import { runInDurableObject } from "cloudflare:test";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { SignalEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  spaceDispatchTraceResponseSchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { upsertRemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { readSpaceDispatchTrace } from "../src/space/infrastructure/postgresql/space-dispatch-read-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import {
  insertSignalRecord,
  readFinalReplyClaimSignalId,
  readSignalEntryById,
} from "../src/space/infrastructure/sql/space-signal-repo";
import { resolveFinalVisibleMessageTraceReadResult } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

const BASE_SIGNAL = {
  v: 1,
  id: "sig-final-1",
  spaceId: "space-1",
  ts: 1_700_000_000_000,
  profile: {
    kind: "system",
    profileId: "openmeld-system",
    profileName: "OpenMeld",
  },
} as const;
const TARGET_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("dispatch final visible message trace", () => {
  it("reads a native continuation's persisted final Space message without a workstation dispatch", async () => {
    const bindings = env as CoreBindings;
    const db = getPostgresDatabase(bindings);
    const stub = bindings.OPENMELD_SPACES.get(
      bindings.OPENMELD_SPACES.newUniqueId()
    );
    await runInDurableObject(stub, async (_instance, state) => {
      ensureSpaceSqlSchema(state.storage.sql);
      const spaceId = state.id.toString();
      const dispatchId = `continuation-${crypto.randomUUID()}`;
      const signal = {
        ...BASE_SIGNAL,
        id: crypto.randomUUID(),
        spaceId,
        type: "signal.text",
        profile: {
          kind: "agent",
          profileId: TARGET_PROFILE_ID,
          profileName: "Center Agent",
        },
        data: {
          text: "The follow-up task is complete.",
          meta: {
            dispatchId,
            purpose: AGENT_REPLY_FINAL_PURPOSE,
            targetProfileId: TARGET_PROFILE_ID,
          },
        },
      } satisfies SignalEnvelope;
      expect(
        insertSignalRecord(state.storage.sql, signal).persistedSignal
      ).toBe(true);
      await upsertRemoteAgentNativeDeliveryRecord({
        db,
        attemptId: null,
        bindingId: "binding-continuation",
        dispatchId,
        idempotencyKey: dispatchId,
        nowMs: signal.ts,
        organizationId: "org-continuation",
        profileId: TARGET_PROFILE_ID,
        spaceId,
        status: "completed",
        triggerMessageId: "task-continuation",
      });
      const response = await readSpaceDispatchTrace({
        db,
        dispatchId,
        spaceId,
        responseContractVersion: 6,
        readReplySignalTrace: () => null,
        readFinalVisibleMessageTrace: (input) =>
          resolveFinalVisibleMessageTraceReadResult({
            ...input,
            readFinalReplyClaimSignalId: (claim) =>
              readFinalReplyClaimSignalId(state.storage.sql, claim),
            readRawSignalById: (signalId) =>
              readSignalEntryById(state.storage.sql, signalId)?.[1] ?? null,
          }),
      });
      expect(response).toMatchObject({
        trace: null,
        correlation: { replySignalId: signal.id },
        nativeDeliveryTrace: {
          finalVisibleMessage: {
            signalId: signal.id,
            dispatchId,
            targetProfileId: TARGET_PROFILE_ID,
          },
          finalVisibleOutcome: {
            delivered: true,
            signalId: signal.id,
            status: "visible_reply",
          },
        },
      });
      expect(spaceDispatchTraceResponseSchema.safeParse(response).success).toBe(
        true
      );
      const mismatched = structuredClone(response);
      if (!mismatched.nativeDeliveryTrace?.finalVisibleMessage) {
        throw new Error("expected persisted visible message");
      }
      mismatched.nativeDeliveryTrace.finalVisibleMessage.targetProfileId =
        "other-agent";
      expect(
        spaceDispatchTraceResponseSchema.safeParse(mismatched).success
      ).toBe(false);
      mismatched.nativeDeliveryTrace.finalVisibleMessage.targetProfileId =
        TARGET_PROFILE_ID;
      mismatched.nativeDeliveryTrace.destination.spaceId = "other-space";
      expect(
        spaceDispatchTraceResponseSchema.safeParse(mismatched).success
      ).toBe(false);
      await state.storage.deleteAlarm();
    });
  });
});
