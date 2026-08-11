import { createAgentProfileBindingApi } from "@openmeld/api-client";
import type { EnsureAgentProfilePrimaryBindingResponse } from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { createCliApiClientFoundation } from "../space/api-client-foundation";

export async function updateAgentProfilePrimaryBindingModelSelection(input: {
  modelId: string;
  profile: OpenMeldProfile;
  reasoningLevel?: string | null;
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const gatewayUrl = await resolveBaseUrl();
  const api = createAgentProfileBindingApi(
    createCliApiClientFoundation(gatewayUrl)
  );
  const modelId = normalizeRequiredText(input.modelId, "--model is required.");
  const reasoningLevel = normalizeOptionalText(input.reasoningLevel);

  return await api.updatePrimaryBindingModelSelection({
    agentProfileId: input.profile.openMeldProfileId,
    modelId,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: input.profile,
    }),
    ...(reasoningLevel ? { reasoningLevel } : {}),
  });
}

function normalizeRequiredText(value: string, message: string): string {
  const normalized = normalizeOptionalText(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
