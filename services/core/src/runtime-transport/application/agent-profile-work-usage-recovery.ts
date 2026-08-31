import { resolveAgentProfileUsageRecoveryAvailability } from "@openmeld/agent-runtime";
import {
  MAX_RUNTIME_TRANSPORT_AGENT_PROFILE_WORK_USAGE_AVAILABLE_TARGETS,
  runtimeTransportAgentProfileWorkUsageAvailableResponseSchema,
} from "@openmeld/schemas";
import type { AcceptedRuntimeAgentControllerReport } from "../../runtime-registry/application/runtime-agent-controller-report-service";

type AgentProfileWorkUsageRecoveryBinding = {
  agentProfileId: string;
};

export type AgentProfileWorkUsageRecoveryBindingStore = {
  listBindings: (input: {
    agentControllerRef: string;
    openMeldServiceRuntimeId: string;
    owner: { id: string; kind: "owner_account" };
  }) => Promise<readonly AgentProfileWorkUsageRecoveryBinding[]>;
};

export type NotifyAgentProfileWorkUsageAvailable = (input: {
  ownerUserId: string;
  targetProfileIds: readonly string[];
}) => Promise<unknown>;

export type ResumeUsageExhaustedAgentProfileWork = (input: {
  ownerUserId: string;
  targetProfileIds: readonly string[];
}) => Promise<void>;

export async function notifyAgentProfileWorkUsageRecoveryAvailable(input: {
  bindingStore: AgentProfileWorkUsageRecoveryBindingStore;
  currentReport: AcceptedRuntimeAgentControllerReport;
  notifyUsageAvailable: NotifyAgentProfileWorkUsageAvailable;
  nowMs: number;
  ownerUserId: string;
  resumeInterruptedWork: ResumeUsageExhaustedAgentProfileWork;
}): Promise<void> {
  const availability = resolveAgentProfileUsageRecoveryAvailability({
    agentControllerRef: input.currentReport.agentControllerRef,
    nowMs: input.nowMs,
    report: {
      expiresAtMs: input.currentReport.expiresAtMs,
      status: input.currentReport.status,
      usageLimits: input.currentReport.agentControllerInterface?.usageLimits,
      usageLimitsSupportMatrixVersion:
        input.currentReport.agentControllerInterface
          ?.usageLimitsSupportMatrixVersion,
    },
  });
  if (!availability.available) {
    return;
  }

  const bindings = await input.bindingStore.listBindings({
    agentControllerRef: input.currentReport.agentControllerRef,
    openMeldServiceRuntimeId:
      input.currentReport.openMeldServiceRuntimeId.value,
    owner: { id: input.ownerUserId, kind: "owner_account" },
  });
  if (bindings.length === 0) {
    return;
  }

  const targetProfileIds = bindings.map((binding) => binding.agentProfileId);
  const continuationProfileIds: string[] = [];
  for (
    let offset = 0;
    offset < targetProfileIds.length;
    offset += MAX_RUNTIME_TRANSPORT_AGENT_PROFILE_WORK_USAGE_AVAILABLE_TARGETS
  ) {
    continuationProfileIds.push(
      ...(await markUsageAvailableWithoutProfileFailureFanout({
        notifyUsageAvailable: input.notifyUsageAvailable,
        ownerUserId: input.ownerUserId,
        targetProfileIds: targetProfileIds.slice(
          offset,
          offset +
            MAX_RUNTIME_TRANSPORT_AGENT_PROFILE_WORK_USAGE_AVAILABLE_TARGETS
        ),
      }))
    );
  }
  if (continuationProfileIds.length === 0) {
    return;
  }
  await input.resumeInterruptedWork({
    ownerUserId: input.ownerUserId,
    targetProfileIds: continuationProfileIds,
  });
}

async function markUsageAvailableWithoutProfileFailureFanout(input: {
  notifyUsageAvailable: NotifyAgentProfileWorkUsageAvailable;
  ownerUserId: string;
  targetProfileIds: readonly string[];
}): Promise<readonly string[]> {
  try {
    const marked =
      runtimeTransportAgentProfileWorkUsageAvailableResponseSchema.parse(
        await input.notifyUsageAvailable({
          ownerUserId: input.ownerUserId,
          targetProfileIds: input.targetProfileIds,
        })
      );
    return marked.continuationProfileIds;
  } catch (error) {
    if (input.targetProfileIds.length > 1) {
      const midpoint = Math.ceil(input.targetProfileIds.length / 2);
      const [left, right] = await Promise.all([
        markUsageAvailableWithoutProfileFailureFanout({
          ...input,
          targetProfileIds: input.targetProfileIds.slice(0, midpoint),
        }),
        markUsageAvailableWithoutProfileFailureFanout({
          ...input,
          targetProfileIds: input.targetProfileIds.slice(midpoint),
        }),
      ]);
      return [...left, ...right];
    }
    console.warn("[core.agent_profile_work.usage_recovery_profile_failed]", {
      agentProfileId: input.targetProfileIds[0] ?? null,
      error,
      ownerUserId: input.ownerUserId,
    });
    return [];
  }
}
