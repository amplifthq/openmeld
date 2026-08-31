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
    const marked =
      runtimeTransportAgentProfileWorkUsageAvailableResponseSchema.parse(
        await input.notifyUsageAvailable({
          ownerUserId: input.ownerUserId,
          targetProfileIds: targetProfileIds.slice(
            offset,
            offset +
              MAX_RUNTIME_TRANSPORT_AGENT_PROFILE_WORK_USAGE_AVAILABLE_TARGETS
          ),
        })
      );
    continuationProfileIds.push(...marked.continuationProfileIds);
  }
  if (continuationProfileIds.length === 0) {
    return;
  }
  await input.resumeInterruptedWork({
    ownerUserId: input.ownerUserId,
    targetProfileIds: continuationProfileIds,
  });
}
