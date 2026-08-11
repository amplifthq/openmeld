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
  db: D1Database;
  slackTeamId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          slack_team_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        FROM openMeldRemoteAgent_slack_workspace_bindings
        WHERE slack_team_id = ?
        LIMIT 1
      `
    )
    .bind(input.slackTeamId)
    .first<RemoteAgentSlackWorkspaceBindingRow>();

  return row ? mapSlackWorkspaceBindingRow(row) : null;
}

export async function readRemoteAgentSlackWorkspaceBindingByOrganization(input: {
  db: D1Database;
  organizationId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          slack_team_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        FROM openMeldRemoteAgent_slack_workspace_bindings
        WHERE organization_id = ?
        ORDER BY updated_at_ms DESC
        LIMIT 1
      `
    )
    .bind(input.organizationId)
    .first<RemoteAgentSlackWorkspaceBindingRow>();

  return row ? mapSlackWorkspaceBindingRow(row) : null;
}

export async function createRemoteAgentSlackWorkspaceBinding(input: {
  atomicWrites?: {
    onCreated?: readonly D1PreparedStatement[];
    onSuccess?: readonly D1PreparedStatement[];
  };
  db: D1Database;
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

  const insertBindingStatement = input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_slack_workspace_bindings (
          slack_team_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?)
      `
    )
    .bind(input.slackTeamId, input.organizationId, input.nowMs, input.nowMs);
  const successStatements = input.atomicWrites?.onSuccess ?? [];
  const createdStatements = input.atomicWrites?.onCreated ?? [];
  try {
    if (successStatements.length === 0 && createdStatements.length === 0) {
      await insertBindingStatement.run();
    } else {
      await input.db.batch([
        insertBindingStatement,
        ...successStatements,
        ...createdStatements,
      ]);
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
  db: D1Database;
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
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed") &&
    error.message.includes("openMeldRemoteAgent_slack_workspace_bindings")
  );
}

async function executeAtomicStatements(
  db: D1Database,
  statements: readonly D1PreparedStatement[]
): Promise<void> {
  if (statements.length === 0) {
    return;
  }
  await db.batch([...statements]);
}

export async function deleteRemoteAgentSlackWorkspaceBindingByOrganization(input: {
  atomicDeleteStatements?: readonly D1PreparedStatement[];
  db: D1Database;
  organizationId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingRecord | null> {
  const existing = await readRemoteAgentSlackWorkspaceBindingByOrganization({
    db: input.db,
    organizationId: input.organizationId,
  });
  if (!existing) {
    return null;
  }

  const deleteBindingStatement = input.db
    .prepare(
      `
        DELETE FROM openMeldRemoteAgent_slack_workspace_bindings
        WHERE organization_id = ?
      `
    )
    .bind(input.organizationId);
  const atomicDeleteStatements = input.atomicDeleteStatements ?? [];
  if (atomicDeleteStatements.length === 0) {
    await deleteBindingStatement.run();
  } else {
    await input.db.batch([deleteBindingStatement, ...atomicDeleteStatements]);
  }
  return existing;
}

export async function moveRemoteAgentSlackWorkspaceBinding(input: {
  atomicMoveStatements: readonly D1PreparedStatement[];
  atomicUnchangedStatements: readonly D1PreparedStatement[];
  db: D1Database;
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
    const unchangedBindingGuardStatement = input.db
      .prepare(
        `
          UPDATE openMeldRemoteAgent_slack_workspace_bindings
          SET updated_at_ms = updated_at_ms
          WHERE slack_team_id = ? AND organization_id = ?
        `
      )
      .bind(input.slackTeamId, input.organizationId);
    await input.db.batch([
      unchangedBindingGuardStatement,
      prepareRequirePreviousStatementChangedOneRow(input.db),
      ...input.atomicUnchangedStatements,
    ]);
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

  const compareAndSwapBindingStatement = input.db
    .prepare(
      `
        UPDATE openMeldRemoteAgent_slack_workspace_bindings
        SET organization_id = ?, created_at_ms = ?, updated_at_ms = ?
        WHERE slack_team_id = ? AND organization_id = ?
      `
    )
    .bind(
      input.organizationId,
      input.nowMs,
      input.nowMs,
      input.slackTeamId,
      input.fromOrganizationId
    );

  await input.db.batch([
    compareAndSwapBindingStatement,
    prepareRequirePreviousStatementChangedOneRow(input.db),
    ...input.atomicMoveStatements,
  ]);

  const record = await readRemoteAgentSlackWorkspaceBinding({
    db: input.db,
    slackTeamId: input.slackTeamId,
  });
  if (!record || record.organizationId !== input.organizationId) {
    throw new Error("Remote Agent Slack workspace move lost its new binding");
  }
  return { record, status: "moved" };
}

function prepareRequirePreviousStatementChangedOneRow(
  db: D1Database
): D1PreparedStatement {
  // D1 batch commits only after every statement succeeds. Turn a zero-row CAS
  // into a constraint failure so token and audit writes cannot follow stale
  // binding evidence inside the same transaction.
  return db.prepare(`
    INSERT INTO openMeldRemoteAgent_slack_workspace_bindings (
      slack_team_id,
      organization_id,
      created_at_ms,
      updated_at_ms
    )
    SELECT NULL, NULL, NULL, NULL
    WHERE changes() != 1
  `);
}

export async function upsertRemoteAgentSlackWorkspaceBinding(input: {
  db: D1Database;
  nowMs: number;
  organizationId: string;
  slackTeamId: string;
}): Promise<RemoteAgentSlackWorkspaceBindingRecord> {
  await input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_slack_workspace_bindings (
          slack_team_id,
          organization_id,
          created_at_ms,
          updated_at_ms
        )
        VALUES (?, ?, ?, ?)
        ON CONFLICT(slack_team_id) DO UPDATE SET
          organization_id = excluded.organization_id,
          updated_at_ms = excluded.updated_at_ms
      `
    )
    .bind(input.slackTeamId, input.organizationId, input.nowMs, input.nowMs)
    .run();

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
