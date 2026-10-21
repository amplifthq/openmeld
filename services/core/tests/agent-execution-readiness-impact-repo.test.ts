import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAgentExecutionReadinessImpactForExecutionRunning,
  clearAgentExecutionReadinessImpactForExecutionSuccess,
  isAcceptedAgentExecutionReadinessImpactReasonCode,
  readFreshAgentExecutionReadinessImpactForBinding,
  resolveAcceptedAgentExecutionReadinessImpactReasonCode,
  writeAcceptedAgentExecutionReadinessImpact,
  writeAgentExecutionReadinessImpact,
} from "../src/agent-execution/infrastructure/postgresql/agent-execution-readiness-impact-repo";
import { env } from "../test-support/worker-env";

beforeEach(async () => {
  await getPostgresDatabase(env).query(
    'DELETE FROM "openmeld"."openMeldDaemon_agent_execution_readiness_impacts"'
  );
});

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
    expect((await db.readRows())[0]?.reasonCode).toBe("workspace.missing");
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
    expect((await db.readRows())[0]).toMatchObject({
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
    expect((await db.readRows())[0]).toMatchObject({
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
    await db.seedRow({
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
    await db.seedRow({
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
      (await db.readRows())
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

function createReadinessImpactDb() {
  const db = getPostgresDatabase(env);
  return Object.assign(db, {
    async readRows(): Promise<ReadinessImpactRow[]> {
      return (
        await db.query<ReadinessImpactRow>({
          text: `SELECT
        agent_profile_id AS "agentProfileId", binding_id AS "bindingId",
        agent_controller_ref AS "agentControllerRef", cleared_at_ms AS "clearedAtMs",
        cleared_by_dispatch_id AS "clearedByDispatchId", created_at_ms AS "createdAtMs",
        expires_at_ms AS "expiresAtMs", impact_id AS "impactId", impact_kind AS "impactKind",
        observed_at_ms AS "observedAtMs", reason_code AS "reasonCode",
        openmeld_service_runtime_id AS "openMeldServiceRuntimeId", source,
        source_attempt_id AS "sourceAttemptId", source_dispatch_id AS "sourceDispatchId",
        updated_at_ms AS "updatedAtMs"
        FROM "openmeld"."openMeldDaemon_agent_execution_readiness_impacts"
        ORDER BY observed_at_ms, impact_kind`,
        })
      ).rows;
    },
    async seedRow(
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
    ): Promise<void> {
      await db.query({
        text: `INSERT INTO "openmeld"."openMeldDaemon_agent_execution_readiness_impacts"
        (impact_id, impact_kind, agent_profile_id, binding_id, openmeld_service_runtime_id,
          agent_controller_ref, reason_code, source, source_dispatch_id, source_attempt_id,
          observed_at_ms, expires_at_ms, created_at_ms, updated_at_ms)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'seed-dispatch','seed-attempt',$9,$10,$9,$9)`,
        values: [
          [
            "readiness_impact",
            row.impactKind,
            row.agentProfileId,
            row.bindingId,
            row.openMeldServiceRuntimeId,
            row.agentControllerRef,
          ].join(":"),
          row.impactKind,
          row.agentProfileId,
          row.bindingId,
          row.openMeldServiceRuntimeId,
          row.agentControllerRef,
          row.reasonCode,
          row.source,
          row.observedAtMs,
          row.observedAtMs + IMPACT_TTL_MS,
        ],
      });
    },
  });
}
