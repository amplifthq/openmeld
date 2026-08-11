import {
  resolveNativeAgentControllerCollaborationModeForController,
  resolveNativeAgentControllerPermissionModeForController,
} from "@openmeld/agent-runtime";
import type {
  GetLocalRuntimeExpectedRoutesResponse,
  LocalRuntimeExpectedRoute,
  LocalRuntimeExpectedRouteExclusion,
} from "@openmeld/schemas/types";
import type { AgentProfileBindingRecord } from "../infrastructure/d1/agent-profile-binding-repo";

// Contract: developing/architecture/agent-transport-contract.md ("Expected Routes Projection")
// Pure assembly of the owner + runtime scoped expected-routes projection.
// Eligibility is decided here, server-side: enabled_primary bindings whose
// execution target is THIS runtime and whose agent profile is active. The
// exclusion list is diagnostic-only and never participates in availability.

export type ExpectedRouteProfileFact = {
  profileKind: "human" | "agent" | "system";
  profileName: string | null;
  status: "active" | "disabled";
};

export function buildExpectedRoutesProjection(input: {
  openMeldServiceRuntimeId: string;
  bindings: readonly AgentProfileBindingRecord[];
  includeAgentControllerCollaborationMode?: boolean;
  includeConfigurationRevision?: boolean;
  profileFactByProfileId: ReadonlyMap<string, ExpectedRouteProfileFact | null>;
}): {
  excludedProfiles: LocalRuntimeExpectedRouteExclusion[];
  expectedRoutes: LocalRuntimeExpectedRoute[];
} {
  const expectedRoutes: LocalRuntimeExpectedRoute[] = [];
  const excludedProfiles: LocalRuntimeExpectedRouteExclusion[] = [];

  for (const binding of input.bindings) {
    if (binding.bindingState !== "enabled_primary") {
      continue;
    }
    if (binding.openMeldServiceRuntimeId !== input.openMeldServiceRuntimeId) {
      excludedProfiles.push({
        agentProfileId: binding.agentProfileId,
        reasonCode: "binding.other_runtime",
      });
      continue;
    }
    const profileFact =
      input.profileFactByProfileId.get(binding.agentProfileId) ?? null;
    // An unresolvable or non-agent profile cannot carry a local Wake route;
    // its binding should already be disabled, so surface it as inactive.
    if (
      profileFact?.profileKind !== "agent" ||
      profileFact.status !== "active"
    ) {
      excludedProfiles.push({
        agentProfileId: binding.agentProfileId,
        reasonCode: "profile.inactive",
      });
      continue;
    }

    expectedRoutes.push({
      agentProfileId: binding.agentProfileId,
      bindingId: binding.bindingId,
      bindingState: "enabled_primary",
      ...buildExpectedRouteConfigurationIdentity(
        binding,
        input.includeConfigurationRevision === true
      ),
      executionTarget: {
        agentControllerConversationId:
          normalizeOptionalIdentifier(binding.agentControllerConversationId) ??
          null,
        agentControllerRef: binding.agentControllerRef,
        openMeldServiceRuntimeId: binding.openMeldServiceRuntimeId,
      },
      modelSelection: binding.modelId
        ? {
            modelId: binding.modelId,
            ...(binding.reasoningLevel
              ? { reasoningLevel: binding.reasoningLevel }
              : {}),
          }
        : undefined,
      ...resolveExpectedRouteAgentControllerModes(
        binding,
        input.includeAgentControllerCollaborationMode === true
      ),
      ...(binding.openCodePermission &&
      isOpenCodeAgentControllerRef(binding.agentControllerRef)
        ? { openCodePermission: binding.openCodePermission }
        : {}),
      profileName: normalizeOptionalIdentifier(profileFact.profileName),
      reasonCodes: [],
      routable: true,
    });
  }

  return {
    excludedProfiles: sortByProfileId(excludedProfiles),
    expectedRoutes: sortByProfileId(expectedRoutes),
  };
}

const buildExpectedRouteConfigurationIdentity = (
  binding: AgentProfileBindingRecord,
  includeConfigurationRevision: boolean
): Pick<LocalRuntimeExpectedRoute, "configurationRevision"> =>
  includeConfigurationRevision
    ? { configurationRevision: binding.configurationRevision }
    : {};

function resolveExpectedRouteAgentControllerModes(
  binding: AgentProfileBindingRecord,
  includeAgentControllerCollaborationMode: boolean
): Partial<
  Pick<
    LocalRuntimeExpectedRoute,
    "agentControllerCollaborationMode" | "agentControllerPermissionMode"
  >
> {
  const agentControllerPermissionMode =
    resolveNativeAgentControllerPermissionModeForController(
      binding.agentControllerPermissionMode,
      { agentControllerRef: binding.agentControllerRef }
    );
  const agentControllerCollaborationMode =
    includeAgentControllerCollaborationMode
      ? resolveNativeAgentControllerCollaborationModeForController(
          binding.agentControllerCollaborationMode,
          { agentControllerRef: binding.agentControllerRef }
        )
      : null;
  return {
    ...(agentControllerCollaborationMode
      ? { agentControllerCollaborationMode }
      : {}),
    ...(agentControllerPermissionMode ? { agentControllerPermissionMode } : {}),
  };
}

function isOpenCodeAgentControllerRef(agentControllerRef: string): boolean {
  return agentControllerRef === "builtin:opencode";
}

// Device-level conditions are expressed at the top level only: missing or
// conflicting runtime resolution returns empty lists, never a per-profile
// exclusion expansion (contract section 3, ruling 2).
export function buildUnresolvedExpectedRoutesResponse(input: {
  generatedAt: string;
  runtimeResolution: "missing" | "conflict";
}): GetLocalRuntimeExpectedRoutesResponse {
  return {
    openMeldServiceRuntimeId: null,
    excludedProfiles: [],
    expectedRoutes: [],
    generatedAt: input.generatedAt,
    runtimeResolution: input.runtimeResolution,
  };
}

function sortByProfileId<T extends { agentProfileId: string }>(
  items: T[]
): T[] {
  return [...items].sort((left, right) =>
    left.agentProfileId.localeCompare(right.agentProfileId)
  );
}

function normalizeOptionalIdentifier(
  value: string | null | undefined
): string | null {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
