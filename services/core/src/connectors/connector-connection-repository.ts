import type { PostgresDatabase, QueryConfig } from "@openmeld/db/postgresql";
import type {
  ConnectorConnectionName,
  ConnectorConnectionPreference,
  ConnectorConnectionStatus,
  ConnectorService,
  PluginAccessPolicy,
} from "@openmeld/schemas/types";

const CONNECTION_HASH_LENGTH = 18;
const CONNECTION_NAME_MAX_LENGTH = 64;
const BASE64_PADDING_PATTERN = /=+$/u;
// Only new registrations receive this policy. Historical null and explicitly
// saved policies on the same registration retain their existing meaning.
const NEW_CONNECTION_ACCESS_POLICY = JSON.stringify({
  center_agent: "none",
  local_agent: "none",
  remote_agent: "none",
} satisfies PluginAccessPolicy);
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
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  service: ConnectorService;
  userId: string;
}): Promise<ConnectorConnectionRecord> {
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."connector_connections" (
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms,
          access_policy
        ) VALUES ($1, $2, $3, 'member', $4, 'pending', $5, $6, NULL, $7)
        ON CONFLICT(organization_id, scope, user_id, service) DO UPDATE SET
          connection_name = excluded.connection_name,
          status = 'pending',
          updated_at_ms = excluded.updated_at_ms,
          access_revision = connector_connections.access_revision + 1,
          disconnected_at_ms = NULL
      `,
    values: [
      input.connectionName,
      input.organizationId,
      input.userId,
      input.service,
      input.nowMs,
      input.nowMs,
      NEW_CONNECTION_ACCESS_POLICY,
    ],
  });
  return await requireConnectorConnection({
    connectionName: input.connectionName,
    db: input.db,
    organizationId: input.organizationId,
  });
}
export async function upsertPendingSharedConnectorConnection(input: {
  auditStatement?: QueryConfig;
  connectionName: ConnectorConnectionName;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  service: ConnectorService;
  userId: string;
}): Promise<ConnectorConnectionRecord> {
  const upsertStatement = {
    text: `
        INSERT INTO "openmeld"."connector_connections" (
          connection_name,
          organization_id,
          user_id,
          scope,
          service,
          status,
          created_at_ms,
          updated_at_ms,
          disconnected_at_ms,
          access_policy
        ) VALUES ($1, $2, $3, 'shared', $4, 'pending', $5, $6, NULL, $7)
        ON CONFLICT(organization_id, service) WHERE scope = 'shared' DO UPDATE SET
          connection_name = excluded.connection_name,
          user_id = excluded.user_id,
          status = 'pending',
          updated_at_ms = excluded.updated_at_ms,
          access_revision = connector_connections.access_revision + 1,
          disconnected_at_ms = NULL
      `,
    values: [
      input.connectionName,
      input.organizationId,
      input.userId,
      input.service,
      input.nowMs,
      input.nowMs,
      NEW_CONNECTION_ACCESS_POLICY,
    ],
  };
  const auditStatement = input.auditStatement;
  if (auditStatement) {
    await input.db.transaction(async (client) => {
      if ((await client.query(upsertStatement)).rowCount === 1) {
        await client.query(auditStatement);
      }
    });
  } else {
    await input.db.query(upsertStatement);
  }
  return await requireConnectorConnection({
    connectionName: input.connectionName,
    db: input.db,
    organizationId: input.organizationId,
  });
}
export async function listConnectorConnections(input: {
  db: PostgresDatabase;
  organizationId: string;
  service?: ConnectorService;
  userId?: string;
}): Promise<ConnectorConnectionRecord[]> {
  const userClause = input.userId
    ? "AND (connection.scope = 'shared' OR connection.user_id = $1)"
    : "";
  const serviceClause = input.service ? "AND connection.service = $1" : "";
  const bindings = [
    input.organizationId,
    ...(input.service ? [input.service] : []),
    ...(input.userId ? [input.userId] : []),
  ];
  const result = await input.db.query<ConnectorConnectionRow>({
    text: `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = $1
          ${serviceClause}
          ${userClause}
        ORDER BY connection.created_at_ms ASC NULLS FIRST, connection.connection_name ASC NULLS FIRST
      `,
    values: [...bindings],
  });
  return result.rows.map(toConnectorConnectionRecord);
}
export async function reconcileConnectorConnections(input: {
  availableConnectionNames: readonly ConnectorConnectionName[];
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  service: ConnectorService;
}): Promise<void> {
  const deactivateMissingConnections = {
    text: `
        UPDATE "openmeld"."connector_connections"
        SET status = 'pending', updated_at_ms = $1, disconnected_at_ms = NULL
        WHERE organization_id = $2
          AND service = $3
          AND status = 'active'
          AND NOT (connection_name = ANY($4::text[]))
      `,
    values: [
      input.nowMs,
      input.organizationId,
      input.service,
      input.availableConnectionNames,
    ],
  };
  if (input.availableConnectionNames.length === 0) {
    await input.db.query(deactivateMissingConnections);
    return;
  }
  const activateAvailableConnections = {
    text: `
        UPDATE "openmeld"."connector_connections"
        SET status = 'active', updated_at_ms = $1, disconnected_at_ms = NULL
        WHERE organization_id = $2
          AND service = $3
          AND status = 'pending'
          AND connection_name = ANY($4::text[])
      `,
    values: [
      input.nowMs,
      input.organizationId,
      input.service,
      input.availableConnectionNames,
    ],
  };
  await input.db.transaction(
    async (client) =>
      [
        await client.query(deactivateMissingConnections),
        await client.query(activateAvailableConnections),
      ] as const
  );
}
export async function requireConnectorConnection(input: {
  connectionName: ConnectorConnectionName;
  db: PostgresDatabase;
  organizationId: string;
}): Promise<ConnectorConnectionRecord> {
  const row = await input.db
    .query<ConnectorConnectionRow>({
      text: `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = $1
          AND connection.connection_name = $2
        LIMIT 1
      `,
      values: [input.organizationId, input.connectionName],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    throw new Error("Connector connection was not found in this Organization.");
  }
  return toConnectorConnectionRecord(row);
}
export async function requireConnectorConnectionForExecution(input: {
  connectionName: ConnectorConnectionName;
  db: PostgresDatabase;
  organizationId: string;
}): Promise<ConnectorExecutionConnectionRecord> {
  const row = await input.db
    .query<ConnectorExecutionConnectionRow>({
      text: `
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
        FROM "openmeld"."connector_connections"
        WHERE organization_id = $1
          AND connection_name = $2
        LIMIT 1
      `,
      values: [input.organizationId, input.connectionName],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    throw new Error("Connector connection was not found in this Organization.");
  }
  return toConnectorExecutionConnectionRecord(row);
}
export async function readConnectorConnectionForUser(input: {
  db: PostgresDatabase;
  organizationId: string;
  service: ConnectorService;
  userId: string;
}): Promise<ConnectorConnectionRecord | null> {
  const row = await input.db
    .query<ConnectorConnectionRow>({
      text: `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = $1
          AND connection.user_id = $2
          AND connection.scope = 'member'
          AND connection.service = $3
        LIMIT 1
      `,
      values: [input.organizationId, input.userId, input.service],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? toConnectorConnectionRecord(row) : null;
}
export async function readSharedConnectorConnection(input: {
  db: PostgresDatabase;
  organizationId: string;
  service: ConnectorService;
}): Promise<ConnectorConnectionRecord | null> {
  const row = await input.db
    .query<ConnectorConnectionRow>({
      text: `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = $1
          AND connection.scope = 'shared'
          AND connection.service = $2
        LIMIT 1
      `,
      values: [input.organizationId, input.service],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? toConnectorConnectionRecord(row) : null;
}
export async function markConnectorConnectionDisconnected(input: {
  auditStatement?: QueryConfig;
  connectionName: ConnectorConnectionName;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
}): Promise<ConnectorConnectionRecord> {
  const disconnectStatement = {
    text: `
        UPDATE "openmeld"."connector_connections"
        SET status = 'disconnected', updated_at_ms = $1, disconnected_at_ms = $2
        WHERE organization_id = $3
          AND connection_name = $4
      `,
    values: [
      input.nowMs,
      input.nowMs,
      input.organizationId,
      input.connectionName,
    ],
  };
  const auditStatement = input.auditStatement;
  const result = auditStatement
    ? await input.db.transaction(async (client) => {
        const mutation = await client.query(disconnectStatement);
        if (mutation.rowCount === 1) {
          await client.query(auditStatement);
        }
        return mutation;
      })
    : await input.db.query(disconnectStatement);
  if (result.rowCount !== 1) {
    throw new Error("Connector connection was not found in this Organization.");
  }
  return await requireConnectorConnection({
    connectionName: input.connectionName,
    db: input.db,
    organizationId: input.organizationId,
  });
}
export async function selectActiveConnectorConnection(input: {
  db: PostgresDatabase;
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
      AND connection.user_id = $3
    `;
  } else {
    exactScopeSql = `
      (
        connection.scope = 'shared'
        OR (
          connection.scope = 'member'
          AND connection.user_id = $3
        )
      )
    `;
  }
  const bindings =
    input.preference === "shared"
      ? [input.organizationId, input.service]
      : [input.organizationId, input.service, input.requesterUserId];
  const row = await input.db
    .query<ConnectorConnectionRow>({
      text: `
        ${connectorConnectionSelectSql}
        WHERE connection.organization_id = $1
          AND connection.service = $2
          AND connection.status = 'active'
          AND (${exactScopeSql})
        ORDER BY
          CASE connection.scope WHEN 'member' THEN 0 ELSE 1 END ASC NULLS FIRST,
          connection.created_at_ms ASC NULLS FIRST,
          connection.connection_name ASC NULLS FIRST
        LIMIT 1
      `,
      values: [...bindings],
    })
    .then((result) => result.rows[0] ?? null);
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
  FROM "openmeld"."connector_connections" connection
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
