import { env, runInDurableObject } from "cloudflare:test";
import type { SignalEnvelope } from "@openmeld/protocol";
import type { SpaceTaskActor } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import type { SpaceTaskService } from "../src/space/application/space-task-service";
import { upsertSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import {
  type SpaceTaskDelivery,
  SpaceTaskDeliveryRepository,
} from "../src/space/infrastructure/sql/space-task-delivery-repo";
import {
  insertSpaceThread,
  insertSpaceThreadSignalPlacement,
  readSpaceThreadSignalPlacementBySignalId,
} from "../src/space/infrastructure/sql/space-thread-repo";
import type { Space } from "../src/space/transport/do/space";

const requester: SpaceTaskActor = {
  ownerUserId: "user-requester",
  profileId: "11111111-1111-4111-8111-111111111111",
  profileKind: "human",
  profileName: "Avery",
};

type TaskDeliverySpace = {
  applySpaceRef: (spaceId: string) => void;
  deliverSpaceTaskAction: (delivery: SpaceTaskDelivery) => Promise<void>;
  spaceTaskService: SpaceTaskService;
};

describe("Space Task handoff delivery", () => {
  it.each([
    ["human", false],
    ["human", true],
    ["agent", false],
    ["agent", true],
  ] as const)("publishes one passive webhook review notice for %s (Thread=%s)", async (profileKind, inThread) => {
    const namespace = (
      env as unknown as { OPENMELD_SPACES: DurableObjectNamespace<Space> }
    ).OPENMELD_SPACES;
    const stub = namespace.get(namespace.newUniqueId());
    const spaceId = stub.id.toString();
    await runInDurableObject(stub, async (instance, state) => {
      // Exercise delivery and message persistence directly. Keep unrelated
      // background retries from racing the assertions and fixture teardown.
      const setAlarm = state.storage.setAlarm.bind(state.storage);
      const alarm = vi
        .spyOn(state.storage, "setAlarm")
        .mockImplementation((at) =>
          setAlarm(Math.max(Number(at), Date.now() + 3_600_000))
        );
      const background = vi.spyOn(state, "waitUntil");
      await state.storage.deleteAlarm();
      try {
        const space = instance as unknown as TaskDeliverySpace;
        space.applySpaceRef(spaceId);
        const now = new Date().toISOString();
        const reviewer: SpaceTaskActor = {
          ownerUserId: "user-reviewer",
          profileId:
            profileKind === "human"
              ? "22222222-2222-4222-8222-222222222222"
              : "agt_22222222-2222-4222-8222-222222222222",
          profileKind,
          profileName: "Reviewer",
        };
        upsertSpaceMetaRecord(state.storage.sql, {
          v: 1,
          spaceId,
          organizationId: "org-task-handoff",
          visibility: "private",
          accessMode: "members_only",
          createdAt: now,
          updatedAt: now,
        });
        for (const actor of [requester, reviewer]) {
          upsertSpaceMemberRecord(state.storage.sql, {
            spaceId,
            profileId: actor.profileId,
            profileKindSnapshot: actor.profileKind,
            profileNameSnapshot: actor.profileName,
            ownerUserIdSnapshot: actor.ownerUserId,
            ownerNameSnapshot: null,
            controllerRefSnapshot:
              actor.profileKind === "agent" ? "builtin:codex" : null,
            status: "active",
            memberSource: "joined_directly",
            addedAt: now,
            removedAt: null,
            addedByProfileId: null,
            addedByOwnerUserId: null,
            addedByDisplayNameSnapshot: null,
            removedByProfileId: null,
            removedByOwnerUserId: null,
            removalReason: null,
            firstEnteredAt: now,
            lastEnteredAt: now,
            createdAt: now,
            updatedAt: now,
          });
        }
        const source: SignalEnvelope = {
          v: 1,
          id: "source",
          spaceId,
          ts: Date.now(),
          type: "signal.text",
          profile: {
            kind: requester.profileKind,
            profileId: requester.profileId,
            profileName: requester.profileName,
          },
          data: { text: "Fix the linked GitHub issue." },
        };
        insertSignalRecord(state.storage.sql, source);
        const threadId = inThread ? `thr_${crypto.randomUUID()}` : null;
        if (threadId) {
          insertSpaceThread(state.storage.sql, {
            threadId,
            spaceId,
            rootSignalId: source.id,
            createdByProfileId: requester.profileId,
            createdAt: now,
            updatedAt: now,
          });
          insertSpaceThreadSignalPlacement(state.storage.sql, {
            signalId: source.id,
            threadId,
            placement: "root",
            createdAt: now,
          });
        }
        const issue = {
          provider: "github" as const,
          owner: "amplifthq",
          repo: "openmeld",
          number: 1143,
          url: "https://github.com/amplifthq/openmeld/issues/1143",
          lastObservedAt: now,
          lastObservedState: "open" as const,
        };
        const service = space.spaceTaskService;
        const created = service.create(
          {
            operationId: "create-task",
            title: "Fix loading state",
            sourceSignalId: source.id,
            threadId,
            reviewerProfileId: reviewer.profileId,
            externalWorkItems: [issue],
          },
          {
            actor: requester,
            requestedBy: requester,
            isSpaceOwner: true,
            resolveMember: (id) =>
              [requester, reviewer].find((actor) => actor.profileId === id) ??
              null,
          }
        );
        service.applyGitHubIssueObservation({
          taskId: created.task.taskId,
          identity: issue,
          observeOperationId: "observe-completed",
          settleOperationId: "settle-completed",
          observedAt: now,
          observedState: "closed",
          observedStateReason: "completed",
        });
        const deliveries = new SpaceTaskDeliveryRepository(state.storage.sql);
        const delivery = deliveries
          .pending(Date.now())
          .find((item) => item.kind === "handoff");
        if (!delivery) {
          throw new Error("Completed issue must deliver its review handoff");
        }
        expect(delivery.actor).toBeNull();
        // A retained user-authorized action still requires fresh authorization;
        // it must not fall back to a system notice if verification is unavailable.
        await expect(
          space.deliverSpaceTaskAction({ ...delivery, actor: requester })
        ).rejects.toThrow("Participant verification is unavailable");
        await space.deliverSpaceTaskAction(delivery);
        // A worker can retry after message persistence but before outbox completion.
        await space.deliverSpaceTaskAction(delivery);
        const signalId = `space-task-handoff:${delivery.receipt.event.eventId}`;
        const rows = state.storage.sql
          .exec<{ payload_json: string }>(
            "SELECT payload_json FROM space_signals WHERE id = ?",
            signalId
          )
          .toArray();
        expect(rows).toHaveLength(1);
        const row = rows[0];
        if (!row) {
          throw new Error("Review handoff was not persisted");
        }
        const signal = JSON.parse(row.payload_json) as SignalEnvelope;
        expect(signal).toMatchObject({
          profile: { kind: "system", profileId: "openmeld-system" },
          type: "signal.text",
          data: {
            text: expect.stringContaining(
              "Task ready for review: Fix loading state"
            ),
            replyTo: { signalId: source.id },
            messageEnvelope: {
              activationTargets: [],
              mentionTargets:
                profileKind === "human" ? [reviewer.profileId] : [],
              referenceTargets:
                profileKind === "agent" ? [reviewer.profileId] : [],
              replyToSignalId: source.id,
            },
          },
        });
        if (signal.type === "signal.text" && profileKind === "agent") {
          expect(signal.data.text).toContain(
            "Wake Reviewer to start the review."
          );
          expect(signal.data.text).not.toContain("(wake)");
        }
        const placement = readSpaceThreadSignalPlacementBySignalId(
          state.storage.sql,
          signalId
        );
        if (threadId) {
          expect(placement).toMatchObject({ threadId, placement: "thread" });
        } else {
          expect(placement).toBeNull();
        }
        expect(deliveries.wakeRefs(created.task.taskId)).toEqual([]);
        expect(
          state.storage.sql
            .exec("SELECT dispatch_id FROM openMeldDaemon_outbox")
            .toArray()
        ).toEqual([]);
      } finally {
        try {
          for (const [promise] of background.mock.calls) {
            await promise;
          }
        } finally {
          background.mockRestore();
          await state.storage.deleteAlarm();
          alarm.mockRestore();
        }
      }
    });
  });
});
