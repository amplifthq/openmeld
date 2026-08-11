import { describe, expect, it, vi } from "vitest";
import {
  readSpaceContractRecordFromSql,
  readSpaceContractRecordStateFromSql,
  repairSpaceContractRecordIfNeeded,
} from "../space/infrastructure/sql/space-contract-repo";

function createSqlStub(
  row: Record<string, unknown> | null,
  options?: {
    failOnWrite?: boolean;
  }
): SqlStorage {
  const exec = vi.fn((query: string) => {
    if (query.includes("SELECT")) {
      return {
        next: () =>
          row === null
            ? ({ done: true } as const)
            : ({ done: false, value: row } as const),
      };
    }

    if (options?.failOnWrite) {
      throw new Error("write failed");
    }

    return {
      next: () => ({ done: true }) as const,
    };
  });

  return {
    exec,
  } as unknown as SqlStorage;
}

describe("space-contract-repo", () => {
  it("reports the negative timestamp lower bound accurately", () => {
    const sql = createSqlStub({
      contract_json: JSON.stringify({
        dispatchPolicy: {
          mode: "mention_only",
        },
        publicationMode: "collaboration",
        allowedActions: ["post_message", "post_status", "stay_silent"],
        resultArchivePolicy: {
          mode: "all_final_results",
        },
        authorityOrder: "default",
        entryBrief: "default",
        dispatchBrief: "default",
      }),
      version: 1,
      updated_at: -8_640_000_000_000_001,
      updated_by: "system",
    });

    expect(() =>
      readSpaceContractRecordFromSql(
        sql,
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
      )
    ).toThrow(
      "timestamp -8640000000000001 is below -MAX_DATE_TIMESTAMP_MS=-8640000000000000"
    );
  });

  it("migrates legacy contract fields and reports rewrite state", () => {
    const sql = createSqlStub({
      contract_json: JSON.stringify({
        dispatchPolicy: {
          mode: "mention_only",
        },
        replyPolicy: {
          defaultReplyBehavior: "system_status",
          agentCanPostMessages: true,
        },
        resultArchivePolicy: {
          mode: "all_final_results",
        },
        authorityOrder: "default",
        entryBrief: "default",
        dispatchBrief: "default",
      }),
      version: 1,
      updated_at: 1_773_899_614_583,
      updated_by: "system",
    });

    const state = readSpaceContractRecordStateFromSql(
      sql,
      "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd"
    );

    expect(state).toEqual({
      contract: {
        version: 1,
        updatedAt: "2026-03-19T05:53:34.583Z",
        updatedBy: "system",
        dispatchPolicy: {
          mode: "mention_only",
        },
        publicationMode: "collaboration",
        allowedActions: ["post_message", "post_status", "stay_silent"],
        resultArchivePolicy: {
          mode: "all_final_results",
        },
        authorityOrder: "default",
        entryBrief: "default",
        dispatchBrief: "default",
      },
      needsRewrite: true,
    });
    expect(sql.exec).toHaveBeenCalledTimes(1);
  });

  it("repairs legacy contract records in canonical format when rewrite is needed", () => {
    const sql = createSqlStub({
      contract_json: JSON.stringify({
        dispatchPolicy: {
          mode: "mention_only",
        },
        replyPolicy: {
          defaultReplyBehavior: "system_status",
          agentCanPostMessages: true,
        },
        resultArchivePolicy: {
          mode: "all_final_results",
        },
        authorityOrder: "default",
        entryBrief: "default",
        dispatchBrief: "default",
      }),
      version: 1,
      updated_at: 1_773_899_614_583,
      updated_by: "system",
    });
    const state = readSpaceContractRecordStateFromSql(
      sql,
      "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd"
    );

    expect(state).not.toBeNull();
    if (!state) {
      return;
    }

    repairSpaceContractRecordIfNeeded(sql, {
      spaceId:
        "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
      contract: state.contract,
      needsRewrite: state.needsRewrite,
    });

    expect(sql.exec).toHaveBeenCalledTimes(2);
    expect(sql.exec).toHaveBeenLastCalledWith(
      expect.stringContaining("INSERT INTO space_contracts"),
      "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
      JSON.stringify({
        dispatchPolicy: {
          mode: "mention_only",
        },
        publicationMode: "collaboration",
        allowedActions: ["post_message", "post_status", "stay_silent"],
        resultArchivePolicy: {
          mode: "all_final_results",
        },
        authorityOrder: "default",
        entryBrief: "default",
        dispatchBrief: "default",
      }),
      1,
      1_773_899_614_583,
      "system"
    );
  });

  it("returns the parsed contract when rewrite repair fails", () => {
    const sql = createSqlStub(
      {
        contract_json: JSON.stringify({
          dispatchPolicy: {
            mode: "mention_only",
          },
          replyPolicy: {
            defaultReplyBehavior: "system_status",
            agentCanPostMessages: true,
          },
          resultArchivePolicy: {
            mode: "all_final_results",
          },
          authorityOrder: "default",
          entryBrief: "default",
          dispatchBrief: "default",
        }),
        version: 1,
        updated_at: 1_773_899_614_583,
        updated_by: "system",
      },
      {
        failOnWrite: true,
      }
    );
    const state = readSpaceContractRecordStateFromSql(
      sql,
      "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd"
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect(state?.contract).toEqual(
      readSpaceContractRecordFromSql(
        createSqlStub({
          contract_json: JSON.stringify({
            dispatchPolicy: {
              mode: "mention_only",
            },
            replyPolicy: {
              defaultReplyBehavior: "system_status",
              agentCanPostMessages: true,
            },
            resultArchivePolicy: {
              mode: "all_final_results",
            },
            authorityOrder: "default",
            entryBrief: "default",
            dispatchBrief: "default",
          }),
          version: 1,
          updated_at: 1_773_899_614_583,
          updated_by: "system",
        }),
        "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd"
      )
    );
    if (!state) {
      warn.mockRestore();
      return;
    }

    expect(() =>
      repairSpaceContractRecordIfNeeded(sql, {
        spaceId:
          "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
        contract: state.contract,
        needsRewrite: state.needsRewrite,
      })
    ).not.toThrow();
    expect(warn).toHaveBeenCalledWith(
      "[core.openmeld.space.contract_rewrite_failed]",
      expect.objectContaining({
        spaceId:
          "ab1c3286d92926cc07e70b4023d24a359387d250f670619af138c3a767f92efd",
        error: expect.any(Error),
      })
    );
    warn.mockRestore();
  });
});
