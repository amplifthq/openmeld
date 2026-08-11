import type { AgentActivityProvider } from "@openmeld/schemas/types";

type ExecutionLinkCandidate = {
  activity_session_id: string;
  agent_controller_ref: string;
  binding_id: string;
  device_id: string;
  organization_id: string;
  provider_conversation_id: string;
  runtime_coordinator_execution_id: string;
  openmeld_service_runtime_id: string;
};

type StoredExecutionLink = ExecutionLinkCandidate & {
  created_at_ms: number;
  id: string;
};

export async function linkAcceptedAgentActivityExecutions(input: {
  activitySession?: {
    deviceId: string;
    memberUserId: string;
    organizationId: string;
    provider: AgentActivityProvider;
    providerSessionId: string;
  };
  db: D1Database;
  nowMs: number;
  runtimeCoordinatorExecutionId?: string;
}) {
  const candidates = await readLinkCandidates(input);
  let created = 0;
  for (const candidate of candidates) {
    const id = `activity_execution_link:${candidate.runtime_coordinator_execution_id}`;
    const insert = await input.db
      .prepare(
        `
          INSERT INTO agent_activity_execution_links (
            id, organization_id, activity_session_id,
            runtime_coordinator_execution_id, device_id,
            openmeld_service_runtime_id, binding_id, agent_controller_ref,
            provider_conversation_id, created_at_ms
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT DO NOTHING
        `
      )
      .bind(
        id,
        candidate.organization_id,
        candidate.activity_session_id,
        candidate.runtime_coordinator_execution_id,
        candidate.device_id,
        candidate.openmeld_service_runtime_id,
        candidate.binding_id,
        candidate.agent_controller_ref,
        candidate.provider_conversation_id,
        input.nowMs
      )
      .run();
    created += Math.max(0, Math.trunc(Number(insert.meta.changes ?? 0)));
    const stored = await input.db
      .prepare(
        `
          SELECT id, organization_id, activity_session_id,
            runtime_coordinator_execution_id, device_id,
            openmeld_service_runtime_id, binding_id, agent_controller_ref,
            provider_conversation_id, created_at_ms
          FROM agent_activity_execution_links
          WHERE runtime_coordinator_execution_id = ?
          LIMIT 1
        `
      )
      .bind(candidate.runtime_coordinator_execution_id)
      .first<StoredExecutionLink>();
    if (!(stored && isCanonicalStoredLink(stored, candidate, id))) {
      throw new Error(
        "Agent Activity execution link conflicts with canonical RuntimeCoordinator authority."
      );
    }
  }
  return created;
}

async function readLinkCandidates(
  input: Parameters<typeof linkAcceptedAgentActivityExecutions>[0]
) {
  const result = await input.db
    .prepare(
      `
        SELECT
          sessions.organization_id,
          sessions.id AS activity_session_id,
          executions.runtime_coordinator_execution_id,
          sessions.device_id,
          executions.openmeld_service_runtime_id,
          executions.binding_id,
          executions.agent_controller_ref,
          sessions.provider_session_id AS provider_conversation_id
        FROM openMeldDaemon_runtime_coordinator_executions executions
        INNER JOIN openMeldDaemon_dispatch_result_inbox inbox
          ON inbox.runtime_coordinator_execution_id =
            executions.runtime_coordinator_execution_id
        INNER JOIN openMeldDaemon_runtime_registry_records runtimes
          ON runtimes.openmeld_service_runtime_id =
            executions.openmeld_service_runtime_id
        INNER JOIN openMeldDaemon_agent_profile_bindings bindings
          ON bindings.binding_id = executions.binding_id
          AND bindings.owner_kind = 'owner_account'
          AND bindings.owner_id = runtimes.owner_id
          AND bindings.agent_profile_id = executions.target_profile_id
          AND bindings.runtime_kind = 'openmeld_service'
          AND bindings.openmeld_service_runtime_id =
            executions.openmeld_service_runtime_id
          AND bindings.agent_controller_ref = executions.agent_controller_ref
          AND bindings.binding_state = 'enabled_primary'
        INNER JOIN space_index_spaces spaces
          ON spaces.space_id = executions.space_id
        INNER JOIN agent_activity_sessions sessions
          ON sessions.organization_id = spaces.organization_id
          AND sessions.member_user_id = runtimes.owner_id
          AND sessions.device_id = runtimes.device_id
          AND sessions.openmeld_service_runtime_id =
            executions.openmeld_service_runtime_id
          AND sessions.provider_session_id = coalesce(
            json_extract(
              inbox.result_payload_json,
              '$.payload.agentControllerConversation.agentControllerConversationId'
            ),
            json_extract(
              inbox.result_payload_json,
              '$.payload.agentControllerConversationId'
            )
          )
          AND bindings.agent_controller_conversation_id =
            sessions.provider_session_id
        WHERE executions.status IN ('result_accepted', 'reply_published')
          AND inbox.publish_state <> 'legacy_result_quarantined'
          AND (
            (executions.agent_controller_ref = 'builtin:codex'
              AND sessions.provider = 'codex'
              AND EXISTS (
                SELECT 1
                FROM openMeldDaemon_provider_conversation_proofs proofs
                WHERE proofs.status = 'passed'
                  AND proofs.provider = 'codex'
                  AND proofs.binding_id = executions.binding_id
                  AND proofs.openmeld_service_runtime_id =
                    executions.openmeld_service_runtime_id
                  AND proofs.agent_controller_ref =
                    executions.agent_controller_ref
                  AND proofs.agent_controller_conversation_id =
                    sessions.provider_session_id
                  AND proofs.observed_at_ms <= inbox.accepted_at_ms
                  AND proofs.expires_at_ms > inbox.accepted_at_ms
              ))
            OR (executions.agent_controller_ref = 'builtin:claude-code'
              AND sessions.provider = 'claude-code')
            OR (executions.agent_controller_ref = 'builtin:opencode'
              AND sessions.provider = 'opencode')
            OR (executions.agent_controller_ref = 'builtin:cursor'
              AND sessions.provider = 'cursor')
          )
          AND json_extract(
            inbox.result_payload_json,
            '$.payload.agentControllerConversation.agentControllerRef'
          ) = executions.agent_controller_ref
          AND (? IS NULL OR executions.runtime_coordinator_execution_id = ?)
          AND (? IS NULL OR sessions.organization_id = ?)
          AND (? IS NULL OR sessions.member_user_id = ?)
          AND (? IS NULL OR sessions.device_id = ?)
          AND (? IS NULL OR sessions.provider = ?)
          AND (? IS NULL OR sessions.provider_session_id = ?)
        ORDER BY inbox.accepted_at_ms DESC
        LIMIT 100
      `
    )
    .bind(
      input.runtimeCoordinatorExecutionId ?? null,
      input.runtimeCoordinatorExecutionId ?? null,
      input.activitySession?.organizationId ?? null,
      input.activitySession?.organizationId ?? null,
      input.activitySession?.memberUserId ?? null,
      input.activitySession?.memberUserId ?? null,
      input.activitySession?.deviceId ?? null,
      input.activitySession?.deviceId ?? null,
      input.activitySession?.provider ?? null,
      input.activitySession?.provider ?? null,
      input.activitySession?.providerSessionId ?? null,
      input.activitySession?.providerSessionId ?? null
    )
    .all<ExecutionLinkCandidate>();
  return result.results ?? [];
}

function isCanonicalStoredLink(
  stored: StoredExecutionLink,
  candidate: ExecutionLinkCandidate,
  id: string
) {
  return (
    stored.id === id &&
    stored.organization_id === candidate.organization_id &&
    stored.activity_session_id === candidate.activity_session_id &&
    stored.runtime_coordinator_execution_id ===
      candidate.runtime_coordinator_execution_id &&
    stored.device_id === candidate.device_id &&
    stored.openmeld_service_runtime_id ===
      candidate.openmeld_service_runtime_id &&
    stored.binding_id === candidate.binding_id &&
    stored.agent_controller_ref === candidate.agent_controller_ref &&
    stored.provider_conversation_id === candidate.provider_conversation_id
  );
}
