import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  authorizeProtectedSpaceAccess,
  authorizeSpaceJoinAccess,
} from "../src/space/application/space-access-policy";
import { reconcileOrganizationAgentOwnership } from "../src/space/infrastructure/sql/organization-agent-ownership";
import type { SpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { createSqliteD1Harness } from "./helpers/sqlite-d1-harness.test-support";

describe("Organization Agent ownership in existing Spaces", () => {
  it("removes inherited read and join access while preserving actual Agent membership", async () => {
    const identity = createSqliteD1Harness();
    const storage = new DatabaseSync(":memory:");
    try {
      identity.run({
        sql: "CREATE TABLE openmeld_profiles (profile_id TEXT, organization_id TEXT, managed_role TEXT)",
      });
      identity.run({
        sql: "INSERT INTO openmeld_profiles VALUES ('center', 'org', 'center_agent'), ('personal-agent', 'org', NULL)",
      });
      storage.exec(
        "CREATE TABLE space_members (profile_id TEXT, owner_user_id_snapshot TEXT, owner_name_snapshot TEXT); CREATE TABLE space_meta (creator_json TEXT)"
      );
      storage.exec(
        "INSERT INTO space_members VALUES ('center', 'creator', 'Creator'), ('personal-agent', 'another-member', 'Another member')"
      );
      storage.prepare("INSERT INTO space_meta VALUES (?)").run(
        JSON.stringify({
          profileId: "center",
          kind: "agent",
          ownerUserId: "creator",
        })
      );
      const sql = {
        exec(query: string, ...params: (string | number | null)[]) {
          const statement = storage.prepare(query);
          const result = statement.run(...params);
          return { rowsWritten: Number(result.changes) };
        },
      } as unknown as SqlStorage;
      const readAccess = (profileId: string, ownerUserId?: string) => {
        const row = storage
          .prepare("SELECT creator_json FROM space_meta")
          .get();
        return {
          context: {
            actorContext: {
              openMeldProfileId: profileId,
              ownerUserId,
              profileKind:
                profileId === "center"
                  ? ("agent" as const)
                  : ("human" as const),
              requestId: "test",
            },
          },
          meta: {
            v: 1,
            spaceId: "private",
            organizationId: "org",
            visibility: "private",
            accessMode: "members_only",
            creator: JSON.parse(String(row?.creator_json)),
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
          } as SpaceMetaRecord,
          readMemberByProfileId: (id: string) => {
            const member = storage
              .prepare("SELECT * FROM space_members WHERE profile_id = ?")
              .get(id);
            return member
              ? ({
                  profileId: id,
                  status: "active",
                  ownerUserIdSnapshot: member.owner_user_id_snapshot,
                } as SpaceMemberRecord)
              : null;
          },
          hasActiveMemberForOwnerUserId: (id: string) =>
            !!storage
              .prepare(
                "SELECT 1 FROM space_members WHERE owner_user_id_snapshot = ?"
              )
              .get(id),
          verifySpacePasswordProof: async () => false,
        };
      };
      expect(
        await authorizeProtectedSpaceAccess(
          readAccess("creator-human", "creator")
        )
      ).toMatchObject({ ok: true });
      expect(
        await reconcileOrganizationAgentOwnership({
          db: identity.db,
          organizationId: "org",
          sql,
        })
      ).toBe(true);
      expect(
        await authorizeProtectedSpaceAccess(
          readAccess("creator-human", "creator")
        )
      ).toEqual({ ok: false, code: "space.membership_required" });
      expect(
        await authorizeSpaceJoinAccess(readAccess("creator-human", "creator"))
      ).toEqual({ ok: false, code: "space.membership_required" });
      expect(
        await authorizeProtectedSpaceAccess(readAccess("center"))
      ).toMatchObject({ ok: true });
      expect(
        await authorizeProtectedSpaceAccess(
          readAccess("another-human", "another-member")
        )
      ).toMatchObject({ ok: true });
      expect(
        storage
          .prepare(
            "SELECT owner_user_id_snapshot FROM space_members WHERE profile_id = 'center'"
          )
          .get()
      ).toEqual({ owner_user_id_snapshot: null });
    } finally {
      storage.close();
      identity.close();
    }
  });
});
