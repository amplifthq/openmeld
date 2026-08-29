import { describe, expect, it } from "vitest";
import {
  clearProviderAccessFailureEvidenceForExecutionSuccess,
  readFreshProviderAccessEvidenceForBinding,
  writeAcceptedProviderAccessFailureEvidence,
} from "../agent-execution/infrastructure/d1/provider-access-evidence-repo";

const HOUR_MS = 60 * 60 * 1000;

describe("provider access evidence repo", () => {
  it("returns only fresh uncleared Claude Code provider access evidence", async () => {
    const db = createProviderAccessEvidenceDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:claude-code",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await expect(
      writeAcceptedProviderAccessFailureEvidence({
        agentProfileId: "agt-1",
        db,
        evidence: {
          observedAtMs: 900,
          provider: "claude-code",
          reasonCode: "provider_account.subscription_access_unavailable",
          source: "wake_failure",
        },
        executionIdentity,
        observedAtMs: 1000,
        sourceAttemptId: "attempt-1",
        sourceDispatchId: "dispatch-1",
      })
    ).resolves.toBe("written");

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:claude-code",
        db,
        nowMs: 1000 + HOUR_MS - 1,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      expiresAtMs: 1000 + HOUR_MS,
      observedAtMs: 1000,
      provider: "claude-code",
      reasonCode: "provider_account.subscription_access_unavailable",
      source: "wake_failure",
    });

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:claude-code",
        db,
        nowMs: 1000 + HOUR_MS,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();

    await clearProviderAccessFailureEvidenceForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 2000,
      db,
      executionIdentity,
      sourceAttemptId: "attempt-success",
      sourceDispatchId: "dispatch-success",
    });

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:claude-code",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
  });

  it.each([
    ["codex", "builtin:codex"],
    ["opencode", "builtin:opencode"],
    ["openclaw", "builtin:openclaw"],
  ] as const)("writes and reads fresh %s provider access evidence", async (provider, agentControllerRef) => {
    const db = createProviderAccessEvidenceDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef,
      openMeldServiceRuntimeId: "runtime-1",
    };

    await expect(
      writeAcceptedProviderAccessFailureEvidence({
        agentProfileId: "agt-1",
        db,
        evidence: {
          observedAtMs: 1000,
          provider,
          reasonCode: "provider_account.organization_access_disabled",
          source: "wake_failure",
        },
        executionIdentity,
        observedAtMs: 1000,
        sourceAttemptId: "attempt-1",
        sourceDispatchId: "dispatch-1",
      })
    ).resolves.toBe("written");

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef,
        db,
        nowMs: 1001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      provider,
      reasonCode: "provider_account.organization_access_disabled",
      source: "wake_failure",
    });

    await expect(
      clearProviderAccessFailureEvidenceForExecutionSuccess({
        agentProfileId: "agt-1",
        clearedAtMs: 1002,
        db,
        executionIdentity,
        sourceAttemptId: "attempt-success",
        sourceDispatchId: "dispatch-success",
      })
    ).resolves.toBe("cleared");

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef,
        db,
        nowMs: 1003,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
  });

  it("rejects evidence whose provider does not match the execution controller", async () => {
    const db = createProviderAccessEvidenceDb();

    await expect(
      writeAcceptedProviderAccessFailureEvidence({
        agentProfileId: "agt-1",
        db,
        evidence: {
          observedAtMs: 1000,
          provider: "codex",
          reasonCode: "provider_account.organization_access_disabled",
          source: "wake_failure",
        },
        executionIdentity: {
          bindingId: "binding-1",
          agentControllerRef: "builtin:opencode",
          openMeldServiceRuntimeId: "runtime-1",
        },
        observedAtMs: 1000,
        sourceAttemptId: "attempt-1",
        sourceDispatchId: "dispatch-1",
      })
    ).resolves.toBe("not_applicable");
  });

  it("does not let an older accepted failure overwrite newer provider evidence", async () => {
    const db = createProviderAccessEvidenceDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: "agt-1",
      db,
      evidence: {
        observedAtMs: 2000,
        provider: "codex",
        reasonCode: "provider_account.organization_access_disabled",
        source: "wake_failure",
      },
      executionIdentity,
      observedAtMs: 2000,
      sourceAttemptId: "attempt-new",
      sourceDispatchId: "dispatch-new",
    });
    await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: "agt-1",
      db,
      evidence: {
        observedAtMs: 1000,
        provider: "codex",
        reasonCode: "provider_account.subscription_access_unavailable",
        source: "wake_failure",
      },
      executionIdentity,
      observedAtMs: 1000,
      sourceAttemptId: "attempt-old",
      sourceDispatchId: "dispatch-old",
    });

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      observedAtMs: 2000,
      reasonCode: "provider_account.organization_access_disabled",
    });
  });

  it("does not let an older accepted success clear newer provider evidence", async () => {
    const db = createProviderAccessEvidenceDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:opencode",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: "agt-1",
      db,
      evidence: {
        observedAtMs: 2000,
        provider: "opencode",
        reasonCode: "provider_account.subscription_access_unavailable",
        source: "wake_failure",
      },
      executionIdentity,
      observedAtMs: 2000,
      sourceAttemptId: "attempt-new",
      sourceDispatchId: "dispatch-new",
    });
    await clearProviderAccessFailureEvidenceForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 1000,
      db,
      executionIdentity,
      sourceAttemptId: "attempt-old-success",
      sourceDispatchId: "dispatch-old-success",
    });

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:opencode",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      observedAtMs: 2000,
      reasonCode: "provider_account.subscription_access_unavailable",
    });
  });

  it("keeps hard failure evidence when success has the same accepted timestamp", async () => {
    const db = createProviderAccessEvidenceDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: "agt-1",
      db,
      evidence: {
        observedAtMs: 2000,
        provider: "codex",
        reasonCode: "provider_account.capacity_exhausted",
        source: "wake_failure",
      },
      executionIdentity,
      observedAtMs: 2000,
      sourceAttemptId: "attempt-failure",
      sourceDispatchId: "dispatch-failure",
    });
    await clearProviderAccessFailureEvidenceForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 2000,
      db,
      executionIdentity,
      sourceAttemptId: "attempt-success",
      sourceDispatchId: "dispatch-success",
    });

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      observedAtMs: 2000,
      reasonCode: "provider_account.capacity_exhausted",
    });
  });

  it("lets a hard failure replace a same-time success watermark", async () => {
    const db = createProviderAccessEvidenceDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await clearProviderAccessFailureEvidenceForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 2000,
      db,
      executionIdentity,
      sourceAttemptId: "attempt-success",
      sourceDispatchId: "dispatch-success",
    });
    await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: "agt-1",
      db,
      evidence: {
        observedAtMs: 2000,
        provider: "codex",
        reasonCode: "provider_account.capacity_exhausted",
        source: "wake_failure",
      },
      executionIdentity,
      observedAtMs: 2000,
      sourceAttemptId: "attempt-failure",
      sourceDispatchId: "dispatch-failure",
    });

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 2001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toMatchObject({
      observedAtMs: 2000,
      reasonCode: "provider_account.capacity_exhausted",
    });
  });

  it("does not let a delayed older failure reopen evidence cleared by a newer success", async () => {
    const db = createProviderAccessEvidenceDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:opencode",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: "agt-1",
      db,
      evidence: {
        observedAtMs: 1000,
        provider: "opencode",
        reasonCode: "provider_account.subscription_access_unavailable",
        source: "wake_failure",
      },
      executionIdentity,
      observedAtMs: 1000,
      sourceAttemptId: "attempt-first-failure",
      sourceDispatchId: "dispatch-first-failure",
    });
    await clearProviderAccessFailureEvidenceForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 3000,
      db,
      executionIdentity,
      sourceAttemptId: "attempt-newer-success",
      sourceDispatchId: "dispatch-newer-success",
    });
    await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: "agt-1",
      db,
      evidence: {
        observedAtMs: 2000,
        provider: "opencode",
        reasonCode: "provider_account.capacity_exhausted",
        source: "wake_failure",
      },
      executionIdentity,
      observedAtMs: 2000,
      sourceAttemptId: "attempt-delayed-failure",
      sourceDispatchId: "dispatch-delayed-failure",
    });

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:opencode",
        db,
        nowMs: 3001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
  });

  it("persists a success watermark before any failure arrives", async () => {
    const db = createProviderAccessEvidenceDb();
    const executionIdentity = {
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
      openMeldServiceRuntimeId: "runtime-1",
    };

    await clearProviderAccessFailureEvidenceForExecutionSuccess({
      agentProfileId: "agt-1",
      clearedAtMs: 3000,
      db,
      executionIdentity,
      sourceAttemptId: "attempt-newer-success",
      sourceDispatchId: "dispatch-newer-success",
    });
    await writeAcceptedProviderAccessFailureEvidence({
      agentProfileId: "agt-1",
      db,
      evidence: {
        observedAtMs: 2000,
        provider: "codex",
        reasonCode: "provider_account.capacity_exhausted",
        source: "wake_failure",
      },
      executionIdentity,
      observedAtMs: 2000,
      sourceAttemptId: "attempt-delayed-failure",
      sourceDispatchId: "dispatch-delayed-failure",
    });

    await expect(
      readFreshProviderAccessEvidenceForBinding({
        agentProfileId: "agt-1",
        bindingId: "binding-1",
        agentControllerRef: "builtin:codex",
        db,
        nowMs: 3001,
        openMeldServiceRuntimeId: "runtime-1",
      })
    ).resolves.toBeNull();
  });
});

type ProviderAccessEvidenceRow = {
  agentProfileId: string;
  bindingId: string;
  agentControllerRef: string;
  clearedAtMs: number | null;
  clearedByDispatchId: string | null;
  createdAtMs: number;
  evidenceId: string;
  expiresAtMs: number;
  observedAtMs: number;
  provider: string;
  reasonCode: string;
  openMeldServiceRuntimeId: string;
  source: string;
  sourceAttemptId: string;
  sourceDispatchId: string;
  updatedAtMs: number;
};

function createProviderAccessEvidenceDb(): D1Database {
  const rowsByKey = new Map<string, ProviderAccessEvidenceRow>();
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: () => {
          const [
            agentProfileId,
            bindingId,
            openMeldServiceRuntimeId,
            agentControllerRef,
            provider,
            nowMs,
          ] = args;
          const row = [...rowsByKey.values()]
            .filter(
              (candidate) =>
                candidate.agentProfileId === agentProfileId &&
                candidate.bindingId === bindingId &&
                candidate.openMeldServiceRuntimeId ===
                  openMeldServiceRuntimeId &&
                candidate.agentControllerRef === agentControllerRef &&
                candidate.provider === provider &&
                candidate.clearedAtMs === null &&
                candidate.expiresAtMs > Number(nowMs)
            )
            .sort((left, right) => right.observedAtMs - left.observedAtMs)[0];
          return row
            ? {
                expiresAtMs: row.expiresAtMs,
                observedAtMs: row.observedAtMs,
                provider: row.provider,
                reasonCode: row.reasonCode,
                source: row.source,
              }
            : null;
        },
        run: () => {
          if (
            sql.includes("INSERT INTO openMeldDaemon_provider_access_evidence")
          ) {
            const row = buildProviderAccessEvidenceRow(args);
            const key = buildProviderAccessEvidenceKey(row);
            const existing = rowsByKey.get(key);
            const existingResultAtMs = existing
              ? Math.max(
                  existing.observedAtMs,
                  existing.clearedAtMs ?? existing.observedAtMs
                )
              : null;
            const resultWins =
              existingResultAtMs === null ||
              (row.clearedAtMs === null
                ? row.observedAtMs > existingResultAtMs ||
                  (row.observedAtMs === existingResultAtMs &&
                    existing?.clearedAtMs !== null)
                : row.clearedAtMs > existingResultAtMs);
            if (resultWins) {
              rowsByKey.set(key, row);
            }
            return { success: true };
          }
          if (sql.includes("UPDATE openMeldDaemon_provider_access_evidence")) {
            const [
              clearedAtMs,
              clearedByDispatchId,
              updatedAtMs,
              agentProfileId,
              bindingId,
              openMeldServiceRuntimeId,
              agentControllerRef,
              provider,
              maximumObservedAtMs,
            ] = args;
            const key = [
              agentProfileId,
              bindingId,
              openMeldServiceRuntimeId,
              agentControllerRef,
              provider,
            ].join("|");
            const row = rowsByKey.get(key);
            if (
              row &&
              row.clearedAtMs === null &&
              row.observedAtMs <= Number(maximumObservedAtMs)
            ) {
              rowsByKey.set(key, {
                ...row,
                clearedAtMs: Number(clearedAtMs),
                clearedByDispatchId: String(clearedByDispatchId),
                updatedAtMs: Number(updatedAtMs),
              });
            }
            return { success: true };
          }
          throw new Error(`unexpected SQL: ${sql}`);
        },
      }),
    }),
  } as unknown as D1Database;
}

function buildProviderAccessEvidenceRow(
  args: readonly unknown[]
): ProviderAccessEvidenceRow {
  if (args.length === 16) {
    const [
      evidenceId,
      provider,
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
      clearedAtMs,
      clearedByDispatchId,
      createdAtMs,
      updatedAtMs,
    ] = args;
    return {
      agentProfileId: String(agentProfileId),
      bindingId: String(bindingId),
      agentControllerRef: String(agentControllerRef),
      clearedAtMs: Number(clearedAtMs),
      clearedByDispatchId: String(clearedByDispatchId),
      createdAtMs: Number(createdAtMs),
      evidenceId: String(evidenceId),
      expiresAtMs: Number(expiresAtMs),
      observedAtMs: Number(observedAtMs),
      provider: String(provider),
      reasonCode: String(reasonCode),
      openMeldServiceRuntimeId: String(openMeldServiceRuntimeId),
      source: String(source),
      sourceAttemptId: String(sourceAttemptId),
      sourceDispatchId: String(sourceDispatchId),
      updatedAtMs: Number(updatedAtMs),
    };
  }
  const [
    evidenceId,
    provider,
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
    evidenceId: String(evidenceId),
    expiresAtMs: Number(expiresAtMs),
    observedAtMs: Number(observedAtMs),
    provider: String(provider),
    reasonCode: String(reasonCode),
    openMeldServiceRuntimeId: String(openMeldServiceRuntimeId),
    source: String(source),
    sourceAttemptId: String(sourceAttemptId),
    sourceDispatchId: String(sourceDispatchId),
    updatedAtMs: Number(updatedAtMs),
  };
}

function buildProviderAccessEvidenceKey(
  row: Pick<
    ProviderAccessEvidenceRow,
    | "agentProfileId"
    | "bindingId"
    | "agentControllerRef"
    | "provider"
    | "openMeldServiceRuntimeId"
  >
): string {
  return [
    row.agentProfileId,
    row.bindingId,
    row.openMeldServiceRuntimeId,
    row.agentControllerRef,
    row.provider,
  ].join("|");
}
