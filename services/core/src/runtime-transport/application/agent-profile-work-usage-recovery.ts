import { resolveAgentProfileUsageRecoveryAvailability } from "@openmeld/agent-runtime";
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
}) => Promise<{ continuationProfileIds: readonly string[] }>;

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

  const recoveryTargets = {
    ownerUserId: input.ownerUserId,
    targetProfileIds: bindings.map((binding) => binding.agentProfileId),
  };
  const marked = await input.notifyUsageAvailable(recoveryTargets);
  if (marked.continuationProfileIds.length === 0) {
    return;
  }
  await input.resumeInterruptedWork({
    ownerUserId: input.ownerUserId,
    targetProfileIds: marked.continuationProfileIds,
  });
}
