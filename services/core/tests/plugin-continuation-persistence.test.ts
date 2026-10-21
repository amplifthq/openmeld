import { runInDurableObject } from "cloudflare:test";
import { pluginConnectionContinuationBindingSchema } from "@openmeld/schemas";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import { createSubmitTurnRequest } from "../../remote-agent/tests/fixtures";
import { pluginContinuationTextDigest } from "../src/connectors/plugin-connection-source-fingerprint";
import { buildRuntimeTransportDeliverDispatchRequest } from "../src/dispatch/infrastructure/runtime-transport/runtime-coordinator-client";
import type { RemoteAgentNativeDeliveryRecord } from "../src/remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { buildRuntimeCoordinatorRunCommandStateStorageKey } from "../src/runtime-transport/application/runtime-coordinator-authority";
import type { RuntimeTransportHub } from "../src/runtime-transport/transport/do/runtime-transport-hub";
import { pluginContinuationMessageFingerprint } from "../src/space/application/plugin-connection-continuation-guard";
import type { SignalPublishContext } from "../src/space/application/types";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { PluginConnectionContinuationRepository } from "../src/space/infrastructure/sql/plugin-connection-continuation-repo";
import { upsertSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import type { Space } from "../src/space/transport/do/space";
import {
  createRetainedRuntimeCommandState,
  createRuntimeTransportDeliveryInput,
} from "../test-support/runtime-transport-delivery.test-support";
import { env } from "../test-support/worker-env";

const human = "55555555-5555-4555-8555-555555555555";
const agent = "agt_33333333-3333-4333-8333-333333333333";

describe("Plugin continuation at the real Space persistence transaction", () => {
  it.each([
    ["workstation", false],
    ["workstation", true],
    ["native", false],
    ["native", true],
  ] as const)("inserts the %s binding or rejects a concurrent original edit (edited=%s)", async (runtime, edited) => {
    const namespace = (
      env as unknown as { OPENMELD_SPACES: DurableObjectNamespace<Space> }
    ).OPENMELD_SPACES;
    const stub = namespace.get(namespace.newUniqueId());
    const runtimeNamespace = (
      env as unknown as {
        OPENMELD_RUNTIME_TRANSPORT: DurableObjectNamespace<RuntimeTransportHub>;
      }
    ).OPENMELD_RUNTIME_TRANSPORT;
    const runtimeShard = runtimeNamespace.get(
      runtimeNamespace.idFromName("user-continuation")
    );
    const spaceId = stub.id.toString();
    const source: Extract<SignalEnvelope, { type: "signal.text" }> = {
      v: 1,
      id: "source",
      spaceId,
      ts: Date.now(),
      type: "signal.text",
      profile: { kind: "human", profileId: human, profileName: "Maya" },
      data: {
        text: "Review",
        messageEnvelope: {
          text: "Review",
          activationTargets: [agent],
          referenceTargets: [],
        },
      },
    };
    const dispatch = createDispatchOutboxRecord({
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      ruleSource: "space",
      ruleId: "space.default.all_members.v1",
      ruleReason: "explicit Wake",
      spaceId,
      organizationId: "org-continuation",
      sourceEventId: source.id,
      sourceClientMessageId: "original",
      targetProfileId: agent,
      senderProfileId: human,
      sourceSignalSnapshot: {
        text: "Review",
        profileId: human,
        profileKind: "human",
      },
      sourceMessageEnvelope: source.data.messageEnvelope,
      nowMs: Date.now(),
    });
    const reply: typeof source = {
      ...source,
      id: "reply",
      profile: { kind: "agent", profileId: agent, profileName: "Helper" },
      data: { text: "Connect", meta: { dispatchId: dispatch.dispatchId } },
    };
    const deliveryInput = createRuntimeTransportDeliveryInput();
    const delivery = buildRuntimeTransportDeliverDispatchRequest({
      ...deliveryInput,
      ownerUserId: "user-continuation",
      executionIdentity: {
        ...deliveryInput.executionIdentity,
        core: {
          ...deliveryInput.executionIdentity.core,
          spaceId,
          dispatchId: dispatch.dispatchId,
          targetProfileId: agent,
          bindingId: "binding-local",
        },
      },
      message: {
        ...deliveryInput.message,
        spaceId,
        dispatchId: dispatch.dispatchId,
        targetProfileId: agent,
        sourceEventId: source.id,
        enqueuedAtMs: dispatch.createdAtMs,
        sourceSignalSnapshot: {
          text: "Review",
          profileId: human,
          profileKind: "human",
        },
        sourceMessageEnvelope: source.data.messageEnvelope,
      },
      sourceSignal: {
        profileId: human,
        profileKind: "human",
        text: "Review",
      },
    });
    const retained = createRetainedRuntimeCommandState(delivery);
    await runInDurableObject(runtimeShard, async (_instance, ownerState) => {
      await ownerState.storage.put(
        buildRuntimeCoordinatorRunCommandStateStorageKey(
          retained.runtimeCoordinatorExecutionId
        ),
        retained
      );
    });
    const localSource = (
      await runtimeShard.rpcReadPluginConnectionExecutionSource({
        ownerUserId: "user-continuation",
        executionId: retained.runtimeCoordinatorExecutionId,
        spaceId,
        dispatchId: dispatch.dispatchId,
        targetProfileId: agent,
      })
    ).source;
    expect(localSource).not.toBeNull();
    await runInDurableObject(stub, async (instance, state) => {
      // This transaction test owns its direct calls. Automatic recovery of the
      // pending dispatch is covered separately and must not race its teardown.
      const setAlarm = state.storage.setAlarm.bind(state.storage);
      const alarm = vi
        .spyOn(state.storage, "setAlarm")
        .mockImplementation((at) =>
          setAlarm(Math.max(Number(at), Date.now() + 3_600_000))
        );
      await state.storage.deleteAlarm();
      const background = vi.spyOn(state, "waitUntil");
      try {
        const now = new Date().toISOString();
        upsertSpaceMetaRecord(state.storage.sql, {
          v: 1,
          spaceId,
          organizationId: "org-continuation",
          visibility: "private",
          accessMode: "members_only",
          createdAt: now,
          updatedAt: now,
        });
        for (const [profileId, kind] of [
          [human, "human"],
          [agent, "agent"],
        ] as const) {
          upsertSpaceMemberRecord(state.storage.sql, {
            spaceId,
            profileId,
            profileKindSnapshot: kind,
            profileNameSnapshot: kind,
            ownerUserIdSnapshot: "user-continuation",
            ownerNameSnapshot: null,
            controllerRefSnapshot: kind === "agent" ? "builtin:codex" : null,
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
        insertDispatchOutboxRecord(state.storage.sql, dispatch);
        insertSignalRecord(state.storage.sql, source);
        insertSignalRecord(state.storage.sql, reply);
        // Both execution families retire the conveyor after admission. Neither
        // preview nor insertion may depend on a queued dispatch remaining here.
        state.storage.sql.exec(
          "DELETE FROM openMeldDaemon_outbox WHERE dispatch_id = ?",
          dispatch.dispatchId
        );
        // Local completion uses the RuntimeCoordinator trace. Neither a final
        // message nor D1 dispatch provenance alone is treated as completed work.
        const trace = {
          dispatch: {
            dispatchId: dispatch.dispatchId,
            owner: { kind: "owner_account", id: "user-continuation" },
          },
          result: { publishedSignalId: reply.id, statusType: null },
          runtimeCoordinatorExecution: {
            runtimeCoordinatorExecutionId:
              retained.runtimeCoordinatorExecutionId,
            bindingId: "binding-local",
            spaceId,
            dispatchId: dispatch.dispatchId,
            targetProfileId: agent,
            status: "reply_published",
            terminalOutcome: {
              kind: "reply_published",
              observedAtMs: Date.now(),
            },
            createdAtMs: Date.now() - 100,
          },
        };
        const traceRead = vi
          .spyOn(instance, "rpcGetDispatchTrace")
          .mockResolvedValue({ trace } as never);
        const localInput = {
          spaceId,
          sourceSignalId: reply.id,
          context: {
            activeOrganizationId: "org-continuation",
            actorContext: {
              requestId: "local-plugin-source",
              profileKind: "human" as const,
              openMeldProfileId: human,
              ownerUserId: "user-continuation",
            },
          },
        };
        expect(
          await instance.rpcReadPluginConnectionLocalSource(localInput)
        ).toMatchObject({
          bindingId: "binding-local",
          executionId: retained.runtimeCoordinatorExecutionId,
          sourceSignalId: source.id,
        });
        trace.runtimeCoordinatorExecution.status = "running";
        await expect(
          instance.rpcReadPluginConnectionLocalSource(localInput)
        ).rejects.toThrow("source_changed");
        trace.runtimeCoordinatorExecution.status = "reply_published";
        await expect(
          instance.rpcReadPluginConnectionLocalSource({
            ...localInput,
            context: {
              ...localInput.context,
              actorContext: {
                ...localInput.context.actorContext,
                openMeldProfileId: "66666666-6666-4666-8666-666666666666",
              },
            },
          })
        ).rejects.toThrow("source_changed");
        traceRead.mockRestore();
        const binding = pluginConnectionContinuationBindingSchema.parse({
          v: 1,
          organizationId: "org-continuation",
          spaceId,
          sourceDispatchId: dispatch.dispatchId,
          source: {
            signalId: source.id,
            revision: 0,
            fingerprint: pluginContinuationMessageFingerprint(source),
          },
          reply: {
            signalId: reply.id,
            revision: 0,
            fingerprint: pluginContinuationMessageFingerprint(reply),
          },
          requesterUserId: "user-continuation",
          requesterProfileId: human,
          targetProfileId: agent,
          service: "linear",
          scope: "shared",
          connectionName: "linear-team",
          connectionUpdatedAtMs: 42,
          continuationTextDigest: pluginContinuationTextDigest("Continue"),
          threadContext: null,
        });
        const repo = new PluginConnectionContinuationRepository(
          state.storage.sql
        );
        repo.reserve("plugin-continue:one", binding);
        let signalContext: SignalPublishContext = {
          pluginContinuationLocalSource: localSource ?? undefined,
        };
        if (runtime === "native") {
          const request = createSubmitTurnRequest({
            organizationId: binding.organizationId,
            spaceId,
            dispatchId: dispatch.dispatchId,
            triggerMessageId: source.id,
            agentProfileId: agent,
            author: {
              profileId: human,
              profileKind: "human",
              displayName: "Maya",
            },
          });
          request.turnEnvelope.sender = {
            kind: "member",
            id: "member",
            displayName: "Maya",
            ownerUserId: binding.requesterUserId,
            profileId: human,
            role: "owner",
            verified: true,
          };
          signalContext = {
            pluginContinuationNativeSource: {
              organizationId: binding.organizationId,
              spaceId,
              dispatchId: dispatch.dispatchId,
              profileId: agent,
              triggerMessageId: source.id,
              bindingId: request.bindingId,
              conversationKind: "space",
              routineRunId: null,
              status: "completed",
              failureCode: null,
              createdAtMs: Date.now(),
              completedAtMs: Date.now(),
              publishedSignalId: reply.id,
              threadContext: null,
              workerSubmitRequest: null,
              executionRecoverySubmitRequest: request,
            } as RemoteAgentNativeDeliveryRecord,
          };
        }
        if (edited) {
          state.storage.sql.exec(
            "UPDATE space_signals SET payload_json = ? WHERE id = ?",
            JSON.stringify({
              ...source,
              data: {
                ...source.data,
                text: "Changed after preview",
                meta: { editedAt: Date.now(), messageRevision: 1 },
              },
            }),
            source.id
          );
        }
        const next: typeof source = {
          ...source,
          id: "continued",
          data: {
            text: "Continue",
            messageEnvelope: {
              text: "Continue",
              activationTargets: [agent],
              referenceTargets: [],
              replyToSignalId: source.id,
            },
            meta: { clientMessageId: "plugin-continue:one" },
          },
        };
        // This test exercises the owning SQL persistence entry, not a mock of its
        // precondition. It is internal transaction integration, not browser smoke.
        const owner = instance as unknown as {
          persistSignalWithOptionalOutbox(
            signal: SignalEnvelope,
            outbox: boolean,
            context?: SignalPublishContext
          ): { persistedSignal: boolean };
        };
        if (edited) {
          expect(() =>
            owner.persistSignalWithOptionalOutbox(next, false, signalContext)
          ).toThrow("original request");
          expect(
            state.storage.sql
              .exec("SELECT id FROM space_signals WHERE id = 'continued'")
              .toArray()
          ).toHaveLength(0);
          expect(repo.read("plugin-continue:one")?.signalId).toBeNull();
        } else {
          expect(
            owner.persistSignalWithOptionalOutbox(next, false, signalContext)
              .persistedSignal
          ).toBe(true);
          expect(repo.read("plugin-continue:one")?.signalId).toBe(next.id);
          expect(
            await instance.rpcReadPluginConnectionContinuationBinding({
              organizationId: "org-continuation",
              spaceId,
              signalId: next.id,
              targetProfileId: agent,
              requesterUserId: "user-continuation",
            })
          ).toMatchObject({
            binding: {
              connectionName: "linear-team",
              scope: "shared",
              connectionUpdatedAtMs: 42,
            },
          });
          state.storage.sql.exec(
            "UPDATE space_signals SET payload_json = ? WHERE id = ?",
            JSON.stringify({
              ...next,
              data: {
                ...next.data,
                text: "Changed continuation",
                meta: {
                  ...next.data.meta,
                  editedAt: Date.now(),
                  messageRevision: 1,
                },
              },
            }),
            next.id
          );
          await expect(
            async () =>
              await instance.rpcReadPluginConnectionContinuationBinding({
                organizationId: "org-continuation",
                spaceId,
                signalId: next.id,
                targetProfileId: agent,
                requesterUserId: "user-continuation",
              })
          ).rejects.toThrow("original request");
        }
      } finally {
        try {
          // The real persistence owner also writes its index in waitUntil.
          // Drain that work before the native runtime and database close.
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
