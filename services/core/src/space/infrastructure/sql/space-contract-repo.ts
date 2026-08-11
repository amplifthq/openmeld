import { spaceContractSchema } from "@openmeld/schemas";
import type {
  PutSpaceContractBody,
  SpaceContract,
} from "@openmeld/schemas/types";
import { normalizePersistedSpaceContractFields } from "../../rules/parsers/space-contract-fields";
import { isoToTimestampMs, timestampMsToIso } from "./space-schema-repo";

type SqlSpaceContractRow = {
  contract_json: string;
  version: number;
  updated_at: number;
  updated_by: string;
};

export type ReadSpaceContractRecordState = {
  contract: SpaceContract;
  needsRewrite: boolean;
};

const MAX_DATE_TIMESTAMP_MS = 8_640_000_000_000_000;

export const readSpaceContractRecordFromSql = (
  sql: SqlStorage,
  spaceId: string
): SpaceContract | null => {
  return readSpaceContractRecordStateFromSql(sql, spaceId)?.contract ?? null;
};

export const readSpaceContractRecordStateFromSql = (
  sql: SqlStorage,
  spaceId: string
): ReadSpaceContractRecordState | null => {
  const row = readOne<SqlSpaceContractRow>(
    sql.exec(
      `
        SELECT
          contract_json,
          version,
          updated_at,
          updated_by
        FROM space_contracts
        WHERE space_id = ?
        LIMIT 1
      `,
      spaceId
    )
  );
  if (!row) {
    return null;
  }

  const { fields, needsRewrite } = parseContractFieldsJson(row.contract_json);
  const contract = {
    version: parsePositiveInteger(row.version, "space_contracts.version"),
    updatedAt: timestampMsToIso(
      parseRequiredTimestampMs(row.updated_at, "space_contracts.updated_at")
    ),
    updatedBy: normalizeRequiredString(
      row.updated_by,
      "space_contracts.updated_by"
    ),
    ...fields,
  };
  const parsed = spaceContractSchema.safeParse(contract);
  if (!parsed.success) {
    throw new Error("space contract record is invalid");
  }

  return {
    contract: parsed.data,
    needsRewrite,
  };
};

export const upsertSpaceContractRecord = (
  sql: SqlStorage,
  input: {
    spaceId: string;
    contract: SpaceContract;
  }
): void => {
  const parsed = spaceContractSchema.safeParse(input.contract);
  if (!parsed.success) {
    throw new Error("space contract record is invalid");
  }

  const contract = parsed.data;
  const contractJson = JSON.stringify({
    dispatchPolicy: contract.dispatchPolicy,
    publicationMode: contract.publicationMode,
    allowedActions: contract.allowedActions,
    resultArchivePolicy: contract.resultArchivePolicy,
    ...(contract.spaceNote === undefined
      ? {}
      : { spaceNote: contract.spaceNote }),
    authorityOrder: contract.authorityOrder,
    entryBrief: contract.entryBrief,
    dispatchBrief: contract.dispatchBrief,
  } satisfies PutSpaceContractBody);

  sql.exec(
    `
      INSERT INTO space_contracts (
        space_id,
        contract_json,
        version,
        updated_at,
        updated_by
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(space_id) DO UPDATE SET
        contract_json = excluded.contract_json,
        version = excluded.version,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by
    `,
    input.spaceId,
    contractJson,
    contract.version,
    parseIsoTimestampMs(contract.updatedAt, "spaceContract.updatedAt"),
    contract.updatedBy
  );
};

export const repairSpaceContractRecordIfNeeded = (
  sql: SqlStorage,
  input: {
    contract: SpaceContract;
    needsRewrite: boolean;
    spaceId: string;
  }
): void => {
  if (!input.needsRewrite) {
    return;
  }

  try {
    upsertSpaceContractRecord(sql, {
      spaceId: input.spaceId,
      contract: input.contract,
    });
  } catch (error) {
    console.warn("[core.openmeld.space.contract_rewrite_failed]", {
      spaceId: input.spaceId,
      error,
    });
  }
};

function parseContractFieldsJson(
  raw: string
): ReturnType<typeof normalizePersistedSpaceContractFields> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("space contract json is invalid");
  }

  return normalizePersistedSpaceContractFields(parsed);
}

function readOne<T extends Record<string, SqlStorageValue>>(
  cursor: SqlStorageCursor<T>
): T | null {
  const next = cursor.next();
  return next.done ? null : next.value;
}

function parsePositiveInteger(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new Error(`invalid ${field}`);
  }
  return value;
}

function parseRequiredTimestampMs(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value)
  ) {
    throw new Error(`invalid ${field}`);
  }
  return clampTimestampMs(value);
}

function parseIsoTimestampMs(value: string, field: string): number {
  const parsed = isoToTimestampMs(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid ${field}`);
  }
  return clampTimestampMs(parsed);
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new Error(`invalid ${field}`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error(`invalid ${field}`);
  }
  return normalized;
}

function clampTimestampMs(value: number): number {
  if (value > MAX_DATE_TIMESTAMP_MS) {
    throw new Error(
      `timestamp ${String(value)} exceeds MAX_DATE_TIMESTAMP_MS=${String(MAX_DATE_TIMESTAMP_MS)}`
    );
  }
  if (value < -MAX_DATE_TIMESTAMP_MS) {
    throw new Error(
      `timestamp ${String(value)} is below -MAX_DATE_TIMESTAMP_MS=${String(-MAX_DATE_TIMESTAMP_MS)}`
    );
  }
  return value;
}
