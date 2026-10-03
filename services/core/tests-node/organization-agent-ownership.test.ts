import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import {
  authorizeProtectedSpaceAccess,
  authorizeSpaceJoinAccess,
} from "../src/space/application/space-access-policy";
import { reconcileOrganizationAgentOwnership } from "../src/space/infrastructure/sql/organization-agent-ownership";
import type { SpaceMemberRecord } from "../src/space/infrastructure/sql/space-member-repo";
import type { SpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { createPostgresHarness } from "./helpers/postgresql-harness.test-support";

describe("Organization Agent ownership in existing Spaces", () => {
  it("removes inherited read and join access while preserving actual Agent membership", async () => {
    const identity = await createPostgresHarness();
    const storage = new DatabaseSync(":memory:");
    try {
      await identity.query({
        text: `
        INSERT INTO "openmeld"."users" (id,name,email) VALUES ('creator','Creator','creator@example.com'),('another-member','Member','member@example.com');
        INSERT INTO "openmeld"."organizations" (id,name,slug,created_at) VALUES ('org','Organization','org',1700000000000);
        INSERT INTO "openmeld"."openmeld_profiles" (profile_id,profile_name,profile_handle,profile_kind,organization_id,managed_role,owner_user_id,created_by_user_id,source)
        VALUES ('agt_00000000-0000-4000-8000-000000000001','Center','center','agent','org','center_agent',NULL,'creator','auth_bootstrap'),
        ('agt_00000000-0000-4000-8000-000000000002','Personal Agent','personal-agent','agent','org',NULL,'another-member','another-member','migration')
      `,
      });
      storage.exec(
        "CREATE TABLE space_members (profile_id TEXT, owner_user_id_snapshot TEXT, owner_name_snapshot TEXT); CREATE TABLE space_meta (creator_json TEXT)"
      );
      storage.exec(
        "INSERT INTO space_members VALUES ('agt_00000000-0000-4000-8000-000000000001', 'creator', 'Creator'), ('agt_00000000-0000-4000-8000-000000000002', 'another-member', 'Another member')"
      );
      storage.prepare("INSERT INTO space_meta VALUES (?)").run(
        JSON.stringify({
          profileId: "agt_00000000-0000-4000-8000-000000000001",
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
                profileId === "agt_00000000-0000-4000-8000-000000000001"
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
        await authorizeProtectedSpaceAccess(
          readAccess("agt_00000000-0000-4000-8000-000000000001")
        )
      ).toMatchObject({ ok: true });
      expect(
        await authorizeProtectedSpaceAccess(
          readAccess("another-human", "another-member")
        )
      ).toMatchObject({ ok: true });
      expect(
        storage
          .prepare(
            "SELECT owner_user_id_snapshot FROM space_members WHERE profile_id = 'agt_00000000-0000-4000-8000-000000000001'"
          )
          .get()
      ).toEqual({ owner_user_id_snapshot: null });
    } finally {
      await storage.close();
      await identity.close();
    }
  });
});
