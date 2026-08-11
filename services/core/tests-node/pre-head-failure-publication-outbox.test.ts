import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { OpenMeldDaemonDispatchQueueMessage } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { retryPendingPreHeadFailurePublications } from "../src/dispatch/application/dispatch-queue-service";
import {
  buildDispatchSystemRequestContext,
  buildDispatchSystemSpaceAccess,
} from "../src/dispatch/application/dispatch-space-access";
import {
  claimPreHeadFailurePublicationIntent,
  createPreHeadFailurePublicationIntent,
  createPreHeadFailureRedriveMessage,
  ensurePreHeadFailurePublicationIntent,
  listDuePreHeadFailurePublicationIntents,
  markPreHeadFailurePublicationCompleted,
  readPreHeadFailurePublicationState,
  reschedulePreHeadFailurePublicationIntent,
} from "../src/dispatch/infrastructure/d1/pre-head-failure-publication-outbox-repository";
import {
  DISPATCH_HINT_SYSTEM_PROFILE_ID,
  DISPATCH_HINT_SYSTEM_PROFILE_NAME,
} from "../src/dispatch/rules/dispatch-hint-policy";
import { OPENMELD_DAEMON_DISPATCH_STATE } from "../src/dispatch/rules/dispatch-lifecycle-contract";
import type { CoreBindings } from "../src/lib/bindings";

const migrationPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../packages/db/drizzle/0066_fine_leo.sql"
);

const createSqliteD1Database = (database: DatabaseSync): D1Database =>
  ({
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => {
        const statement = database.prepare(sql);
        const sqlValues = values as SQLInputValue[];
        return {
          all: () => Promise.resolve({ results: statement.all(...sqlValues) }),
          first: () => Promise.resolve(statement.get(...sqlValues) ?? null),
          run: () => {
            const result = statement.run(...sqlValues);
            return Promise.resolve({
              meta: {
                changes: result.changes,
              },
              success: true,
            });
          },
        };
      },
    }),
  }) as unknown as D1Database;

const createDispatchMessage = (): OpenMeldDaemonDispatchQueueMessage => ({
  v: 2,
  autoRelayDepth: 0,
  contextIdMappingSpec: null,
  controllerSnapshot: {
    agentControllerRef: null,
    targetBindingEnabled: true,
    targetBindingState: "bound",
  },
  dispatchChainId: "dispatch-outbox-1",
  dispatchContractVersion: 2,
  dispatchId: "dispatch-outbox-1",
  dispatchPolicy: "mention_only",
  dispatchRulesSnapshot: {
    dispatchPolicy: "mention_only",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    ruleSource: "registry",
  },
  dispatchSnapshot: {
    dispatchPolicy: "mention_only",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    ruleSource: "registry",
    targetBindingEnabled: true,
    targetBindingState: "bound",
  },
  enqueuedAtMs: 1000,
  idempotencyKey: "5:event|5:agent",
  ruleId: "registry.default.all_members.v1",
  ruleReason: "default allow all members mention",
  ruleSource: "registry",
  sourceEventId: "event-outbox-1",
  spaceId: "space-1",
  targetProfileId: "agt_00000000-0000-4000-8000-000000000001",
  taskId: "task-outbox-1",
  transportMode: null,
  visitedProfileIds: [],
  visitedProfileIdsHash: "stable32:outbox",
});

describe("pre-head failure publication operational outbox", () => {
  it("recovers an overdue frozen command with versioned claim and completion fencing", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      for (const statement of fs
        .readFileSync(migrationPath, "utf8")
        .split("--> statement-breakpoint")
        .map((value) => value.trim())
        .filter(Boolean)) {
        database.exec(statement);
      }
      const db = createSqliteD1Database(database);
      const redriveMessage = createPreHeadFailureRedriveMessage(
        createDispatchMessage()
      );
      const context = buildDispatchSystemRequestContext({
        message: redriveMessage,
        requestIdPrefix: "openMeldDaemon-dispatch-hint",
      });
      const intent = createPreHeadFailurePublicationIntent({
        attemptId: "attempt-outbox-1",
        createdAtMs: 1000,
        dispatchMessage: redriveMessage,
        errorCode: "agent_profile_binding.profile_owner_invalid",
        finalStatus: OPENMELD_DAEMON_DISPATCH_STATE.failedTerminal,
        idempotencyKey: redriveMessage.idempotencyKey,
        publicationCommand: {
          context,
          data: {
            actorProfileId: redriveMessage.targetProfileId,
            dispatchId: redriveMessage.dispatchId,
            failureStage: "execution",
            generatedBy: "openmeld",
            noticeType: "terminal_failure",
            reason: "agent_profile_binding.profile_owner_invalid",
            reasonCode: "agent_profile_binding.profile_owner_invalid",
            text: "This agent no longer exists, so this Wake cannot be delivered.",
          },
          profile: {
            kind: "system",
            profileId: DISPATCH_HINT_SYSTEM_PROFILE_ID,
            profileName: DISPATCH_HINT_SYSTEM_PROFILE_NAME,
          },
          spaceAccess: buildDispatchSystemSpaceAccess({
            message: redriveMessage,
            requestIdPrefix: "openMeldDaemon-dispatch-hint",
          }),
          spaceId: redriveMessage.spaceId,
        },
      });

      await expect(
        ensurePreHeadFailurePublicationIntent({ db, intent })
      ).resolves.toEqual(intent);
      await expect(
        listDuePreHeadFailurePublicationIntents({
          db,
          limit: 10,
          nowMs: 45 * 24 * 60 * 60 * 1000,
        })
      ).resolves.toEqual([intent]);

      const queueSend = vi.fn().mockResolvedValue(undefined);
      await expect(
        retryPendingPreHeadFailurePublications({
          db,
          env: {
            OPENMELD_DAEMON_DISPATCH_QUEUE: { send: queueSend },
          } as unknown as CoreBindings,
          nowMs: 2000,
        })
      ).resolves.toEqual({ enqueued: 1, errors: 0, scanned: 1 });
      expect(queueSend).toHaveBeenCalledWith(intent.redriveMessage);

      const claimed = await claimPreHeadFailurePublicationIntent({
        claimId: "claim-outbox-1",
        db,
        dispatchId: intent.dispatchId,
        nowMs: 2000,
      });
      expect(claimed).toMatchObject({
        outcome: "claimed",
        intent: {
          claimId: "claim-outbox-1",
          stateVersion: 1,
        },
      });
      await expect(
        claimPreHeadFailurePublicationIntent({
          claimId: "claim-outbox-2",
          db,
          dispatchId: intent.dispatchId,
          nowMs: 2000,
        })
      ).resolves.toEqual({ outcome: "busy" });
      if (claimed.outcome !== "claimed") {
        throw new Error("expected the first outbox claim to win");
      }

      await reschedulePreHeadFailurePublicationIntent({
        db,
        intent: claimed.intent,
        nextAttemptAtMs: 3000,
        nowMs: 2500,
      });
      const reclaimed = await claimPreHeadFailurePublicationIntent({
        claimId: "claim-outbox-3",
        db,
        dispatchId: intent.dispatchId,
        nowMs: 3000,
      });
      expect(reclaimed).toMatchObject({
        outcome: "claimed",
        intent: {
          attemptCount: 1,
          claimId: "claim-outbox-3",
          stateVersion: 3,
        },
      });
      if (reclaimed.outcome !== "claimed") {
        throw new Error("expected the rescheduled outbox row to be claimable");
      }
      await markPreHeadFailurePublicationCompleted({
        completedAtMs: 4000,
        db,
        intent: reclaimed.intent,
      });
      await expect(
        readPreHeadFailurePublicationState({
          db,
          dispatchId: intent.dispatchId,
        })
      ).resolves.toEqual({ status: "completed" });
    } finally {
      database.close();
    }
  });
});
