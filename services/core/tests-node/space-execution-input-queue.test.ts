import { DatabaseSync } from "node:sqlite";
import type {
  RemoteAgentWorkerExecutionInputRequest,
  SignalEnvelope,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
  claimQueuedSpaceExecutionInput,
  deleteQueuedSpaceExecutionInput,
  ensureSpaceExecutionInputOutbox,
  insertSpaceExecutionInput,
  listQueuedSpaceExecutionInputs,
  readNextSpaceExecutionInputAlarm,
  readSpaceExecutionInput,
  reorderQueuedSpaceExecutionInputs,
  settleQueuedSpaceExecutionInput,
} from "../src/space/infrastructure/sql/space-execution-input-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";

function fixture(run: (sql: SqlStorage) => void) {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...params: (string | number | null)[]) {
      const rows = db.prepare(query).all(...params);
      return { toArray: () => rows };
    },
  } as unknown as SqlStorage;
  try {
    ensureSpaceExecutionInputOutbox(sql);
    run(sql);
  } finally {
    db.close();
  }
}

function enqueue(sql: SqlStorage, inputId: string, queued = true) {
  insertSpaceExecutionInput(sql, {
    request: {
      inputId,
      authorProfileId: "human-1",
      sourceSignalId: `signal-${inputId}`,
      text: inputId,
      target: {
        v: 1,
        organizationId: "org",
        spaceId: "space",
        submissionId: "submission",
        idempotencyKey: "delivery",
      },
    } satisfies RemoteAgentWorkerExecutionInputRequest,
    signal: {
      v: 1,
      id: `signal-${inputId}`,
      spaceId: "space",
      ts: 1,
      profile: { kind: "human", profileId: "human-1", profileName: "Morgan" },
      type: "signal.text",
      data: {
        text: inputId,
        meta: {
          centerAgentExecutionInput: {
            dispatchId: "dispatch",
            targetProfileId: "agt_11111111-1111-4111-8111-111111111111",
          },
        },
      },
    } satisfies SignalEnvelope,
    nowMs: 1,
    queued,
  });
}

describe("Space pending input ownership", () => {
  it("reorders only the caller's slots without moving another author's message", () => {
    fixture((sql) => {
      for (const id of ["a", "other", "b"]) {
        enqueue(sql, id);
      }
      sql.exec(
        "UPDATE space_execution_input_outbox SET signal_json = json_set(signal_json, '$.profile.profileId', 'other-author') WHERE input_id = 'other'"
      );
      expect(
        reorderQueuedSpaceExecutionInputs(
          sql,
          ["a", "b"],
          ["b", "a"],
          "human-1"
        )
      ).toBe(true);
      expect(
        listQueuedSpaceExecutionInputs(sql).map((item) => item.inputId)
      ).toEqual(["b", "other", "a"]);
      expect(
        reorderQueuedSpaceExecutionInputs(
          sql,
          ["b", "other", "a"],
          ["other", "b", "a"],
          "human-1"
        )
      ).toBe(false);
    });
  });
  it("upgrades the previous Space schema without turning accepted inputs into pending Queue work", () => {
    fixture((sql) => {
      ensureSpaceSqlSchema(sql);
      enqueue(sql, "legacy-input", false);
      for (const column of [
        "queue_state",
        "queue_position",
        "queue_claim",
        "queue_receipt_due_at_ms",
        "queue_blocked",
      ]) {
        sql.exec(
          `ALTER TABLE space_execution_input_outbox DROP COLUMN ${column}`
        );
      }
      sql.exec("DELETE FROM schema_migrations WHERE version >= 49");
      sql.exec(
        "INSERT OR IGNORE INTO schema_migrations (version, checksum, applied_at) VALUES (48, 'space-sql-schema-v48', 0)"
      );
      ensureSpaceSqlSchema(sql);
      ensureSpaceSqlSchema(sql);
      expect(readSpaceExecutionInput(sql, "legacy-input")?.queued).toBe(false);
      expect(readNextSpaceExecutionInputAlarm(sql)).toBe(1);
      expect(listQueuedSpaceExecutionInputs(sql)).toEqual([]);
      enqueue(sql, "new-input");
      expect(
        listQueuedSpaceExecutionInputs(sql).map((item) => item.inputId)
      ).toEqual(["new-input"]);
    });
  });

  it("consumes the displayed order and excludes deleted or already claimed inputs", () => {
    fixture((sql) => {
      for (const id of ["a", "b", "c"]) {
        enqueue(sql, id);
      }
      expect(
        reorderQueuedSpaceExecutionInputs(sql, ["a", "b", "c"], ["c", "b", "a"])
      ).toBe(true);
      expect(deleteQueuedSpaceExecutionInput(sql, "b", "human-1")).toBe(true);
      expect(
        listQueuedSpaceExecutionInputs(sql).map((item) => item.inputId)
      ).toEqual(["c", "a"]);
      expect(claimQueuedSpaceExecutionInput(sql, "a", "consume")).toBe(false);
      expect(claimQueuedSpaceExecutionInput(sql, "c", "consume")).toBe(true);
      expect(deleteQueuedSpaceExecutionInput(sql, "c", "human-1")).toBe(false);
      expect(claimQueuedSpaceExecutionInput(sql, "c", "steer")).toBe(false);
      expect(claimQueuedSpaceExecutionInput(sql, "a", "consume")).toBe(false);
      expect(
        reorderQueuedSpaceExecutionInputs(sql, ["c", "a"], ["a", "c"])
      ).toBe(false);
      settleQueuedSpaceExecutionInput(sql, "c", "consume", "applied");
      expect(claimQueuedSpaceExecutionInput(sql, "a", "consume")).toBe(true);
    });
  });

  it("holds an uncertain Steer, never consumes it again, and requires its exact claim to settle", () => {
    fixture((sql) => {
      enqueue(sql, "a");
      enqueue(sql, "b");
      expect(deleteQueuedSpaceExecutionInput(sql, "a", "another-member")).toBe(
        false
      );
      expect(claimQueuedSpaceExecutionInput(sql, "b", "steer")).toBe(true);
      // The prior Core's forwarding query must not rediscover a Queue claim.
      expect(
        sql
          .exec(
            "SELECT input_id FROM space_execution_input_outbox WHERE next_attempt_at_ms IS NOT NULL"
          )
          .toArray()
      ).toEqual([]);
      expect(
        settleQueuedSpaceExecutionInput(sql, "b", "consume", "applied")
      ).toBe(false);
      expect(
        settleQueuedSpaceExecutionInput(sql, "b", "steer", "unconfirmed")
      ).toBe(true);
      expect(claimQueuedSpaceExecutionInput(sql, "a", "consume")).toBe(false);
      expect(claimQueuedSpaceExecutionInput(sql, "b", "steer")).toBe(false);
      expect(deleteQueuedSpaceExecutionInput(sql, "b", "human-1")).toBe(false);
      expect(
        listQueuedSpaceExecutionInputs(sql).find((item) => item.inputId === "b")
          ?.state
      ).toBe("unconfirmed");
      expect(
        settleQueuedSpaceExecutionInput(sql, "b", "steer", "applied")
      ).toBe(true);
      expect(claimQueuedSpaceExecutionInput(sql, "b", "consume")).toBe(false);
      expect(claimQueuedSpaceExecutionInput(sql, "a", "consume")).toBe(true);
    });
  });

  it("keeps rejected input queued but blocks automatic consumption and stale reorder", () => {
    fixture((sql) => {
      enqueue(sql, "a");
      enqueue(sql, "b");
      expect(claimQueuedSpaceExecutionInput(sql, "a", "steer")).toBe(true);
      expect(
        settleQueuedSpaceExecutionInput(sql, "a", "steer", "rejected")
      ).toBe(true);
      expect(
        listQueuedSpaceExecutionInputs(sql).map((item) => item.inputId)
      ).toEqual(["a", "b"]);
      expect(claimQueuedSpaceExecutionInput(sql, "a", "consume")).toBe(false);
      expect(claimQueuedSpaceExecutionInput(sql, "b", "consume")).toBe(false);
      enqueue(sql, "c");
      expect(
        reorderQueuedSpaceExecutionInputs(sql, ["a", "b"], ["b", "a"])
      ).toBe(false);
      expect(
        reorderQueuedSpaceExecutionInputs(sql, ["a", "b", "c"], ["b", "b", "c"])
      ).toBe(false);
      expect(deleteQueuedSpaceExecutionInput(sql, "a", "human-1")).toBe(true);
      expect(claimQueuedSpaceExecutionInput(sql, "b", "consume")).toBe(true);
    });
  });
});
