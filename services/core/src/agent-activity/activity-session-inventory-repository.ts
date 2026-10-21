import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
import {
  agentActivityInventoryCoverageSchema,
  agentActivityInventorySessionSchema,
  agentActivitySessionInventoryResponseSchema,
  submitAgentActivitySessionReconciliationResponseSchema,
} from "@openmeld/schemas";
import type {
  AgentActivityInventoryCoverage,
  AgentActivityInventorySession,
  AgentActivitySessionInventoryQuery,
  AgentActivitySessionInventoryResponse,
  AgentProfileBindingSessionInventorySelection,
  LocalAgentSessionProvider,
  SubmitAgentActivitySessionReconciliationBody,
  SubmitAgentActivitySessionReconciliationResponse,
} from "@openmeld/schemas/types";
export const AGENT_ACTIVITY_SESSION_INVENTORY_STALE_AFTER_MS = 15 * 60_000;
const BASE64_PADDING_PATTERN = /=+$/u;
export type AgentActivitySessionResumeEligibility = {
  activeOrganizationId: string | null;
  agentControllerRef: string;
  agentProfileId: string;
  deviceId: string;
  nowMs: number;
  ownerUserId: string;
  selection: AgentProfileBindingSessionInventorySelection;
};
export type AgentActivitySessionInventorySelectionCapability =
  | "fork"
  | "resume";
type InventorySourceAuthority = {
  connectedComputerId: string;
  deviceId: string;
  organizationId: string;
  ownerUserId: string;
};
type SourceRow = {
  current_reconciliation_id: string | null;
  next_page_index: number;
  state: AgentActivityInventoryCoverage["state"];
};
type InventoryRow = {
  agent_controller_ref: string;
  binding_count: number;
  bound_agent_profile_id: string | null;
  can_fork: number;
  can_resume: number;
  computer_id: string;
  device_id: string;
  computer_last_seen_at_ms: number | null;
  computer_name: string;
  computer_state: AgentActivityInventorySession["computer"]["state"];
  inventory_updated_at_ms: number;
  last_active_at_ms: number;
  native_session_id: string;
  native_session_title: string | null;
  organization_id: string;
  organization_name: string;
  origin: AgentActivityInventorySession["origin"];
  owner_name: string;
  owner_user_id: string;
  project_id: string;
  project_name: string;
  project_slug: string;
  provider: LocalAgentSessionProvider;
  source_last_complete_at_ms: number | null;
  source_state: AgentActivityInventoryCoverage["state"];
  started_at_ms: number | null;
  status: AgentActivityInventorySession["status"];
};
type CoverageRow = {
  agent_controller_ref: string;
  computer_id: string;
  last_attempt_at_ms: number | null;
  last_complete_at_ms: number | null;
  problem_code: string | null;
  project_id: string;
  provider: LocalAgentSessionProvider;
  state: AgentActivityInventoryCoverage["state"];
};
type PageCursor = {
  agentControllerRef: string;
  lastActiveAtMs: number;
  nativeSessionId: string;
  ownerUserId: string;
  querySignature: string;
  version: 1;
};
export type DeletedAgentActivitySessionInventoryMemberProjection = {
  candidateCount: number;
  inventoryCount: number;
  sourceCount: number;
};
export type AgentActivitySessionInventoryMemberCleanupRequest = {
  attemptCount: number;
  organizationId: string;
  ownerUserId: string;
  requestedAtMs: number;
};
export async function requestAgentActivitySessionInventoryMemberCleanup(input: {
  db: PostgresDatabase;
  finalize: boolean;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
}): Promise<DeletedAgentActivitySessionInventoryMemberProjection> {
  const statements = [
    {
      text: `INSERT INTO "openmeld"."agent_activity_session_inventory_member_cleanup_requests" (
           organization_id,
           owner_user_id,
           requested_at_ms,
           last_attempt_at_ms,
           attempt_count,
           last_error
         ) SELECT id, $2, $3, $4, 0, NULL
           FROM "openmeld"."organizations" WHERE id = $1
           FOR KEY SHARE
         ON CONFLICT (organization_id, owner_user_id) DO UPDATE SET
           requested_at_ms = excluded.requested_at_ms,
           last_attempt_at_ms = excluded.last_attempt_at_ms,
           attempt_count = 0,
           last_error = NULL`,
      values: [
        input.organizationId,
        input.ownerUserId,
        input.nowMs,
        input.nowMs,
      ],
    },
    {
      text: `DELETE FROM "openmeld"."agent_activity_session_inventory_candidates"
         WHERE organization_id = $1 AND owner_user_id = $2`,
      values: [input.organizationId, input.ownerUserId],
    },
    {
      text: `DELETE FROM "openmeld"."agent_activity_session_inventory"
         WHERE organization_id = $1 AND owner_user_id = $2`,
      values: [input.organizationId, input.ownerUserId],
    },
    {
      text: `DELETE FROM "openmeld"."agent_activity_session_inventory_sources"
         WHERE organization_id = $1 AND owner_user_id = $2`,
      values: [input.organizationId, input.ownerUserId],
    },
  ];
  if (input.finalize) {
    statements.push({
      text: `DELETE FROM "openmeld"."agent_activity_session_inventory_member_cleanup_requests"
           WHERE organization_id = $1 AND owner_user_id = $2`,
      values: [input.organizationId, input.ownerUserId],
    });
  }
  const [, candidates, inventory, sources] = await input.db.transaction(
    async (client) => {
      const results: QueryResult[] = [];
      for (const query of statements) {
        results.push(await client.query(query));
      }
      return results;
    }
  );
  if (!(candidates && inventory && sources)) {
    throw new Error(
      "Session inventory cleanup did not return every mutation result"
    );
  }
  return {
    candidateCount: Number(candidates.rowCount ?? 0),
    inventoryCount: Number(inventory.rowCount ?? 0),
    sourceCount: Number(sources.rowCount ?? 0),
  };
}
export async function readAgentActivitySessionInventoryMemberCleanupRequests(input: {
  db: PostgresDatabase;
  limit: number;
}): Promise<AgentActivitySessionInventoryMemberCleanupRequest[]> {
  const result = await input.db.query<{
    attempt_count: number;
    organization_id: string;
    owner_user_id: string;
    requested_at_ms: number;
  }>({
    text: `SELECT
         organization_id,
         owner_user_id,
         requested_at_ms,
         attempt_count
       FROM "openmeld"."agent_activity_session_inventory_member_cleanup_requests"
       ORDER BY last_attempt_at_ms ASC NULLS FIRST, requested_at_ms ASC NULLS FIRST,
         organization_id ASC NULLS FIRST, owner_user_id ASC NULLS FIRST
       LIMIT $1`,
    values: [input.limit],
  });
  return (result.rows ?? []).map((row) => ({
    attemptCount: Number(row.attempt_count),
    organizationId: row.organization_id,
    ownerUserId: row.owner_user_id,
    requestedAtMs: Number(row.requested_at_ms),
  }));
}
export async function recordAgentActivitySessionInventoryMemberCleanupFailure(input: {
  db: PostgresDatabase;
  error: string;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  await input.db.query({
    text: `UPDATE "openmeld"."agent_activity_session_inventory_member_cleanup_requests"
       SET attempt_count = attempt_count + 1,
           last_attempt_at_ms = $1,
           last_error = $2
       WHERE organization_id = $3 AND owner_user_id = $4`,
    values: [
      input.nowMs,
      input.error.slice(0, 512),
      input.organizationId,
      input.ownerUserId,
    ],
  });
}
export async function recordAgentActivitySessionInventoryMemberCleanupWaiting(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
}): Promise<void> {
  await input.db.query({
    text: `UPDATE "openmeld"."agent_activity_session_inventory_member_cleanup_requests"
       SET last_attempt_at_ms = $1, last_error = NULL
       WHERE organization_id = $2 AND owner_user_id = $3`,
    values: [input.nowMs, input.organizationId, input.ownerUserId],
  });
}
export async function readConnectedComputerId(input: {
  db: PostgresDatabase;
  deviceId: string;
  ownerUserId: string;
}): Promise<string | null> {
  const row = await input.db
    .query<{
      connected_computer_id: string | null;
    }>({
      text: `
        SELECT connected_computer_id
        FROM "openmeld"."openMeldDaemon_owned_devices"
        WHERE owner_user_id = $1 AND device_id = $2
        LIMIT 1
      `,
      values: [input.ownerUserId, input.deviceId],
    })
    .then((result) => result.rows[0] ?? null);
  const value = row?.connected_computer_id?.trim();
  return value ? value : null;
}
export async function canResumeAgentActivitySessionSelection(
  input: {
    db: PostgresDatabase;
  } & AgentActivitySessionResumeEligibility
): Promise<boolean> {
  const query = buildAgentActivitySessionResumeEligibilityQuery(input);
  if (!query) {
    return false;
  }
  const row = await input.db
    .query<{
      allowed: number;
    }>({ text: query.sql, values: [...query.bindings] })
    .then((result) => result.rows[0] ?? null);
  return row?.allowed === 1;
}
export async function resolveAgentActivitySessionInventorySelection(input: {
  agentControllerRef: string;
  capability: AgentActivitySessionInventorySelectionCapability;
  computerId: string;
  db: PostgresDatabase;
  nativeSessionId: string;
  nowMs: number;
  organizationId: string;
  ownerUserId: string;
  projectId: string;
}): Promise<AgentProfileBindingSessionInventorySelection | null> {
  const connectedComputerId =
    (await readConnectedComputerId({
      db: input.db,
      deviceId: input.computerId,
      ownerUserId: input.ownerUserId,
    })) ?? input.computerId;
  const inventory = await readAgentActivitySessionInventory({
    db: input.db,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    query: {
      limit: 100,
      memberUserId: input.ownerUserId,
      nativeSessionId: input.nativeSessionId,
      projectId: input.projectId,
    },
  });
  const session = inventory.sessions.find(
    (candidate) =>
      candidate.computer.id === connectedComputerId &&
      candidate.localAgent.agentControllerRef === input.agentControllerRef
  );
  if (
    !session ||
    session.dataState !== "current" ||
    (input.capability === "resume" &&
      (!session.canResume || session.bindingState !== "unbound")) ||
    (input.capability === "fork" && !session.canFork)
  ) {
    return null;
  }
  return {
    computerId: session.computer.id,
    nativeSessionId: session.nativeSessionId,
    organizationId: session.organization.id,
    ownerUserId: session.owner.userId,
    projectId: session.project.id,
    provider: session.localAgent.provider,
  };
}
export async function resolveAgentActivitySessionInventoryExecutionSelection(
  input: Parameters<typeof resolveAgentActivitySessionInventorySelection>[0]
): Promise<{
  runtimeDeviceId: string;
  selection: AgentProfileBindingSessionInventorySelection;
} | null> {
  const selection = await resolveAgentActivitySessionInventorySelection(input);
  if (!selection) {
    return null;
  }
  const row = await input.db
    .query<{
      device_id: string;
    }>({
      text: `SELECT device_id
       FROM "openmeld"."agent_activity_session_inventory"
       WHERE organization_id = $1
         AND owner_user_id = $2
         AND project_id = $3
         AND connected_computer_id = $4
         AND agent_controller_ref = $5
         AND native_session_id = $6
         AND visible = 1
       LIMIT 1`,
      values: [
        selection.organizationId,
        selection.ownerUserId,
        selection.projectId,
        selection.computerId,
        input.agentControllerRef,
        selection.nativeSessionId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  const runtimeDeviceId = row?.device_id?.trim();
  return runtimeDeviceId ? { runtimeDeviceId, selection } : null;
}
export function buildAgentActivitySessionResumeEligibilityQuery(
  input: AgentActivitySessionResumeEligibility,
  parameterOffset = 0
): {
  bindings: unknown[];
  sql: string;
} | null {
  if (
    input.activeOrganizationId !== input.selection.organizationId ||
    input.ownerUserId !== input.selection.ownerUserId
  ) {
    return null;
  }
  return {
    bindings: [
      input.selection.organizationId,
      input.selection.ownerUserId,
      input.selection.projectId,
      input.selection.computerId,
      input.deviceId,
      input.agentControllerRef,
      input.selection.provider,
      input.selection.nativeSessionId,
      input.nowMs - AGENT_ACTIVITY_SESSION_INVENTORY_STALE_AFTER_MS,
      input.agentProfileId,
    ],
    sql: `
        SELECT 1 AS allowed
        FROM "openmeld"."agent_activity_session_inventory" inventory
        INNER JOIN "openmeld"."agent_activity_session_inventory_sources" source
          ON source.source_scope_key = inventory.source_scope_key
        INNER JOIN "openmeld"."projects"
          ON projects.id = inventory.project_id
          AND projects.organization_id = inventory.organization_id
          AND projects.archived_at_ms IS NULL
        INNER JOIN "openmeld"."members"
          ON members.organization_id = inventory.organization_id
          AND members.user_id = inventory.owner_user_id
        INNER JOIN "openmeld"."openMeldDaemon_owned_devices" owned
          ON owned.owner_user_id = inventory.owner_user_id
          AND owned.device_id = inventory.device_id
          AND owned.connected_computer_id = inventory.connected_computer_id
        WHERE inventory.organization_id = $${parameterOffset + 1}
          AND inventory.owner_user_id = $${parameterOffset + 2}
          AND inventory.project_id = $${parameterOffset + 3}
          AND inventory.connected_computer_id = $${parameterOffset + 4}
          AND inventory.device_id = $${parameterOffset + 5}
          AND inventory.agent_controller_ref = $${parameterOffset + 6}
          AND inventory.provider = $${parameterOffset + 7}
          AND inventory.native_session_id = $${parameterOffset + 8}
          AND inventory.visible = 1
          AND inventory.can_resume = 1
          AND source.state = 'current'
          AND source.last_complete_at_ms >= $${parameterOffset + 9}
          AND NOT EXISTS (
            SELECT 1
            FROM "openmeld"."openMeldDaemon_agent_profile_bindings" binding
            INNER JOIN "openmeld"."openmeld_profiles" profile
              ON profile.profile_id = binding.agent_profile_id
              AND profile.organization_id = inventory.organization_id
              AND profile.owner_user_id = inventory.owner_user_id
              AND profile.profile_kind = 'agent'
              AND profile.status = 'active'
            WHERE binding.owner_kind = 'owner_account'
              AND binding.owner_id = inventory.owner_user_id
              AND binding.agent_controller_ref = inventory.agent_controller_ref
              AND binding.agent_controller_conversation_id = inventory.native_session_id
              AND binding.binding_state = 'enabled_primary'
              AND binding.agent_profile_id <> $${parameterOffset + 10}
          )
        LIMIT 1
      `,
  };
}
export async function acceptAgentActivitySessionReconciliation(input: {
  authority: InventorySourceAuthority;
  db: PostgresDatabase;
  nowMs: number;
  reconciliation: SubmitAgentActivitySessionReconciliationBody;
}): Promise<SubmitAgentActivitySessionReconciliationResponse> {
  const sourceScopeKey = await sha256Key([
    input.authority.organizationId,
    input.authority.ownerUserId,
    input.authority.deviceId,
    input.reconciliation.projectId,
    input.reconciliation.localConnectionId,
    input.reconciliation.agentControllerRef,
  ]);
  const existing = await input.db
    .query<SourceRow>({
      text: `
        SELECT current_reconciliation_id, next_page_index, state
        FROM "openmeld"."agent_activity_session_inventory_sources"
        WHERE source_scope_key = $1
        LIMIT 1
      `,
      values: [sourceScopeKey],
    })
    .then((result) => result.rows[0] ?? null);
  if (
    existing?.current_reconciliation_id ===
      input.reconciliation.reconciliationId &&
    input.reconciliation.pageIndex < Number(existing.next_page_index)
  ) {
    return parseReconciliationResponse({
      acceptedPageIndex: input.reconciliation.pageIndex,
      publishedSessionCount:
        input.reconciliation.terminal && existing.state === "current"
          ? await countPublishedSessions({ db: input.db, sourceScopeKey })
          : null,
      reconciliationId: input.reconciliation.reconciliationId,
      status: "reused",
    });
  }
  const startsNewReconciliation =
    !existing ||
    existing.current_reconciliation_id !==
      input.reconciliation.reconciliationId;
  const expectedPageIndex = startsNewReconciliation
    ? 0
    : Number(existing.next_page_index);
  if (input.reconciliation.pageIndex !== expectedPageIndex) {
    throw new Error(
      `Agent Activity Session reconciliation expected page ${expectedPageIndex}.`
    );
  }

  if (
    input.reconciliation.result !== "sessions" &&
    input.reconciliation.result !== "partial"
  ) {
    return await acceptTerminalCoverageResult({
      ...input,
      expectedCurrentReconciliationId:
        existing?.current_reconciliation_id ?? null,
      sourceScopeKey,
    });
  }
  await stageSessionPage({
    ...input,
    sourceScopeKey,
    startsNewReconciliation,
  });
  if (!input.reconciliation.terminal) {
    return parseReconciliationResponse({
      acceptedPageIndex: input.reconciliation.pageIndex,
      publishedSessionCount: null,
      reconciliationId: input.reconciliation.reconciliationId,
      status: "accepted",
    });
  }
  const conflictingIdentity = await input.db
    .query<{
      native_session_id: string;
    }>({
      text: `
        SELECT inventory.native_session_id
        FROM "openmeld"."agent_activity_session_inventory" inventory
        INNER JOIN "openmeld"."agent_activity_session_inventory_candidates" candidate
          ON candidate.organization_id = inventory.organization_id
          AND candidate.owner_user_id = inventory.owner_user_id
          AND candidate.agent_controller_ref = inventory.agent_controller_ref
          AND candidate.native_session_id = inventory.native_session_id
        WHERE candidate.source_scope_key = $1
          AND candidate.reconciliation_id = $2
          AND inventory.source_scope_key <> $3
          AND inventory.visible = 1
        LIMIT 1
      `,
      values: [
        sourceScopeKey,
        input.reconciliation.reconciliationId,
        sourceScopeKey,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (conflictingIdentity) {
    await input.db.transaction(
      async (client) =>
        [
          await client.query({
            text: `
            DELETE FROM "openmeld"."agent_activity_session_inventory_candidates"
            WHERE source_scope_key = $1 AND reconciliation_id = $2
          `,
            values: [sourceScopeKey, input.reconciliation.reconciliationId],
          }),
          await client.query({
            text: `
            UPDATE "openmeld"."agent_activity_session_inventory_sources"
            SET state = 'error', problem_code = 'session_identity_conflict',
                updated_at_ms = $1
            WHERE source_scope_key = $2
              AND current_reconciliation_id = $3
              AND state = 'syncing'
          `,
            values: [
              input.nowMs,
              sourceScopeKey,
              input.reconciliation.reconciliationId,
            ],
          }),
        ] as const
    );
    throw new Error(
      "Agent Activity Session identity is already claimed by another current source."
    );
  }
  await publishStagedSessions({
    db: input.db,
    nowMs: input.nowMs,
    problemCode: input.reconciliation.problemCode ?? null,
    reconciliationId: input.reconciliation.reconciliationId,
    result: input.reconciliation.result,
    sourceScopeKey,
  });
  const publishedSessionCount = await countPublishedSessions({
    db: input.db,
    sourceScopeKey,
  });
  return parseReconciliationResponse({
    acceptedPageIndex: input.reconciliation.pageIndex,
    publishedSessionCount,
    reconciliationId: input.reconciliation.reconciliationId,
    status: "published",
  });
}
async function stageSessionPage(input: {
  authority: InventorySourceAuthority;
  db: PostgresDatabase;
  nowMs: number;
  reconciliation: SubmitAgentActivitySessionReconciliationBody;
  sourceScopeKey: string;
  startsNewReconciliation: boolean;
}): Promise<void> {
  const statements: QueryConfig[] = [];
  if (input.startsNewReconciliation) {
    statements.push({
      text: 'DELETE FROM "openmeld"."agent_activity_session_inventory_candidates" WHERE source_scope_key = $1',
      values: [input.sourceScopeKey],
    });
  }
  // One multi-row INSERT per page (at most
  // AGENT_ACTIVITY_SESSION_RECONCILIATION_PAGE_MAX rows) instead of one
  // statement per session: same rows, same transaction, far fewer round trips.
  const candidateValues: unknown[] = [];
  const candidateRows: string[] = [];
  for (const session of input.reconciliation.sessions) {
    const candidateId = await sha256Key([
      input.sourceScopeKey,
      input.reconciliation.reconciliationId,
      input.reconciliation.agentControllerRef,
      session.nativeSessionId,
    ]);
    const rowValues = [
      candidateId,
      input.sourceScopeKey,
      input.reconciliation.reconciliationId,
      input.reconciliation.pageIndex,
      input.authority.organizationId,
      input.authority.ownerUserId,
      input.reconciliation.agentControllerRef,
      session.nativeSessionId,
      input.reconciliation.projectId,
      input.authority.deviceId,
      input.authority.connectedComputerId,
      input.reconciliation.localConnectionId,
      input.reconciliation.provider,
      session.nativeSessionTitle,
      session.status,
      session.lastActiveAtMs,
      session.startedAtMs,
      session.origin,
      session.canResume ? 1 : 0,
      session.canFork ? 1 : 0,
      input.reconciliation.observedAtMs,
      input.nowMs,
    ];
    const offset = candidateValues.length;
    candidateRows.push(
      `(${rowValues.map((_, index) => `$${offset + index + 1}`).join(", ")})`
    );
    candidateValues.push(...rowValues);
  }
  if (candidateRows.length > 0) {
    statements.push({
      text: `
            INSERT INTO "openmeld"."agent_activity_session_inventory_candidates" (
              id, source_scope_key, reconciliation_id, page_index,
              organization_id, owner_user_id, agent_controller_ref,
              native_session_id, project_id, device_id,
              connected_computer_id, local_connection_id, provider,
              native_session_title, status, last_active_at_ms, started_at_ms,
              origin, can_resume, can_fork, observed_at_ms, created_at_ms
            ) VALUES ${candidateRows.join(", ")}
          `,
      values: candidateValues,
    });
  }
  statements.push({
    text: `
          INSERT INTO "openmeld"."agent_activity_session_inventory_sources" (
            source_scope_key, organization_id, owner_user_id, project_id,
            device_id, connected_computer_id, local_connection_id,
            agent_controller_ref, provider, state, current_reconciliation_id,
            next_page_index, problem_code, last_attempt_at_ms,
            last_complete_at_ms, updated_at_ms
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'syncing', $10, $11, NULL, $12, NULL, $13)
          ON CONFLICT(source_scope_key) DO UPDATE SET
            organization_id = excluded.organization_id,
            owner_user_id = excluded.owner_user_id,
            project_id = excluded.project_id,
            device_id = excluded.device_id,
            connected_computer_id = excluded.connected_computer_id,
            local_connection_id = excluded.local_connection_id,
            agent_controller_ref = excluded.agent_controller_ref,
            provider = excluded.provider,
            state = 'syncing',
            current_reconciliation_id = excluded.current_reconciliation_id,
            next_page_index = excluded.next_page_index,
            problem_code = NULL,
            last_attempt_at_ms = excluded.last_attempt_at_ms,
            updated_at_ms = excluded.updated_at_ms
        `,
    values: [
      input.sourceScopeKey,
      input.authority.organizationId,
      input.authority.ownerUserId,
      input.reconciliation.projectId,
      input.authority.deviceId,
      input.authority.connectedComputerId,
      input.reconciliation.localConnectionId,
      input.reconciliation.agentControllerRef,
      input.reconciliation.provider,
      input.reconciliation.reconciliationId,
      input.reconciliation.pageIndex + 1,
      input.nowMs,
      input.nowMs,
    ],
  });
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
}
async function publishStagedSessions(input: {
  db: PostgresDatabase;
  nowMs: number;
  problemCode: string | null;
  reconciliationId: string;
  result: "partial" | "sessions";
  sourceScopeKey: string;
}): Promise<void> {
  await input.db.transaction(
    async (client) =>
      [
        await client.query({
          text: `
          DELETE FROM "openmeld"."agent_activity_session_inventory"
          WHERE source_scope_key = $1
            AND EXISTS (
              SELECT 1
              FROM "openmeld"."agent_activity_session_inventory_sources" active_source
              WHERE active_source.source_scope_key = $2
                AND active_source.current_reconciliation_id = $3
                AND active_source.state = 'syncing'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "openmeld"."agent_activity_session_inventory_candidates" candidate
              INNER JOIN "openmeld"."agent_activity_session_inventory" claimed
                ON claimed.organization_id = candidate.organization_id
                AND claimed.owner_user_id = candidate.owner_user_id
                AND claimed.agent_controller_ref = candidate.agent_controller_ref
                AND claimed.native_session_id = candidate.native_session_id
              WHERE candidate.source_scope_key = $4
                AND candidate.reconciliation_id = $5
                AND claimed.source_scope_key <> $6
                AND claimed.visible = 1
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "openmeld"."agent_activity_session_inventory_candidates" candidate
              WHERE candidate.source_scope_key = $7
                AND candidate.reconciliation_id = $8
                AND candidate.organization_id = agent_activity_session_inventory.organization_id
                AND candidate.owner_user_id = agent_activity_session_inventory.owner_user_id
                AND candidate.agent_controller_ref = agent_activity_session_inventory.agent_controller_ref
                AND candidate.native_session_id = agent_activity_session_inventory.native_session_id
            )
        `,
          values: [
            input.sourceScopeKey,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
            input.sourceScopeKey,
            input.reconciliationId,
          ],
        }),
        await client.query({
          text: `
          INSERT INTO "openmeld"."agent_activity_session_inventory" (
            id, organization_id, owner_user_id, agent_controller_ref,
            native_session_id, project_id, device_id, connected_computer_id,
            local_connection_id, source_scope_key, provider,
            native_session_title, status, last_active_at_ms, started_at_ms,
            origin, can_resume, can_fork, visible,
            source_reconciliation_id, observed_at_ms, published_at_ms,
            updated_at_ms
          )
          SELECT
            'inventory:' || substr(candidate.id, 8),
            candidate.organization_id, candidate.owner_user_id,
            candidate.agent_controller_ref, candidate.native_session_id,
            candidate.project_id, candidate.device_id,
            candidate.connected_computer_id, candidate.local_connection_id,
            candidate.source_scope_key, candidate.provider,
            candidate.native_session_title, candidate.status,
            candidate.last_active_at_ms, candidate.started_at_ms,
            candidate.origin, candidate.can_resume, candidate.can_fork, 1,
            candidate.reconciliation_id, candidate.observed_at_ms, $1, $2
          FROM "openmeld"."agent_activity_session_inventory_candidates" candidate
          WHERE candidate.source_scope_key = $3
            AND candidate.reconciliation_id = $4
            AND EXISTS (
              SELECT 1
              FROM "openmeld"."agent_activity_session_inventory_sources" active_source
              WHERE active_source.source_scope_key = $5
                AND active_source.current_reconciliation_id = $6
                AND active_source.state = 'syncing'
            )
            AND NOT EXISTS (
              SELECT 1
              FROM "openmeld"."agent_activity_session_inventory_candidates" proposed
              INNER JOIN "openmeld"."agent_activity_session_inventory" claimed
                ON claimed.organization_id = proposed.organization_id
                AND claimed.owner_user_id = proposed.owner_user_id
                AND claimed.agent_controller_ref = proposed.agent_controller_ref
                AND claimed.native_session_id = proposed.native_session_id
              WHERE proposed.source_scope_key = $7
                AND proposed.reconciliation_id = $8
                AND claimed.source_scope_key <> $9
                AND claimed.visible = 1
            )
          ON CONFLICT(organization_id, owner_user_id, agent_controller_ref, native_session_id)
          DO UPDATE SET
            project_id = excluded.project_id,
            device_id = excluded.device_id,
            connected_computer_id = excluded.connected_computer_id,
            local_connection_id = excluded.local_connection_id,
            source_scope_key = excluded.source_scope_key,
            provider = excluded.provider,
            native_session_title = excluded.native_session_title,
            status = excluded.status,
            last_active_at_ms = excluded.last_active_at_ms,
            started_at_ms = excluded.started_at_ms,
            origin = excluded.origin,
            can_resume = excluded.can_resume,
            can_fork = excluded.can_fork,
            visible = 1,
            source_reconciliation_id = excluded.source_reconciliation_id,
            observed_at_ms = excluded.observed_at_ms,
            published_at_ms = excluded.published_at_ms,
            updated_at_ms = excluded.updated_at_ms
          WHERE agent_activity_session_inventory.source_scope_key = excluded.source_scope_key
            OR agent_activity_session_inventory.visible = 0
        `,
          values: [
            input.nowMs,
            input.nowMs,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
          ],
        }),
        await client.query({
          text: `
          UPDATE "openmeld"."agent_activity_session_inventory_sources"
          SET state = $8, problem_code = $9,
              last_complete_at_ms = $1, updated_at_ms = $2
          WHERE source_scope_key = $3
            AND current_reconciliation_id = $4
            AND state = 'syncing'
            AND NOT EXISTS (
              SELECT 1
              FROM "openmeld"."agent_activity_session_inventory_candidates" candidate
              INNER JOIN "openmeld"."agent_activity_session_inventory" claimed
                ON claimed.organization_id = candidate.organization_id
                AND claimed.owner_user_id = candidate.owner_user_id
                AND claimed.agent_controller_ref = candidate.agent_controller_ref
                AND claimed.native_session_id = candidate.native_session_id
              WHERE candidate.source_scope_key = $5
                AND candidate.reconciliation_id = $6
                AND claimed.source_scope_key <> $7
                AND claimed.visible = 1
            )
        `,
          values: [
            input.nowMs,
            input.nowMs,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
            input.result === "partial" ? "error" : "current",
            input.problemCode,
          ],
        }),
        await client.query({
          text: `
          UPDATE "openmeld"."agent_activity_session_inventory_sources"
          SET state = 'error', problem_code = 'session_identity_conflict',
              updated_at_ms = $1
          WHERE source_scope_key = $2
            AND current_reconciliation_id = $3
            AND state = 'syncing'
            AND EXISTS (
              SELECT 1
              FROM "openmeld"."agent_activity_session_inventory_candidates" candidate
              INNER JOIN "openmeld"."agent_activity_session_inventory" claimed
                ON claimed.organization_id = candidate.organization_id
                AND claimed.owner_user_id = candidate.owner_user_id
                AND claimed.agent_controller_ref = candidate.agent_controller_ref
                AND claimed.native_session_id = candidate.native_session_id
              WHERE candidate.source_scope_key = $4
                AND candidate.reconciliation_id = $5
                AND claimed.source_scope_key <> $6
                AND claimed.visible = 1
            )
        `,
          values: [
            input.nowMs,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
            input.reconciliationId,
            input.sourceScopeKey,
          ],
        }),
        await client.query(
          retireReplacedDisconnectedSourcesStatement({
            db: input.db,
            reconciliationId: input.reconciliationId,
            sourceScopeKey: input.sourceScopeKey,
          })
        ),
        await client.query({
          text: `
          DELETE FROM "openmeld"."agent_activity_session_inventory_candidates"
          WHERE source_scope_key = $1 AND reconciliation_id = $2
        `,
          values: [input.sourceScopeKey, input.reconciliationId],
        }),
      ] as const
  );
  const source = await input.db
    .query<SourceRow & { problem_code: string | null }>({
      text: `
        SELECT current_reconciliation_id, next_page_index, state, problem_code
        FROM "openmeld"."agent_activity_session_inventory_sources"
        WHERE source_scope_key = $1
        LIMIT 1
      `,
      values: [input.sourceScopeKey],
    })
    .then((result) => result.rows[0] ?? null);
  if (
    source?.current_reconciliation_id !== input.reconciliationId ||
    source.state !== (input.result === "partial" ? "error" : "current") ||
    source.problem_code !== input.problemCode
  ) {
    if (source?.problem_code === "session_identity_conflict") {
      throw new Error(
        "Agent Activity Session identity is already claimed by another current source."
      );
    }
    throw new Error(
      "Agent Activity Session reconciliation did not publish a current source."
    );
  }
}
async function acceptTerminalCoverageResult(input: {
  authority: InventorySourceAuthority;
  db: PostgresDatabase;
  expectedCurrentReconciliationId: string | null;
  nowMs: number;
  reconciliation: SubmitAgentActivitySessionReconciliationBody;
  sourceScopeKey: string;
}): Promise<SubmitAgentActivitySessionReconciliationResponse> {
  const hidesCurrentRows =
    input.reconciliation.result === "unsupported" ||
    input.reconciliation.result === "disconnected";
  const state = input.reconciliation.result;
  const statements: QueryConfig[] = [
    {
      text: `
          INSERT INTO "openmeld"."agent_activity_session_inventory_sources" (
            source_scope_key, organization_id, owner_user_id, project_id,
            device_id, connected_computer_id, local_connection_id,
            agent_controller_ref, provider, state, current_reconciliation_id,
            next_page_index, problem_code, last_attempt_at_ms,
            last_complete_at_ms, updated_at_ms
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, $12, $13, $14, $15)
          ON CONFLICT(source_scope_key) DO UPDATE SET
            organization_id = excluded.organization_id,
            owner_user_id = excluded.owner_user_id,
            project_id = excluded.project_id,
            device_id = excluded.device_id,
            connected_computer_id = excluded.connected_computer_id,
            local_connection_id = excluded.local_connection_id,
            agent_controller_ref = excluded.agent_controller_ref,
            provider = excluded.provider,
            state = excluded.state,
            current_reconciliation_id = excluded.current_reconciliation_id,
            next_page_index = 1,
            problem_code = excluded.problem_code,
            last_attempt_at_ms = excluded.last_attempt_at_ms,
            last_complete_at_ms = CASE
              WHEN excluded.state IN ('unsupported', 'disconnected')
                THEN excluded.last_complete_at_ms
              ELSE agent_activity_session_inventory_sources.last_complete_at_ms
            END,
            updated_at_ms = excluded.updated_at_ms
          WHERE agent_activity_session_inventory_sources.current_reconciliation_id IS NOT DISTINCT FROM $16
        `,
      values: [
        input.sourceScopeKey,
        input.authority.organizationId,
        input.authority.ownerUserId,
        input.reconciliation.projectId,
        input.authority.deviceId,
        input.authority.connectedComputerId,
        input.reconciliation.localConnectionId,
        input.reconciliation.agentControllerRef,
        input.reconciliation.provider,
        state,
        input.reconciliation.reconciliationId,
        input.reconciliation.problemCode ?? null,
        input.nowMs,
        hidesCurrentRows ? input.nowMs : null,
        input.nowMs,
        input.expectedCurrentReconciliationId,
      ],
    },
    {
      text: `
          DELETE FROM "openmeld"."agent_activity_session_inventory_candidates"
          WHERE source_scope_key = $1
            AND EXISTS (
              SELECT 1
              FROM "openmeld"."agent_activity_session_inventory_sources" active_source
              WHERE active_source.source_scope_key = $2
                AND active_source.current_reconciliation_id = $3
                AND active_source.state = $4
            )
        `,
      values: [
        input.sourceScopeKey,
        input.sourceScopeKey,
        input.reconciliation.reconciliationId,
        state,
      ],
    },
  ];
  if (hidesCurrentRows) {
    statements.push({
      text: `
            DELETE FROM "openmeld"."agent_activity_session_inventory"
            WHERE source_scope_key = $1
              AND EXISTS (
                SELECT 1
                FROM "openmeld"."agent_activity_session_inventory_sources" active_source
                WHERE active_source.source_scope_key = $2
                  AND active_source.current_reconciliation_id = $3
                  AND active_source.state = $4
              )
          `,
      values: [
        input.sourceScopeKey,
        input.sourceScopeKey,
        input.reconciliation.reconciliationId,
        state,
      ],
    });
  }
  statements.push(
    retireReplacedDisconnectedSourcesStatement({
      db: input.db,
      reconciliationId: input.reconciliation.reconciliationId,
      sourceScopeKey: input.sourceScopeKey,
    })
  );
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  const source = await input.db
    .query<SourceRow>({
      text: `
        SELECT current_reconciliation_id, next_page_index, state
        FROM "openmeld"."agent_activity_session_inventory_sources"
        WHERE source_scope_key = $1
        LIMIT 1
      `,
      values: [input.sourceScopeKey],
    })
    .then((result) => result.rows[0] ?? null);
  if (
    source?.current_reconciliation_id !==
      input.reconciliation.reconciliationId ||
    source.state !== state
  ) {
    throw new Error(
      "Agent Activity Session reconciliation did not publish terminal coverage."
    );
  }
  return parseReconciliationResponse({
    acceptedPageIndex: 0,
    publishedSessionCount: hidesCurrentRows ? 0 : null,
    reconciliationId: input.reconciliation.reconciliationId,
    status: "published",
  });
}
function retireReplacedDisconnectedSourcesStatement(input: {
  db: PostgresDatabase;
  reconciliationId: string;
  sourceScopeKey: string;
}): QueryConfig {
  return {
    text: `
        DELETE FROM "openmeld"."agent_activity_session_inventory_sources"
        WHERE state = 'disconnected'
          AND source_scope_key <> $1
          AND EXISTS (
            SELECT 1
            FROM "openmeld"."agent_activity_session_inventory_sources" replacement
            WHERE replacement.source_scope_key = $2
              AND replacement.current_reconciliation_id = $3
              AND replacement.state IN ('current', 'unsupported')
              AND replacement.organization_id = agent_activity_session_inventory_sources.organization_id
              AND replacement.owner_user_id = agent_activity_session_inventory_sources.owner_user_id
              AND replacement.project_id = agent_activity_session_inventory_sources.project_id
              AND replacement.device_id = agent_activity_session_inventory_sources.device_id
              AND replacement.connected_computer_id = agent_activity_session_inventory_sources.connected_computer_id
              AND replacement.agent_controller_ref = agent_activity_session_inventory_sources.agent_controller_ref
              AND replacement.provider = agent_activity_session_inventory_sources.provider
          )
      `,
    values: [
      input.sourceScopeKey,
      input.sourceScopeKey,
      input.reconciliationId,
    ],
  };
}
export async function readAgentActivitySessionInventory(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  query: AgentActivitySessionInventoryQuery;
}): Promise<AgentActivitySessionInventoryResponse> {
  const querySignature = await buildQuerySignature({
    organizationId: input.organizationId,
    query: input.query,
  });
  const cursor = input.query.cursor
    ? decodeCursor(input.query.cursor, querySignature)
    : null;
  const filters = buildInventoryFilters({
    cursor,
    organizationId: input.organizationId,
    query: input.query,
  });
  const rows = await input.db.query<InventoryRow>({
    text: `
        SELECT
          inventory.organization_id,
          organizations.name AS organization_name,
          inventory.owner_user_id,
          coalesce(users.name, 'Organization member') AS owner_name,
          inventory.project_id,
          projects.name AS project_name,
          projects.slug AS project_slug,
          inventory.connected_computer_id AS computer_id,
          inventory.device_id,
          coalesce(owned.user_display_name, owned.observed_display_name, 'Computer') AS computer_name,
          owned.last_observed_at_ms AS computer_last_seen_at_ms,
          CASE
            WHEN EXISTS (
              SELECT 1
              FROM "openmeld"."openMeldDaemon_runtime_registry_records" runtime
              INNER JOIN "openmeld"."openMeldDaemon_runtime_agent_controller_reports" report
                ON report.openmeld_service_runtime_id = runtime.openmeld_service_runtime_id
                AND report.agent_controller_ref = inventory.agent_controller_ref
              WHERE runtime.owner_kind = 'owner_account'
                AND runtime.owner_id = inventory.owner_user_id
                AND runtime.device_id = inventory.device_id
                AND report.expires_at_ms > $1
            ) THEN 'online'
            WHEN EXISTS (
              SELECT 1
              FROM "openmeld"."openMeldDaemon_runtime_registry_records" runtime
              INNER JOIN "openmeld"."openMeldDaemon_runtime_agent_controller_reports" report
                ON report.openmeld_service_runtime_id = runtime.openmeld_service_runtime_id
                AND report.agent_controller_ref = inventory.agent_controller_ref
              WHERE runtime.owner_kind = 'owner_account'
                AND runtime.owner_id = inventory.owner_user_id
                AND runtime.device_id = inventory.device_id
            ) THEN 'offline'
            ELSE 'unknown'
          END AS computer_state,
          inventory.agent_controller_ref,
          inventory.provider,
          inventory.native_session_id,
          inventory.native_session_title,
          inventory.status,
          inventory.last_active_at_ms,
          inventory.started_at_ms,
          inventory.origin,
          inventory.can_resume,
          inventory.can_fork,
          inventory.updated_at_ms AS inventory_updated_at_ms,
          source.state AS source_state,
          source.last_complete_at_ms AS source_last_complete_at_ms,
          (
            SELECT count(DISTINCT profile.profile_id)
            FROM "openmeld"."openMeldDaemon_agent_profile_bindings" binding
            INNER JOIN "openmeld"."openmeld_profiles" profile
              ON profile.profile_id = binding.agent_profile_id
              AND profile.organization_id = inventory.organization_id
              AND profile.owner_user_id = inventory.owner_user_id
              AND profile.profile_kind = 'agent'
              AND profile.status = 'active'
            WHERE binding.owner_kind = 'owner_account'
              AND binding.owner_id = inventory.owner_user_id
              AND binding.agent_controller_ref = inventory.agent_controller_ref
              AND binding.agent_controller_conversation_id = inventory.native_session_id
              AND binding.binding_state = 'enabled_primary'
          ) AS binding_count,
          (
            SELECT min(profile.profile_id)
            FROM "openmeld"."openMeldDaemon_agent_profile_bindings" binding
            INNER JOIN "openmeld"."openmeld_profiles" profile
              ON profile.profile_id = binding.agent_profile_id
              AND profile.organization_id = inventory.organization_id
              AND profile.owner_user_id = inventory.owner_user_id
              AND profile.profile_kind = 'agent'
              AND profile.status = 'active'
            WHERE binding.owner_kind = 'owner_account'
              AND binding.owner_id = inventory.owner_user_id
              AND binding.agent_controller_ref = inventory.agent_controller_ref
              AND binding.agent_controller_conversation_id = inventory.native_session_id
              AND binding.binding_state = 'enabled_primary'
          ) AS bound_agent_profile_id
        FROM "openmeld"."agent_activity_session_inventory" inventory
        INNER JOIN "openmeld"."agent_activity_session_inventory_sources" source
          ON source.source_scope_key = inventory.source_scope_key
        INNER JOIN "openmeld"."organizations" ON organizations.id = inventory.organization_id
        INNER JOIN "openmeld"."members"
          ON members.organization_id = inventory.organization_id
          AND members.user_id = inventory.owner_user_id
        INNER JOIN "openmeld"."users" ON users.id = inventory.owner_user_id
        INNER JOIN "openmeld"."projects"
          ON projects.id = inventory.project_id
          AND projects.organization_id = inventory.organization_id
          AND projects.archived_at_ms IS NULL
        INNER JOIN "openmeld"."openMeldDaemon_owned_devices" owned
          ON owned.owner_user_id = inventory.owner_user_id
          AND owned.device_id = inventory.device_id
          AND owned.connected_computer_id = inventory.connected_computer_id
        WHERE ${filters.sql}
        ORDER BY inventory.last_active_at_ms DESC NULLS LAST,
          inventory.owner_user_id ASC NULLS FIRST,
          inventory.agent_controller_ref ASC NULLS FIRST,
          inventory.native_session_id ASC NULLS FIRST
        LIMIT $${filters.bindings.length + 2}
      `,
    values: [input.nowMs, ...filters.bindings, input.query.limit + 1],
  });
  const pageRows = (rows.rows ?? []).slice(0, input.query.limit);
  const sessions = pageRows.map((row) => mapInventoryRow(row, input.nowMs));
  const last = pageRows.at(-1);
  const nextCursor =
    (rows.rows ?? []).length > input.query.limit && last
      ? encodeCursor({
          agentControllerRef: last.agent_controller_ref,
          lastActiveAtMs: Number(last.last_active_at_ms),
          nativeSessionId: last.native_session_id,
          ownerUserId: last.owner_user_id,
          querySignature,
          version: 1,
        })
      : null;
  const [organization, coverage] = await Promise.all([
    readOrganizationIdentity(input),
    readCoverage(input),
  ]);
  return agentActivitySessionInventoryResponseSchema.parse({
    asOfMs: input.nowMs,
    coverage,
    nextCursor,
    organization,
    sessions,
  });
}
function buildInventoryFilters(input: {
  cursor: PageCursor | null;
  organizationId: string;
  query: AgentActivitySessionInventoryQuery;
}): {
  bindings: unknown[];
  sql: string;
} {
  const clauses = [
    "inventory.organization_id = $2",
    "inventory.visible = 1",
    "source.state IN ('syncing', 'current', 'stale', 'error')",
  ];
  const bindings: unknown[] = [input.organizationId];
  const add = (column: string, value: unknown) => {
    clauses.push(`${column} = $${bindings.length + 2}`);
    bindings.push(value);
  };
  if (input.query.memberUserId) {
    add("inventory.owner_user_id", input.query.memberUserId);
  }
  if (input.query.computerId) {
    add("inventory.connected_computer_id", input.query.computerId);
  }
  if (input.query.projectId) {
    add("inventory.project_id", input.query.projectId);
  }
  if (input.query.provider) {
    add("inventory.provider", input.query.provider);
  }
  if (input.query.status) {
    add("inventory.status", input.query.status);
  }
  if (input.query.origin) {
    add("inventory.origin", input.query.origin);
  }
  if (input.query.nativeSessionId) {
    add("inventory.native_session_id", input.query.nativeSessionId);
  }
  if (input.query.query) {
    const pattern = `%${escapeLike(input.query.query.toLowerCase())}%`;
    clauses.push(
      `(lower(inventory.native_session_id) LIKE $${bindings.length + 2} ESCAPE '\\' OR lower(coalesce(inventory.native_session_title, '')) LIKE $${bindings.length + 2} ESCAPE '\\')`
    );
    bindings.push(pattern);
  }
  if (input.cursor) {
    clauses.push(`(
      inventory.last_active_at_ms < $${bindings.length + 2}
      OR (inventory.last_active_at_ms = $${bindings.length + 2}
        AND (inventory.owner_user_id, inventory.agent_controller_ref, inventory.native_session_id)
          > ($${bindings.length + 3}, $${bindings.length + 4}, $${bindings.length + 5}))
    )`);
    bindings.push(
      input.cursor.lastActiveAtMs,
      input.cursor.ownerUserId,
      input.cursor.agentControllerRef,
      input.cursor.nativeSessionId
    );
  }
  return { bindings, sql: clauses.join(" AND ") };
}
async function readCoverage(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  query: AgentActivitySessionInventoryQuery;
}): Promise<AgentActivityInventoryCoverage[]> {
  const clauses = [
    "source.organization_id = $2",
    "projects.archived_at_ms IS NULL",
  ];
  const bindings: unknown[] = [input.organizationId];
  if (input.query.computerId) {
    clauses.push(`source.connected_computer_id = $${bindings.length + 2}`);
    bindings.push(input.query.computerId);
  }
  if (input.query.projectId) {
    clauses.push(`source.project_id = $${bindings.length + 2}`);
    bindings.push(input.query.projectId);
  }
  if (input.query.memberUserId) {
    clauses.push(`source.owner_user_id = $${bindings.length + 2}`);
    bindings.push(input.query.memberUserId);
  }
  if (input.query.provider) {
    clauses.push(`source.provider = $${bindings.length + 2}`);
    bindings.push(input.query.provider);
  }
  const rows = await input.db.query<CoverageRow>({
    text: `
        SELECT
          source.agent_controller_ref,
          source.connected_computer_id AS computer_id,
          source.last_attempt_at_ms,
          source.last_complete_at_ms,
          source.problem_code,
          source.project_id,
          source.provider,
          CASE
            WHEN source.state = 'current'
              AND source.last_complete_at_ms < $1 THEN 'stale'
            ELSE source.state
          END AS state
        FROM "openmeld"."agent_activity_session_inventory_sources" source
        INNER JOIN "openmeld"."members"
          ON members.organization_id = source.organization_id
          AND members.user_id = source.owner_user_id
        INNER JOIN "openmeld"."projects"
          ON projects.id = source.project_id
          AND projects.organization_id = source.organization_id
        WHERE ${clauses.join(" AND ")}
        ORDER BY source.project_id, source.owner_user_id,
          source.connected_computer_id, source.agent_controller_ref
      `,
    values: [
      input.nowMs - AGENT_ACTIVITY_SESSION_INVENTORY_STALE_AFTER_MS,
      ...bindings,
    ],
  });
  return (rows.rows ?? []).map((row) =>
    agentActivityInventoryCoverageSchema.parse({
      agentControllerRef: row.agent_controller_ref,
      computerId: row.computer_id,
      lastAttemptAtMs:
        row.last_attempt_at_ms === null ? null : Number(row.last_attempt_at_ms),
      lastCompleteAtMs:
        row.last_complete_at_ms === null
          ? null
          : Number(row.last_complete_at_ms),
      problemCode: row.problem_code,
      projectId: row.project_id,
      provider: row.provider,
      state: row.state,
    })
  );
}
async function readOrganizationIdentity(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<{
  id: string;
  name: string;
}> {
  const row = await input.db
    .query<{
      id: string;
      name: string;
    }>({
      text: 'SELECT id, name FROM "openmeld"."organizations" WHERE id = $1 LIMIT 1',
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    throw new Error("Authorized Organization identity is missing.");
  }
  return { id: row.id, name: row.name };
}
function mapInventoryRow(
  row: InventoryRow,
  nowMs: number
): AgentActivityInventorySession {
  const bindingCount = Number(row.binding_count);
  let bindingState: AgentActivityInventorySession["bindingState"] = "conflict";
  if (bindingCount === 0) {
    bindingState = "unbound";
  } else if (bindingCount === 1) {
    bindingState = "bound";
  }
  return agentActivityInventorySessionSchema.parse({
    boundAgentProfileId:
      bindingState === "bound" ? row.bound_agent_profile_id : null,
    bindingState,
    canFork: Boolean(row.can_fork),
    canResume: Boolean(row.can_resume),
    computer: {
      id: row.computer_id,
      lastSeenAtMs:
        row.computer_last_seen_at_ms === null
          ? null
          : Number(row.computer_last_seen_at_ms),
      name: row.computer_name,
      state: row.computer_state,
    },
    dataState:
      row.source_state === "current" &&
      row.source_last_complete_at_ms !== null &&
      Number(row.source_last_complete_at_ms) >=
        nowMs - AGENT_ACTIVITY_SESSION_INVENTORY_STALE_AFTER_MS
        ? "current"
        : "stale",
    inventoryUpdatedAtMs: Number(row.inventory_updated_at_ms),
    lastActiveAtMs: Number(row.last_active_at_ms),
    localAgent: {
      agentControllerRef: row.agent_controller_ref,
      name: providerDisplayName(row.provider),
      provider: row.provider,
    },
    nativeSessionId: row.native_session_id,
    nativeSessionTitle: row.native_session_title,
    organization: {
      id: row.organization_id,
      name: row.organization_name,
    },
    origin: row.origin,
    owner: { name: row.owner_name, userId: row.owner_user_id },
    project: {
      id: row.project_id,
      name: row.project_name,
      slug: row.project_slug,
    },
    startedAtMs: row.started_at_ms === null ? null : Number(row.started_at_ms),
    status: row.status,
  });
}
function providerDisplayName(provider: LocalAgentSessionProvider): string {
  return {
    "claude-code": "Claude Code",
    codex: "Codex",
    cursor: "Cursor",
    "grok-build": "Grok Build",
    opencode: "OpenCode",
  }[provider];
}
async function countPublishedSessions(input: {
  db: PostgresDatabase;
  sourceScopeKey: string;
}): Promise<number> {
  const row = await input.db
    .query<{
      count: number;
    }>({
      text: `
        SELECT count(*) AS count
        FROM "openmeld"."agent_activity_session_inventory"
        WHERE source_scope_key = $1 AND visible = 1
      `,
      values: [input.sourceScopeKey],
    })
    .then((result) => result.rows[0] ?? null);
  return Number(row?.count ?? 0);
}
async function buildQuerySignature(input: {
  organizationId: string;
  query: AgentActivitySessionInventoryQuery;
}): Promise<string> {
  return await sha256Key([
    input.organizationId,
    input.query.memberUserId ?? "",
    input.query.nativeSessionId ?? "",
    input.query.origin ?? "",
    input.query.projectId ?? "",
    input.query.provider ?? "",
    input.query.query ?? "",
    input.query.status ?? "",
    String(input.query.limit),
    ...(input.query.computerId ? ["computerId", input.query.computerId] : []),
  ]);
}
async function sha256Key(parts: readonly string[]): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(parts));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}
function encodeCursor(cursor: PageCursor): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}
function decodeCursor(value: string, querySignature: string): PageCursor {
  try {
    const decoded: unknown = JSON.parse(
      new TextDecoder().decode(base64UrlToBytes(value))
    );
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("version" in decoded) ||
      decoded.version !== 1 ||
      !("querySignature" in decoded) ||
      decoded.querySignature !== querySignature ||
      !("lastActiveAtMs" in decoded) ||
      !Number.isSafeInteger(decoded.lastActiveAtMs) ||
      !("ownerUserId" in decoded) ||
      typeof decoded.ownerUserId !== "string" ||
      !("agentControllerRef" in decoded) ||
      typeof decoded.agentControllerRef !== "string" ||
      !("nativeSessionId" in decoded) ||
      typeof decoded.nativeSessionId !== "string"
    ) {
      throw new Error("invalid cursor fields");
    }
    return decoded as PageCursor;
  } catch (error) {
    throw new Error("Agent Activity Session cursor is invalid.", {
      cause: error,
    });
  }
}
function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "");
}
function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(
    normalized.length + ((4 - (normalized.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}
function parseReconciliationResponse(
  value: unknown
): SubmitAgentActivitySessionReconciliationResponse {
  return submitAgentActivitySessionReconciliationResponseSchema.parse(value);
}
