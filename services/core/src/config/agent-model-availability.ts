import {
  getAgentControllerModelCatalogId,
  type ModelAvailabilityDecision,
  parseAgentControllerRef,
  resolveAgentControllerUsageProviderId,
  resolveModelAvailability,
} from "@openmeld/agent-runtime";
import type { ModelCatalog } from "@openmeld/schemas/types";
import type { AcceptedRuntimeAgentControllerReport } from "../runtime-registry/application/runtime-agent-controller-report-service";
import { readAuthoredModelCatalog } from "./model-catalog";

export function readCurrentAgentModelAuthType(input: {
  agentControllerRef: string;
  openMeldServiceRuntimeId?: string | null;
  currentReport?: AcceptedRuntimeAgentControllerReport | null;
  nowMs: number;
}): string | null {
  const report = input.currentReport;
  const auth = report?.agentControllerInterface?.auth;
  if (
    report?.agentControllerRef !== input.agentControllerRef ||
    report?.openMeldServiceRuntimeId.value !== input.openMeldServiceRuntimeId ||
    report?.agentControllerInterface?.agentControllerRef !==
      input.agentControllerRef ||
    report?.status !== "ready" ||
    report.expiresAtMs <= input.nowMs ||
    auth?.status !== "authenticated"
  ) {
    return null;
  }
  return auth.type ?? null;
}

/** Interpret existing, identity-checked account evidence; never probe a provider. */
export function resolveCurrentAgentModelAvailability(input: {
  agentControllerRef: string;
  modelId: string | null | undefined;
  openMeldServiceRuntimeId?: string | null;
  currentReport?: AcceptedRuntimeAgentControllerReport | null;
  nowMs: number;
  catalog?: ModelCatalog;
}): ModelAvailabilityDecision {
  // An unset native session has no explicit model intent to rewrite or guess.
  if (!input.modelId) {
    return { available: true };
  }
  const ref = parseAgentControllerRef(input.agentControllerRef);
  const catalog = input.catalog ?? readAuthoredModelCatalog();
  const controller = ref
    ? catalog.agentControllers[getAgentControllerModelCatalogId(ref)]
    : null;
  const model = controller?.models.find((entry) => entry.id === input.modelId);
  return resolveModelAvailability(model, {
    agentControllerRef: input.agentControllerRef,
    authType: readCurrentAgentModelAuthType(input),
    providerId:
      model?.hostedRuntime?.provider ??
      resolveAgentControllerUsageProviderId({
        agentControllerRef: input.agentControllerRef,
        modelId: input.modelId,
      }),
  });
}
