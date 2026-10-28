import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  HOSTED_CENTER_AGENT_CONTROLLER_REF,
  HOSTED_REMOTE_AGENT_CONTROLLER_REF,
} from "@openmeld/schemas";
import { describe, expect, it, onTestFinished } from "vitest";
import {
  createDispatchOutboxRecord,
  deleteDispatchOutboxRecord,
  hasRecoverableDispatchOutboxHandoffRecords,
  insertDispatchOutboxRecord,
  listDispatchOutboxRecoveryCandidates,
  markDispatchOutboxCancelled,
  markDispatchOutboxHandedOff,
} from "../src/space/infrastructure/outbox/dispatch-outbox-repo";
import { ensureSpaceSqlSchema } from "../src/space/infrastructure/sql/space-schema-repo";

describe("hosted outbox handoff recovery", () => {
  it.each([
    [HOSTED_CENTER_AGENT_CONTROLLER_REF, false, false, true],
    [HOSTED_REMOTE_AGENT_CONTROLLER_REF, true, false, true],
    ["local:codex", true, false, false],
    [null, true, false, false],
    [null, false, false, true],
    [null, true, true, true],
  ] as const)("keeps %s owner=%s recovery=%s handoffs eligible=%s until retirement", (agentControllerRef, hasOwner, hostedRecovery, eligible) => {
    const db = new DatabaseSync(":memory:");
    onTestFinished(() => db.close());
    const sql = {
      exec(query: string, ...params: SQLInputValue[]) {
        const statement = db.prepare(query);
        if (!statement.columns().length) {
          const result = statement.run(...params);
          return { rowsWritten: Number(result.changes), toArray: () => [] };
        }
        return { toArray: () => statement.all(...params) };
      },
    } as unknown as SqlStorage;
    ensureSpaceSqlSchema(sql);
    const input = {
      agentControllerRef,
      bindingEnabled: true,
      bindingState: "bound",
      dispatchPolicy: "mention_only",
      ...(hasOwner
        ? { dispatchOwner: { kind: "owner_account" as const, id: "owner-1" } }
        : {}),
      nowMs: 1_700_000_000_000,
      ruleId: "registry.default.all_members.v1",
      ruleReason: "default allow all members mention",
      ruleSource: "registry",
      senderProfileId: "human-1",
      sourceEventId: "signal-1",
      sourceSignalSnapshot: {
        profileId: "human-1",
        profileKind: "human",
        text: "Please check this request.",
      },
      spaceId: "space-1",
      targetProfileId: "agent-1",
    } as const;
    const record = createDispatchOutboxRecord(input);
    insertDispatchOutboxRecord(sql, record);
    expect(hasRecoverableDispatchOutboxHandoffRecords(sql)).toBe(false);
    // Old workstation handoffs must not consume the bounded hosted recovery batch.
    for (let index = 0; index < 21; index += 1) {
      const workstation = createDispatchOutboxRecord({
        ...input,
        agentControllerRef: "local:codex",
        nowMs: input.nowMs - 1000,
        sourceEventId: `workstation-${index}`,
      });
      insertDispatchOutboxRecord(sql, workstation);
      markDispatchOutboxHandedOff(sql, {
        dispatchId: workstation.dispatchId,
        handedOffAtMs: workstation.createdAtMs + 1,
      });
    }
    markDispatchOutboxHandedOff(sql, {
      dispatchId: record.dispatchId,
      handedOffAtMs: record.createdAtMs + 1,
      hostedAdmissionRecovery: hostedRecovery,
    });
    expect(hasRecoverableDispatchOutboxHandoffRecords(sql)).toBe(eligible);
    const candidates = listDispatchOutboxRecoveryCandidates(sql, {
      limit: 20,
      handedOffRedriveBeforeMs: input.nowMs + 100,
    });
    expect(candidates.map((candidate) => candidate.dispatchId)).toEqual(
      eligible ? [record.dispatchId] : []
    );
    if (hostedRecovery) {
      expect(candidates[0]).toMatchObject({
        deliveryRecoveryReason: "hosted_admission_incomplete",
        idempotencyKey: record.idempotencyKey,
      });
    }

    markDispatchOutboxCancelled(sql, { dispatchId: record.dispatchId });
    expect(hasRecoverableDispatchOutboxHandoffRecords(sql)).toBe(false);
    // A new independent Wake can be retired after durable admission.
    const next = createDispatchOutboxRecord({
      ...input,
      nowMs: record.createdAtMs + 2,
      sourceEventId: "signal-2",
    });
    insertDispatchOutboxRecord(sql, next);
    markDispatchOutboxHandedOff(sql, {
      dispatchId: next.dispatchId,
      handedOffAtMs: next.createdAtMs + 1,
    });
    deleteDispatchOutboxRecord(sql, { dispatchId: next.dispatchId });
    expect(hasRecoverableDispatchOutboxHandoffRecords(sql)).toBe(false);
  });
});
