import { runtimeDispatchPolicySchema } from "@openmeld/schemas";
import type { RuntimeDispatchPolicy } from "@openmeld/schemas/types";

const SPACE_POLICY_SCOPE_KIND_DEFAULT = "space_default" as const;
const SPACE_POLICY_SCOPE_KIND_TARGET = "target_profile" as const;
const SPACE_POLICY_DEFAULT_SCOPE_ID = "default";
const SPACE_POLICY_UPDATED_BY_SYSTEM = "system";
const SPACE_POLICY_DEFAULT_VALUE = "mention_only" as const;

type SqlSpaceDispatchPolicyRow = {
  dispatch_policy: string;
  scope_id: string;
  scope_kind: string;
  updated_at_ms: number;
  updated_by: string;
};

export type SpaceDispatchPolicyScopeKind =
  | typeof SPACE_POLICY_SCOPE_KIND_DEFAULT
  | typeof SPACE_POLICY_SCOPE_KIND_TARGET;

export type SpaceDispatchPolicyRecord = {
  dispatchPolicy: RuntimeDispatchPolicy;
  scopeId: string;
  scopeKind: SpaceDispatchPolicyScopeKind;
  updatedAtMs: number;
  updatedBy: string;
};

export type ResolvedSpaceDispatchPolicy = {
  dispatchPolicy: RuntimeDispatchPolicy;
  scopeId: string;
  scopeKind: SpaceDispatchPolicyScopeKind | "system_default";
};

export const ensureDefaultSpaceDispatchPolicy = (
  sql: SqlStorage,
  nowMs: number
): void => {
  sql.exec(
    `
      INSERT OR IGNORE INTO space_dispatch_policies (
        scope_kind,
        scope_id,
        dispatch_policy,
        updated_by,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?)
    `,
    SPACE_POLICY_SCOPE_KIND_DEFAULT,
    SPACE_POLICY_DEFAULT_SCOPE_ID,
    SPACE_POLICY_DEFAULT_VALUE,
    SPACE_POLICY_UPDATED_BY_SYSTEM,
    nowMs
  );
};

export const readSpaceDispatchPolicy = (
  sql: SqlStorage,
  input: {
    scopeKind: SpaceDispatchPolicyScopeKind;
    scopeId: string;
  }
): SpaceDispatchPolicyRecord | null => {
  const row = sql
    .exec<SqlSpaceDispatchPolicyRow>(
      `
        SELECT
          scope_kind,
          scope_id,
          dispatch_policy,
          updated_by,
          updated_at_ms
        FROM space_dispatch_policies
        WHERE scope_kind = ?
          AND scope_id = ?
        LIMIT 1
      `,
      input.scopeKind,
      input.scopeId
    )
    .toArray()[0];
  if (!row) {
    return null;
  }
  const parsedDispatchPolicy = runtimeDispatchPolicySchema.safeParse(
    row.dispatch_policy
  );
  if (!parsedDispatchPolicy.success) {
    return null;
  }

  return {
    dispatchPolicy: parsedDispatchPolicy.data,
    scopeId: String(row.scope_id),
    scopeKind:
      row.scope_kind === SPACE_POLICY_SCOPE_KIND_TARGET
        ? SPACE_POLICY_SCOPE_KIND_TARGET
        : SPACE_POLICY_SCOPE_KIND_DEFAULT,
    updatedAtMs: Number(row.updated_at_ms),
    updatedBy: String(row.updated_by),
  };
};

export const resolveSpaceDispatchPolicyForTarget = (
  sql: SqlStorage,
  input: {
    nowMs: number;
    targetProfileId: string;
  }
): ResolvedSpaceDispatchPolicy => {
  ensureDefaultSpaceDispatchPolicy(sql, input.nowMs);
  const normalizedTargetProfileId = input.targetProfileId.trim();
  if (normalizedTargetProfileId.length > 0) {
    const targetRecord = readSpaceDispatchPolicy(sql, {
      scopeKind: SPACE_POLICY_SCOPE_KIND_TARGET,
      scopeId: normalizedTargetProfileId,
    });
    if (targetRecord) {
      return {
        dispatchPolicy: targetRecord.dispatchPolicy,
        scopeKind: targetRecord.scopeKind,
        scopeId: targetRecord.scopeId,
      };
    }
  }

  const defaultRecord = readSpaceDispatchPolicy(sql, {
    scopeKind: SPACE_POLICY_SCOPE_KIND_DEFAULT,
    scopeId: SPACE_POLICY_DEFAULT_SCOPE_ID,
  });
  if (defaultRecord) {
    return {
      dispatchPolicy: defaultRecord.dispatchPolicy,
      scopeKind: defaultRecord.scopeKind,
      scopeId: defaultRecord.scopeId,
    };
  }

  return {
    dispatchPolicy: SPACE_POLICY_DEFAULT_VALUE,
    scopeKind: "system_default",
    scopeId: SPACE_POLICY_DEFAULT_SCOPE_ID,
  };
};
