import { env, runInDurableObject } from "cloudflare:test";
import type { SpaceAccessContext } from "@openmeld/space";
import { getSpaceAccessRequestContext } from "@openmeld/space";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import type { PasswordAuthorizationResult } from "../src/space/application/types";
import {
  createDispatchOutboxRecord,
  insertDispatchOutboxRecord,
  readDispatchOutboxRecordByDispatchId,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import {
  type SpaceMemberRecord,
  upsertSpaceMemberRecord,
} from "../src/space/infrastructure/sql/space-member-repo";
import {
  type SpaceMetaRecord,
  upsertSpaceMetaRecord,
} from "../src/space/infrastructure/sql/space-meta-repo";

const sourceProfileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const targetProfileId = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("device waiting Wake Space authority", () => {
  it("retains the exact outbox intent and rechecks current membership and write access", async () => {
    const namespace = (env as CoreBindings).OPENMELD_SPACES;
    const id = namespace.newUniqueId();
    const spaceId = id.toString();
    await runInDurableObject(namespace.get(id), async (instance, state) => {
      const now = new Date().toISOString();
      const meta: SpaceMetaRecord = {
        v: 1,
        spaceId,
        organizationId: "org-device-wait",
        visibility: "private",
        accessMode: "members_only",
        createdAt: now,
        updatedAt: now,
      };
      upsertSpaceMetaRecord(state.storage.sql, meta);
      const member = (
        profileId: string,
        kind: "human" | "agent"
      ): SpaceMemberRecord => ({
        spaceId,
        profileId,
        profileKindSnapshot: kind,
        profileNameSnapshot: kind,
        ownerUserIdSnapshot: "requester-owner",
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
      const source = member(sourceProfileId, "human");
      const target = member(targetProfileId, "agent");
      upsertSpaceMemberRecord(state.storage.sql, source);
      upsertSpaceMemberRecord(state.storage.sql, target);
      const deviceWait = {
        bindingId: "binding-device-wait",
        openMeldServiceRuntimeId: "runtime-device-wait",
        targetProfileId,
        deadlineAtMs: Date.now() + 60_000,
      };
      const record = createDispatchOutboxRecord({
        bindingEnabled: true,
        bindingState: "bound",
        deviceWait,
        dispatchPolicy: "mention_only",
        ruleSource: "space",
        ruleId: "space.default.all_members.v1",
        ruleReason: "explicit Wake",
        spaceId,
        organizationId: meta.organizationId,
        sourceEventId: "source-device-wait",
        sourceClientMessageId: "client-device-wait",
        targetProfileId,
        senderProfileId: sourceProfileId,
        sourceSignalSnapshot: {
          text: "Check the report",
          profileId: sourceProfileId,
          profileKind: "human",
        },
        nowMs: Date.now(),
      });
      expect(insertDispatchOutboxRecord(state.storage.sql, record)).toBe(true);
      expect(
        readDispatchOutboxRecordByDispatchId(
          state.storage.sql,
          record.dispatchId
        )?.deviceWait
      ).toEqual(deviceWait);
      let permission: PasswordAuthorizationResult = { ok: true, meta };
      const authorize = vi.fn(
        async (
          _access: SpaceAccessContext
        ): Promise<PasswordAuthorizationResult> => permission
      );
      Object.defineProperty(instance, "authorizeWritableSpaceAccess", {
        configurable: true,
        value: authorize,
      });
      const request = {
        spaceId,
        dispatchId: record.dispatchId,
        sourceSignalId: record.sourceEventId,
        targetProfileId,
      };
      try {
        expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual(
          { allowed: true }
        );
        const firstCall = authorize.mock.calls[0];
        if (!firstCall) {
          throw new Error("Expected the owning access check.");
        }
        expect(
          getSpaceAccessRequestContext(firstCall[0])?.actorContext
        ).toMatchObject({
          openMeldProfileId: sourceProfileId,
          ownerUserId: "requester-owner",
        });
        upsertSpaceMemberRecord(state.storage.sql, {
          ...source,
          ownerUserIdSnapshot: "refreshed-owner",
        });
        expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual(
          { allowed: true }
        );
        const refreshedCall = authorize.mock.calls.at(-1);
        if (!refreshedCall) {
          throw new Error("Expected refreshed actor authorization");
        }
        expect(
          getSpaceAccessRequestContext(refreshedCall[0])?.actorContext
        ).toMatchObject({
          openMeldProfileId: sourceProfileId,
          ownerUserId: "refreshed-owner",
        });
        permission = {
          ok: false,
          response: new Response(null, { status: 403 }),
        };
        expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual(
          { allowed: false }
        );
        upsertSpaceMemberRecord(state.storage.sql, source);
        permission = {
          ok: false,
          response: new Response(null, { status: 503 }),
        };
        await expect(
          instance.rpcCheckDeviceWaitingWakeAccess(request)
        ).rejects.toThrow("unavailable");
        permission = { ok: true, meta };
        upsertSpaceMemberRecord(state.storage.sql, {
          ...source,
          status: "removed",
        });
        expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual(
          { allowed: false }
        );
        upsertSpaceMemberRecord(state.storage.sql, source);
        upsertSpaceMemberRecord(state.storage.sql, {
          ...target,
          status: "removed",
        });
        expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual(
          { allowed: false }
        );
        upsertSpaceMemberRecord(state.storage.sql, target);
        expect(
          await instance.rpcCheckDeviceWaitingWakeAccess({
            ...request,
            sourceSignalId: "different-source",
          })
        ).toEqual({ allowed: false });
      } finally {
        Reflect.deleteProperty(instance, "authorizeWritableSpaceAccess");
      }
    });
  });
});
