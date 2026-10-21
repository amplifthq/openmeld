import { runInDurableObject } from "cloudflare:test";
import type { QueryResult } from "@openmeld/db/postgresql";
import { getPostgresDatabase } from "@openmeld/db/postgresql";
import type { SpaceAccessContext } from "@openmeld/space";
import {
  getSpaceAccessPassword,
  getSpaceAccessRequestContext,
} from "@openmeld/space";
import { describe, expect, it, vi } from "vitest";
import type { CoreBindings } from "../src/lib/bindings";
import {
  buildSpacePasswordProof,
  verifySpacePasswordProof,
} from "../src/lib/space-password-proof";
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
  readSpaceMetaRecordFromSql,
  type SpaceMetaRecord,
  upsertSpaceMetaRecord,
} from "../src/space/infrastructure/sql/space-meta-repo";
import { env } from "../test-support/worker-env";

const sourceProfileId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const targetProfileId = "agt_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
describe("device waiting Wake Space authority", () => {
  it.each([
    "members_only",
    "protected",
  ] as const)("rechecks live access and preserves member authorization across password rotation (%s)", async (accessMode) => {
    await ensureOrganizationMember();
    const namespace = (env as CoreBindings).OPENMELD_SPACES;
    const id = namespace.newUniqueId();
    const spaceId = id.toString();
    await runInDurableObject(namespace.get(id), async (instance, state) => {
      const now = new Date().toISOString();
      const originalPassword = "original-space-password";
      const meta: SpaceMetaRecord = {
        v: 1,
        spaceId,
        organizationId: "org-device-wait",
        visibility: "private",
        accessMode,
        ...(accessMode === "protected"
          ? { passwordProof: await buildSpacePasswordProof(originalPassword) }
          : {}),
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
        ...(accessMode === "protected"
          ? { spacePassword: originalPassword }
          : {}),
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
      const request = {
        spaceId,
        dispatchId: record.dispatchId,
        sourceSignalId: record.sourceEventId,
        targetProfileId,
      };
      // Exercise the real DO authorization chain before installing the failure
      // injection below. A stale password does not revoke active membership.
      expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual({
        allowed: true,
      });
      if (accessMode === "protected") {
        const rotatedProof = await buildSpacePasswordProof(
          "rotated-space-password"
        );
        await expect(
          verifySpacePasswordProof(originalPassword, rotatedProof)
        ).resolves.toBe(false);
        meta.passwordProof = rotatedProof;
        upsertSpaceMetaRecord(state.storage.sql, meta);
        expect(
          readSpaceMetaRecordFromSql(state.storage.sql, spaceId)?.passwordProof
        ).toEqual(rotatedProof);
        expect(
          readDispatchOutboxRecordByDispatchId(
            state.storage.sql,
            record.dispatchId
          )?.spacePassword
        ).toBe(originalPassword);
        expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual(
          { allowed: true }
        );
      }
      // Removing either member still denies the wait, including when another
      // active Profile on the same account could pass the general access gate.
      upsertSpaceMemberRecord(state.storage.sql, {
        ...source,
        status: "removed",
      });
      expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual({
        allowed: false,
      });
      upsertSpaceMemberRecord(state.storage.sql, source);
      upsertSpaceMemberRecord(state.storage.sql, {
        ...target,
        status: "removed",
      });
      expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual({
        allowed: false,
      });
      upsertSpaceMemberRecord(state.storage.sql, target);
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
      try {
        expect(await instance.rpcCheckDeviceWaitingWakeAccess(request)).toEqual(
          { allowed: true }
        );
        const firstCall = authorize.mock.calls[0];
        if (!firstCall) {
          throw new Error("Expected the owning access check.");
        }
        expect(getSpaceAccessPassword(firstCall[0])).toBeUndefined();
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
async function ensureOrganizationMember(): Promise<void> {
  const nowMs = Date.now();
  const db = getPostgresDatabase(env as CoreBindings);
  if (!db) {
    throw new Error("Expected OPENMELD_DB in the Core test environment.");
  }
  await db.transaction(async (client) =>
    (async () => {
      const results: QueryResult[] = [];
      for (const query of [
        {
          ...{
            text: `
        INSERT INTO "openmeld"."users" (
          id,
          name,
          email,
          email_verified,
          created_at,
          updated_at
        )
        VALUES ($1, 'Device Wait Requester', $2, 1, $3, $4) ON CONFLICT DO NOTHING`,
            values: [],
          },
          values: [
            "requester-owner",
            "device-wait-requester@openmeld.test",
            nowMs,
            nowMs,
          ],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."organizations" (id, name, slug, created_at)
        VALUES ('org-device-wait', 'Device Wait Test', 'device-wait-test', $1) ON CONFLICT DO NOTHING`,
            values: [],
          },
          values: [nowMs],
        },
        {
          ...{
            text: `
        INSERT INTO "openmeld"."members" (
          id,
          organization_id,
          user_id,
          role,
          created_at
        )
        VALUES (
          'member-device-wait-requester',
          'org-device-wait',
          'requester-owner',
          'member',
          $1
        ) ON CONFLICT DO NOTHING`,
            values: [],
          },
          values: [nowMs],
        },
      ]) {
        results.push(await client.query(query));
      }
      return results;
    })()
  );
}
