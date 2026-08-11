import {
  centerAgentContextLoadSelectedEntrySchema,
  centerAgentContextManifestMaterializationSchema,
} from "@openmeld/schemas";
import type {
  CenterAgentContextLoadSelectedEntry,
  CenterAgentContextManifestMaterialization,
  CenterAgentContextManifestSourceRef,
  CreateCenterAgentContextManifestResponse,
} from "@openmeld/schemas/types";
import {
  prepareCenterAgentAuditJournalEntryStatement,
  type ResolvedCenterAgentAttribution,
} from "./center-agent-repository";

export async function insertCenterAgentContextManifest(input: {
  actorProfileId: string;
  attribution: ResolvedCenterAgentAttribution;
  auditEntryId: string;
  clientName: string;
  continuationCursor: string | null;
  conversationSpaceId: string;
  db: D1Database;
  estimatedTokenCount: number;
  includedMessageCount: number;
  manifestId: string;
  nowMs: number;
  organizationId: string;
  requestedByProfileId: string;
  requestedTokenBudget: number;
  materializations: readonly CenterAgentContextManifestMaterialization[];
  sourceRefs: readonly CenterAgentContextManifestSourceRef[];
  truncated: boolean;
  truncationReasons: CreateCenterAgentContextManifestResponse["budget"]["truncationReasons"];
  view: "messages";
}): Promise<void> {
  const auditStatement = prepareCenterAgentAuditJournalEntryStatement({
    action: "read_center_agent_context",
    actorProfileId: input.actorProfileId,
    attribution: input.attribution,
    db: input.db,
    id: input.auditEntryId,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    resource: {
      id: input.manifestId,
      type: "center_agent_context_manifest",
    },
  });
  const manifestStatement = input.db
    .prepare(
      `
        INSERT INTO center_agent_context_manifests (
          id,
          organization_id,
          requested_by_profile_id,
          actor_profile_id,
          conversation_space_id,
          client_name,
          view,
          schema_version,
          requested_token_budget,
          estimated_token_count,
          included_message_count,
          truncated,
          truncation_reasons_json,
          continuation_cursor,
          source_refs_json,
          audit_entry_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.manifestId,
      input.organizationId,
      input.requestedByProfileId,
      input.actorProfileId,
      input.conversationSpaceId,
      input.clientName,
      input.view,
      "center_agent_context_manifest.v1",
      input.requestedTokenBudget,
      input.estimatedTokenCount,
      input.includedMessageCount,
      input.truncated ? 1 : 0,
      JSON.stringify(input.truncationReasons),
      input.continuationCursor,
      JSON.stringify(input.sourceRefs),
      input.auditEntryId,
      input.nowMs
    );
  const materializationStatement = input.db
    .prepare(
      `
        INSERT INTO center_agent_context_manifest_materializations (
          manifest_id,
          entries_json,
          created_at
        )
        VALUES (?, ?, ?)
      `
    )
    .bind(
      input.manifestId,
      JSON.stringify(input.materializations),
      input.nowMs
    );
  await input.db.batch([
    auditStatement,
    manifestStatement,
    materializationStatement,
  ]);
}

type CenterAgentContextManifestForLoadReceiptRow = {
  actor_profile_id: string;
  client_name: string;
  id: string;
  materialized_entries_json: string | null;
  organization_id: string;
  requested_by_profile_id: string;
};

export type CenterAgentContextManifestForLoadReceipt = {
  actorProfileId: string;
  clientName: string;
  id: string;
  materializations: CenterAgentContextManifestMaterialization[];
  organizationId: string;
  requestedByProfileId: string;
};

type CenterAgentContextLoadReceiptRow = {
  actor_profile_id: string;
  audit_entry_id: string;
  client_name: string;
  created_at: number;
  estimated_token_count: number;
  id: string;
  included_message_count: number;
  manifest_id: string;
  organization_id: string;
  requested_by_profile_id: string;
  selected_entries_json: string;
};

export type CenterAgentContextLoadReceiptRecord = {
  actorProfileId: string;
  auditEntryId: string;
  clientName: string;
  createdAtMs: number;
  estimatedTokenCount: number;
  id: string;
  includedMessageCount: number;
  manifestId: string;
  organizationId: string;
  requestedByProfileId: string;
  selectedEntries: CenterAgentContextLoadSelectedEntry[];
};

export async function readCenterAgentContextManifestForLoadReceipt(input: {
  db: D1Database;
  manifestId: string;
  organizationId: string;
  requestedByProfileId: string;
}): Promise<CenterAgentContextManifestForLoadReceipt | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          requested_by_profile_id,
          actor_profile_id,
          manifest.client_name,
          materialization.entries_json AS materialized_entries_json
        FROM center_agent_context_manifests AS manifest
        LEFT JOIN center_agent_context_manifest_materializations AS materialization
          ON materialization.manifest_id = manifest.id
        WHERE manifest.id = ?
          AND manifest.organization_id = ?
          AND manifest.requested_by_profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.manifestId, input.organizationId, input.requestedByProfileId)
    .first<CenterAgentContextManifestForLoadReceiptRow>();
  if (!row) {
    return null;
  }
  const materializations = row.materialized_entries_json
    ? parseJsonArray({
        json: row.materialized_entries_json,
        label: "Center Agent Context Manifest materializations",
        schema: centerAgentContextManifestMaterializationSchema,
      })
    : [];
  return {
    actorProfileId: row.actor_profile_id,
    clientName: row.client_name,
    id: row.id,
    materializations,
    organizationId: row.organization_id,
    requestedByProfileId: row.requested_by_profile_id,
  };
}

export async function readCenterAgentContextLoadReceiptByManifest(input: {
  db: D1Database;
  manifestId: string;
  organizationId: string;
  requestedByProfileId: string;
}): Promise<CenterAgentContextLoadReceiptRecord | null> {
  const row = await input.db
    .prepare(
      `
        SELECT
          id,
          organization_id,
          manifest_id,
          requested_by_profile_id,
          actor_profile_id,
          client_name,
          selected_entries_json,
          estimated_token_count,
          included_message_count,
          audit_entry_id,
          created_at
        FROM center_agent_context_load_receipts
        WHERE manifest_id = ?
          AND organization_id = ?
          AND requested_by_profile_id = ?
        LIMIT 1
      `
    )
    .bind(input.manifestId, input.organizationId, input.requestedByProfileId)
    .first<CenterAgentContextLoadReceiptRow>();
  return row ? mapContextLoadReceiptRow(row) : null;
}

export async function insertCenterAgentContextLoadReceipt(input: {
  actorProfileId: string;
  attribution: ResolvedCenterAgentAttribution;
  auditEntryId: string;
  clientName: string;
  db: D1Database;
  estimatedTokenCount: number;
  id: string;
  manifestId: string;
  nowMs: number;
  organizationId: string;
  requestedByProfileId: string;
  selectedEntries: readonly CenterAgentContextLoadSelectedEntry[];
}): Promise<void> {
  const auditStatement = prepareCenterAgentAuditJournalEntryStatement({
    action: "load_center_agent_context",
    actorProfileId: input.actorProfileId,
    attribution: input.attribution,
    db: input.db,
    id: input.auditEntryId,
    nowMs: input.nowMs,
    organizationId: input.organizationId,
    resource: {
      id: input.id,
      type: "center_agent_context_load_receipt",
    },
  });
  const receiptStatement = input.db
    .prepare(
      `
        INSERT INTO center_agent_context_load_receipts (
          id,
          organization_id,
          manifest_id,
          requested_by_profile_id,
          actor_profile_id,
          client_name,
          schema_version,
          selected_entries_json,
          estimated_token_count,
          included_message_count,
          audit_entry_id,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      input.id,
      input.organizationId,
      input.manifestId,
      input.requestedByProfileId,
      input.actorProfileId,
      input.clientName,
      "center_agent_context_load_receipt.v1",
      JSON.stringify(input.selectedEntries),
      input.estimatedTokenCount,
      input.selectedEntries.length,
      input.auditEntryId,
      input.nowMs
    );
  await input.db.batch([auditStatement, receiptStatement]);
}

function mapContextLoadReceiptRow(
  row: CenterAgentContextLoadReceiptRow
): CenterAgentContextLoadReceiptRecord {
  return {
    actorProfileId: row.actor_profile_id,
    auditEntryId: row.audit_entry_id,
    clientName: row.client_name,
    createdAtMs: row.created_at,
    estimatedTokenCount: row.estimated_token_count,
    id: row.id,
    includedMessageCount: row.included_message_count,
    manifestId: row.manifest_id,
    organizationId: row.organization_id,
    requestedByProfileId: row.requested_by_profile_id,
    selectedEntries: parseJsonArray({
      json: row.selected_entries_json,
      label: "Center Agent Context Load Receipt selections",
      schema: centerAgentContextLoadSelectedEntrySchema,
    }),
  };
}

function parseJsonArray<T>(input: {
  json: string;
  label: string;
  schema: {
    safeParse: (
      value: unknown
    ) => { data: T; success: true } | { success: false };
  };
}): T[] {
  let value: unknown;
  try {
    value = JSON.parse(input.json);
  } catch (error) {
    throw new Error(`${input.label} are invalid JSON.`, { cause: error });
  }
  if (!Array.isArray(value)) {
    throw new Error(`${input.label} do not match the stored contract.`);
  }
  const parsed: T[] = [];
  for (const entry of value) {
    const result = input.schema.safeParse(entry);
    if (!result.success) {
      throw new Error(`${input.label} do not match the stored contract.`);
    }
    parsed.push(result.data);
  }
  return parsed;
}
