import type { MessageChannelIdentityLinkAuditRecord } from "../../application/message-channel-identity-link-audit";
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
  providerUserDisplayName?: string | null;
  providerUserId: string;
  resolutionSource: RemoteAgentLarkPlatformIdentityLinkSource;
  openmeldUserId: string;
};

type RemoteAgentLarkPlatformIdentityLinkRow = {
  connection_id: string;
  created_at_ms: number;
  organization_id: string;
  provider: RemoteAgentLarkPlatformProvider;
  provider_user_display_name?: string | null;
  provider_user_id: string;
  resolution_source: RemoteAgentLarkPlatformIdentityLinkSource;
  openmeld_user_id: string;
};

export async function listRemoteAgentLarkPlatformIdentityLinks(input: {
  connectionId: string;
  db: D1Database;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
}): Promise<RemoteAgentLarkPlatformIdentityLinkRecord[]> {
  const result = await input.db
    .prepare(
      `
        SELECT
          identity_link.provider,
          identity_link.connection_id,
          identity_link.provider_user_id,
          identity_link.organization_id,
          identity_link.openmeld_user_id,
          identity_link.resolution_source,
          identity_link.created_at_ms,
          (
            SELECT token.provider_user_display_name
            FROM openMeldRemoteAgent_message_channel_identity_link_tokens AS token
            WHERE token.provider = identity_link.provider
              AND token.connection_id = identity_link.connection_id
              AND token.provider_user_id = identity_link.provider_user_id
            ORDER BY token.issued_at_ms DESC
            LIMIT 1
          ) AS provider_user_display_name
        FROM openMeldRemoteAgent_lark_platform_identity_links AS identity_link
        WHERE identity_link.organization_id = ?
          AND identity_link.provider = ?
          AND identity_link.connection_id = ?
        ORDER BY identity_link.created_at_ms ASC, identity_link.provider_user_id ASC
      `
    )
    .bind(input.organizationId, input.provider, input.connectionId)
    .all<RemoteAgentLarkPlatformIdentityLinkRow>();
  return result.results.map(mapIdentityLinkRow);
}

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

export async function disconnectRemoteAgentLarkPlatformIdentityLink(input: {
  audit: MessageChannelIdentityLinkAuditRecord;
  connectionId: string;
  db: D1Database;
  organizationId: string;
  provider: RemoteAgentLarkPlatformProvider;
  providerUserId: string;
  openmeldUserId: string;
}): Promise<boolean> {
  if (input.audit.action !== "disconnect_message_channel_identity_link") {
    throw new Error(
      "Lark-platform identity disconnect has invalid audit action"
    );
  }
  if (input.audit.organizationId !== input.organizationId) {
    throw new Error(
      "Lark-platform identity disconnect has mismatched audit scope"
    );
  }
  const auditStatement = input.db
    .prepare(
      `
        INSERT INTO center_agent_audit_journal (
          id,
          organization_id,
          actor_profile_id,
          action,
          on_behalf_of_profile_id,
          on_behalf_of_user_id,
          on_behalf_of_display_name,
          resource_type,
          resource_id,
          source_native_delivery_id,
          created_at
        )
        SELECT ?, ?, ?, ?, NULL, NULL, NULL, ?, ?, NULL, ?
        WHERE EXISTS (
          SELECT 1
          FROM openMeldRemoteAgent_lark_platform_identity_links
          WHERE provider = ?
            AND connection_id = ?
            AND provider_user_id = ?
            AND organization_id = ?
            AND openmeld_user_id = ?
        )
      `
    )
    .bind(
      input.audit.id,
      input.audit.organizationId,
      input.audit.actorProfileId,
      input.audit.action,
      "message_channel_identity_link",
      input.audit.resourceId,
      input.audit.createdAtMs,
      input.provider,
      input.connectionId,
      input.providerUserId,
      input.organizationId,
      input.openmeldUserId
    );
  const deleteStatement = input.db
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
    );
  const results = await input.db.batch([auditStatement, deleteStatement]);
  const result = results.at(-1);
  if (!result) {
    throw new Error(
      "Lark-platform identity link delete batch returned no result"
    );
  }
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
    providerUserDisplayName: row.provider_user_display_name ?? null,
    providerUserId: row.provider_user_id,
    resolutionSource: row.resolution_source,
    openmeldUserId: row.openmeld_user_id,
  };
}
