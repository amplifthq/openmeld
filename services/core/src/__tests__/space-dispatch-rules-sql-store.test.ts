import { describe, expect, it, vi } from "vitest";
import {
  readSpaceDispatchRule,
  resolveSpaceMentionDispatchRuleSet,
} from "../space/infrastructure/sql/space-dispatch-rule-repo";

const createSqlStub = (rows: Record<string, unknown>[]) => {
  const exec = vi.fn((query: string) => {
    if (query.includes("SELECT") && query.includes("space_dispatch_rules")) {
      return {
        toArray: () => rows,
      };
    }
    return {
      rowsWritten: 1,
      toArray: () => [],
    };
  });
  return {
    exec,
  } as unknown as SqlStorage;
};

describe("space dispatch rules sql store", () => {
  it("resolves default all_members rule from SQL store", () => {
    const nowMs = Date.UTC(2026, 1, 26, 11, 0, 0);
    const sql = createSqlStub([
      {
        mode: "all_members",
        allow: 1,
        rule_id: "space.default.all_members.v1",
        rule_reason: "default allow all members mention",
        rule_set_version: 1,
        updated_by: "system",
        updated_at_ms: nowMs,
      },
    ]);

    const ruleSet = resolveSpaceMentionDispatchRuleSet(sql, nowMs);

    expect(ruleSet).toEqual({
      space: {
        allow: true,
        ruleId: "space.default.all_members.v1",
        ruleReason: "default allow all members mention",
      },
    });

    const execMock = (sql as unknown as { exec: ReturnType<typeof vi.fn> })
      .exec;
    const insertCall = execMock.mock.calls.find(([query]) =>
      String(query).includes("INSERT OR IGNORE INTO space_dispatch_rules")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[6]).toBe(1);
    expect(insertCall?.[7]).toBe("system");
    expect(insertCall?.[8]).toBe(nowMs);
  });

  it("maps allow flag to false when stored value is 0", () => {
    const sql = createSqlStub([
      {
        mode: "all_members",
        allow: 0,
        rule_id: "space.owner_only.v1",
        rule_reason: "owner only",
        rule_set_version: 2,
        updated_by: "system",
        updated_at_ms: Date.UTC(2026, 1, 26, 12, 0, 0),
      },
    ]);

    const rule = readSpaceDispatchRule(sql);

    expect(rule).toEqual({
      allow: false,
      mode: "all_members",
      ruleId: "space.owner_only.v1",
      ruleReason: "owner only",
      ruleSetVersion: 2,
      updatedBy: "system",
      updatedAtMs: Date.UTC(2026, 1, 26, 12, 0, 0),
    });
  });
});
