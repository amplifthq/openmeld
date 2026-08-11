import {
  type AgentControllerRefKind,
  parseAgentControllerRef,
} from "@openmeld/agent-runtime";
import { createAgentProfileBindingApi } from "@openmeld/api-client";
import type {
  AgentProfileBindingProjection,
  GetAgentProfilePrimaryBindingResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import { resolveLocalRegistryAgentIdFromAgentControllerRef } from "../agents/controller-identity";
import { resolveBaseUrl } from "../config/base-url";
import type { OpenMeldProfile } from "../config/openmeld-profiles-api";
import { buildOpenMeldRequestContextFromProfile } from "../config/openmeld-request-context";
import { createCliApiClientFoundation } from "../space/api-client-foundation";
import type { PrimaryBindingReadSession } from "./primary-binding-read-session";

export type AgentProfilePrimaryAgentControllerReport = {
  bindingState: AgentProfileBindingProjection["bindingState"];
  capabilityKind: AgentControllerRefKind;
  agentControllerRef: string;
  capabilityId: string;
  localAgentId: string | null;
  primaryBinding: GetAgentProfilePrimaryBindingResponse["binding"];
  reasonCodes: string[];
  routable: boolean;
};

export async function resolveAgentProfilePrimaryAgentControllerReport(input: {
  baseUrl?: string;
  bindingReads?: PrimaryBindingReadSession;
  profile: OpenMeldProfile;
  requestContext?: OpenMeldRequestContext;
}): Promise<AgentProfilePrimaryAgentControllerReport | null> {
  if (input.profile.profileKind !== "agent") {
    return null;
  }

  const response = input.bindingReads
    ? await input.bindingReads.readPrimaryBinding(input.profile)
    : await readPrimaryBindingDirect(input);
  const parsedCapability = parseAgentControllerRef(
    response.binding.executionTarget?.agentControllerRef
  );
  if (!parsedCapability) {
    return null;
  }

  return {
    bindingState: response.binding.bindingState,
    capabilityKind: parsedCapability.kind,
    agentControllerRef: parsedCapability.ref,
    capabilityId: parsedCapability.id,
    localAgentId: resolveLocalRegistryAgentIdFromAgentControllerRef({
      agentControllerRef: parsedCapability.ref,
    }),
    primaryBinding: response.binding,
    reasonCodes: response.binding.reasonCodes,
    routable: response.binding.routable,
  };
}

async function readPrimaryBindingDirect(input: {
  baseUrl?: string;
  profile: OpenMeldProfile;
  requestContext?: OpenMeldRequestContext;
}): Promise<GetAgentProfilePrimaryBindingResponse> {
  const baseUrl = input.baseUrl ?? (await resolveBaseUrl());
  const api = createAgentProfileBindingApi(
    createCliApiClientFoundation(baseUrl)
  );
  return await api.getPrimaryBinding({
    agentProfileId: input.profile.openMeldProfileId,
    requestContext:
      input.requestContext ??
      buildOpenMeldRequestContextFromProfile({
        openMeldProfile: input.profile,
      }),
  });
}
