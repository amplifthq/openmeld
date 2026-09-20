import { createRuntimeLookupInput } from "@openmeld/agent-runtime";
import type {
  DaemonServiceLane,
  GetLocalRuntimeExpectedRoutesQuery,
  GetLocalRuntimeExpectedRoutesResponse,
} from "@openmeld/schemas/types";
import { readAuthProfileFacts } from "../../auth/application/profile-facts-reader";
import type { CoreBindings } from "../../lib/bindings";
import { lookupRuntime } from "../../runtime-registry/application/runtime-lookup-service";
import { readRuntimeRegistryRecord } from "../../runtime-registry/infrastructure/d1/runtime-registry-repo";
import { listEnabledPrimaryAgentProfileBindingRecords } from "../infrastructure/d1/agent-profile-binding-repo";
import {
  buildExpectedRoutesProjection,
  buildUnresolvedExpectedRoutesResponse,
  type ExpectedRouteProfileFact,
} from "./expected-routes-projection";

export type ReadLocalRuntimeExpectedRoutesResult =
  | {
      response: GetLocalRuntimeExpectedRoutesResponse;
      status: "ok";
    }
  | {
      status: "invalid_identity";
    }
  | {
      status: "profile_facts_unavailable";
    };

export async function readLocalRuntimeExpectedRoutes(input: {
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"] | undefined;
  contractVersion?: GetLocalRuntimeExpectedRoutesQuery["contractVersion"];
  db: D1Database;
  deviceId: string;
  generatedAt?: string;
  lane: DaemonServiceLane;
  ownerUserId: string;
}): Promise<ReadLocalRuntimeExpectedRoutesResult> {
  const owner = { id: input.ownerUserId, kind: "owner_account" as const };
  const runtimeLookupInput = createRuntimeLookupInput({
    deviceId: input.deviceId,
    lane: input.lane,
    owner,
  });
  const lookupResult = await lookupRuntime({
    runtimeLookupInput,
    store: {
      readRuntimeRecord: async (readInput) =>
        await readRuntimeRegistryRecord({
          db: input.db,
          runtimeLookupInput: readInput.runtimeLookupInput,
        }),
    },
  });
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  if (lookupResult.status === "invalid_identity") {
    return { status: "invalid_identity" };
  }
  if (lookupResult.status === "missing" || lookupResult.status === "conflict") {
    return {
      response: buildUnresolvedExpectedRoutesResponse({
        generatedAt,
        runtimeResolution: lookupResult.status,
      }),
      status: "ok",
    };
  }

  const openMeldServiceRuntimeId = lookupResult.openMeldServiceRuntimeId.value;
  const bindings = await listEnabledPrimaryAgentProfileBindingRecords({
    db: input.db,
    owner,
  });
  const runtimeBindings = bindings.filter(
    (binding) => binding.openMeldServiceRuntimeId === openMeldServiceRuntimeId
  );
  const profiles = await readAuthProfileFacts({
    authWorker: input.authWorker,
    profileIds: runtimeBindings.map((binding) => binding.agentProfileId),
  });
  // A transient profile-facts outage must fail the whole read instead of
  // shrinking the expected set: consumers keep their current catalog on a
  // failed load, while an "inactive" answer would deregister live routes.
  if (profiles === null) {
    return { status: "profile_facts_unavailable" };
  }
  const profileFactByProfileId = new Map<
    string,
    ExpectedRouteProfileFact | null
  >(
    runtimeBindings.map(({ agentProfileId }) => {
      const profile = profiles.get(agentProfileId);
      return [
        agentProfileId,
        profile && profile.ownerUserId?.trim() === input.ownerUserId
          ? {
              defaultProjectId: normalizeOptionalText(profile.defaultProjectId),
              profileKind: profile.profileKind,
              profileName: profile.profileName.trim() || null,
              status: profile.status,
            }
          : null,
      ];
    })
  );
  const projection = buildExpectedRoutesProjection({
    openMeldServiceRuntimeId,
    bindings,
    includeAgentControllerCollaborationMode:
      input.contractVersion === "v2" ||
      input.contractVersion === "v3" ||
      input.contractVersion === "v4",
    includeConfigurationRevision:
      input.contractVersion === "v3" || input.contractVersion === "v4",
    includeDefaultProjectId: input.contractVersion === "v4",
    profileFactByProfileId,
  });

  return {
    response: {
      openMeldServiceRuntimeId,
      excludedProfiles: projection.excludedProfiles,
      expectedRoutes: projection.expectedRoutes,
      generatedAt,
      runtimeResolution: "resolved",
    },
    status: "ok",
  };
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
