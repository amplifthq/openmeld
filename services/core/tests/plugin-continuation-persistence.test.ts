import { env, runInDurableObject } from "cloudflare:test";
import { pluginConnectionContinuationBindingSchema } from "@openmeld/schemas";
import type { SignalEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it, vi } from "vitest";
import {
  pluginContinuationMessageFingerprint,
  pluginContinuationTextDigest,
} from "../src/space/application/plugin-connection-continuation-guard";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { PluginConnectionContinuationRepository } from "../src/space/infrastructure/sql/plugin-connection-continuation-repo";
import { upsertSpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import type { Space } from "../src/space/transport/do/space";

const human = "55555555-5555-4555-8555-555555555555";
const agent = "agt_33333333-3333-4333-8333-333333333333";

describe("Plugin continuation at the real Space persistence transaction", () => {
  it.each([
    false,
    true,
  ])("inserts the binding with the message or rejects a concurrent original edit (edited=%s)", async (edited) => {
    const namespace = (
      env as unknown as { OPENMELD_SPACES: DurableObjectNamespace<Space> }
    ).OPENMELD_SPACES;
    const stub = namespace.get(namespace.newUniqueId());
    const spaceId = stub.id.toString();
    await runInDurableObject(stub, async (instance, state) => {
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
      insertDispatchOutboxRecord(state.storage.sql, dispatch);
      const reply: typeof source = {
        ...source,
        id: "reply",
        profile: { kind: "agent", profileId: agent, profileName: "Helper" },
        data: { text: "Connect", meta: { dispatchId: dispatch.dispatchId } },
      };
      insertSignalRecord(state.storage.sql, source);
      insertSignalRecord(state.storage.sql, reply);
      // Local completion uses the RuntimeCoordinator trace. Neither a final
      // message nor D1 dispatch provenance alone is treated as completed work.
      const trace = {
        dispatch: { dispatchId: dispatch.dispatchId },
        result: { publishedSignalId: reply.id, statusType: null },
        runtimeCoordinatorExecution: {
          runtimeCoordinatorExecutionId: "execution-local",
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
        executionId: "execution-local",
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
          outbox: boolean
        ): { persistedSignal: boolean };
      };
      if (edited) {
        expect(() =>
          owner.persistSignalWithOptionalOutbox(next, false)
        ).toThrow("original request");
        expect(
          state.storage.sql
            .exec("SELECT id FROM space_signals WHERE id = 'continued'")
            .toArray()
        ).toHaveLength(0);
        expect(repo.read("plugin-continue:one")?.signalId).toBeNull();
      } else {
        expect(
          owner.persistSignalWithOptionalOutbox(next, false).persistedSignal
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
    });
  });
});
