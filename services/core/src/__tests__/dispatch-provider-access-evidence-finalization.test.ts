import type {
  OpenMeldDaemonDispatchQueueMessage,
  OpenMeldDaemonTaskResultEnvelope,
} from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as readinessImpactRepo from "../agent-execution/infrastructure/d1/agent-execution-readiness-impact-repo";
import {
  clearAgentExecutionReadinessImpactForExecutionSuccess,
  writeAcceptedAgentExecutionReadinessImpact,
} from "../agent-execution/infrastructure/d1/agent-execution-readiness-impact-repo";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as providerAccessEvidenceRepo from "../agent-execution/infrastructure/d1/provider-access-evidence-repo";
import {
  clearProviderAccessFailureEvidenceForExecutionSuccess,
  writeAcceptedProviderAccessFailureEvidence,
} from "../agent-execution/infrastructure/d1/provider-access-evidence-repo";
import { finalizeAcceptedDispatchResult } from "../dispatch/application/dispatch-execution-service";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as dispatchResultService from "../dispatch/application/dispatch-result-service";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as dispatchLedgerD1 from "../dispatch/infrastructure/d1/dispatch-ledger-d1";
import {
  markDispatchStatus,
  readDispatchAttemptExecutionOwnershipFact,
} from "../dispatch/infrastructure/d1/dispatch-ledger-d1";
// biome-ignore lint/performance/noNamespaceImport: Needed for per-test spy of module exports.
import * as spaceSignalEmitter from "../rpc/space-signal-emitter";
import type { DispatchResultInboxRecord } from "../runtime-transport/infrastructure/d1/dispatch-result-inbox-repo";

const AGENT_PROFILE_ID = "agt_11111111-1111-4111-8111-111111111111";

const dispatchMessage = {
  v: 2,
  dispatchId: "dispatch-provider-access-1",
  spaceId: "space-1",
  sourceEventId: "signal-source-1",
  targetProfileId: AGENT_PROFILE_ID,
  dispatchChainId: "dispatch-provider-access-1",
  autoRelayDepth: 0,
  visitedProfileIds: [],
  visitedProfileIdsHash: "stable32:provider-access-1",
  dispatchContractVersion: 2,
  dispatchPolicy: "mention_only",
  ruleSource: "registry",
  ruleId: "registry.default.all_members.v1",
  ruleReason: "default allow all members mention",
  taskId: "task-provider-access-1",
  transportMode: null,
  controllerSnapshot: {
    targetBindingState: "bound",
    targetBindingEnabled: true,
    agentControllerRef: "builtin:claude-code",
  },
  contextIdMappingSpec: null,
  dispatchRulesSnapshot: {
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
  },
  dispatchSnapshot: {
    dispatchPolicy: "mention_only",
    ruleSource: "registry",
    ruleId: "registry.default.all_members.v1",
    ruleReason: "default allow all members mention",
    targetBindingState: "bound",
    targetBindingEnabled: true,
  },
  idempotencyKey: "5:signal-source-1|5:agt-provider-access-1",
  enqueuedAtMs: 1_700_000_000_000,
} satisfies OpenMeldDaemonDispatchQueueMessage;

const codexDispatchMessage = {
  ...dispatchMessage,
  controllerSnapshot: {
    ...dispatchMessage.controllerSnapshot,
    agentControllerRef: "builtin:codex",
  },
} satisfies OpenMeldDaemonDispatchQueueMessage;

const opencodeDispatchMessage = {
  ...dispatchMessage,
  controllerSnapshot: {
    ...dispatchMessage.controllerSnapshot,
    agentControllerRef: "builtin:opencode",
  },
} satisfies OpenMeldDaemonDispatchQueueMessage;

const successTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentControllerConversationId: "claude-thread-1",
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    agentControllerRef: "builtin:claude-code",
    deduped: false,
    output: "done",
    sourceEventId: "signal-source-1",
    status: "success",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const unboundSuccessTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    agentControllerRef: "builtin:claude-code",
    deduped: false,
    output: "done",
    sourceEventId: "signal-source-1",
    spaceAction: {
      type: "post_message",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        text: "done",
      },
    },
    status: "success",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const failedTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    deduped: false,
    errorCode: "quota.exceeded",
    errorMessage: "Claude Code subscription access is unavailable.",
    errorType: "auth",
    providerAccessEvidence: {
      observedAtMs: 1_700_000_000_050,
      provider: "claude-code",
      reasonCode: "provider_account.subscription_access_unavailable",
      source: "wake_failure",
    },
    sourceEventId: "signal-source-1",
    status: "failed",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const codexFailedTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    agentControllerRef: "builtin:codex",
    deduped: false,
    errorCode: "auth.required",
    errorMessage: "Codex is not signed in.",
    errorType: "auth",
    providerAccessEvidence: {
      observedAtMs: 1_700_000_000_050,
      provider: "codex",
      reasonCode: "provider_account.organization_access_disabled",
      source: "wake_failure",
    },
    sourceEventId: "signal-source-1",
    status: "failed",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const codexStructuredUsageExhaustedTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    agentControllerRef: "builtin:codex",
    deduped: false,
    errorCode: "usage_exhausted",
    errorMessage: "Codex usage is exhausted.",
    errorType: "adapter",
    originalError: "You've hit your usage limit. Try again at 2:03 AM.",
    sourceEventId: "signal-source-1",
    status: "failed",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const opencodeStructuredUsageExhaustedTaskResult = {
  ...codexStructuredUsageExhaustedTaskResult,
  payload: {
    ...codexStructuredUsageExhaustedTaskResult.payload,
    agentControllerRef: "builtin:opencode",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const opencodeReportedUsageExhaustedTaskResult = {
  ...opencodeStructuredUsageExhaustedTaskResult,
  payload: {
    ...opencodeStructuredUsageExhaustedTaskResult.payload,
    providerAccessEvidence: {
      observedAtMs: 1_700_000_000_050,
      provider: "opencode",
      reasonCode: "usage_exhausted",
      source: "wake_failure",
    },
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const readinessImpactFailedTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    deduped: false,
    errorCode: "controller.client.upgrade_required",
    errorMessage: "Codex needs an update before it can run.",
    errorType: "adapter",
    sourceEventId: "signal-source-1",
    status: "failed",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const workspaceAliasReadinessImpactFailedTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    deduped: false,
    errorCode: "profile.workspace.invalid",
    errorMessage: "profile.workspace.invalid: local workspace is broken",
    errorType: "config",
    sourceEventId: "signal-source-1",
    status: "failed",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const publicationFailureTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    deduped: false,
    errorCode: "openmeld.space_action.repair_failed",
    errorMessage: "OpenMeld could not repair the Space action.",
    errorType: "policy",
    sourceEventId: "signal-source-1",
    status: "failed",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const policyMissedFailedTaskResult = {
  v: 4,
  code: "service.task_result",
  payload: {
    agentId: AGENT_PROFILE_ID,
    attemptId: "attempt-provider-access-1",
    deduped: false,
    errorCode: "runtime.reply.empty_output",
    errorMessage: "The local agent finished without a reply.",
    errorType: "adapter",
    sourceEventId: "signal-source-1",
    status: "failed",
    taskId: "task-provider-access-1",
  },
} satisfies OpenMeldDaemonTaskResultEnvelope;

const buildInboxRecord = (
  taskResult: OpenMeldDaemonTaskResultEnvelope
): DispatchResultInboxRecord => ({
  acceptedAtMs: 1_700_000_000_100,
  attemptId: "attempt-provider-access-1",
  daemonSessionId: "daemon-session-1",
  dispatchId: "dispatch-provider-access-1",
  executionTokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  executionTokenRunId: "run-1",
  leaseEpoch: 1,
  publicationErrorCode: null,
  publishedSignalId: null,
  publishState: "result_accepted",
  resultKey: "dispatch-provider-access-1:attempt-provider-access-1",
  runtimeCoordinatorExecutionId: "rce-1",
  submittedConnectionGeneration: 1,
  targetProfileId: AGENT_PROFILE_ID,
  taskId: "task-provider-access-1",
  taskResult,
  updatedAtMs: 1_700_000_000_100,
});

const buildEnv = () =>
  ({
    OPENMELD_AUTH_WORKER: {},
    OPENMELD_LOCAL_STATE_DB: {} as D1Database,
  }) as unknown as Parameters<typeof finalizeAcceptedDispatchResult>[0]["env"];

const finalizeExistingAcceptedDispatchResultForTest = async () => {
  await finalizeAcceptedDispatchResult({
    db: {} as D1Database,
    dispatchMessage,
    env: buildEnv(),
    inboxRecord: buildInboxRecord(successTaskResult),
    recordPublicationProjection: false,
    targetOwnerUserId: "owner-1",
    targetProfileMentionLabel: "Claude Code",
    targetProfileName: "Claude Code",
  });
};

describe("dispatch provider access evidence finalization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // vi.mock module factories do not reach the worker-entry module graph in
    // vitest-pool-workers (src/index.ts already loaded these modules in the
    // same isolate), so per-test spies on the shared module namespaces are the
    // only mocking mechanism that actually intercepts the finalization path.
    vi.spyOn(
      dispatchLedgerD1,
      "readDispatchAttemptExecutionOwnershipFact"
    ).mockResolvedValue({
      status: "found",
      attemptId: "attempt-provider-access-1",
      bindingId: "binding-claude-code-1",
      agentControllerRef: "builtin:claude-code",
      dispatchId: "dispatch-provider-access-1",
      openMeldServiceRuntimeId: "runtime-office-mac-1",
      targetProfileId: AGENT_PROFILE_ID,
      taskId: "task-provider-access-1",
    });
    vi.spyOn(dispatchLedgerD1, "claimFinalReplyEmission").mockResolvedValue(
      "claimed"
    );
    vi.spyOn(dispatchLedgerD1, "claimReplyingHintEmission").mockResolvedValue(
      "claimed"
    );
    vi.spyOn(
      dispatchLedgerD1,
      "markDispatchAttemptWaitingForResult"
    ).mockResolvedValue(undefined);
    vi.spyOn(dispatchLedgerD1, "markDispatchStatus").mockResolvedValue(
      undefined
    );
    vi.spyOn(
      dispatchLedgerD1,
      "recordDispatchAttemptExecutionOwnership"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      dispatchLedgerD1,
      "rollbackFinalReplyEmissionClaim"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      dispatchLedgerD1,
      "rollbackReplyingHintEmissionClaim"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      dispatchLedgerD1,
      "writeOpenMeldDaemonOpsDecision"
    ).mockResolvedValue(undefined);
    vi.spyOn(
      dispatchResultService,
      "getDispatchResultByDispatchId"
    ).mockResolvedValue(null);
    vi.spyOn(dispatchResultService, "writeDispatchResult").mockResolvedValue(
      undefined
    );
    vi.spyOn(spaceSignalEmitter, "emitSpaceStatusSignal").mockResolvedValue({
      v: 1,
      id: "signal-status-final-1",
      spaceId: "space-1",
      ts: 1_700_000_000_200,
      type: "signal.status",
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Claude Code",
      },
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        generatedBy: "openmeld",
        status: "done",
        text: "done",
      },
    } as never);
    vi.spyOn(
      spaceSignalEmitter,
      "emitSpaceSystemNoticeSignal"
    ).mockResolvedValue({
      v: 1,
      id: "signal-system-final-1",
      spaceId: "space-1",
      ts: 1_700_000_000_200,
      type: "signal.system_notice",
      profile: {
        kind: "system",
        profileId: "openmeld-system",
        profileName: "OpenMeld",
      },
      data: {
        actorProfileId: "agt_11111111-1111-4111-8111-111111111111",
        generatedBy: "openmeld",
        noticeType: "terminal_failure",
        reason: "quota.exceeded",
        text: "The agent could not complete this Wake.",
      },
    } as never);
    vi.spyOn(spaceSignalEmitter, "emitSpaceTextSignal").mockResolvedValue({
      v: 1,
      id: "signal-final-1",
      spaceId: "space-1",
      ts: 1_700_000_000_200,
      type: "signal.text",
      profile: {
        kind: "agent",
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        profileName: "Claude Code",
      },
      data: {
        text: "done",
      },
    } as never);
    vi.spyOn(
      providerAccessEvidenceRepo,
      "writeAcceptedProviderAccessFailureEvidence"
    ).mockResolvedValue("written");
    vi.spyOn(
      providerAccessEvidenceRepo,
      "clearProviderAccessFailureEvidenceForExecutionSuccess"
    ).mockResolvedValue("cleared");
    vi.spyOn(
      readinessImpactRepo,
      "writeAcceptedAgentExecutionReadinessImpact"
    ).mockResolvedValue("written");
    vi.spyOn(
      readinessImpactRepo,
      "clearAgentExecutionReadinessImpactForExecutionSuccess"
    ).mockResolvedValue("cleared");
  });

  it("writes provider account evidence only from an accepted matching failed result", async () => {
    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(failedTaskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Claude Code",
        targetProfileName: "Claude Code",
      })
    ).resolves.toEqual({
      publishedSignalId: "signal-system-final-1",
      publishState: "reply_published",
      status: "finalized",
    });

    expect(readDispatchAttemptExecutionOwnershipFact).toHaveBeenCalledWith({
      attemptId: "attempt-provider-access-1",
      db: {},
      dispatchId: "dispatch-provider-access-1",
    });
    expect(writeAcceptedProviderAccessFailureEvidence).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      db: {},
      evidence: failedTaskResult.payload.providerAccessEvidence,
      executionIdentity: {
        bindingId: "binding-claude-code-1",
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-office-mac-1",
      },
      observedAtMs: 1_700_000_000_100,
      sourceAttemptId: "attempt-provider-access-1",
      sourceDispatchId: "dispatch-provider-access-1",
    });
    expect(
      clearProviderAccessFailureEvidenceForExecutionSuccess
    ).not.toHaveBeenCalled();
    expect(writeAcceptedAgentExecutionReadinessImpact).not.toHaveBeenCalled();
  });

  it("writes Codex provider account evidence from its accepted execution identity", async () => {
    vi.mocked(readDispatchAttemptExecutionOwnershipFact).mockResolvedValueOnce({
      status: "found",
      attemptId: "attempt-provider-access-1",
      bindingId: "binding-codex-1",
      agentControllerRef: "builtin:codex",
      dispatchId: "dispatch-provider-access-1",
      openMeldServiceRuntimeId: "runtime-office-mac-1",
      targetProfileId: AGENT_PROFILE_ID,
      taskId: "task-provider-access-1",
    });

    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage: codexDispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(codexFailedTaskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Codex",
        targetProfileName: "Codex",
      })
    ).resolves.toMatchObject({
      publishState: "reply_published",
      status: "finalized",
    });

    expect(writeAcceptedProviderAccessFailureEvidence).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      db: {},
      evidence: codexFailedTaskResult.payload.providerAccessEvidence,
      executionIdentity: {
        bindingId: "binding-codex-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-office-mac-1",
      },
      observedAtMs: 1_700_000_000_100,
      sourceAttemptId: "attempt-provider-access-1",
      sourceDispatchId: "dispatch-provider-access-1",
    });
  });

  it("writes minimum Codex Usage evidence from an accepted structured usage exhaustion", async () => {
    vi.mocked(readDispatchAttemptExecutionOwnershipFact).mockResolvedValueOnce({
      status: "found",
      attemptId: "attempt-provider-access-1",
      bindingId: "binding-codex-1",
      agentControllerRef: "builtin:codex",
      dispatchId: "dispatch-provider-access-1",
      openMeldServiceRuntimeId: "runtime-office-mac-1",
      targetProfileId: AGENT_PROFILE_ID,
      taskId: "task-provider-access-1",
    });

    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage: codexDispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(codexStructuredUsageExhaustedTaskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Codex",
        targetProfileName: "Codex",
      })
    ).resolves.toMatchObject({
      publishState: "reply_published",
      status: "finalized",
    });

    expect(writeAcceptedProviderAccessFailureEvidence).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      db: {},
      evidence: {
        observedAtMs: 1_700_000_000_100,
        provider: "codex",
        reasonCode: "usage_exhausted",
        source: "wake_failure",
      },
      executionIdentity: {
        bindingId: "binding-codex-1",
        agentControllerRef: "builtin:codex",
        openMeldServiceRuntimeId: "runtime-office-mac-1",
      },
      observedAtMs: 1_700_000_000_100,
      sourceAttemptId: "attempt-provider-access-1",
      sourceDispatchId: "dispatch-provider-access-1",
    });
  });

  it("does not turn structured Usage exhaustion into admission evidence for an unsupported controller", async () => {
    vi.mocked(readDispatchAttemptExecutionOwnershipFact).mockResolvedValueOnce({
      status: "found",
      attemptId: "attempt-provider-access-1",
      bindingId: "binding-opencode-1",
      agentControllerRef: "builtin:opencode",
      dispatchId: "dispatch-provider-access-1",
      openMeldServiceRuntimeId: "runtime-office-mac-1",
      targetProfileId: AGENT_PROFILE_ID,
      taskId: "task-provider-access-1",
    });

    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage: opencodeDispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(
          opencodeStructuredUsageExhaustedTaskResult
        ),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "OpenCode",
        targetProfileName: "OpenCode",
      })
    ).resolves.toMatchObject({
      publishState: "reply_published",
      status: "finalized",
    });

    expect(writeAcceptedProviderAccessFailureEvidence).not.toHaveBeenCalled();
  });

  it("does not let reported Usage exhaustion block future Wakes for an unsupported controller", async () => {
    vi.mocked(readDispatchAttemptExecutionOwnershipFact).mockResolvedValueOnce({
      status: "found",
      attemptId: "attempt-provider-access-1",
      bindingId: "binding-opencode-1",
      agentControllerRef: "builtin:opencode",
      dispatchId: "dispatch-provider-access-1",
      openMeldServiceRuntimeId: "runtime-office-mac-1",
      targetProfileId: AGENT_PROFILE_ID,
      taskId: "task-provider-access-1",
    });

    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage: opencodeDispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(opencodeReportedUsageExhaustedTaskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "OpenCode",
        targetProfileName: "OpenCode",
      })
    ).resolves.toMatchObject({
      publishState: "reply_published",
      status: "finalized",
    });

    expect(writeAcceptedProviderAccessFailureEvidence).not.toHaveBeenCalled();
  });

  it("does not let a legacy wording-derived capacity classification change Wakeability", async () => {
    const legacyCapacityTaskResult = {
      ...codexFailedTaskResult,
      payload: {
        ...codexFailedTaskResult.payload,
        errorCode: "quota.exceeded",
        providerAccessEvidence: {
          ...codexFailedTaskResult.payload.providerAccessEvidence,
          reasonCode: "provider_account.capacity_exhausted" as const,
        },
      },
    } satisfies OpenMeldDaemonTaskResultEnvelope;

    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage: codexDispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(legacyCapacityTaskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Codex",
        targetProfileName: "Codex",
      })
    ).resolves.toMatchObject({
      publishState: "reply_published",
      status: "finalized",
    });

    expect(writeAcceptedProviderAccessFailureEvidence).not.toHaveBeenCalled();
  });

  it("writes readiness impact from an accepted failed result covered by policy", async () => {
    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(readinessImpactFailedTaskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Codex",
        targetProfileName: "Codex",
      })
    ).resolves.toEqual({
      publishedSignalId: "signal-system-final-1",
      publishState: "reply_published",
      status: "finalized",
    });

    expect(writeAcceptedAgentExecutionReadinessImpact).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      db: {},
      executionIdentity: {
        bindingId: "binding-claude-code-1",
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-office-mac-1",
      },
      observedAtMs: 1_700_000_000_100,
      reasonCode: "controller.client.upgrade_required",
      sourceAttemptId: "attempt-provider-access-1",
      sourceDispatchId: "dispatch-provider-access-1",
    });
    expect(writeAcceptedProviderAccessFailureEvidence).not.toHaveBeenCalled();
  });

  it("normalizes workspace aliases before writing accepted readiness impact", async () => {
    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(
          workspaceAliasReadinessImpactFailedTaskResult
        ),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Codex",
        targetProfileName: "Codex",
      })
    ).resolves.toEqual({
      publishedSignalId: "signal-system-final-1",
      publishState: "reply_published",
      status: "finalized",
    });

    expect(writeAcceptedAgentExecutionReadinessImpact).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      db: {},
      executionIdentity: {
        bindingId: "binding-claude-code-1",
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-office-mac-1",
      },
      observedAtMs: 1_700_000_000_100,
      reasonCode: "workspace.invalid",
      sourceAttemptId: "attempt-provider-access-1",
      sourceDispatchId: "dispatch-provider-access-1",
    });
  });

  it("clears matching provider account evidence after an accepted successful result", async () => {
    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(successTaskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Claude Code",
        targetProfileName: "Claude Code",
      })
    ).resolves.toEqual({
      publishedSignalId: "signal-system-final-1",
      publishState: "reply_published",
      status: "finalized",
    });

    expect(
      clearProviderAccessFailureEvidenceForExecutionSuccess
    ).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      clearedAtMs: 1_700_000_000_100,
      db: {},
      executionIdentity: {
        bindingId: "binding-claude-code-1",
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-office-mac-1",
      },
      sourceAttemptId: "attempt-provider-access-1",
      sourceDispatchId: "dispatch-provider-access-1",
    });
    expect(
      clearAgentExecutionReadinessImpactForExecutionSuccess
    ).toHaveBeenCalledWith({
      agentProfileId: AGENT_PROFILE_ID,
      clearedAtMs: 1_700_000_000_100,
      db: {},
      executionIdentity: {
        bindingId: "binding-claude-code-1",
        agentControllerRef: "builtin:claude-code",
        openMeldServiceRuntimeId: "runtime-office-mac-1",
      },
      sourceDispatchId: "dispatch-provider-access-1",
    });
    expect(writeAcceptedProviderAccessFailureEvidence).not.toHaveBeenCalled();
    expect(writeAcceptedAgentExecutionReadinessImpact).not.toHaveBeenCalled();
  });

  it("leaves accepted success settlement to the Space after publishing without a conversation id", async () => {
    await expect(
      finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(unboundSuccessTaskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Claude Code",
        targetProfileName: "Claude Code",
      })
    ).resolves.toEqual({
      publishedSignalId: "signal-final-1",
      publishState: "reply_published",
      status: "finalized",
    });

    expect(markDispatchStatus).not.toHaveBeenCalled();
  });

  it("does not write readiness impact for publication or policy-missed failures", async () => {
    for (const taskResult of [
      publicationFailureTaskResult,
      policyMissedFailedTaskResult,
    ]) {
      vi.clearAllMocks();
      vi.mocked(readDispatchAttemptExecutionOwnershipFact).mockResolvedValue({
        status: "found",
        attemptId: "attempt-provider-access-1",
        bindingId: "binding-claude-code-1",
        agentControllerRef: "builtin:claude-code",
        dispatchId: "dispatch-provider-access-1",
        openMeldServiceRuntimeId: "runtime-office-mac-1",
        targetProfileId: AGENT_PROFILE_ID,
        taskId: "task-provider-access-1",
      });

      await finalizeAcceptedDispatchResult({
        db: {} as D1Database,
        dispatchMessage,
        env: buildEnv(),
        inboxRecord: buildInboxRecord(taskResult),
        recordPublicationProjection: false,
        targetOwnerUserId: "owner-1",
        targetProfileMentionLabel: "Codex",
        targetProfileName: "Codex",
      });

      expect(writeAcceptedAgentExecutionReadinessImpact).not.toHaveBeenCalled();
    }
  });

  it("does not write readiness impact when execution identity does not match", async () => {
    vi.mocked(readDispatchAttemptExecutionOwnershipFact).mockResolvedValueOnce({
      status: "found",
      attemptId: "attempt-provider-access-1",
      bindingId: "binding-claude-code-1",
      agentControllerRef: "builtin:claude-code",
      dispatchId: "dispatch-provider-access-1",
      openMeldServiceRuntimeId: "runtime-office-mac-1",
      targetProfileId: "agt_other",
      taskId: "task-provider-access-1",
    });

    await finalizeAcceptedDispatchResult({
      db: {} as D1Database,
      dispatchMessage,
      env: buildEnv(),
      inboxRecord: buildInboxRecord(readinessImpactFailedTaskResult),
      recordPublicationProjection: false,
      targetOwnerUserId: "owner-1",
      targetProfileMentionLabel: "Codex",
      targetProfileName: "Codex",
    });

    expect(writeAcceptedAgentExecutionReadinessImpact).not.toHaveBeenCalled();
  });

  it("does not trust an existing D1 published pointer as dispatch success", async () => {
    vi.mocked(
      dispatchResultService.getDispatchResultByDispatchId
    ).mockResolvedValueOnce({
      dispatchId: dispatchMessage.dispatchId,
      publicOutcome: "post_message",
      publishedSignalId: "signal-existing-1",
      resultKind: "text",
      resultRef: "result-ref-1",
      spaceId: dispatchMessage.spaceId,
    } as never);

    await finalizeExistingAcceptedDispatchResultForTest();

    expect(markDispatchStatus).not.toHaveBeenCalled();
  });
  it("does not settle an unpublished non-silent result from the D1 projection alone", async () => {
    vi.mocked(
      dispatchResultService.getDispatchResultByDispatchId
    ).mockResolvedValueOnce({
      dispatchId: dispatchMessage.dispatchId,
      publicOutcome: "system_notice",
      publishedSignalId: null,
      resultKind: "text",
      resultRef: "result-ref-2",
      spaceId: dispatchMessage.spaceId,
    } as never);

    await finalizeExistingAcceptedDispatchResultForTest();

    expect(markDispatchStatus).not.toHaveBeenCalled();
  });

  it("leaves intentionally internal-only settlement to the Space", async () => {
    vi.mocked(
      dispatchResultService.getDispatchResultByDispatchId
    ).mockResolvedValueOnce({
      dispatchId: dispatchMessage.dispatchId,
      publicOutcome: "internal_only",
      publishedSignalId: null,
      resultKind: "text",
      resultRef: "result-ref-3",
      spaceId: dispatchMessage.spaceId,
    } as never);

    await finalizeExistingAcceptedDispatchResultForTest();

    expect(markDispatchStatus).not.toHaveBeenCalled();
  });
});
