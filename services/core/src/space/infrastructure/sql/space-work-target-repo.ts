import { centerAgentWorkTargetRecordSchema } from "@openmeld/schemas";
import type {
  CenterAgentWorkTargetRecord,
  CenterAgentWorkTargetRequest,
} from "@openmeld/schemas/types";
import { createCoreRpcHttpError } from "../../../rpc/errors";

/** Space owns this context constraint. It grants no execution permission. */
export function ensureSpaceWorkTargetTable(sql: SqlStorage) {
  sql.exec(`CREATE TABLE IF NOT EXISTS space_work_targets (
    scope_key TEXT PRIMARY KEY, record_json TEXT NOT NULL
  )`);
}

export function readSpaceWorkTarget(sql: SqlStorage, scopeKey: string) {
  const row = sql
    .exec<{ record_json: string }>(
      "SELECT record_json FROM space_work_targets WHERE scope_key = ?",
      scopeKey
    )
    .toArray()[0];
  return row
    ? centerAgentWorkTargetRecordSchema.parse(JSON.parse(row.record_json))
    : null;
}

export function selectSpaceWorkTarget(
  sql: SqlStorage,
  input: {
    scopeKey: string;
    sourceSignalId: string;
    sourceRevision: number;
    requesterProfileId: string;
    selection: NonNullable<CenterAgentWorkTargetRequest["selection"]>;
  }
): CenterAgentWorkTargetRecord {
  const current = readSpaceWorkTarget(sql, input.scopeKey);
  const choice = input.selection.choice;
  const target = choice.kind === "select" ? choice.target : current?.target;
  const sameTarget =
    target &&
    current &&
    JSON.stringify(target) === JSON.stringify(current.target);
  if (
    current?.selectionSignalId === input.sourceSignalId &&
    current.selectionRevision === input.sourceRevision
  ) {
    if (
      sameTarget &&
      current.selectionKind === choice.kind &&
      current.selectedByProfileId === input.requesterProfileId
    ) {
      return current;
    }
    throw conflict("selection_already_bound");
  }
  if ((current?.revision ?? 0) !== input.selection.expectedRevision) {
    throw conflict("revision_conflict");
  }
  if (!target) {
    throw conflict("inherit_unavailable");
  }
  const record = centerAgentWorkTargetRecordSchema.parse({
    target,
    revision: (current?.revision ?? 0) + 1,
    sourceSignalId:
      choice.kind === "inherit"
        ? current?.sourceSignalId
        : input.sourceSignalId,
    sourceRevision:
      choice.kind === "inherit"
        ? current?.sourceRevision
        : input.sourceRevision,
    sourceProfileId:
      choice.kind === "inherit"
        ? current?.sourceProfileId
        : input.requesterProfileId,
    selectionSignalId: input.sourceSignalId,
    selectionRevision: input.sourceRevision,
    selectedByProfileId: input.requesterProfileId,
    selectionKind: choice.kind,
  });
  sql.exec(
    "INSERT INTO space_work_targets (scope_key, record_json) VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET record_json = excluded.record_json",
    input.scopeKey,
    JSON.stringify(record)
  );
  return record;
}

function conflict(reason: string) {
  return createCoreRpcHttpError({
    status: 409,
    code: `center_agent.work_target.${reason}`,
    reason:
      "Read the current work target and select the goal and destination for this request.",
  });
}
