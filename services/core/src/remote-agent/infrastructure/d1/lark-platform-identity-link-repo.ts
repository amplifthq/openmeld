import type { RemoteAgentLarkPlatformProvider } from "./lark-platform-channel-connection-repo";

export type RemoteAgentLarkPlatformIdentityLinkSource =
  | "email_auto"
  | "explicit"
  | "installer";

export type RemoteAgentLarkPlatformIdentityLinkRecord = {
  connectionId: string;
  createdAtMs: number;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  providerUserId: string;
  resolutionSource: RemoteAgentLarkPlatformIdentityLinkSource;
  openmeldUserId: string;
};

type RemoteAgentLarkPlatformIdentityLinkRow = {
  connection_id: string;
  created_at_ms: number;
  organization_id: string;
  provider: RemoteAgentLarkPlatformProvider;
  provider_user_id: string;
  resolution_source: RemoteAgentLarkPlatformIdentityLinkSource;
  openmeld_user_id: string;
};

export async function readRemoteAgentLarkPlatformIdentityLink(input: {
  connectionId: string;
  db: D1Database;
  provider: RemoteAgentLarkPlatformProvider;
  providerUserId: string;
}): Promise<RemoteAgentLarkPlatformIdentityLinkRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          provider,
          connection_id,
          provider_user_id,
          organization_id,
          openmeld_user_id,
          resolution_source,
          created_at_ms
        FROM openMeldRemoteAgent_lark_platform_identity_links
        WHERE provider = ?
          AND connection_id = ?
          AND provider_user_id = ?
        LIMIT 1
      `
    )
    .bind(input.provider, input.connectionId, input.providerUserId)
    .first<RemoteAgentLarkPlatformIdentityLinkRow>();
  return row ? mapIdentityLinkRow(row) : null;
}

export async function insertRemoteAgentLarkPlatformIdentityLinkIfAbsent(input: {
  connectionId: string;
  db: D1Database;
  nowMs: number;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  providerUserId: string;
  resolutionSource: RemoteAgentLarkPlatformIdentityLinkSource;
  openmeldUserId: string;
}): Promise<{
  record: RemoteAgentLarkPlatformIdentityLinkRecord;
  status: "created" | "existing";
}> {
  const existing = await readRemoteAgentLarkPlatformIdentityLink(input);
  if (existing) {
    assertIdentityLinkMatchesRequest(existing, input);
    return { record: existing, status: "existing" };
  }
  const result = await input.db
    .prepare(
      `
        INSERT INTO openMeldRemoteAgent_lark_platform_identity_links (
          provider,
          connection_id,
          provider_user_id,
          organization_id,
          openmeld_user_id,
          resolution_source,
          created_at_ms
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        FROM openMeldRemoteAgent_lark_platform_channel_connections
        WHERE connection_id = ?
          AND provider = ?
          AND organization_id = ?
          AND EXISTS (
            SELECT 1
            FROM members
            WHERE members.organization_id = ?
              AND members.user_id = ?
          )
        ON CONFLICT(provider, connection_id, provider_user_id) DO NOTHING
      `
    )
    .bind(
      input.provider,
      input.connectionId,
      input.providerUserId,
      input.organizationId,
      input.openmeldUserId,
      input.resolutionSource,
      input.nowMs,
      input.connectionId,
      input.provider,
      input.organizationId,
      input.organizationId,
      input.openmeldUserId
    )
    .run();
  const record = await readRemoteAgentLarkPlatformIdentityLink(input);
  if (!record) {
    throw new Error(
      "Lark-platform identity link does not match its connection and Organization member"
    );
  }
  assertIdentityLinkMatchesRequest(record, input);
  return {
    record,
    status: Number(result.meta?.changes ?? 0) === 1 ? "created" : "existing",
  };
}

function assertIdentityLinkMatchesRequest(
  record: RemoteAgentLarkPlatformIdentityLinkRecord,
  input: {
    connectionId: string;
    organizationId: string;
    provider: RemoteAgentLarkPlatformProvider;
    providerUserId: string;
    openmeldUserId: string;
  }
): void {
  if (
    record.connectionId !== input.connectionId ||
    record.organizationId !== input.organizationId ||
    record.provider !== input.provider ||
    record.providerUserId !== input.providerUserId ||
    record.openmeldUserId !== input.openmeldUserId
  ) {
    throw new Error(
      "Lark-platform identity link conflicts with an existing scoped mapping"
    );
  }
}

export async function deleteRemoteAgentLarkPlatformIdentityLinkIfMatches(input: {
  connectionId: string;
  db: D1Database;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  providerUserId: string;
  openmeldUserId: string;
}): Promise<boolean> {
  const result = await input.db
    .prepare(
      `
        DELETE FROM openMeldRemoteAgent_lark_platform_identity_links
        WHERE provider = ?
          AND connection_id = ?
          AND provider_user_id = ?
          AND organization_id = ?
          AND openmeld_user_id = ?
      `
    )
    .bind(
      input.provider,
      input.connectionId,
      input.providerUserId,
      input.organizationId,
      input.openmeldUserId
    )
    .run();
  return Number(result.meta?.changes ?? 0) === 1;
}

function mapIdentityLinkRow(
  row: RemoteAgentLarkPlatformIdentityLinkRow
): RemoteAgentLarkPlatformIdentityLinkRecord {
  return {
    connectionId: row.connection_id,
    createdAtMs: row.created_at_ms,
    organizationId: row.organization_id,
    provider: row.provider,
    providerUserId: row.provider_user_id,
    resolutionSource: row.resolution_source,
    openmeldUserId: row.openmeld_user_id,
  };
}
