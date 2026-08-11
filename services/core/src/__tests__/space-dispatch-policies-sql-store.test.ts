import { describe, expect, it, vi } from "vitest";
import {
  readSpaceDispatchPolicy,
  resolveSpaceDispatchPolicyForTarget,
} from "../space/infrastructure/sql/space-dispatch-policy-repo";

const createSqlStub = (input: {
  defaultPolicyRow?: Record<string, unknown>;
  targetPolicyRow?: Record<string, unknown>;
}) => {
  const exec = vi.fn((query: string, ...params: unknown[]) => {
    if (query.includes("SELECT") && query.includes("space_dispatch_policies")) {
      const scopeKind = String(params[0] ?? "");
      const scopeId = String(params[1] ?? "");
      if (scopeKind === "target_profile" && scopeId.length > 0) {
        return {
          toArray: () => (input.targetPolicyRow ? [input.targetPolicyRow] : []),
        };
      }
      if (scopeKind === "space_default" && scopeId === "default") {
        return {
          toArray: () =>
            input.defaultPolicyRow ? [input.defaultPolicyRow] : [],
        };
      }
      return {
        toArray: () => [],
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

describe("space dispatch policies sql store", () => {
  it("resolves target_profile override before space_default", () => {
    const nowMs = Date.UTC(2026, 1, 28, 10, 0, 0);
    const sql = createSqlStub({
      defaultPolicyRow: {
        scope_kind: "space_default",
        scope_id: "default",
        dispatch_policy: "mention_only",
        updated_by: "system",
        updated_at_ms: nowMs,
      },
      targetPolicyRow: {
        scope_kind: "target_profile",
        scope_id: "agt-profile-1",
        dispatch_policy: "mention_only",
        updated_by: "owner:user-1",
        updated_at_ms: nowMs,
      },
    });

    const resolved = resolveSpaceDispatchPolicyForTarget(sql, {
      nowMs,
      targetProfileId: "agt-profile-1",
    });

    expect(resolved).toEqual({
      dispatchPolicy: "mention_only",
      scopeKind: "target_profile",
      scopeId: "agt-profile-1",
    });
  });

  it("falls back to space_default when target override is absent", () => {
    const nowMs = Date.UTC(2026, 1, 28, 10, 15, 0);
    const sql = createSqlStub({
      defaultPolicyRow: {
        scope_kind: "space_default",
        scope_id: "default",
        dispatch_policy: "mention_only",
        updated_by: "system",
        updated_at_ms: nowMs,
      },
    });

    const resolved = resolveSpaceDispatchPolicyForTarget(sql, {
      nowMs,
      targetProfileId: "agt-profile-2",
    });

    expect(resolved).toEqual({
      dispatchPolicy: "mention_only",
      scopeKind: "space_default",
      scopeId: "default",
    });
  });

  it("returns system default and ensures default row insert when no row exists", () => {
    const nowMs = Date.UTC(2026, 1, 28, 10, 30, 0);
    const sql = createSqlStub({});

    const resolved = resolveSpaceDispatchPolicyForTarget(sql, {
      nowMs,
      targetProfileId: "agt-profile-3",
    });

    expect(resolved).toEqual({
      dispatchPolicy: "mention_only",
      scopeKind: "system_default",
      scopeId: "default",
    });

    const execMock = (sql as unknown as { exec: ReturnType<typeof vi.fn> })
      .exec;
    const insertCall = execMock.mock.calls.find(([query]) =>
      String(query).includes("INSERT OR IGNORE INTO space_dispatch_policies")
    );
    expect(insertCall).toBeDefined();
    expect(insertCall?.[1]).toBe("space_default");
    expect(insertCall?.[2]).toBe("default");
    expect(insertCall?.[3]).toBe("mention_only");
    expect(insertCall?.[4]).toBe("system");
    expect(insertCall?.[5]).toBe(nowMs);
  });

  it("returns null when stored dispatch_policy is invalid", () => {
    const sql = createSqlStub({
      defaultPolicyRow: {
        scope_kind: "space_default",
        scope_id: "default",
        dispatch_policy: "manual",
        updated_by: "system",
        updated_at_ms: Date.UTC(2026, 1, 28, 11, 0, 0),
      },
    });

    const record = readSpaceDispatchPolicy(sql, {
      scopeKind: "space_default",
      scopeId: "default",
    });

    expect(record).toBeNull();
  });
});
