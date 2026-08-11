import { createPrepareReadinessApi } from "@openmeld/api-client";
import type { GetPrepareReadinessResponse } from "@openmeld/schemas/types";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import { resolveAgentProfilePrimaryAgentControllerReport } from "./agent-profile-primary-binding";

export type PrepareReadinessApiEvidence = {
  status: "not_ready" | "ready" | "unavailable";
  source: "prepare_readiness_api";
  agentControllerRef?: string;
  reason?:
    | "agent_controller_ref_unavailable"
    | "read_failed"
    | "service_contract_unavailable";
  openMeldServiceRuntimeId?: string;
  runnableCapabilityCount: number;
  nonRunnableCapabilityCount: number;
  reasonCodes: string[];
};

export async function resolvePrepareReadinessApiEvidence(input: {
  baseUrl?: string;
  profile: OpenMeldProfile;
}): Promise<PrepareReadinessApiEvidence> {
  const agentControllerRef = await resolveProfileAgentControllerRef(input);
  if (!agentControllerRef) {
    return unavailableEvidence({
      reason: "agent_controller_ref_unavailable",
      reasonCode: "prepare_readiness.agent_controller_ref_unavailable",
    });
  }

  const serviceContract = await readDaemonServiceContract().catch(() => null);
  if (
    !(
      serviceContract?.deviceId &&
      serviceContract.gatewayUrl &&
      isFinitePositiveNumber(serviceContract.heartbeatMs) &&
      serviceContract.lane
    )
  ) {
    return unavailableEvidence({
      agentControllerRef,
      reason: "service_contract_unavailable",
      reasonCode: "prepare_readiness.service_contract_unavailable",
    });
  }

  try {
    const api = createPrepareReadinessApi(
      createCliApiClientFoundation(input.baseUrl ?? serviceContract.gatewayUrl)
    );
    const response = await api.getReadiness({
      agentControllerRefs: [agentControllerRef],
      deviceId: serviceContract.deviceId,
      lane: serviceContract.lane,
    });
    return toEvidence({ agentControllerRef, response });
  } catch (error) {
    console.warn("[openmeld.prepare_readiness.api_read_failed]", {
      event: "cli.prepare_readiness.api_read_failed",
      error: toErrorMessage(error),
      profileId: input.profile.openMeldProfileId,
    });
    return unavailableEvidence({
      agentControllerRef,
      reason: "read_failed",
      reasonCode: "prepare_readiness.read_failed",
    });
  }
}

function isFinitePositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

async function resolveProfileAgentControllerRef(input: {
  baseUrl?: string;
  profile: OpenMeldProfile;
}): Promise<string | null> {
  const capability = await resolveAgentProfilePrimaryAgentControllerReport({
    baseUrl: input.baseUrl,
    profile: input.profile,
  }).catch(() => null);
  return capability?.agentControllerRef ?? null;
}

function toEvidence(input: {
  agentControllerRef: string;
  response: GetPrepareReadinessResponse;
}): PrepareReadinessApiEvidence {
  return {
    agentControllerRef: input.agentControllerRef,
    nonRunnableCapabilityCount: input.response.nonRunnableCapabilities.length,
    reasonCodes: input.response.summary.reasonCodes,
    runnableCapabilityCount: input.response.runnableCapabilities.length,
    openMeldServiceRuntimeId: input.response.openMeldServiceRuntimeId?.value,
    source: "prepare_readiness_api",
    status: input.response.status,
  };
}

function unavailableEvidence(input: {
  agentControllerRef?: string;
  reason: NonNullable<PrepareReadinessApiEvidence["reason"]>;
  reasonCode: string;
}): PrepareReadinessApiEvidence {
  return {
    ...(input.agentControllerRef
      ? { agentControllerRef: input.agentControllerRef }
      : {}),
    nonRunnableCapabilityCount: 0,
    reason: input.reason,
    reasonCodes: [input.reasonCode],
    runnableCapabilityCount: 0,
    source: "prepare_readiness_api",
    status: "unavailable",
  };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message.trim();
    return message.length > 0 ? message : "unknown error";
  }
  const message = String(error ?? "").trim();
  return message.length > 0 ? message : "unknown error";
}
