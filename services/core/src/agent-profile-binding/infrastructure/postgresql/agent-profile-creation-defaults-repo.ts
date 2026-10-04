import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  agentControllerCollaborationModeSchema,
  agentControllerPermissionModeSchema,
  openCodePermissionConfigSchema,
} from "@openmeld/schemas";
import type {
  AgentControllerCollaborationMode,
  AgentControllerPermissionMode,
  AgentProfileBindingOpenCodePermission,
} from "@openmeld/schemas/types";
export type AgentProfileCreationDefaultsRecord = {
  agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
  agentControllerPermissionMode: AgentControllerPermissionMode | null;
  agentControllerRef: string;
  createdAtMs: number;
  defaultProjectId: string | null;
  id: string;
  modelId: string | null;
  openCodePermission: AgentProfileBindingOpenCodePermission | null;
  organizationId: string;
  reasoningLevel: string | null;
  updatedAtMs: number;
  userId: string;
};
type AgentProfileCreationDefaultsRow = {
  agent_controller_collaboration_mode: string | null;
  agent_controller_permission_mode: string | null;
  agent_controller_ref: string;
  created_at_ms: number;
  default_project_id: string | null;
  id: string;
  model_id: string | null;
  open_code_permission_json: string | null;
  organization_id: string;
  reasoning_level: string | null;
  updated_at_ms: number;
  user_id: string;
};
export async function readAgentProfileCreationDefaultsRecord(input: {
  agentControllerRef: string;
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
}): Promise<AgentProfileCreationDefaultsRecord | null> {
  const row = await input.db
    .query<AgentProfileCreationDefaultsRow>({
      text: `
        SELECT
          id,
          organization_id,
          user_id,
          agent_controller_ref,
          agent_controller_collaboration_mode,
          default_project_id,
          model_id,
          reasoning_level,
          agent_controller_permission_mode,
          open_code_permission_json,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."agent_profile_creation_defaults"
        WHERE organization_id = $1
          AND user_id = $2
          AND agent_controller_ref = $3
        LIMIT 1
      `,
      values: [input.organizationId, input.userId, input.agentControllerRef],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapAgentProfileCreationDefaultsRow(row) : null;
}
export async function listAgentProfileCreationDefaultsRecords(input: {
  db: PostgresDatabase;
  organizationId: string;
  userId: string;
}): Promise<AgentProfileCreationDefaultsRecord[]> {
  const result = await input.db.query<AgentProfileCreationDefaultsRow>({
    text: `
        SELECT
          id,
          organization_id,
          user_id,
          agent_controller_ref,
          agent_controller_collaboration_mode,
          default_project_id,
          model_id,
          reasoning_level,
          agent_controller_permission_mode,
          open_code_permission_json,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."agent_profile_creation_defaults"
        WHERE organization_id = $1
          AND user_id = $2
        ORDER BY updated_at_ms DESC NULLS LAST, agent_controller_ref ASC NULLS FIRST
      `,
    values: [input.organizationId, input.userId],
  });
  return (result.rows ?? []).map(mapAgentProfileCreationDefaultsRow);
}
export async function upsertAgentProfileCreationDefaultsRecord(input: {
  agentControllerCollaborationMode: AgentControllerCollaborationMode | null;
  agentControllerPermissionMode: AgentControllerPermissionMode | null;
  agentControllerRef: string;
  db: PostgresDatabase;
  defaultProjectId: string | null;
  modelId: string | null;
  nowMs: number;
  openCodePermission: AgentProfileBindingOpenCodePermission | null;
  organizationId: string;
  reasoningLevel: string | null;
  userId: string;
}): Promise<AgentProfileCreationDefaultsRecord> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."agent_profile_creation_defaults" (
          id,
          organization_id,
          user_id,
          agent_controller_ref,
          agent_controller_collaboration_mode,
          default_project_id,
          model_id,
          reasoning_level,
          agent_controller_permission_mode,
          open_code_permission_json,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT(organization_id, user_id, agent_controller_ref) DO UPDATE SET
          agent_controller_collaboration_mode = excluded.agent_controller_collaboration_mode,
          default_project_id = excluded.default_project_id,
          model_id = excluded.model_id,
          reasoning_level = excluded.reasoning_level,
          agent_controller_permission_mode = excluded.agent_controller_permission_mode,
          open_code_permission_json = excluded.open_code_permission_json,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      crypto.randomUUID(),
      input.organizationId,
      input.userId,
      input.agentControllerRef,
      input.agentControllerCollaborationMode,
      input.defaultProjectId,
      input.modelId,
      input.reasoningLevel,
      input.agentControllerPermissionMode,
      input.openCodePermission
        ? JSON.stringify(input.openCodePermission)
        : null,
      input.nowMs,
      input.nowMs,
    ],
  });
  const record = await readAgentProfileCreationDefaultsRecord(input);
  if (!record) {
    throw new Error(
      "Agent Profile creation defaults write did not produce a row"
    );
  }
  return record;
}
function mapAgentProfileCreationDefaultsRow(
  row: AgentProfileCreationDefaultsRow
): AgentProfileCreationDefaultsRecord {
  return {
    agentControllerCollaborationMode:
      row.agent_controller_collaboration_mode === null
        ? null
        : agentControllerCollaborationModeSchema.parse(
            row.agent_controller_collaboration_mode
          ),
    agentControllerPermissionMode:
      row.agent_controller_permission_mode === null
        ? null
        : agentControllerPermissionModeSchema.parse(
            row.agent_controller_permission_mode
          ),
    agentControllerRef: row.agent_controller_ref,
    createdAtMs: row.created_at_ms,
    defaultProjectId: row.default_project_id,
    id: row.id,
    modelId: row.model_id,
    openCodePermission: row.open_code_permission_json
      ? openCodePermissionConfigSchema.parse(
          JSON.parse(row.open_code_permission_json)
        )
      : null,
    organizationId: row.organization_id,
    reasoningLevel: row.reasoning_level,
    updatedAtMs: row.updated_at_ms,
    userId: row.user_id,
  };
}
