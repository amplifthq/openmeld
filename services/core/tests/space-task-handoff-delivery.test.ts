import { runInDurableObject } from "cloudflare:test";
import type { SignalEnvelope } from "@openmeld/protocol";
import type { SpaceTaskActor } from "@openmeld/schemas/types";
import { createAuthenticatedSpaceAccessContext } from "@openmeld/space";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import { buildDefaultSpaceContract } from "../src/space/application/space-contract-service";
import type { SpaceTaskService } from "../src/space/application/space-task-service";
import { upsertSpaceContractRecord } from "../src/space/infrastructure/sql/space-contract-repo";
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
import { createProjectionPostgresBinding } from "../test-support/postgresql-query.test-support";
import { env } from "../test-support/worker-env";

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
    ["human", false, false],
    ["human", true, false],
    ["agent", false, false],
    ["agent", true, false],
    ["agent", true, true],
    ["agent", true, "create-and-delegate"],
    ["agent", true, "self-trigger"],
    ["agent", true, "retry-after-issue-update"],
  ] as const)("accounts for a Task handoff for %s (Thread=%s, assignment=%s)", async (profileKind, inThread, assignment) => {
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
        const listener: SpaceTaskActor = {
          ...reviewer,
          profileId: "agt_33333333-3333-4333-8333-333333333333",
          profileKind: "agent",
          profileName: "Unassigned listener",
        };
        upsertSpaceContractRecord(state.storage.sql, {
          spaceId,
          contract: {
            ...buildDefaultSpaceContract(),
            dispatchPolicy: { mode: "listen_all" },
          },
        });
        for (const actor of [requester, reviewer, listener]) {
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
        const reply = { ...source, id: "thread-reply" };
        if (threadId) {
          insertSignalRecord(state.storage.sql, reply);
          insertSpaceThreadSignalPlacement(state.storage.sql, {
            signalId: reply.id,
            threadId,
            placement: "thread",
            createdAt: now,
          });
        }
        // A main message with replies stays in main; only replies belong to the Thread.
        const context = {
          activeOrganizationId: "org-task-handoff",
          actorContext: {
            callerPrincipalId: requester.ownerUserId ?? undefined,
            openMeldProfileId: requester.profileId,
            ownerUserId: requester.ownerUserId ?? undefined,
            profileKind: "human" as const,
            requestId: "location-read",
          },
        };
        const admission = vi
          .spyOn(
            instance as unknown as {
              authorizeSpaceAccess: () => Promise<{ ok: true }>;
            },
            "authorizeSpaceAccess"
          )
          .mockResolvedValue({ ok: true });
        try {
          expect(
            await instance.rpcReadPluginActionRequestLocations({
              context,
              expectedOrganizationId: "org-task-handoff",
              spaceId,
              sourceSignalIds: [source.id, reply.id, "missing-message"],
              spaceAccess: createAuthenticatedSpaceAccessContext({
                requestContext: context,
                spaceId,
              }),
            })
          ).toEqual([
            { sourceSignalId: source.id, threadId: null },
            ...(threadId ? [{ sourceSignalId: reply.id, threadId }] : []),
          ]);
        } finally {
          admission.mockRestore();
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
        let created = service.create(
          {
            operationId: "create-task",
            title: "Fix loading state",
            sourceSignalId: source.id,
            threadId,
            reviewerProfileId: assignment
              ? requester.profileId
              : reviewer.profileId,
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
        if (assignment) {
          const bindings = Reflect.get(instance, "bindings") as CoreBindings;
          const resolveProfileById = vi.fn(
            ({ openMeldProfileId }: { openMeldProfileId: string }) => {
              const actor =
                openMeldProfileId === reviewer.profileId ? reviewer : requester;
              return Promise.resolve({
                ok: true,
                profile: {
                  profileId: actor.profileId,
                  profileKind: actor.profileKind,
                  profileName: actor.profileName,
                  profileHandle: "task-participant",
                  ownerUserId: actor.ownerUserId,
                  status: "active",
                },
              });
            }
          );
          if (assignment === "retry-after-issue-update") {
            resolveProfileById.mockRejectedValueOnce(
              new Error("Auth temporarily unavailable")
            );
          }
          Reflect.set(instance, "bindings", {
            ...bindings,
            OPENMELD_POSTGRESQL: createProjectionPostgresBinding((query) =>
              query.text.includes('FROM "openmeld"."members"')
                ? [{ id: "requester-membership", role: "member" }]
                : []
            ),
            OPENMELD_AUTH_WORKER: {
              resolveProfileById,
            },
          });
          try {
            const input = {
              spaceId,
              taskId: created.task.taskId,
              context,
              body: {
                action: "assign" as const,
                operationId: "initial-handoff",
                expectedRevision: 1,
                assigneeProfileId: reviewer.profileId,
                reviewerProfileId: requester.profileId,
                wakeAssignee: true,
              },
            };
            const taskRequestContext =
              assignment === "self-trigger"
                ? {
                    ...context,
                    actorContext: {
                      ...context.actorContext,
                      callerPrincipalId: reviewer.ownerUserId ?? undefined,
                      openMeldProfileId: reviewer.profileId,
                      ownerUserId: reviewer.ownerUserId ?? undefined,
                      profileKind: "agent" as const,
                    },
                  }
                : context;
            const createInput = {
              spaceId,
              context: taskRequestContext,
              ...(assignment === "self-trigger"
                ? { representedRequester: requester }
                : {}),
              body: {
                operationId: "create-with-initial-handoff",
                title: "Fix loading state",
                sourceSignalId: source.id,
                threadId,
                assigneeProfileId: reviewer.profileId,
                reviewerProfileId: requester.profileId,
                wakeAssignee: true,
                externalWorkItems: [issue],
              },
            };
            const creating =
              assignment === "create-and-delegate" ||
              assignment === "self-trigger";
            const assigned = creating
              ? await instance.rpcCreateTask(createInput)
              : await instance.rpcMutateTask(input);
            if (creating) {
              created = assigned;
            }
            expect(assigned.task.phase).toBe("to_do");
            if (assignment === "self-trigger") {
              const detail = await instance.rpcGetTask({
                spaceId,
                context: taskRequestContext,
                taskId: assigned.task.taskId,
                includeAffordances: true,
              });
              expect(detail.pendingActions).toContainEqual({
                kind: "handoff",
                state: "failed",
                error: expect.stringContaining("cannot Wake itself"),
              });
              const signalId = `space-task-handoff:${assigned.event.eventId}`;
              expect(
                state.storage.sql
                  .exec("SELECT id FROM space_signals WHERE id = ?", signalId)
                  .toArray()
              ).toEqual([]);
              expect(
                state.storage.sql
                  .exec(
                    "SELECT payload_json FROM openMeldDaemon_outbox WHERE source_event_id = ?",
                    signalId
                  )
                  .toArray()
              ).toEqual([]);
              expect(
                new SpaceTaskDeliveryRepository(state.storage.sql).wakeRefs(
                  assigned.task.taskId
                )
              ).toEqual([]);
              return;
            }
            if (assignment === "retry-after-issue-update") {
              const deliveries = new SpaceTaskDeliveryRepository(
                state.storage.sql
              );
              const pending = deliveries.read(
                `${assigned.event.eventId}:handoff`
              );
              if (!pending) {
                throw new Error(
                  "Expected the failed assignment handoff to remain pending"
                );
              }
              expect(deliveries.status(created.task.taskId)).toContainEqual(
                expect.objectContaining({ kind: "handoff", state: "failed" })
              );
              service.mutate(
                created.task.taskId,
                {
                  action: "attach_external_work_item",
                  expectedRevision: assigned.task.revision,
                  operationId: "attach-issue-after-delegating",
                  item: {
                    ...issue,
                    number: 1144,
                    url: "https://github.com/amplifthq/openmeld/issues/1144",
                  },
                },
                {
                  actor: requester,
                  isSpaceOwner: false,
                  resolveMember: (id) =>
                    [requester, reviewer, listener].find(
                      (member) => member.profileId === id
                    ) ?? null,
                }
              );
              await space.deliverSpaceTaskAction(pending);
            }
            const replay =
              assignment === "create-and-delegate"
                ? await instance.rpcCreateTask(createInput)
                : await instance.rpcMutateTask(input);
            expect(replay.applied).toBe(false);
            const signalId = `space-task-handoff:${assigned.event.eventId}`;
            const row = state.storage.sql
              .exec<{ payload_json: string }>(
                "SELECT payload_json FROM space_signals WHERE id = ?",
                signalId
              )
              .toArray()[0];
            expect(row).toBeDefined();
            const signal = JSON.parse(row?.payload_json ?? "{}");
            expect(signal.data.messageEnvelope.activationTargets).toEqual([
              reviewer.profileId,
            ]);
            expect(signal.data.text).not.toContain("start_task");
            expect(
              readSpaceThreadSignalPlacementBySignalId(
                state.storage.sql,
                signalId
              )
            ).toMatchObject({ threadId, placement: "thread" });
            const rows = state.storage.sql
              .exec<{ payload_json: string }>(
                "SELECT payload_json FROM openMeldDaemon_outbox WHERE source_event_id = ?",
                signalId
              )
              .toArray();
            expect(rows).toHaveLength(1);
            const dispatch = JSON.parse(rows[0]?.payload_json ?? "{}");
            expect(dispatch.sourceSignalSnapshot.text).toContain(
              created.task.taskId
            );
            expect(dispatch.sourceSignalSnapshot.text).toContain("start_task");
            expect(dispatch.sourceSignalSnapshot.text).toContain(
              requester.profileId
            );
            expect(
              new SpaceTaskDeliveryRepository(state.storage.sql).wakeRefs(
                created.task.taskId
              )
            ).toEqual([
              { sourceSignalId: signalId, targetProfileId: reviewer.profileId },
            ]);
            return;
          } finally {
            Reflect.set(instance, "bindings", bindings);
          }
        }
        service.applyGitHubIssueObservation({
          taskId: created.task.taskId,
          identity: issue,
          observeOperationId: "observe-completed",
          observedAt: now,
          observedState: "closed",
          observedStateReason: "completed",
        });
        const deliveries = new SpaceTaskDeliveryRepository(state.storage.sql);
        expect(service.read(created.task.taskId).task).toMatchObject({
          phase: "to_do",
          result: null,
        });
        expect(
          deliveries.pending(Date.now()).some((item) => item.kind === "handoff")
        ).toBe(false);
        const taskContext = {
          actor: requester,
          isSpaceOwner: true,
          resolveMember: (id: string) =>
            [requester, reviewer].find((member) => member.profileId === id) ??
            null,
        };
        const assigned = service.mutate(
          created.task.taskId,
          {
            action: "assign",
            operationId: "assign-result-author",
            expectedRevision: service.read(created.task.taskId).task.revision,
            assigneeProfileId: requester.profileId,
          },
          taskContext
        );
        const started = service.mutate(
          created.task.taskId,
          {
            action: "mark_in_progress",
            operationId: "start-explicit-work",
            expectedRevision: assigned.task.revision,
          },
          taskContext
        );
        service.mutate(
          created.task.taskId,
          {
            action: "submit_result",
            operationId: "submit-verified-result",
            expectedRevision: started.task.revision,
            summary: "Verified the requested loading-state behavior.",
          },
          taskContext
        );
        const delivery = deliveries
          .pending(Date.now())
          .find((item) => item.kind === "handoff");
        if (!delivery) {
          throw new Error(
            "The explicit Task result must deliver its review handoff"
          );
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
            delivery.receipt.task.result?.summary
          );
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
