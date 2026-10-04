import {
  isPostgresUniqueViolation,
  type PostgresDatabase,
  type QueryConfig,
} from "@openmeld/db/postgresql";
export type RemoteAgentSlackWorkspaceBindingRecord = {
  createdAtMs: number;
  organizationId: string;
  slackTeamId: string;
  updatedAtMs: number;
};
export type RemoteAgentSlackWorkspaceBindingCreateResult =
  | {
      record: RemoteAgentSlackWorkspaceBindingRecord;
      status: "created" | "unchanged";
    }
  | {
      existing: RemoteAgentSlackWorkspaceBindingRecord;
      status: "workspace_already_bound" | "organization_already_bound";
    };
export type RemoteAgentSlackWorkspaceBindingMoveResult =
  | {
      record: RemoteAgentSlackWorkspaceBindingRecord;
      status: "moved" | "unchanged";
    }
  | {
      existing: RemoteAgentSlackWorkspaceBindingRecord;
      status: "workspace_already_bound" | "organization_already_bound";
    };
type RemoteAgentSlackWorkspaceBindingRow = {
  created_at_ms: number;
  organization_id: string;
  slack_team_id: string;
  updated_at_ms: number;
};
export async function readRemoteAgentSlackWorkspaceBinding(input: {
  db: PostgresDatabase;
  slackTeamId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingRecord | null> {
  const row = await input.db
    .query<RemoteAgentSlackWorkspaceBindingRow>({
      text: `
        SELECT
          slack_team_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
        WHERE slack_team_id = $1
        LIMIT 1
      `,
      values: [input.slackTeamId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapSlackWorkspaceBindingRow(row) : null;
}
export async function readRemoteAgentSlackWorkspaceBindingByOrganization(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingRecord | null> {
  const row = await input.db
    .query<RemoteAgentSlackWorkspaceBindingRow>({
      text: `
        SELECT
          slack_team_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
        WHERE organization_id = $1
        ORDER BY updated_at_ms DESC NULLS LAST
        LIMIT 1
      `,
      values: [input.organizationId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapSlackWorkspaceBindingRow(row) : null;
}
export async function createRemoteAgentSlackWorkspaceBinding(input: {
  atomicWrites?: {
    onCreated?: readonly QueryConfig[];
    onSuccess?: readonly QueryConfig[];
  };
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingCreateResult> {
  const existingTeamBinding = await readRemoteAgentSlackWorkspaceBinding({
    db: input.db,
    slackTeamId: input.slackTeamId,
  });
  if (existingTeamBinding) {
    if (existingTeamBinding.organizationId === input.organizationId) {
      await executeAtomicStatements(
        input.db,
        input.atomicWrites?.onSuccess ?? []
      );
      return { record: existingTeamBinding, status: "unchanged" };
    }
    return {
      existing: existingTeamBinding,
      status: "workspace_already_bound",
    };
  }
  const existingOrganizationBinding =
    await readRemoteAgentSlackWorkspaceBindingByOrganization({
      db: input.db,
      organizationId: input.organizationId,
    });
  if (existingOrganizationBinding) {
    return {
      existing: existingOrganizationBinding,
      status: "organization_already_bound",
    };
  }
  const insertBindingStatement = {
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_slack_workspace_bindings" (
          slack_team_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4)
      `,
    values: [input.slackTeamId, input.organizationId, input.nowMs, input.nowMs],
  };
  const successStatements = input.atomicWrites?.onSuccess ?? [];
  const createdStatements = input.atomicWrites?.onCreated ?? [];
  try {
    if (successStatements.length === 0 && createdStatements.length === 0) {
      await input.db.query(insertBindingStatement);
    } else {
      await input.db.transaction(async (client) =>
        Promise.all([
          client.query(insertBindingStatement),
          ...successStatements.map((query) => client.query(query)),
          ...createdStatements.map((query) => client.query(query)),
        ])
      );
    }
  } catch (error) {
    const raceOutcome =
      await resolveRemoteAgentSlackWorkspaceBindingRaceOutcome({
        db: input.db,
        error,
        organizationId: input.organizationId,
        slackTeamId: input.slackTeamId,
      });
    if (raceOutcome) {
      return raceOutcome;
    }
    throw error;
  }
  const record = await readRemoteAgentSlackWorkspaceBinding({
    db: input.db,
    slackTeamId: input.slackTeamId,
  });
  if (!record) {
    throw new Error("Remote Agent Slack workspace binding write lost its row");
  }
  return { record, status: "created" };
}
/**
 * A concurrent request can insert a conflicting binding between this
 * function's prechecks and its INSERT. Reclassify that race the same way
 * the prechecks would have, instead of surfacing a raw constraint error.
 */
async function resolveRemoteAgentSlackWorkspaceBindingRaceOutcome(input: {
  db: PostgresDatabase;
  error: unknown;
  organizationId: string;
  slackTeamId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingCreateResult | null> {
  if (!isRemoteAgentSlackWorkspaceBindingUniqueConstraintError(input.error)) {
    return null;
  }
  const [teamBinding, organizationBinding] = await Promise.all([
    readRemoteAgentSlackWorkspaceBinding({
      db: input.db,
      slackTeamId: input.slackTeamId,
    }),
    readRemoteAgentSlackWorkspaceBindingByOrganization({
      db: input.db,
      organizationId: input.organizationId,
    }),
  ]);
  if (teamBinding && teamBinding.organizationId !== input.organizationId) {
    return { existing: teamBinding, status: "workspace_already_bound" };
  }
  if (
    organizationBinding &&
    organizationBinding.slackTeamId !== input.slackTeamId
  ) {
    return {
      existing: organizationBinding,
      status: "organization_already_bound",
    };
  }
  return null;
}
function isRemoteAgentSlackWorkspaceBindingUniqueConstraintError(
  error: unknown
): boolean {
  return (
    isPostgresUniqueViolation(
      error,
      "openMeldRemoteAgent_slack_workspace_org_unique"
    ) ||
    isPostgresUniqueViolation(
      error,
      "openMeldRemoteAgent_slack_workspace_bindings_pkey"
    )
  );
}
async function executeAtomicStatements(
  db: PostgresDatabase,
  statements: readonly QueryConfig[]
): Promise<void> {
  if (statements.length === 0) {
    return;
  }
  await db.transaction(async (client) =>
    Promise.all([...statements.map((query) => client.query(query))])
  );
}
export async function deleteRemoteAgentSlackWorkspaceBindingByOrganization(input: {
  atomicDeleteStatements?: readonly QueryConfig[];
  db: PostgresDatabase;
  organizationId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingRecord | null> {
  const existing = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: input.db,
    organizationId: input.organizationId,
  });
  if (!existing) {
    return null;
  }
  const deleteBindingStatement = {
    text: `
        DELETE FROM "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
        WHERE organization_id = $1
      `,
    values: [input.organizationId],
  };
  const atomicDeleteStatements = input.atomicDeleteStatements ?? [];
  if (atomicDeleteStatements.length === 0) {
    await input.db.query(deleteBindingStatement);
  } else {
    await input.db.transaction(async (client) =>
      Promise.all([
        client.query(deleteBindingStatement),
        ...atomicDeleteStatements.map((query) => client.query(query)),
      ])
    );
  }
  return existing;
}
export async function moveRemoteAgentSlackWorkspaceBinding(input: {
  atomicMoveStatements: readonly QueryConfig[];
  atomicUnchangedStatements: readonly QueryConfig[];
  db: PostgresDatabase;
  fromOrganizationId: string;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingMoveResult> {
  const existingTeamBinding = await readRemoteAgentSlackWorkspaceBinding({
    db: input.db,
    slackTeamId: input.slackTeamId,
  });
  if (!existingTeamBinding) {
    throw new Error(
      "The Slack workspace is no longer connected to the expected organization"
    );
  }
  if (existingTeamBinding.organizationId === input.organizationId) {
    const unchangedBindingGuardStatement = {
      text: `
          UPDATE "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
          SET updated_at_ms = updated_at_ms
          WHERE slack_team_id = $1 AND organization_id = $2
        `,
      values: [input.slackTeamId, input.organizationId],
    };
    await input.db.transaction(async (client) => {
      if ((await client.query(unchangedBindingGuardStatement)).rowCount !== 1) {
        throw new Error("Slack workspace binding changed concurrently.");
      }
      for (const statement of input.atomicUnchangedStatements) {
        await client.query(statement);
      }
    });
    return { record: existingTeamBinding, status: "unchanged" };
  }
  if (existingTeamBinding.organizationId !== input.fromOrganizationId) {
    return {
      existing: existingTeamBinding,
      status: "workspace_already_bound",
    };
  }
  const existingOrganizationBinding =
    await readRemoteAgentSlackWorkspaceBindingByOrganization({
      db: input.db,
      organizationId: input.organizationId,
    });
  if (existingOrganizationBinding) {
    return {
      existing: existingOrganizationBinding,
      status: "organization_already_bound",
    };
  }
  const compareAndSwapBindingStatement = {
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_slack_workspace_bindings"
        SET organization_id = $1, created_at_ms = $2, updated_at_ms = $3
        WHERE slack_team_id = $4 AND organization_id = $5
      `,
    values: [
      input.organizationId,
      input.nowMs,
      input.nowMs,
      input.slackTeamId,
      input.fromOrganizationId,
    ],
  };
  await input.db.transaction(async (client) => {
    if ((await client.query(compareAndSwapBindingStatement)).rowCount !== 1) {
      throw new Error(
        "Slack workspace binding changed concurrently; move was rolled back."
      );
    }
    for (const statement of input.atomicMoveStatements) {
      await client.query(statement);
    }
  });
  const record = await readRemoteAgentSlackWorkspaceBinding({
    db: input.db,
    slackTeamId: input.slackTeamId,
  });
  if (!record || record.organizationId !== input.organizationId) {
    throw new Error("Remote Agent Slack workspace move lost its new binding");
  }
  return { record, status: "moved" };
}
export async function upsertRemoteAgentSlackWorkspaceBinding(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingRecord> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."openMeldRemoteAgent_slack_workspace_bindings" (
          slack_team_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT(slack_team_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [input.slackTeamId, input.organizationId, input.nowMs, input.nowMs],
  });
  const record = await readRemoteAgentSlackWorkspaceBinding({
    db: input.db,
    slackTeamId: input.slackTeamId,
  });
  if (!record) {
    throw new Error("Remote Agent Slack workspace binding write lost its row");
  }
  return record;
}
function mapSlackWorkspaceBindingRow(
  row: RemoteAgentSlackWorkspaceBindingRow
): RemoteAgentSlackWorkspaceBindingRecord {
  return {
    createdAtMs: row.created_at_ms,
    organizationId: row.organization_id,
    slackTeamId: row.slack_team_id,
    updatedAtMs: row.updated_at_ms,
  };
}
