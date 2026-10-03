import { env, runInDurableObject } from "cloudflare:test";
import { buildAgentTaskKey } from "@openmeld/schemas";
import type {
  OpenMeldRequestContext,
  PostSpaceWakeStopBody,
  PostSpaceWakeStopResponse,
  SignalEnvelope,
} from "@openmeld/schemas/types";
import { expect, it } from "vitest";
import { readAgentTaskTerminalOutcome } from "../src/agent-task-coordination/infrastructure/d1/agent-task-coordination-repo";
import {
  createDispatchOutboxRecord,
  readDispatchOutboxRecordByDispatchId,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { upsertSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";
import type { Space } from "../src/space/transport/do/space";

const targetProfileId = "agt_11111111-1111-4111-8111-111111111111";
const clientMessageId = "early-stop-request";

it.each([
  "builtin:codex",
  "hosted:center-agent",
  "hosted:remote-agent",
])("fences a late %s send and persists exactly one stopped outcome", async (agentControllerRef) => {
  const namespace = (
    env as unknown as { OPENMELD_SPACES: DurableObjectNamespace<Space> }
  ).OPENMELD_SPACES;
  await runInDurableObject(
    namespace.get(namespace.newUniqueId()),
    async (instance, state) => {
      // Existing v50 Spaces already have the input queue, but neither Stop table.
      // Re-run the real migration before exercising the late-send fence below.
      state.storage.sql.exec("DROP TABLE space_pending_wake_stops");
      state.storage.sql.exec("DROP TABLE space_wake_stop_outcome_outbox");
      state.storage.sql.exec(
        "DELETE FROM schema_migrations WHERE version >= 50"
      );
      state.storage.sql.exec(
        "INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (50, 'space-sql-schema-v50', ?)",
        Date.now()
      );
      ensureSpaceSqlSchema(state.storage.sql);
      const now = new Date().toISOString();
      upsertSpaceMetaRecord(state.storage.sql, {
        v: 1,
        spaceId: state.id.toString(),
        organizationId: "org",
        visibility: "private",
        accessMode: "public",
        createdAt: now,
        updatedAt: now,
      });
      upsertSpaceMemberRecord(state.storage.sql, {
        spaceId: state.id.toString(),
        profileId: targetProfileId,
        profileKindSnapshot: "agent",
        profileNameSnapshot: "Runner",
        controllerRefSnapshot: agentControllerRef,
        ownerUserIdSnapshot: "owner",
        ownerNameSnapshot: "Owner",
        status: "active",
        memberSource: "added_by_member",
        addedAt: now,
        createdAt: now,
        updatedAt: now,
        removedAt: null,
        addedByProfileId: null,
        addedByOwnerUserId: null,
        addedByDisplayNameSnapshot: null,
        removedByProfileId: null,
        removedByOwnerUserId: null,
        removalReason: null,
        firstEnteredAt: null,
        lastEnteredAt: null,
      });
      const internal = instance as unknown as {
        flushPendingWakeStopOutcomes: () => Promise<void>;
        handlePostWakeStop: (
          body: PostSpaceWakeStopBody,
          context: OpenMeldRequestContext
        ) => Promise<PostSpaceWakeStopResponse>;
        stopUnreceivedWake: (
          body: PostSpaceWakeStopBody,
          context: OpenMeldRequestContext
        ) => PostSpaceWakeStopResponse | null;
        collectInsertedDispatchMessages: (
          records: ReturnType<typeof createDispatchOutboxRecord>[],
          dispatches: unknown[],
          notices: SignalEnvelope[]
        ) => void;
      };
      const context: OpenMeldRequestContext = {
        activeOrganizationId: "org",
        actorContext: {
          openMeldProfileId: "human",
          ownerUserId: "owner",
          callerPrincipalId: "owner",
          profileKind: "human",
          requestId: "stop",
        },
      };
      const body: PostSpaceWakeStopBody = {
        target: { by: "client_message", clientMessageId, targetProfileId },
      };
      expect(await internal.handlePostWakeStop(body, context)).toMatchObject({
        status: "cancelled",
        stopMode: "openmeld_owned_pre_agent",
      });
      expect(await internal.handlePostWakeStop(body, context)).toMatchObject({
        status: "cancelled",
      });
      const makeRecord = (senderProfileId: string, target = targetProfileId) =>
        createDispatchOutboxRecord({
          bindingState: "bound",
          bindingEnabled: true,
          agentControllerRef,
          dispatchPolicy: "mention_only",
          ruleId: "early-stop",
          ruleReason: "test",
          ruleSource: "system",
          sourceSignalSnapshot: {
            profileId: senderProfileId,
            profileKind: "human",
            profileMentionLabel: senderProfileId,
            text: "Please investigate",
          },
          senderProfileId,
          spaceId: state.id.toString(),
          sourceEventId: `source-${senderProfileId}-${target}`,
          sourceClientMessageId: clientMessageId,
          targetProfileId: target,
          nowMs: Date.now(),
        });
      const record = makeRecord("human");
      const dispatches: unknown[] = [];
      const notices: SignalEnvelope[] = [];
      state.storage.transactionSync(() =>
        internal.collectInsertedDispatchMessages([record], dispatches, notices)
      );
      expect(dispatches).toEqual([]);
      expect(
        readDispatchOutboxRecordByDispatchId(
          state.storage.sql,
          record.dispatchId
        )?.outboxStatus
      ).toBe("cancelled");
      expect(notices).toHaveLength(1);
      expect(notices[0]).toMatchObject({
        type: "signal.system_notice",
        data: { noticeType: "wake_stopped", dispatchId: record.dispatchId },
      });
      expect(
        await instance.rpcReadFinalReplyClaimOutcome({
          dispatchId: record.dispatchId,
          profileId: targetProfileId,
          spaceId: state.id.toString(),
        })
      ).toMatchObject({ outcome: "stopped" });
      internal.collectInsertedDispatchMessages([record], dispatches, notices);
      expect(dispatches).toEqual([]);
      expect(notices).toHaveLength(1);
      await internal.flushPendingWakeStopOutcomes();
      await internal.flushPendingWakeStopOutcomes();
      expect(
        await readAgentTaskTerminalOutcome({
          db: env.OPENMELD_DB,
          taskKey: buildAgentTaskKey({
            v: 1,
            kind: "space_wake",
            spaceId: state.id.toString(),
            sourceClientMessageId: clientMessageId,
            targetProfileId,
          }),
        })
      ).toMatchObject({
        outcome: { status: "stopped", publishedSignalId: notices[0]?.id },
      });
      // A guessed client ID must not cancel another author or another target.
      internal.collectInsertedDispatchMessages(
        [makeRecord("another-human"), makeRecord("human", "another-agent")],
        dispatches,
        notices
      );
      expect(dispatches).toHaveLength(2);
      expect(
        internal.stopUnreceivedWake(
          {
            target: {
              by: "client_message",
              clientMessageId,
              targetProfileId: "not-a-member",
            },
          },
          context
        )
      ).toBeNull();
    }
  );
});
