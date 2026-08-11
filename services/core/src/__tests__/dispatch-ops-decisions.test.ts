import { describe, expect, it } from "vitest";
import {
  listRecentOpenMeldDaemonOpsDecisions,
  writeOpenMeldDaemonOpsDecision,
} from "../dispatch/infrastructure/d1/dispatch-ledger-d1";

type OpsDecisionRow = {
  id: string;
  decisionCode: string;
  decisionPayloadJson: string;
  decidedBy: string;
  decidedAtMs: number;
  expectedRecoveryCriteria: string | null;
  source: string;
  correlationId: string | null;
};

const createInMemoryOpsDecisionDb = () => {
  const rows: OpsDecisionRow[] = [];

  const db = {
    prepare: (query: string) => {
      const normalized = query.toLowerCase().replace(/\s+/g, " ").trim();
      const queryIncludes = (sql: string) =>
        normalized.includes(sql.toLowerCase());
      return {
        bind: (...args: unknown[]) => ({
          run: () => {
            if (!queryIncludes("insert into openMeldDaemon_ops_decisions")) {
              throw new Error(`unsupported run query: ${query}`);
            }
            const [
              id,
              decisionCode,
              decisionPayloadJson,
              decidedBy,
              decidedAtMs,
              expectedRecoveryCriteria,
              source,
              correlationId,
            ] = args;
            rows.push({
              id: String(id ?? ""),
              decisionCode: String(decisionCode ?? ""),
              decisionPayloadJson: String(decisionPayloadJson ?? "null"),
              decidedBy: String(decidedBy ?? ""),
              decidedAtMs: Number(decidedAtMs ?? 0),
              expectedRecoveryCriteria:
                typeof expectedRecoveryCriteria === "string"
                  ? expectedRecoveryCriteria
                  : null,
              source: String(source ?? ""),
              correlationId:
                typeof correlationId === "string" ? correlationId : null,
            });
            return Promise.resolve({ success: true });
          },
          all: () => {
            if (!queryIncludes("from openMeldDaemon_ops_decisions")) {
              throw new Error(`unsupported all query: ${query}`);
            }
            const hasCorrelationFilter = normalized.includes(
              "where correlation_id = ?"
            );
            const hasDecisionFilter = normalized.includes("decision_code = ?");
            let argIndex = 0;
            const correlationId = hasCorrelationFilter
              ? args[argIndex++]
              : null;
            const decisionCode = hasDecisionFilter ? args[argIndex++] : null;
            const limit = args[argIndex];
            const normalizedCorrelationId =
              typeof correlationId === "string" ? correlationId : null;
            const normalizedDecisionCode =
              typeof decisionCode === "string" ? decisionCode : null;
            const safeLimit = Math.max(1, Number(limit ?? 1));

            const filtered = rows
              .filter((row) => {
                if (
                  normalizedDecisionCode &&
                  row.decisionCode !== normalizedDecisionCode
                ) {
                  return false;
                }
                if (
                  normalizedCorrelationId &&
                  row.correlationId !== normalizedCorrelationId
                ) {
                  return false;
                }
                return true;
              })
              .sort((left, right) => right.decidedAtMs - left.decidedAtMs)
              .slice(0, safeLimit)
              .map((row) => ({
                id: row.id,
                decision_code: row.decisionCode,
                decision_payload_json: row.decisionPayloadJson,
                decided_by: row.decidedBy,
                decided_at_ms: row.decidedAtMs,
                expected_recovery_criteria: row.expectedRecoveryCriteria,
                source: row.source,
                correlation_id: row.correlationId,
              }));

            return Promise.resolve({ results: filtered });
          },
        }),
      };
    },
  } as unknown as D1Database;

  return {
    db,
  };
};

describe("dispatch ops decisions store", () => {
  it("writes ops decision row with payload json", async () => {
    const { db } = createInMemoryOpsDecisionDb();

    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "dispatch.window.risk",
      decisionPayload: {
        queueLagMs: 123,
        dispatchId: "dispatch-1",
      },
      decidedBy: "core.dispatch_queue.risk",
      decidedAtMs: 1000,
      expectedRecoveryCriteria: "queue lag recovers",
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-1",
    });

    const rows = await listRecentOpenMeldDaemonOpsDecisions({
      db,
      limit: 10,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        decisionCode: "dispatch.window.risk",
        decidedBy: "core.dispatch_queue.risk",
        source: "dispatch_queue_consumer",
        correlationId: "dispatch-1",
      })
    );
    expect(JSON.parse(rows[0]?.decisionPayloadJson ?? "null")).toEqual({
      queueLagMs: 123,
      dispatchId: "dispatch-1",
    });
  });

  it("stores stale lease audit payload with traceable identifiers", async () => {
    const { db } = createInMemoryOpsDecisionDb();

    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "core.dispatch_queue.stale_lease",
      decisionPayload: {
        dispatchId: "dispatch-stale-1",
        profileId: "agent-1",
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 7,
        reasonCode: "stale_lease_result_rejected",
        retryCount: 3,
      },
      decidedBy: "core.dispatch_queue.stale_lease_audit",
      decidedAtMs: 2000,
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-stale-1",
    });

    const rows = await listRecentOpenMeldDaemonOpsDecisions({
      db,
      limit: 10,
    });

    const payload = JSON.parse(rows[0]?.decisionPayloadJson ?? "{}");
    expect(payload).toEqual(
      expect.objectContaining({
        dispatchId: "dispatch-stale-1",
        profileId: "agent-1",
        daemonSessionId: "daemon-session-1",
        leaseEpoch: 7,
        reasonCode: "stale_lease_result_rejected",
        retryCount: 3,
      })
    );
  });

  it("filters recent decisions by decisionCode and correlationId", async () => {
    const { db } = createInMemoryOpsDecisionDb();

    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "controller.binding.lookup_failed",
      decisionPayload: { bindingSource: "auth_rpc" },
      decidedBy: "core.dispatch_queue.preflight",
      decidedAtMs: 3000,
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-2",
    });
    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "controller.binding.lookup_failed",
      decisionPayload: { bindingSource: "auth_rpc" },
      decidedBy: "core.dispatch_queue.preflight",
      decidedAtMs: 2000,
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-3",
    });
    await writeOpenMeldDaemonOpsDecision({
      db,
      decisionCode: "dispatch.window.risk",
      decisionPayload: { queueLagMs: 999 },
      decidedBy: "core.dispatch_queue.risk",
      decidedAtMs: 1000,
      source: "dispatch_queue_consumer",
      correlationId: "dispatch-4",
    });

    const lookupOnly = await listRecentOpenMeldDaemonOpsDecisions({
      db,
      limit: 10,
      decisionCode: "controller.binding.lookup_failed",
    });
    expect(lookupOnly).toHaveLength(2);
    expect(lookupOnly[0]?.decidedAtMs).toBeGreaterThan(
      lookupOnly[1]?.decidedAtMs ?? 0
    );

    const byCorrelation = await listRecentOpenMeldDaemonOpsDecisions({
      db,
      limit: 10,
      decisionCode: "controller.binding.lookup_failed",
      correlationId: "dispatch-3",
    });
    expect(byCorrelation).toHaveLength(1);
    expect(byCorrelation[0]).toEqual(
      expect.objectContaining({
        decisionCode: "controller.binding.lookup_failed",
        correlationId: "dispatch-3",
      })
    );
  });
});
