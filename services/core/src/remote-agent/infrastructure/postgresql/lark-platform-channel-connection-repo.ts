import type {
  PostgresDatabase,
  QueryConfig,
  QueryResult,
} from "@openmeld/db/postgresql";
import type { MessageChannelConnectionStatus } from "@openmeld/schemas/types";
export type RemoteAgentLarkPlatformProvider = "feishu" | "lark";
export type RemoteAgentLarkPlatformTransport = "webhook" | "websocket";
export type RemoteAgentLarkPlatformWebhookSurface = "callbacks" | "events";
export type RemoteAgentLarkPlatformChannelConnectionRecord = {
  appId: string;
  botName: string | null;
  botOpenId: string | null;
  callbacksWebhookVerifiedAtMs: number | null;
  connectionGeneration: number;
  connectionId: string;
  createdAtMs: number;
  eventsWebhookVerifiedAtMs: number | null;
  failureReasonCode: string | null;
  grantedCapabilityGroups: readonly string[];
  installedByUserId: string;
  lastVerifiedAtMs: number | null;
  organizationId: string;
  permissionBundleVersion: string;
  provider: RemoteAgentLarkPlatformProvider;
  status: MessageChannelConnectionStatus;
  tenantKey: string | null;
  transport: RemoteAgentLarkPlatformTransport;
  updatedAtMs: number;
};
export type RemoteAgentLarkPlatformChannelCredentialsRecord = {
  connectionId: string;
  createdAtMs: number;
  credentialFormatVersion: number;
  encryptedAppSecret: string;
  encryptedEventEncryptKey: string | null;
  encryptedVerificationToken: string | null;
  updatedAtMs: number;
};
type RemoteAgentLarkPlatformChannelConnectionRow = {
  app_id: string;
  bot_name: string | null;
  bot_open_id: string | null;
  callbacks_webhook_verified_at_ms: number | null;
  connection_generation: number;
  connection_id: string;
  created_at_ms: number;
  events_webhook_verified_at_ms: number | null;
  failure_reason_code: string | null;
  granted_capability_groups_json: string;
  installed_by_user_id: string;
  last_verified_at_ms: number | null;
  organization_id: string;
  permission_bundle_version: string;
  provider: RemoteAgentLarkPlatformProvider;
  status: MessageChannelConnectionStatus;
  tenant_key: string | null;
  transport: RemoteAgentLarkPlatformTransport;
  updated_at_ms: number;
};
type RemoteAgentLarkPlatformChannelCredentialsRow = {
  connection_id: string;
  created_at_ms: number;
  credential_format_version: number;
  encrypted_app_secret: string;
  encrypted_event_encrypt_key: string | null;
  encrypted_verification_token: string | null;
  updated_at_ms: number;
};
const CAPABILITY_GROUP_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/u;
const CONNECTION_SELECT = `
  SELECT
    connection_id,
    organization_id,
    provider,
    app_id,
    tenant_key,
    bot_open_id,
    bot_name,
    callbacks_webhook_verified_at_ms,
    transport,
    status,
    installed_by_user_id,
    permission_bundle_version,
    granted_capability_groups_json,
    connection_generation,
    events_webhook_verified_at_ms,
    last_verified_at_ms,
    failure_reason_code,
    created_at_ms,
    updated_at_ms
  FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
`;
export async function readRemoteAgentLarkPlatformChannelConnection(input: {
  connectionId: string;
  db: PostgresDatabase;
}): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null> {
  const row = await input.db
    .query<RemoteAgentLarkPlatformChannelConnectionRow>({
      text: `${CONNECTION_SELECT} WHERE connection_id = $1 LIMIT 1`,
      values: [input.connectionId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapConnectionRow(row) : null;
}
export type LarkPlatformWebhookCredentials = Pick<
  RemoteAgentLarkPlatformChannelCredentialsRecord,
  | "credentialFormatVersion"
  | "encryptedEventEncryptKey"
  | "encryptedVerificationToken"
>;
/** Read the current connection and its verification material in one D1 round trip. */
export async function readRemoteAgentLarkPlatformWebhookContext(input: {
  connectionId: string;
  db: PostgresDatabase;
}): Promise<{
  connection: RemoteAgentLarkPlatformChannelConnectionRecord;
  credentials: LarkPlatformWebhookCredentials | null;
} | null> {
  const row = await input.db
    .query<
      RemoteAgentLarkPlatformChannelConnectionRow & {
        credential_format_version: number | null;
        encrypted_event_encrypt_key: string | null;
        encrypted_verification_token: string | null;
      }
    >({
      text: `
    SELECT connection.*, credentials.credential_format_version,
      credentials.encrypted_event_encrypt_key,
      credentials.encrypted_verification_token
    FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections" connection
    LEFT JOIN "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials" credentials
      ON credentials.connection_id = connection.connection_id
    WHERE connection.connection_id = $1 LIMIT 1
  `,
      values: [input.connectionId],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    return null;
  }
  return {
    connection: mapConnectionRow(row),
    credentials:
      row.credential_format_version === null
        ? null
        : {
            credentialFormatVersion: row.credential_format_version,
            encryptedEventEncryptKey: row.encrypted_event_encrypt_key,
            encryptedVerificationToken: row.encrypted_verification_token,
          },
  };
}
export async function bindRemoteAgentLarkPlatformConnectionTenant(input: {
  appId: string;
  connectionId: string;
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  tenantKey: string;
}): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null> {
  const tenantKey = input.tenantKey.trim();
  if (!tenantKey) {
    return null;
  }
  await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        SET
          tenant_key = $1,
          updated_at_ms = CASE
            WHEN updated_at_ms < $2 THEN $3
            ELSE updated_at_ms
          END
        WHERE connection_id = $4
          AND organization_id = $5
          AND provider = $6
          AND app_id = $7
          AND status = 'connected'
          AND tenant_key IS NULL
      `,
    values: [
      tenantKey,
      input.nowMs,
      input.nowMs,
      input.connectionId,
      input.organizationId,
      input.provider,
      input.appId,
    ],
  });
  const connection = await readRemoteAgentLarkPlatformChannelConnection({
    connectionId: input.connectionId,
    db: input.db,
  });
  return connection?.status === "connected" &&
    connection.organizationId === input.organizationId &&
    connection.provider === input.provider &&
    connection.appId === input.appId &&
    connection.tenantKey === tenantKey
    ? connection
    : null;
}
export async function readRemoteAgentLarkPlatformChannelConnectionForOrganization(input: {
  db: PostgresDatabase;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null> {
  const row = await input.db
    .query<RemoteAgentLarkPlatformChannelConnectionRow>({
      text: `${CONNECTION_SELECT}
       WHERE organization_id = $1
         AND provider = $2
       LIMIT 1`,
      values: [input.organizationId, input.provider],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapConnectionRow(row) : null;
}
export async function listRemoteAgentLarkPlatformChannelConnectionsForOrganization(input: {
  db: PostgresDatabase;
  organizationId: string;
}): Promise<RemoteAgentLarkPlatformChannelConnectionRecord[]> {
  const result =
    await input.db.query<RemoteAgentLarkPlatformChannelConnectionRow>({
      text: `${CONNECTION_SELECT}
       WHERE organization_id = $1
       ORDER BY provider ASC NULLS FIRST`,
      values: [input.organizationId],
    });
  return result.rows.map(mapConnectionRow);
}
export async function readRemoteAgentLarkPlatformChannelCredentials(input: {
  connectionId: string;
  db: PostgresDatabase;
}): Promise<RemoteAgentLarkPlatformChannelCredentialsRecord | null> {
  const row = await input.db
    .query<RemoteAgentLarkPlatformChannelCredentialsRow>({
      text: `
        SELECT
          connection_id,
          encrypted_app_secret,
          encrypted_verification_token,
          encrypted_event_encrypt_key,
          credential_format_version,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials"
        WHERE connection_id = $1
        LIMIT 1
      `,
      values: [input.connectionId],
    })
    .then((result) => result.rows[0] ?? null);
  return row ? mapCredentialsRow(row) : null;
}
export async function setRemoteAgentLarkPlatformChannelConnectionStatus(input: {
  connectionId: string;
  db: PostgresDatabase;
  failureReasonCode: string | null;
  lastVerifiedAtMs: number | null;
  nowMs: number;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  status: MessageChannelConnectionStatus;
}): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null> {
  const result = await input.db.query({
    text: `
        UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        SET
          status = $1,
          failure_reason_code = $2,
          last_verified_at_ms = $3,
          updated_at_ms = $4
        WHERE connection_id = $5
          AND organization_id = $6
          AND provider = $7
      `,
    values: [
      input.status,
      input.failureReasonCode,
      input.lastVerifiedAtMs,
      input.nowMs,
      input.connectionId,
      input.organizationId,
      input.provider,
    ],
  });
  if (Number(result.rowCount ?? 0) !== 1) {
    return null;
  }
  return await readRemoteAgentLarkPlatformChannelConnection({
    connectionId: input.connectionId,
    db: input.db,
  });
}
export async function disconnectRemoteAgentLarkPlatformChannelConnection(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<RemoteAgentLarkPlatformChannelConnectionRecord | null> {
  const connection =
    await readRemoteAgentLarkPlatformChannelConnectionForOrganization(input);
  const statements: QueryConfig[] = [];
  if (connection) {
    statements.push(
      {
        text: `
            DELETE FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_credentials"
            WHERE connection_id = $1
          `,
        values: [connection.connectionId],
      },
      {
        text: `
            DELETE FROM "openmeld"."openMeldRemoteAgent_lark_platform_identity_links"
            WHERE connection_id = $1
              AND organization_id = $2
              AND provider = $3
          `,
        values: [connection.connectionId, input.organizationId, input.provider],
      },
      {
        text: `
            DELETE FROM "openmeld"."openMeldRemoteAgent_lark_platform_context_cursors"
            WHERE connection_id = $1
              AND organization_id = $2
              AND provider = $3
          `,
        values: [connection.connectionId, input.organizationId, input.provider],
      },
      {
        text: `
            UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
            SET
              status = 'disconnected',
              failure_reason_code = NULL,
              connection_generation = connection_generation + 1,
              updated_at_ms = $1
            WHERE connection_id = $2
              AND organization_id = $3
              AND provider = $4
          `,
        values: [
          input.nowMs,
          connection.connectionId,
          input.organizationId,
          input.provider,
        ],
      }
    );
  }
  statements.push({
    text: `
          UPDATE "openmeld"."openMeldRemoteAgent_lark_platform_registration_attempts"
          SET
            status = 'disconnected',
            failure_reason_code = NULL,
            poll_claim_id = NULL,
            poll_claim_expires_at_ms = NULL,
            consumed_at_ms = $1,
            updated_at_ms = $2
          WHERE organization_id = $3
            AND provider = $4
            AND consumed_at_ms IS NULL
            AND status IN ('pending_registration', 'credentials_received', 'configuring')
        `,
    values: [input.nowMs, input.nowMs, input.organizationId, input.provider],
  });
  await input.db.transaction(async (client) => {
    const results: QueryResult[] = [];
    for (const query of statements) {
      results.push(await client.query(query));
    }
    return results;
  });
  return connection
    ? await readRemoteAgentLarkPlatformChannelConnection({
        connectionId: connection.connectionId,
        db: input.db,
      })
    : null;
}
export async function deleteDisconnectedRemoteAgentLarkPlatformChannelConnection(input: {
  connectionId: string;
  db: PostgresDatabase;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<boolean> {
  const result = await input.db.query({
    text: `
        DELETE FROM "openmeld"."openMeldRemoteAgent_lark_platform_channel_connections"
        WHERE connection_id = $1
          AND organization_id = $2
          AND provider = $3
          AND status = 'disconnected'
      `,
    values: [input.connectionId, input.organizationId, input.provider],
  });
  return Number(result.rowCount ?? 0) === 1;
}
function mapConnectionRow(
  row: RemoteAgentLarkPlatformChannelConnectionRow
): RemoteAgentLarkPlatformChannelConnectionRecord {
  return {
    appId: row.app_id,
    botName: row.bot_name,
    botOpenId: row.bot_open_id,
    callbacksWebhookVerifiedAtMs: row.callbacks_webhook_verified_at_ms,
    connectionGeneration: row.connection_generation,
    connectionId: row.connection_id,
    createdAtMs: row.created_at_ms,
    eventsWebhookVerifiedAtMs: row.events_webhook_verified_at_ms,
    failureReasonCode: row.failure_reason_code,
    grantedCapabilityGroups: parseGrantedCapabilityGroups(
      row.granted_capability_groups_json
    ),
    installedByUserId: row.installed_by_user_id,
    lastVerifiedAtMs: row.last_verified_at_ms,
    organizationId: row.organization_id,
    permissionBundleVersion: row.permission_bundle_version,
    provider: row.provider,
    status: row.status,
    tenantKey: row.tenant_key,
    transport: row.transport,
    updatedAtMs: row.updated_at_ms,
  };
}
function mapCredentialsRow(
  row: RemoteAgentLarkPlatformChannelCredentialsRow
): RemoteAgentLarkPlatformChannelCredentialsRecord {
  return {
    connectionId: row.connection_id,
    createdAtMs: row.created_at_ms,
    credentialFormatVersion: row.credential_format_version,
    encryptedAppSecret: row.encrypted_app_secret,
    encryptedEventEncryptKey: row.encrypted_event_encrypt_key,
    encryptedVerificationToken: row.encrypted_verification_token,
    updatedAtMs: row.updated_at_ms,
  };
}
function parseGrantedCapabilityGroups(value: string): readonly string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      !Array.isArray(parsed) ||
      parsed.length > 32 ||
      parsed.some(
        (item) =>
          typeof item !== "string" || !CAPABILITY_GROUP_PATTERN.test(item)
      ) ||
      new Set(parsed).size !== parsed.length
    ) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw new Error(
      "Remote Agent Lark-platform connection has invalid granted capability groups"
    );
  }
}
