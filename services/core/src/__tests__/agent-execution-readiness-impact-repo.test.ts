import { describe, expect, it } from "vitest";
import {
  clearAgentExecutionReadinessImpactForExecutionRunning,
  clearAgentExecutionReadinessImpactForExecutionSuccess,
  isAcceptedAgentExecutionReadinessImpactReasonCode,
  readFreshAgentExecutionReadinessImpactForBinding,
  resolveAcceptedAgentExecutionReadinessImpactReasonCode,
  writeAcceptedAgentExecutionReadinessImpact,
  writeAgentExecutionReadinessImpact,
} from "../agent-execution/infrastructure/d1/agent-execution-readiness-impact-repo";

const IMPACT_TTL_MS = 30 * 60 * 1000;

describe("agent execution readiness impact repo", () => {
  it.each([
    "controller.launch.choice_required",
    "controller.launch.needs_repair",
    "controller.client.upgrade_required",
    "controller.runtime.missing",
    "runtime_coordinator.delivery_expired",
    "workspace.invalid",
    "workspace.missing",
  ])("returns only fresh uncleared readiness impacts for reason code %s", async (reasonCode) => {
    const db = createReadinessImpactDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await expect(
      writeAgentExecutionReadinessImpact({
        agentProfileId: "agt-1",
        db,
        executionIdentity,
        observedAtMs: 1000,
        reasonCode,
        sourceAttemptId: "attempt-1",
        sourceDispatchId: "dispatch-1",
      })
    ).resolves.toBe("written");

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 1000 + IMPACT_TTL_MS - 1,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      expiresAtMs: 1000 + IMPACT_TTL_MS,
      impactKind: "local_execution",
      observedAtMs: 1000,
      reasonCode,
      source: "wake_failure",
    });

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 1000 + IMPACT_TTL_MS,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();

    await clearAgentExecutionReadinessImpactForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 2000,
      db,
      executionIdentity,
      sourceDispatchId: "dispatch-success",
    });

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
  });

  it.each([
    "runtime.reply.empty_output",
  ])("ignores reason code %s outside the shared impact taxonomy", async (reasonCode) => {
    const db = createReadinessImpactDb();

    await expect(
      writeAgentExecutionReadinessImpact({
        agentProfileId: "agt-1",
        db,
        executionIdentity: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        },
        observedAtMs: 1000,
        reasonCode,
        sourceAttemptId: "attempt-1",
        sourceDispatchId: "dispatch-1",
      })
    ).resolves.toBe("not_applicable");

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 1001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
  });

  it("keeps the accepted-result wrapper compatible", async () => {
    const db = createReadinessImpactDb();

    await expect(
      writeAcceptedAgentExecutionReadinessImpact({
        agentProfileId: "agt-1",
        db,
        executionIdentity: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        },
        observedAtMs: 1000,
        reasonCode: "controller.runtime.missing",
        sourceAttemptId: "attempt-1",
        sourceDispatchId: "dispatch-1",
      })
    ).resolves.toBe("written");

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 1001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      reasonCode: "controller.runtime.missing",
    });
  });

  it("normalizes accepted workspace failure aliases before storage", async () => {
    const db = createReadinessImpactDb();

    await expect(
      writeAcceptedAgentExecutionReadinessImpact({
        agentProfileId: "agt-1",
        db,
        executionIdentity: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:codex",
          openMeldServiceRuntimeId: "runtime-1",
        },
        observedAtMs: 1000,
        reasonCode: "profile.workspace.missing",
        sourceAttemptId: "attempt-1",
        sourceDispatchId: "dispatch-1",
      })
    ).resolves.toBe("written");

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 1001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      reasonCode: "workspace.missing",
    });
    expect(db.readRows()[0]?.reasonCode).toBe("workspace.missing");
  });

  it("does not let impacts for another execution scope block this target", async () => {
    const db = createReadinessImpactDb();

    await writeAgentExecutionReadinessImpact({
      agentProfileId: "agt-1",
      db,
      executionIdentity: {
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      observedAtMs: 1000,
      reasonCode: "runtime_coordinator.delivery_expired",
      sourceAttemptId: "attempt-1",
      sourceDispatchId: "dispatch-1",
    });

    for (const scope of [
      {
        agentProfileId: "agt-2",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      {
        agentProfileId: "agt-1",
        bindingId: "binding-2",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      {
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-1",
      },
      {
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-2",
      },
    ]) {
      await expect(
        readFreshAgentExecutionReadinessImpactForBinding({
          ...scope,
          db,
          nowMs: 1001,
        })
      ).resolves.toBeNull();
    }
  });

  it("clears only matching execution-scope impacts after success", async () => {
    const db = createReadinessImpactDb();

    await writeAgentExecutionReadinessImpact({
      agentProfileId: "agt-1",
      db,
      executionIdentity: {
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      observedAtMs: 1000,
      reasonCode: "runtime_coordinator.delivery_expired",
      sourceAttemptId: "attempt-1",
      sourceDispatchId: "dispatch-1",
    });
    await writeAgentExecutionReadinessImpact({
      agentProfileId: "agt-1",
      db,
      executionIdentity: {
        bindingId: "binding-2",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      observedAtMs: 1000,
      reasonCode: "runtime_coordinator.delivery_expired",
      sourceAttemptId: "attempt-2",
      sourceDispatchId: "dispatch-2",
    });

    await clearAgentExecutionReadinessImpactForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 2000,
      db,
      executionIdentity: {
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      sourceDispatchId: "dispatch-success",
    });

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-2",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      reasonCode: "runtime_coordinator.delivery_expired",
    });
  });

  it("clears a stale blocker when the same execution scope is confirmed running", async () => {
    const db = createReadinessImpactDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await writeAgentExecutionReadinessImpact({
      agentProfileId: "agt-1",
      db,
      executionIdentity,
      observedAtMs: 1000,
      reasonCode: "controller.launch.needs_repair",
      sourceAttemptId: "attempt-failed",
      sourceDispatchId: "dispatch-failed",
    });

    await clearAgentExecutionReadinessImpactForExecutionRunning({
      agentProfileId: "agt-1",
      clearedAtMs: 2000,
      db,
      executionAuthorizedAtMs: 1500,
      executionIdentity,
      sourceDispatchId: "dispatch-running",
    });

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
    expect(db.readRows()[0]).toMatchObject({
      clearedAtMs: 2000,
      clearedByDispatchId: "dispatch-running",
    });
  });

  it("does not let a late running lifecycle clear a newer blocker from another execution", async () => {
    const db = createReadinessImpactDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await writeAgentExecutionReadinessImpact({
      agentProfileId: "agt-1",
      db,
      executionIdentity,
      observedAtMs: 2000,
      reasonCode: "controller.launch.needs_repair",
      sourceAttemptId: "attempt-newer",
      sourceDispatchId: "dispatch-newer",
    });

    await clearAgentExecutionReadinessImpactForExecutionRunning({
      agentProfileId: "agt-1",
      clearedAtMs: 3000,
      db,
      executionAuthorizedAtMs: 1500,
      executionIdentity,
      sourceDispatchId: "dispatch-older",
    });

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 3001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      observedAtMs: 2000,
      reasonCode: "controller.launch.needs_repair",
    });
    expect(db.readRows()[0]).toMatchObject({
      clearedAtMs: null,
      clearedByDispatchId: null,
    });
  });

  it("clears a newer blocker when it belongs to the execution now running", async () => {
    const db = createReadinessImpactDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await writeAgentExecutionReadinessImpact({
      agentProfileId: "agt-1",
      db,
      executionIdentity,
      observedAtMs: 2000,
      reasonCode: "controller.launch.needs_repair",
      sourceAttemptId: "attempt-running",
      sourceDispatchId: "dispatch-running",
    });

    await clearAgentExecutionReadinessImpactForExecutionRunning({
      agentProfileId: "agt-1",
      clearedAtMs: 3000,
      db,
      executionAuthorizedAtMs: 1500,
      executionIdentity,
      sourceDispatchId: "dispatch-running",
    });

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 3001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
  });

  it("does not let newer non-taxonomy impact rows hide the latest valid blocker", async () => {
    const db = createReadinessImpactDb();

    await writeAgentExecutionReadinessImpact({
      agentProfileId: "agt-1",
      db,
      executionIdentity: {
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      observedAtMs: 1000,
      reasonCode: "runtime_coordinator.delivery_expired",
      sourceAttemptId: "attempt-1",
      sourceDispatchId: "dispatch-1",
    });
    db.seedRow({
      agentProfileId: "agt-1",
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      impactKind: "future_readiness_signal",
      observedAtMs: 2000,
      reasonCode: "future.reason",
      openMeldServiceRuntimeId: "runtime-1",
      source: "future_source",
    });

    await expect(
      readFreshAgentExecutionReadinessImpactForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      impactKind: "local_execution",
      observedAtMs: 1000,
      reasonCode: "runtime_coordinator.delivery_expired",
      source: "wake_failure",
    });
  });

  it("does not clear non-taxonomy or non-success-clearable impact rows", async () => {
    const db = createReadinessImpactDb();

    await writeAgentExecutionReadinessImpact({
      agentProfileId: "agt-1",
      db,
      executionIdentity: {
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      observedAtMs: 1000,
      reasonCode: "controller.runtime.missing",
      sourceAttemptId: "attempt-1",
      sourceDispatchId: "dispatch-1",
    });
    db.seedRow({
      agentProfileId: "agt-1",
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      impactKind: "future_manual_review",
      observedAtMs: 2000,
      reasonCode: "future.manual_review",
      openMeldServiceRuntimeId: "runtime-1",
      source: "future_source",
    });

    await clearAgentExecutionReadinessImpactForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 3000,
      db,
      executionIdentity: {
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-1",
      },
      sourceDispatchId: "dispatch-success",
    });

    expect(
      db
        .readRows()
        .filter(
          (row) =>
            row.agentProfileId === "agt-1" &&
            row.bindingId === "binding-1" &&
            row.openMeldServiceRuntimeId === "runtime-1" &&
            row.agentControllerRef === "builtin:codex"
        )
        .map((row) => ({
          clearedAtMs: row.clearedAtMs,
          impactKind: row.impactKind,
          reasonCode: row.reasonCode,
        }))
    ).toEqual([
      {
        clearedAtMs: 3000,
        impactKind: "local_execution",
        reasonCode: "controller.runtime.missing",
      },
      {
        clearedAtMs: null,
        impactKind: "future_manual_review",
        reasonCode: "future.manual_review",
      },
    ]);
  });

  it("uses the shared taxonomy allowlist for accepted readiness impact reasons", () => {
    for (const reasonCode of [
      "controller.launch.choice_required",
      "controller.launch.needs_repair",
      "controller.client.upgrade_required",
      "controller.runtime.missing",
      "runtime_coordinator.delivery_expired",
      "workspace.invalid",
      "workspace.missing",
    ]) {
      expect(
        isAcceptedAgentExecutionReadinessImpactReasonCode(reasonCode)
      ).toBe(true);
      expect(
        resolveAcceptedAgentExecutionReadinessImpactReasonCode(reasonCode)
      ).toBe(reasonCode);
    }
    expect(
      resolveAcceptedAgentExecutionReadinessImpactReasonCode(
        "profile.workspace.invalid"
      )
    ).toBe("workspace.invalid");
    expect(
      resolveAcceptedAgentExecutionReadinessImpactReasonCode(
        "profile.workspace.missing"
      )
    ).toBe("workspace.missing");

    for (const reasonCode of [
      "daemon.delivery.execution_stalled",
      "daemon.delivery.start_timeout",
      "runtime.reply.empty_output",
      "runtime.reply.metadata_missing.agent_controller_ref",
      "reply.publication_failed",
    ]) {
      expect(
        isAcceptedAgentExecutionReadinessImpactReasonCode(reasonCode)
      ).toBe(false);
      expect(
        resolveAcceptedAgentExecutionReadinessImpactReasonCode(reasonCode)
      ).toBeNull();
    }
  });
});

type ReadinessImpactRow = {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  clearedAtMs: number | null;
  clearedByDispatchId: string | null;
  createdAtMs: number;
  expiresAtMs: number;
  impactId: string;
  impactKind: string;
  observedAtMs: number;
  reasonCode: string;
  openMeldServiceRuntimeId: string;
  source: string;
  sourceAttemptId: string;
  sourceDispatchId: string;
  updatedAtMs: number;
};

type ReadinessImpactDbHarness = D1Database & {
  readRows: () => readonly ReadinessImpactRow[];
  seedRow: (
    row: Pick<
      ReadinessImpactRow,
      | "agentProfileId"
      | "bindingId"
      | "agentControllerRef"
      | "impactKind"
      | "observedAtMs"
      | "reasonCode"
      | "openMeldServiceRuntimeId"
      | "source"
    >
  ) => void;
};

function createReadinessImpactDb(): ReadinessImpactDbHarness {
  const rowsByKey = new Map<string, ReadinessImpactRow>();
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        all: () => {
          const [
            agentProfileId,
            bindingId,
            openMeldServiceRuntimeId,
            agentControllerRef,
            nowMs,
          ] = args;
          const results = [...rowsByKey.values()]
            .filter(
              (candidate) =>
                candidate.agentProfileId === agentProfileId &&
                candidate.bindingId === bindingId &&
                candidate.openMeldServiceRuntimeId ===
                  openMeldServiceRuntimeId &&
                candidate.agentControllerRef === agentControllerRef &&
                candidate.clearedAtMs === null &&
                candidate.expiresAtMs > Number(nowMs)
            )
            .sort((left, right) => right.observedAtMs - left.observedAtMs)
            .map((row) => ({
              expiresAtMs: row.expiresAtMs,
              impactKind: row.impactKind,
              observedAtMs: row.observedAtMs,
              reasonCode: row.reasonCode,
              source: row.source,
            }));
          return { results };
        },
        run: () => {
          if (
            sql.includes(
              "INSERT INTO openMeldDaemon_agent_execution_readiness_impacts"
            )
          ) {
            const row = buildReadinessImpactRow(args);
            rowsByKey.set(buildReadinessImpactKey(row), row);
            return { success: true };
          }
          if (
            sql.includes(
              "UPDATE openMeldDaemon_agent_execution_readiness_impacts"
            )
          ) {
            const [
              clearedAtMs,
              clearedByDispatchId,
              updatedAtMs,
              agentProfileId,
              bindingId,
              openMeldServiceRuntimeId,
              agentControllerRef,
              ...remainingBindings
            ] = args;
            const hasRunningExecutionBoundary = sql.includes(
              "observed_at_ms <= ?"
            );
            const executionAuthorizedAtMs = hasRunningExecutionBoundary
              ? Number(remainingBindings[0])
              : null;
            const matchingSourceDispatchId = hasRunningExecutionBoundary
              ? String(remainingBindings[1])
              : null;
            const taxonomyBindings = hasRunningExecutionBoundary
              ? remainingBindings.slice(2)
              : remainingBindings;
            const clearableRows = toTaxonomyBindingSet(taxonomyBindings);
            for (const [key, row] of rowsByKey.entries()) {
              if (
                row.agentProfileId === agentProfileId &&
                row.bindingId === bindingId &&
                row.openMeldServiceRuntimeId === openMeldServiceRuntimeId &&
                row.agentControllerRef === agentControllerRef &&
                row.clearedAtMs === null &&
                (!hasRunningExecutionBoundary ||
                  row.observedAtMs <= Number(executionAuthorizedAtMs) ||
                  row.sourceDispatchId === matchingSourceDispatchId) &&
                clearableRows.has(buildTaxonomyBindingKey(row))
              ) {
                rowsByKey.set(key, {
                  ...row,
                  clearedAtMs: Number(clearedAtMs),
                  clearedByDispatchId: String(clearedByDispatchId),
                  updatedAtMs: Number(updatedAtMs),
                });
              }
            }
            return { success: true };
          }
          throw new Error(`unexpected SQL: ${sql}`);
        },
      }),
    }),
    readRows: () => [...rowsByKey.values()],
    seedRow: (
      row: Pick<
        ReadinessImpactRow,
        | "agentProfileId"
        | "bindingId"
        | "agentControllerRef"
        | "impactKind"
        | "observedAtMs"
        | "reasonCode"
        | "openMeldServiceRuntimeId"
        | "source"
      >
    ) => {
      const fullRow: ReadinessImpactRow = {
        ...row,
        clearedAtMs: null,
        clearedByDispatchId: null,
        createdAtMs: row.observedAtMs,
        expiresAtMs: row.observedAtMs + IMPACT_TTL_MS,
        impactId: [
          "readiness_impact",
          row.impactKind,
          row.agentProfileId,
          row.bindingId,
          row.openMeldServiceRuntimeId,
          row.agentControllerRef,
        ].join(":"),
        sourceAttemptId: "seed-attempt",
        sourceDispatchId: "seed-dispatch",
        updatedAtMs: row.observedAtMs,
      };
      rowsByKey.set(buildReadinessImpactKey(fullRow), fullRow);
    },
  } as unknown as ReadinessImpactDbHarness;
}

function buildReadinessImpactRow(args: readonly unknown[]): ReadinessImpactRow {
  const [
    impactId,
    impactKind,
    agentProfileId,
    bindingId,
    openMeldServiceRuntimeId,
    agentControllerRef,
    reasonCode,
    source,
    sourceDispatchId,
    sourceAttemptId,
    observedAtMs,
    expiresAtMs,
    createdAtMs,
    updatedAtMs,
  ] = args;
  return {
    agentProfileId: String(agentProfileId),
    bindingId: String(bindingId),
    agentControllerRef: String(agentControllerRef),
    clearedAtMs: null,
    clearedByDispatchId: null,
    createdAtMs: Number(createdAtMs),
    expiresAtMs: Number(expiresAtMs),
    impactId: String(impactId),
    impactKind: String(impactKind),
    observedAtMs: Number(observedAtMs),
    reasonCode: String(reasonCode),
    openMeldServiceRuntimeId: String(openMeldServiceRuntimeId),
    source: String(source),
    sourceAttemptId: String(sourceAttemptId),
    sourceDispatchId: String(sourceDispatchId),
    updatedAtMs: Number(updatedAtMs),
  };
}

function buildReadinessImpactKey(
  row: Pick<
    ReadinessImpactRow,
    | "agentProfileId"
    | "bindingId"
    | "agentControllerRef"
    | "impactKind"
    | "openMeldServiceRuntimeId"
  >
): string {
  return [
    row.agentProfileId,
    row.bindingId,
    row.openMeldServiceRuntimeId,
    row.agentControllerRef,
    row.impactKind,
  ].join("|");
}

function toTaxonomyBindingSet(values: readonly unknown[]): Set<string> {
  const bindings = new Set<string>();
  for (let index = 0; index < values.length; index += 3) {
    bindings.add(
      [values[index], values[index + 1], values[index + 2]]
        .map(String)
        .join("|")
    );
  }
  return bindings;
}

function buildTaxonomyBindingKey(
  row: Pick<ReadinessImpactRow, "impactKind" | "reasonCode" | "source">
): string {
  return [row.impactKind, row.reasonCode, row.source].join("|");
}
