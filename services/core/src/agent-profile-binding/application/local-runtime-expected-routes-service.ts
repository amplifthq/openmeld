import { createRuntimeLookupInput } from "@openmeld/agent-runtime";
import type {
  DaemonServiceLane,
  GetLocalRuntimeExpectedRoutesQuery,
  GetLocalRuntimeExpectedRoutesResponse,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../lib/bindings";
import { lookupRuntime } from "../../runtime-registry/application/runtime-lookup-service";
import { readRuntimeRegistryRecord } from "../../runtime-registry/infrastructure/d1/runtime-registry-repo";
import { listEnabledPrimaryAgentProfileBindingRecords } from "../infrastructure/d1/agent-profile-binding-repo";
import {
  buildExpectedRoutesProjection,
  buildUnresolvedExpectedRoutesResponse,
  type ExpectedRouteProfileFact,
} from "./expected-routes-projection";

type ExpectedRouteProfileFactResult =
  | { status: "invalid" }
  | { status: "resolved"; profile: ExpectedRouteProfileFact }
  | { status: "unavailable" };

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
  const profileFactEntries = await Promise.all(
    runtimeBindings.map(
      async (binding) =>
        [
          binding.agentProfileId,
          await resolveExpectedRouteProfileFact({
            agentProfileId: binding.agentProfileId,
            authWorker: input.authWorker,
            ownerUserId: input.ownerUserId,
          }),
        ] as const
    )
  );
  // A transient profile-facts outage must fail the whole read instead of
  // shrinking the expected set: consumers keep their current catalog on a
  // failed load, while an "inactive" answer would deregister live routes.
  const unavailableEntry = profileFactEntries.find(
    ([, fact]) => fact.status === "unavailable"
  );
  if (unavailableEntry) {
    return { status: "profile_facts_unavailable" };
  }
  const profileFactByProfileId = new Map<
    string,
    ExpectedRouteProfileFact | null
  >(
    profileFactEntries.map(([agentProfileId, fact]) => [
      agentProfileId,
      fact.status === "resolved" ? fact.profile : null,
    ])
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

async function resolveExpectedRouteProfileFact(input: {
  agentProfileId: string;
  authWorker: CoreBindings["OPENMELD_AUTH_WORKER"] | undefined;
  ownerUserId: string;
}): Promise<ExpectedRouteProfileFactResult> {
  if (!input.authWorker?.resolveProfileById) {
    return { status: "unavailable" };
  }
  let result: Awaited<
    ReturnType<
      NonNullable<
        NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>["resolveProfileById"]
      >
    >
  >;
  try {
    result = await input.authWorker.resolveProfileById({
      openMeldProfileId: input.agentProfileId,
    });
  } catch {
    return { status: "unavailable" };
  }
  if (!result.ok) {
    return result.code === "profile.not_found"
      ? { status: "invalid" }
      : { status: "unavailable" };
  }
  if (result.profile.profileId !== input.agentProfileId) {
    return { status: "invalid" };
  }
  if (String(result.profile.ownerUserId ?? "").trim() !== input.ownerUserId) {
    return { status: "invalid" };
  }
  return {
    profile: {
      defaultProjectId: normalizeOptionalText(result.profile.defaultProjectId),
      profileKind: result.profile.profileKind,
      profileName: result.profile.profileName?.trim() || null,
      status: result.profile.status,
    },
    status: "resolved",
  };
}

function normalizeOptionalText(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
