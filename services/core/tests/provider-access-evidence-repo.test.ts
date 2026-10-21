import { getPostgresDatabase } from "@openmeld/db/postgresql";
import { beforeEach, describe, expect, it } from "vitest";
import { env } from "../test-support/worker-env";

beforeEach(async () => {
  await getPostgresDatabase(env).query(
    'DELETE FROM "openmeld"."openMeldDaemon_provider_access_evidence"'
  );
});

import {
  clearProviderAccessFailureEvidenceForExecutionSuccess,
  readFreshProviderAccessEvidenceForBinding,
  writeAcceptedProviderAccessFailureEvidence,
} from "../src/agent-execution/infrastructure/postgresql/provider-access-evidence-repo";

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
        reasonCode: "usage_exhausted",
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
      reasonCode: "usage_exhausted",
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

function createProviderAccessEvidenceDb() {
  return getPostgresDatabase(env);
}
