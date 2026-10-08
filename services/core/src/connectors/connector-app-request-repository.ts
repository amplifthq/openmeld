import type { PostgresDatabase } from "@openmeld/db/postgresql";
import { buildConnectorAppRequestProviderKey } from "@openmeld/schemas";
import type {
  ConnectorAppRequest,
  ConnectorAppRequestSource,
} from "@openmeld/schemas/types";

type ConnectorAppRequestRow = {
  available_at_ms: number | null;
  created_at_ms: number;
  id: string;
  notified_at_ms: number | null;
  organization_id: string;
  provider_id: string | null;
  provider_name: string;
  requested_capabilities: string;
  requester_member_id: string | null;
  requester_user_id: string | null;
  source: string;
  status: string;
  updated_at_ms: number;
  use_case: string | null;
};
export async function upsertConnectorAppRequest(input: {
  db: PostgresDatabase;
  nowMs: number;
  organizationId: string;
  providerId: string | null;
  providerName: string;
  requestedCapabilities: string[];
  requesterMemberId: string;
  requesterUserId: string;
  source: ConnectorAppRequestSource;
  useCase: string | null;
}): Promise<ConnectorAppRequest> {
  const providerKey = buildConnectorAppRequestProviderKey({
    providerId: input.providerId,
    providerName: input.providerName,
    source: input.source,
  });
  await input.db.query({
    text: `
        INSERT INTO "openmeld"."connector_app_requests" (
          id,
          organization_id,
          requester_user_id,
          requester_member_id,
          provider_key,
          provider_id,
          provider_name,
          requested_capabilities,
          use_case,
          source,
          status,
          available_at_ms,
          notified_at_ms,
          created_at_ms,
          updated_at_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'requested', NULL, NULL, $11, $12)
        ON CONFLICT(organization_id, requester_user_id, provider_key) DO UPDATE SET
          requester_member_id = excluded.requester_member_id,
          provider_id = excluded.provider_id,
          provider_name = excluded.provider_name,
          requested_capabilities = excluded.requested_capabilities,
          use_case = excluded.use_case,
          source = excluded.source,
          status = CASE
            WHEN connector_app_requests.status = 'declined' THEN 'requested'
            ELSE connector_app_requests.status
          END,
          available_at_ms = CASE
            WHEN connector_app_requests.status = 'declined' THEN NULL
            ELSE connector_app_requests.available_at_ms
          END,
          notified_at_ms = CASE
            WHEN connector_app_requests.status = 'declined' THEN NULL
            ELSE connector_app_requests.notified_at_ms
          END,
          updated_at_ms = excluded.updated_at_ms
      `,
    values: [
      `connector_request_${crypto.randomUUID()}`,
      input.organizationId,
      input.requesterUserId,
      input.requesterMemberId,
      providerKey,
      input.providerId,
      input.providerName,
      JSON.stringify(input.requestedCapabilities),
      input.useCase,
      input.source,
      input.nowMs,
      input.nowMs,
    ],
  });
  const row = await input.db
    .query<ConnectorAppRequestRow>({
      text: `
        SELECT
          id,
          organization_id,
          requester_user_id,
          requester_member_id,
          provider_id,
          provider_name,
          requested_capabilities,
          use_case,
          source,
          status,
          available_at_ms,
          notified_at_ms,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."connector_app_requests"
        WHERE organization_id = $1
          AND requester_user_id = $2
          AND provider_key = $3
        LIMIT 1
      `,
      values: [input.organizationId, input.requesterUserId, providerKey],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    throw new Error("Connector App request upsert produced no record.");
  }
  return toConnectorAppRequest(row);
}
export async function listConnectorAppRequestsForRequester(input: {
  db: PostgresDatabase;
  organizationId: string;
  requesterUserId: string;
}): Promise<ConnectorAppRequest[]> {
  const result = await input.db.query<ConnectorAppRequestRow>({
    text: `
        SELECT
          id,
          organization_id,
          requester_user_id,
          requester_member_id,
          provider_id,
          provider_name,
          requested_capabilities,
          use_case,
          source,
          status,
          available_at_ms,
          notified_at_ms,
          created_at_ms,
          updated_at_ms
        FROM "openmeld"."connector_app_requests"
        WHERE organization_id = $1
          AND requester_user_id = $2
        ORDER BY created_at_ms DESC NULLS LAST, id DESC NULLS LAST
        LIMIT 500
      `,
    values: [input.organizationId, input.requesterUserId],
  });
  return result.rows.map(toConnectorAppRequest);
}
function toConnectorAppRequest(
  row: ConnectorAppRequestRow
): ConnectorAppRequest {
  if (row.source !== "openconnector_catalog" && row.source !== "freeform") {
    throw new Error(`Invalid connector App request source: ${row.source}`);
  }
  if (
    row.status !== "requested" &&
    row.status !== "available" &&
    row.status !== "declined"
  ) {
    throw new Error(`Invalid connector App request status: ${row.status}`);
  }
  return {
    availableAtMs: row.available_at_ms,
    createdAtMs: row.created_at_ms,
    id: row.id,
    notifiedAtMs: row.notified_at_ms,
    organizationId: row.organization_id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    requestedCapabilities: parseRequestedCapabilities(
      row.requested_capabilities
    ),
    requesterMemberId: row.requester_member_id,
    requesterUserId: row.requester_user_id,
    source: row.source,
    status: row.status,
    updatedAtMs: row.updated_at_ms,
    useCase: row.use_case,
  };
}
function parseRequestedCapabilities(value: string): string[] {
  const parsed: unknown = JSON.parse(value);
  if (
    !Array.isArray(parsed) ||
    parsed.some((capability) => typeof capability !== "string")
  ) {
    throw new Error("Invalid connector App request capabilities.");
  }
  return parsed;
}
