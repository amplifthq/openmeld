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
  catalog?: Pick<ModelCatalog, "agentControllers">;
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

/** Catalog intent validation is shared by creation admission and Binding writes. */
export function validateAgentModelSelection(input: {
  agentControllerRef: string;
  catalog: Pick<ModelCatalog, "agentControllers">;
  currentReport?: AcceptedRuntimeAgentControllerReport | null;
  modelId: string;
  nowMs: number;
  openMeldServiceRuntimeId?: string | null;
  reasoningLevel?: string | null;
}): {
  code:
    | "agent_profile_binding.model_not_supported"
    | "agent_profile_binding.reasoning_level_not_supported";
  reason: string;
} | null {
  const ref = parseAgentControllerRef(input.agentControllerRef);
  const controller = ref
    ? input.catalog.agentControllers[getAgentControllerModelCatalogId(ref)]
    : undefined;
  const availability = resolveCurrentAgentModelAvailability(input);
  if (
    !availability.available &&
    controller?.models.some((model) => model.id === input.modelId)
  ) {
    return {
      code: "agent_profile_binding.model_not_supported",
      reason: availability.message,
    };
  }
  const supportedModels =
    controller?.models.filter(
      (model) =>
        resolveCurrentAgentModelAvailability({ ...input, modelId: model.id })
          .available
    ) ?? [];
  const selectedModel = supportedModels.find(
    (model) => model.id === input.modelId
  );
  if (!selectedModel) {
    return {
      code: "agent_profile_binding.model_not_supported",
      reason: `Model "${input.modelId}" is not supported for Agent Controller "${input.agentControllerRef}". Supported models: ${formatSupportedValues(supportedModels.map((model) => model.id))}.`,
    };
  }
  if (
    input.reasoningLevel &&
    !selectedModel.supportedReasoningLevels.includes(input.reasoningLevel)
  ) {
    return {
      code: "agent_profile_binding.reasoning_level_not_supported",
      reason: `Reasoning level "${input.reasoningLevel}" is not supported for model "${input.modelId}". Supported reasoning levels: ${formatSupportedValues(selectedModel.supportedReasoningLevels)}.`,
    };
  }
  return null;
}

function formatSupportedValues(values: readonly string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}
