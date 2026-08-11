import type { MentionDispatchRuleSet } from "@openmeld/schemas";

const SPACE_RULE_SCOPE_KEY = "space_default";
const SPACE_RULE_MODE_ALL_MEMBERS = "all_members";
const SPACE_RULE_UPDATED_BY_SYSTEM = "system";
const SPACE_RULE_DEFAULT_ID = "space.default.all_members.v1";
const SPACE_RULE_DEFAULT_REASON = "default allow all members mention";
const SPACE_RULE_DEFAULT_ALLOW = 1;
const SPACE_RULE_DEFAULT_SET_VERSION = 1;

type SqlSpaceDispatchRuleRow = {
  allow: number;
  mode: string;
  rule_id: string;
  rule_reason: string;
  rule_set_version: number;
  updated_at_ms: number;
  updated_by: string;
};

export type SpaceDispatchRuleRecord = {
  allow: boolean;
  mode: "all_members";
  ruleId: string;
  ruleReason: string;
  ruleSetVersion: number;
  updatedAtMs: number;
  updatedBy: string;
};

export const resolveSpaceMentionDispatchRuleSet = (
  sql: SqlStorage,
  nowMs: number
): MentionDispatchRuleSet => {
  ensureDefaultSpaceDispatchRule(sql, nowMs);
  const current = readSpaceDispatchRule(sql);
  if (!current) {
    return {
      space: {
        allow: true,
        ruleId: SPACE_RULE_DEFAULT_ID,
        ruleReason: SPACE_RULE_DEFAULT_REASON,
      },
    };
  }

  return {
    space: {
      allow: current.allow,
      ruleId: current.ruleId,
      ruleReason: current.ruleReason,
    },
  };
};

export const ensureDefaultSpaceDispatchRule = (
  sql: SqlStorage,
  nowMs: number
): void => {
  sql.exec(
    `
      INSERT OR IGNORE INTO space_dispatch_rules (
        scope_key,
        mode,
        allow,
        rule_id,
        rule_reason,
        rule_set_version,
        updated_by,
        updated_at_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    SPACE_RULE_SCOPE_KEY,
    SPACE_RULE_MODE_ALL_MEMBERS,
    SPACE_RULE_DEFAULT_ALLOW,
    SPACE_RULE_DEFAULT_ID,
    SPACE_RULE_DEFAULT_REASON,
    SPACE_RULE_DEFAULT_SET_VERSION,
    SPACE_RULE_UPDATED_BY_SYSTEM,
    nowMs
  );
};

export const readSpaceDispatchRule = (
  sql: SqlStorage
): SpaceDispatchRuleRecord | null => {
  const row = sql
    .exec<SqlSpaceDispatchRuleRow>(
      `
        SELECT
          mode,
          allow,
          rule_id,
          rule_reason,
          rule_set_version,
          updated_by,
          updated_at_ms
        FROM space_dispatch_rules
        WHERE scope_key = ?
        LIMIT 1
      `,
      SPACE_RULE_SCOPE_KEY
    )
    .toArray()[0];

  if (!row) {
    return null;
  }

  return {
    allow: Number(row.allow) === 1,
    mode: SPACE_RULE_MODE_ALL_MEMBERS,
    ruleId: String(row.rule_id),
    ruleReason: String(row.rule_reason),
    ruleSetVersion: Number(row.rule_set_version),
    updatedAtMs: Number(row.updated_at_ms),
    updatedBy: String(row.updated_by),
  };
};
