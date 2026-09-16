import type {
  ConnectorConnectionName,
  ConnectorConnectionPreference,
  ConnectorConnectionStatus,
  ConnectorService,
} from "@openmeld/schemas";

const CONNECTION_HASH_LENGTH = 18;
const CONNECTION_NAME_MAX_LENGTH = 64;
const BASE64_PADDING_PATTERN = /=+$/u;

export type ConnectorConnectionRecord = {
  connectionName: ConnectorConnectionName;
  createdAtMs: number;
  disconnectedAtMs: number | null;
  organizationId: string;
  scope: "member" | "shared";
  service: ConnectorService;
  status: ConnectorConnectionStatus;
  updatedAtMs: number;
  userId: string;
};

export type ConnectorExecutionConnectionRecord = ConnectorConnectionRecord;

type ConnectorConnectionRow = {
  connection_name: string;
  created_at_ms: number;
  disconnected_at_ms: number | null;
  organization_id: string;
  scope: string;
  service: string;
  status: string;
  updated_at_ms: number;
  user_id: string;
};

type ConnectorExecutionConnectionRow = ConnectorConnectionRow;

export async function createConnectorConnectionName(input: {
  organizationId: string;
  service: ConnectorService;
  userId: string;
}): Promise<ConnectorConnectionName> {
  const [organizationHash, userHash] = await Promise.all([
    createStableIdentifierHash(input.organizationId),
    createStableIdentifierHash(input.userId),
  ]);
  return await buildConnectorConnectionName({
    prefix: `org_${organizationHash}__user_${userHash}__`,
    service: input.service,
  });
}

export async function createSharedConnectorConnectionName(input: {
  organizationId: string;
  service: ConnectorService;
}): Promise<ConnectorConnectionName> {
  const organizationHash = await createStableIdentifierHash(
    input.organizationId
  );
  return await buildConnectorConnectionName({
    prefix: `org_${organizationHash}__shared__`,
    service: input.service,
  });
}

async function buildConnectorConnectionName(input: {
  prefix: string;
  service: ConnectorService;
}): Promise<ConnectorConnectionName> {
  const readableName = `${input.prefix}${input.service}`;
  if (readableName.length <= CONNECTION_NAME_MAX_LENGTH) {
    return readableName as ConnectorConnectionName;
  }
  const availableServiceLength =
    CONNECTION_NAME_MAX_LENGTH - input.prefix.length;
  const serviceHash = await createStableIdentifierHash(input.service);
  return `${input.prefix}${serviceHash.slice(0, availableServiceLength)}` as ConnectorConnectionName;
}

export async function upsertPendingConnectorConnection(input: {
  connectionName: ConnectorConnectionName;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  service: ConnectorService;
  userId: string;
}): Promise<ConnectorConnectionRecord> {
  await input.db
    .prepare(
      `
        INSERT INTO connector_connections (
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms
        ) VALUES (?, ?, ?, 'member', ?, 'pending', ?, ?, NULL)
        ON CONFLICT(organization_id, scope, user_id, service) DO UPDATE SET
          connection_name = excluded.connection_name,
          status = 'pending',
          updated_at_ms = excluded.updated_at_ms,
          disconnected_at_ms = NULL
      `
    )
    .bind(
      input.connectionName,
      input.organizationId,
      input.userId,
      input.service,
      input.nowMs,
      input.nowMs
    )
    .run();
  return await requireConnectorConnection({
    connectionName: input.connectionName,
    db: input.db,
    organizationId: input.organizationId,
  });
}

export async function upsertPendingSharedConnectorConnection(input: {
  auditStatement?: D1PreparedStatement;
  connectionName: ConnectorConnectionName;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  service: ConnectorService;
  userId: string;
}): Promise<ConnectorConnectionRecord> {
  const upsertStatement = input.db
    .prepare(
      `
        INSERT INTO connector_connections (
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms
        ) VALUES (?, ?, ?, 'shared', ?, 'pending', ?, ?, NULL)
        ON CONFLICT(organization_id, service) WHERE scope = 'shared' DO UPDATE SET
          connection_name = excluded.connection_name,
          user_id = excluded.user_id,
          status = 'pending',
          updated_at_ms = excluded.updated_at_ms,
          disconnected_at_ms = NULL
      `
    )
    .bind(
      input.connectionName,
      input.organizationId,
      input.userId,
      input.service,
      input.nowMs,
      input.nowMs
    );
  if (input.auditStatement) {
    await input.db.batch([upsertStatement, input.auditStatement]);
  } else {
    await upsertStatement.run();
  }
  return await requireConnectorConnection({
    connectionName: input.connectionName,
    db: input.db,
    organizationId: input.organizationId,
  });
}

export async function listConnectorConnections(input: {
  db: D1Database;
  organizationId: string;
  service?: ConnectorService;
  userId?: string;
}): Promise<ConnectorConnectionRecord[]> {
  const userClause = input.userId
    ? "AND (connection.scope = 'shared' OR connection.user_id = ?)"
    : "";
  const serviceClause = input.service ? "AND connection.service = ?" : "";
  const bindings = [
    input.organizationId,
    ...(input.service ? [input.service] : []),
    ...(input.userId ? [input.userId] : []),
  ];
  const result = await input.db
    .prepare(
      `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = ?
          ${serviceClause}
          ${userClause}
        ORDER BY connection.created_at_ms ASC, connection.connection_name ASC
      `
    )
    .bind(...bindings)
    .all<ConnectorConnectionRow>();
  return result.results.map(toConnectorConnectionRecord);
}

export async function reconcileConnectorConnections(input: {
  availableConnectionNames: readonly ConnectorConnectionName[];
  db: D1Database;
  nowMs: number;
  organizationId: string;
  service: ConnectorService;
}): Promise<void> {
  const availablePlaceholders = input.availableConnectionNames
    .map(() => "?")
    .join(", ");
  const deactivateMissingConnections = input.db
    .prepare(
      `
        UPDATE connector_connections
        SET status = 'pending', updated_at_ms = ?, disconnected_at_ms = NULL
        WHERE organization_id = ?
          AND service = ?
          AND status = 'active'
          ${
            availablePlaceholders
              ? `AND connection_name NOT IN (${availablePlaceholders})`
              : ""
          }
      `
    )
    .bind(
      input.nowMs,
      input.organizationId,
      input.service,
      ...input.availableConnectionNames
    );
  if (input.availableConnectionNames.length === 0) {
    await deactivateMissingConnections.run();
    return;
  }
  const activateAvailableConnections = input.db
    .prepare(
      `
        UPDATE connector_connections
        SET status = 'active', updated_at_ms = ?, disconnected_at_ms = NULL
        WHERE organization_id = ?
          AND service = ?
          AND status != 'disconnected'
          AND connection_name IN (${availablePlaceholders})
      `
    )
    .bind(
      input.nowMs,
      input.organizationId,
      input.service,
      ...input.availableConnectionNames
    );
  await input.db.batch([
    deactivateMissingConnections,
    activateAvailableConnections,
  ]);
}

export async function requireConnectorConnection(input: {
  connectionName: ConnectorConnectionName;
  db: D1Database;
  organizationId: string;
}): Promise<ConnectorConnectionRecord> {
  const row = await input.db
    .prepare(
      `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = ?
          AND connection.connection_name = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.connectionName)
    .first<ConnectorConnectionRow>();
  if (!row) {
    throw new Error("Connector connection was not found in this Organization.");
  }
  return toConnectorConnectionRecord(row);
}

export async function requireConnectorConnectionForExecution(input: {
  connectionName: ConnectorConnectionName;
  db: D1Database;
  organizationId: string;
}): Promise<ConnectorExecutionConnectionRecord> {
  const row = await input.db
    .prepare(
      `
        SELECT
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms
        FROM connector_connections
        WHERE organization_id = ?
          AND connection_name = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.connectionName)
    .first<ConnectorExecutionConnectionRow>();
  if (!row) {
    throw new Error("Connector connection was not found in this Organization.");
  }
  return toConnectorExecutionConnectionRecord(row);
}

export async function readConnectorConnectionForUser(input: {
  db: D1Database;
  organizationId: string;
  service: ConnectorService;
  userId: string;
}): Promise<ConnectorConnectionRecord | null> {
  const row = await input.db
    .prepare(
      `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = ?
          AND connection.user_id = ?
          AND connection.scope = 'member'
          AND connection.service = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.userId, input.service)
    .first<ConnectorConnectionRow>();
  return row ? toConnectorConnectionRecord(row) : null;
}

export async function readSharedConnectorConnection(input: {
  db: D1Database;
  organizationId: string;
  service: ConnectorService;
}): Promise<ConnectorConnectionRecord | null> {
  const row = await input.db
    .prepare(
      `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = ?
          AND connection.scope = 'shared'
          AND connection.service = ?
        LIMIT 1
      `
    )
    .bind(input.organizationId, input.service)
    .first<ConnectorConnectionRow>();
  return row ? toConnectorConnectionRecord(row) : null;
}

export async function markConnectorConnectionDisconnected(input: {
  auditStatement?: D1PreparedStatement;
  connectionName: ConnectorConnectionName;
  db: D1Database;
  nowMs: number;
  organizationId: string;
}): Promise<ConnectorConnectionRecord> {
  const disconnectStatement = input.db
    .prepare(
      `
        UPDATE connector_connections
        SET status = 'disconnected', updated_at_ms = ?, disconnected_at_ms = ?
        WHERE organization_id = ?
          AND connection_name = ?
      `
    )
    .bind(input.nowMs, input.nowMs, input.organizationId, input.connectionName);
  const result = input.auditStatement
    ? (await input.db.batch([disconnectStatement, input.auditStatement]))[0]
    : await disconnectStatement.run();
  if (result?.meta.changes !== 1) {
    throw new Error("Connector connection was not found in this Organization.");
  }
  return await requireConnectorConnection({
    connectionName: input.connectionName,
    db: input.db,
    organizationId: input.organizationId,
  });
}

export async function selectActiveConnectorConnection(input: {
  db: D1Database;
  organizationId: string;
  preference: ConnectorConnectionPreference;
  requesterUserId: string | null;
  service: ConnectorService;
}): Promise<{
  connection: ConnectorConnectionRecord;
  selection: "requester" | "shared";
} | null> {
  let exactScopeSql: string;
  if (input.preference === "shared") {
    exactScopeSql = "connection.scope = 'shared'";
  } else if (input.preference === "requester") {
    exactScopeSql = `
      connection.scope = 'member'
      AND connection.user_id = ?
    `;
  } else {
    exactScopeSql = `
      (
        connection.scope = 'shared'
        OR (
          connection.scope = 'member'
          AND connection.user_id = ?
        )
      )
    `;
  }
  const bindings =
    input.preference === "shared"
      ? [input.organizationId, input.service]
      : [input.organizationId, input.service, input.requesterUserId];
  const row = await input.db
    .prepare(
      `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = ?
          AND connection.service = ?
          AND connection.status = 'active'
          AND (${exactScopeSql})
        ORDER BY
          CASE connection.scope WHEN 'member' THEN 0 ELSE 1 END ASC,
          connection.created_at_ms ASC,
          connection.connection_name ASC
        LIMIT 1
      `
    )
    .bind(...bindings)
    .first<ConnectorConnectionRow>();
  if (!row) {
    return null;
  }
  const connection = toConnectorConnectionRecord(row);
  return {
    connection,
    selection: connection.scope === "member" ? "requester" : "shared",
  };
}

const connectorConnectionSelectSql = `
  SELECT
    connection.connection_name,
    connection.organization_id,
    connection.user_id,
    connection.scope,
    connection.service,
    connection.status,
    connection.created_at_ms,
    connection.updated_at_ms,
    connection.disconnected_at_ms
  FROM connector_connections connection
`;

async function createStableIdentifierHash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  const bytes = new Uint8Array(digest);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(BASE64_PADDING_PATTERN, "")
    .slice(0, CONNECTION_HASH_LENGTH);
}

function toConnectorConnectionRecord(
  row: ConnectorConnectionRow
): ConnectorConnectionRecord {
  return {
    connectionName: row.connection_name as ConnectorConnectionName,
    createdAtMs: row.created_at_ms,
    disconnectedAtMs: row.disconnected_at_ms,
    organizationId: row.organization_id,
    scope: requireConnectorConnectionScope(row.scope),
    service: row.service as ConnectorService,
    status: row.status as ConnectorConnectionStatus,
    updatedAtMs: row.updated_at_ms,
    userId: row.user_id,
  };
}

function toConnectorExecutionConnectionRecord(
  row: ConnectorExecutionConnectionRow
): ConnectorExecutionConnectionRecord {
  return {
    connectionName: row.connection_name as ConnectorConnectionName,
    createdAtMs: row.created_at_ms,
    disconnectedAtMs: row.disconnected_at_ms,
    organizationId: row.organization_id,
    scope: requireConnectorConnectionScope(row.scope),
    service: row.service as ConnectorService,
    status: row.status as ConnectorConnectionStatus,
    updatedAtMs: row.updated_at_ms,
    userId: row.user_id,
  };
}

function requireConnectorConnectionScope(
  value: string
): ConnectorConnectionRecord["scope"] {
  if (value === "member" || value === "shared") {
    return value;
  }
  throw new Error(`Invalid connector connection scope: ${value}`);
}
