import { createAgentProfileBindingApi } from "@openmeld/api-client";
import type {
  AgentControllerPermissionMode,
  EnsureAgentProfilePrimaryBindingResponse,
} from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { createCliApiClientFoundation } from "../space/api-client-foundation";

export async function updateAgentProfilePrimaryBindingAgentControllerPermissionMode(input: {
  agentControllerPermissionMode: AgentControllerPermissionMode;
  profile: OpenMeldProfile;
}): Promise<EnsureAgentProfilePrimaryBindingResponse> {
  const gatewayUrl = await resolveBaseUrl();
  const api = createAgentProfileBindingApi(
    createCliApiClientFoundation(gatewayUrl)
  );

  return await api.updatePrimaryBindingAgentControllerPermissionMode({
    agentControllerPermissionMode: input.agentControllerPermissionMode,
    agentProfileId: input.profile.openMeldProfileId,
    requestContext: buildOpenMeldRequestContextFromProfile({
      openMeldProfile: input.profile,
    }),
  });
}
