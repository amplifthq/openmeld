import {
  buildCenterAgentMemberMemoryRef,
  buildCenterAgentOrganizationMemoryRef,
  CENTER_AGENT_ORGANIZATION_MEMORY_DEFAULT_ENABLED,
  type CenterAgentMemoryPolicy,
  type CenterAgentMemoryRepository,
} from "./contract";

type MemoryPolicyRow = {
  organization_memory_opt_in: number | boolean | null;
  updated_by_user_id: string | null;
};

export function createD1CenterAgentMemoryRepository(
  db: D1Database
): CenterAgentMemoryRepository {
  return {
    async markMemberDeleted(input) {
      const result = await db
        .prepare(
          `
            UPDATE center_agent_memory_subjects
            SET
              status = 'deleted',
              deleted_at_ms = ?,
              updated_at_ms = ?,
              last_error = NULL
            WHERE organization_id = ?
              AND subject_kind = 'member'
              AND member_user_id = ?
          `
        )
        .bind(
          input.deletedAtMs,
          input.deletedAtMs,
          input.organizationId,
          input.userId
        )
        .run();
      return Number(result.meta.changes ?? 0) > 0;
    },

    async markMemberDeleteFailed(input) {
      await db
        .prepare(
          `
            INSERT INTO center_agent_memory_subjects (
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
            VALUES (?, ?, 'member', ?, 'zep_cloud', ?, 'delete_failed', ?, ?, ?)
            ON CONFLICT(subject_id) DO UPDATE SET
              status = 'delete_failed',
              updated_at_ms = excluded.updated_at_ms,
              last_error = excluded.last_error
          `
        )
        .bind(
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
          input.error
        )
        .run();
    },

    async markOrganizationDeleted(input) {
      const result = await db
        .prepare(
          `
            UPDATE center_agent_memory_subjects
            SET
              status = 'deleted',
              deleted_at_ms = ?,
              updated_at_ms = ?,
              last_error = NULL
            WHERE organization_id = ?
              AND subject_kind = 'organization'
          `
        )
        .bind(input.deletedAtMs, input.deletedAtMs, input.organizationId)
        .run();
      return Number(result.meta.changes ?? 0) > 0;
    },

    async markOrganizationDeleteFailed(input) {
      const ref = buildCenterAgentOrganizationMemoryRef({
        organizationId: input.organizationId,
      });
      await db
        .prepare(
          `
            INSERT INTO center_agent_memory_subjects (
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
            VALUES (?, ?, 'organization', 'zep_cloud', ?, 'delete_failed', ?, ?, ?)
            ON CONFLICT(subject_id) DO UPDATE SET
              status = 'delete_failed',
              updated_at_ms = excluded.updated_at_ms,
              last_error = excluded.last_error
          `
        )
        .bind(
          ref.subjectId,
          input.organizationId,
          ref.zepGraphId,
          input.nowMs,
          input.nowMs,
          input.error
        )
        .run();
    },

    async readPolicy(organizationId) {
      const row = await db
        .prepare(
          `
            SELECT
              organization_memory_opt_in,
              updated_by_user_id
            FROM center_agent_memory_policies
            WHERE organization_id = ?
            LIMIT 1
          `
        )
        .bind(organizationId)
        .first<MemoryPolicyRow>();
      return {
        organizationMemoryOptIn: row
          ? Boolean(row.organization_memory_opt_in)
          : CENTER_AGENT_ORGANIZATION_MEMORY_DEFAULT_ENABLED,
        updatedByUserId: row?.updated_by_user_id ?? null,
      } satisfies CenterAgentMemoryPolicy;
    },

    async upsertPolicy(input) {
      await db
        .prepare(
          `
            INSERT INTO center_agent_memory_policies (
              organization_id,
              organization_memory_opt_in,
              updated_by_user_id,
              created_at_ms,
              updated_at_ms
            )
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(organization_id) DO UPDATE SET
              organization_memory_opt_in = excluded.organization_memory_opt_in,
              updated_by_user_id = excluded.updated_by_user_id,
              updated_at_ms = excluded.updated_at_ms
          `
        )
        .bind(
          input.organizationId,
          input.organizationMemoryOptIn ? 1 : 0,
          input.updatedByUserId,
          input.nowMs,
          input.nowMs
        )
        .run();
      return await this.readPolicy(input.organizationId);
    },

    async upsertMemberSubject(input) {
      const ref = buildCenterAgentMemberMemoryRef(input);
      await db
        .prepare(
          `
            INSERT INTO center_agent_memory_subjects (
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
            VALUES (?, ?, 'member', ?, ?, 'zep_cloud', ?, 'active', ?, ?, NULL, NULL)
            ON CONFLICT(subject_id) DO UPDATE SET
              member_id = excluded.member_id,
              member_user_id = excluded.member_user_id,
              status = 'active',
              updated_at_ms = excluded.updated_at_ms,
              deleted_at_ms = NULL,
              last_error = NULL
          `
        )
        .bind(
          ref.subjectId,
          input.organizationId,
          input.memberId,
          input.userId,
          ref.zepUserId,
          input.nowMs,
          input.nowMs
        )
        .run();
      return ref;
    },

    async upsertOrganizationSubject(input) {
      const ref = buildCenterAgentOrganizationMemoryRef(input);
      await db
        .prepare(
          `
            INSERT INTO center_agent_memory_subjects (
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
            VALUES (?, ?, 'organization', 'zep_cloud', ?, 'active', ?, ?, NULL, NULL)
            ON CONFLICT(subject_id) DO UPDATE SET
              status = 'active',
              updated_at_ms = excluded.updated_at_ms,
              deleted_at_ms = NULL,
              last_error = NULL
          `
        )
        .bind(
          ref.subjectId,
          input.organizationId,
          ref.zepGraphId,
          input.nowMs,
          input.nowMs
        )
        .run();
      return ref;
    },
  };
}
