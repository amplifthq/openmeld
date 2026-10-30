import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  buildCenterAgentSpaceMemoryRef,
  CENTER_AGENT_ORGANIZATION_MEMORY_DEFAULT_ENABLED,
  type CenterAgentMemoryPolicy,
  type CenterAgentMemoryReadRepository,
  type CenterAgentMemoryRepository,
} from "./contract";

type MemoryPolicyRow = {
  organization_memory_opt_in: number | boolean | null;
  updated_by_user_id: string | null;
};
export function createPostgresCenterAgentMemoryRepository(
  db: PostgresDatabase
): CenterAgentMemoryRepository & CenterAgentMemoryReadRepository {
  return {
    async readActiveSubjects(input) {
      const policy = await this.readPolicy(input.organizationId);
      const member = input.speakerMember
        ? buildCenterAgentMemberMemoryRef({
            organizationId: input.organizationId,
            memberId: input.speakerMember.memberId,
            userId: input.speakerMember.userId,
          })
        : null;
      const organization = buildCenterAgentOrganizationMemoryRef(input);
      const space = input.spaceId
        ? buildCenterAgentSpaceMemoryRef({
            organizationId: input.organizationId,
            spaceId: input.spaceId,
          })
        : null;
      const rows = await db.query<{
        subject_id: string;
        zep_user_id: string | null;
        zep_graph_id: string | null;
        updated_at_ms: number;
      }>({
        text: `
        SELECT subject_id, zep_user_id, zep_graph_id, updated_at_ms
        FROM "openmeld"."center_agent_memory_subjects"
        WHERE organization_id = $1 AND provider = 'zep_cloud' AND status = 'active'
          AND deleted_at_ms IS NULL
          AND ((subject_kind = 'member' AND member_id = $2 AND member_user_id = $3)
            OR (subject_kind = 'organization' AND $4 = 1)
            OR (subject_kind = 'space' AND $4 = 1 AND subject_id = $5 AND space_id = $6))
        LIMIT 3
      `,
        values: [
          input.organizationId,
          input.speakerMember?.memberId ?? null,
          input.speakerMember?.userId ?? null,
          policy.organizationMemoryOptIn ? 1 : 0,
          space?.subjectId ?? null,
          input.spaceId ?? null,
        ],
      });
      // Use existing active subjects only. A read never creates/revives a graph
      // or trusts a provider selector that differs from its canonical owner.
      return [
        ...(space ? [space] : []),
        ...(member ? [member] : []),
        organization,
      ].flatMap((ref) => {
        const row = rows.rows.find(
          (row) =>
            row.subject_id === ref.subjectId &&
            row.zep_user_id === (ref.zepUserId ?? null) &&
            row.zep_graph_id === (ref.zepGraphId ?? null)
        );
        return row ? [{ ...ref, updatedAtMs: row.updated_at_ms }] : [];
      });
    },
    async upsertSpaceSubject(input) {
      const ref = buildCenterAgentSpaceMemoryRef(input);
      const result = await db.query({
        text: `INSERT INTO "openmeld"."center_agent_memory_subjects"
          (subject_id, organization_id, subject_kind, space_id, provider, zep_graph_id, status, created_at_ms, updated_at_ms)
          VALUES ($1, $2, 'space', $3, 'zep_cloud', $4, 'active', $5, $5)
          ON CONFLICT(subject_id) DO UPDATE SET subject_id = excluded.subject_id
          WHERE "center_agent_memory_subjects".status = 'active'
          RETURNING subject_id`,
        values: [
          ref.subjectId,
          input.organizationId,
          input.spaceId,
          ref.zepGraphId,
          input.nowMs,
        ],
      });
      if (!result.rows.length) {
        throw new Error("center_agent_memory.space_deleted");
      }
      return ref;
    },
    async markSpaceDeleted(input) {
      const result = await db.query({
        text: `UPDATE "openmeld"."center_agent_memory_subjects" SET status = 'deleted', deleted_at_ms = $1, updated_at_ms = $1, last_error = NULL WHERE organization_id = $2 AND subject_kind = 'space' AND space_id = $3`,
        values: [input.deletedAtMs, input.organizationId, input.spaceId],
      });
      return Number(result.rowCount ?? 0) > 0;
    },
    async beginSpaceDeletion(input) {
      const ref = buildCenterAgentSpaceMemoryRef(input);
      await db.query({
        text: `INSERT INTO "openmeld"."center_agent_memory_subjects"
          (subject_id, organization_id, subject_kind, space_id, provider, zep_graph_id, status, created_at_ms, updated_at_ms)
          VALUES ($1, $2, 'space', $3, 'zep_cloud', $4, 'deleting', $5, $5)
          ON CONFLICT(subject_id) DO UPDATE SET status = 'deleting', updated_at_ms = excluded.updated_at_ms`,
        values: [
          ref.subjectId,
          input.organizationId,
          input.spaceId,
          ref.zepGraphId,
          input.nowMs,
        ],
      });
    },
    async isSpaceSubjectActive(input) {
      const result = await db.query({
        text: `SELECT 1 FROM "openmeld"."center_agent_memory_subjects" WHERE subject_id = $1 AND organization_id = $2 AND subject_kind = 'space' AND space_id = $3 AND status = 'active' AND deleted_at_ms IS NULL`,
        values: [
          buildCenterAgentSpaceMemoryRef(input).subjectId,
          input.organizationId,
          input.spaceId,
        ],
      });
      return result.rows.length > 0;
    },
    async markSpaceDeleteFailed(input) {
      const ref = buildCenterAgentSpaceMemoryRef(input);
      await db.query({
        text: `INSERT INTO "openmeld"."center_agent_memory_subjects"
          (subject_id, organization_id, subject_kind, space_id, provider, zep_graph_id, status, created_at_ms, updated_at_ms, last_error)
          VALUES ($1, $2, 'space', $3, 'zep_cloud', $4, 'delete_failed', $5, $5, $6)
          ON CONFLICT(subject_id) DO UPDATE SET status = 'delete_failed', updated_at_ms = excluded.updated_at_ms, last_error = excluded.last_error`,
        values: [
          ref.subjectId,
          input.organizationId,
          input.spaceId,
          ref.zepGraphId,
          input.nowMs,
          input.error,
        ],
      });
    },
    async markMemberDeleted(input) {
      const result = await db.query({
        text: `
            UPDATE "openmeld"."center_agent_memory_subjects"
            SET
              status = 'deleted',
              deleted_at_ms = $1,
              updated_at_ms = $2,
              last_error = NULL
            WHERE organization_id = $3
              AND subject_kind = 'member'
              AND member_user_id = $4
          `,
        values: [
          input.deletedAtMs,
          input.deletedAtMs,
          input.organizationId,
          input.userId,
        ],
      });
      return Number(result.rowCount ?? 0) > 0;
    },
    async markMemberDeleteFailed(input) {
      await db.query({
        text: `
            INSERT INTO "openmeld"."center_agent_memory_subjects" (
              subject_id,
              organization_id,
              subject_kind,
              member_user_id,
              provider,
              zep_user_id,
              status,
              created_at_ms,
              updated_at_ms,
              last_error
            )
            VALUES ($1, $2, 'member', $3, 'zep_cloud', $4, 'delete_failed', $5, $6, $7)
            ON CONFLICT(subject_id) DO UPDATE SET
              status = 'delete_failed',
              updated_at_ms = excluded.updated_at_ms,
              last_error = excluded.last_error
          `,
        values: [
          buildCenterAgentMemberMemoryRef({
            memberId: "unknown_member",
            organizationId: input.organizationId,
            userId: input.userId,
          }).subjectId,
          input.organizationId,
          input.userId,
          buildCenterAgentMemberMemoryRef({
            memberId: "unknown_member",
            organizationId: input.organizationId,
            userId: input.userId,
          }).zepUserId,
          input.nowMs,
          input.nowMs,
          input.error,
        ],
      });
    },
    async markOrganizationDeleted(input) {
      const result = await db.query({
        text: `
            UPDATE "openmeld"."center_agent_memory_subjects"
            SET
              status = 'deleted',
              deleted_at_ms = $1,
              updated_at_ms = $2,
              last_error = NULL
            WHERE organization_id = $3
              AND subject_kind = 'organization'
          `,
        values: [input.deletedAtMs, input.deletedAtMs, input.organizationId],
      });
      return Number(result.rowCount ?? 0) > 0;
    },
    async markOrganizationDeleteFailed(input) {
      const ref = buildCenterAgentOrganizationMemoryRef({
        organizationId: input.organizationId,
      });
      await db.query({
        text: `
            INSERT INTO "openmeld"."center_agent_memory_subjects" (
              subject_id,
              organization_id,
              subject_kind,
              provider,
              zep_graph_id,
              status,
              created_at_ms,
              updated_at_ms,
              last_error
            )
            VALUES ($1, $2, 'organization', 'zep_cloud', $3, 'delete_failed', $4, $5, $6)
            ON CONFLICT(subject_id) DO UPDATE SET
              status = 'delete_failed',
              updated_at_ms = excluded.updated_at_ms,
              last_error = excluded.last_error
          `,
        values: [
          ref.subjectId,
          input.organizationId,
          ref.zepGraphId,
          input.nowMs,
          input.nowMs,
          input.error,
        ],
      });
    },
    async readPolicy(organizationId) {
      const row = await db
        .query<MemoryPolicyRow>({
          text: `
            SELECT
              organization_memory_opt_in,
              updated_by_user_id
            FROM "openmeld"."center_agent_memory_policies"
            WHERE organization_id = $1
            LIMIT 1
          `,
          values: [organizationId],
        })
        .then((result) => result.rows[0] ?? null);
      return {
        organizationMemoryOptIn: row
          ? Boolean(row.organization_memory_opt_in)
          : CENTER_AGENT_ORGANIZATION_MEMORY_DEFAULT_ENABLED,
        updatedByUserId: row?.updated_by_user_id ?? null,
      } satisfies CenterAgentMemoryPolicy;
    },
    async upsertPolicy(input) {
      await db.query({
        text: `
            INSERT INTO "openmeld"."center_agent_memory_policies" (
              organization_id,
              organization_memory_opt_in,
              updated_by_user_id,
              created_at_ms,
              updated_at_ms
            )
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT(organization_id) DO UPDATE SET
              organization_memory_opt_in = excluded.organization_memory_opt_in,
              updated_by_user_id = excluded.updated_by_user_id,
              updated_at_ms = excluded.updated_at_ms
          `,
        values: [
          input.organizationId,
          input.organizationMemoryOptIn ? 1 : 0,
          input.updatedByUserId,
          input.nowMs,
          input.nowMs,
        ],
      });
      return await this.readPolicy(input.organizationId);
    },
    async upsertMemberSubject(input) {
      const ref = buildCenterAgentMemberMemoryRef(input);
      await db.query({
        text: `
            INSERT INTO "openmeld"."center_agent_memory_subjects" (
              subject_id,
              organization_id,
              subject_kind,
              member_id,
              member_user_id,
              provider,
              zep_user_id,
              status,
              created_at_ms,
              updated_at_ms,
              deleted_at_ms,
              last_error
            )
            VALUES ($1, $2, 'member', $3, $4, 'zep_cloud', $5, 'active', $6, $7, NULL, NULL)
            ON CONFLICT(subject_id) DO UPDATE SET
              member_id = excluded.member_id,
              member_user_id = excluded.member_user_id,
              status = 'active',
              updated_at_ms = excluded.updated_at_ms,
              deleted_at_ms = NULL,
              last_error = NULL
          `,
        values: [
          ref.subjectId,
          input.organizationId,
          input.memberId,
          input.userId,
          ref.zepUserId,
          input.nowMs,
          input.nowMs,
        ],
      });
      return ref;
    },
    async upsertOrganizationSubject(input) {
      const ref = buildCenterAgentOrganizationMemoryRef(input);
      await db.query({
        text: `
            INSERT INTO "openmeld"."center_agent_memory_subjects" (
              subject_id,
              organization_id,
              subject_kind,
              provider,
              zep_graph_id,
              status,
              created_at_ms,
              updated_at_ms,
              deleted_at_ms,
              last_error
            )
            VALUES ($1, $2, 'organization', 'zep_cloud', $3, 'active', $4, $5, NULL, NULL)
            ON CONFLICT(subject_id) DO UPDATE SET
              status = 'active',
              updated_at_ms = excluded.updated_at_ms,
              deleted_at_ms = NULL,
              last_error = NULL
          `,
        values: [
          ref.subjectId,
          input.organizationId,
          ref.zepGraphId,
          input.nowMs,
          input.nowMs,
        ],
      });
      return ref;
    },
  };
}
