import {
  createAuthorityOpenMeldServiceRuntimeId,
  createRuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { AgentActivityEventRejectionReason } from "@openmeld/schemas/types";
import { lookupRuntime } from "../runtime-registry/application/runtime-lookup-service";
import { readRuntimeRegistryRecord } from "../runtime-registry/infrastructure/d1/runtime-registry-repo";

export type VerifiedRuntimeReportingAuthority = {
  deviceId: string;
  lane: string;
  ownerUserId: string;
  openMeldServiceRuntimeId: string;
};

export async function verifyRuntimeReportingAuthority(input: {
  db: D1Database;
  deviceId: string;
  lane: string;
  ownerUserId: string;
  openMeldServiceRuntimeId: {
    source: "runtime_registry_authority";
    value: string;
  };
}): Promise<
  | { ok: true; runtime: VerifiedRuntimeReportingAuthority }
  | {
      ok: false;
      reason: Extract<
        AgentActivityEventRejectionReason,
        | "runtime_lookup_conflict"
        | "runtime_missing"
        | "openmeld_service_runtime_id_invalid"
        | "openmeld_service_runtime_id_mismatch"
        | "openmeld_service_runtime_identity_invalid"
      >;
    }
> {
  try {
    const runtimeLookupInput = createRuntimeLookupInput({
      deviceId: input.deviceId,
      lane: input.lane,
      owner: { id: input.ownerUserId, kind: "owner_account" },
    });
    const submittedRuntimeId = createAuthorityOpenMeldServiceRuntimeId({
      lookupInput: runtimeLookupInput,
      source: input.openMeldServiceRuntimeId.source,
      openMeldServiceRuntimeId: input.openMeldServiceRuntimeId.value,
    });
    const result = await lookupRuntime({
      runtimeLookupInput,
      store: {
        readRuntimeRecord: async (lookupInput) =>
          await readRuntimeRegistryRecord({
            db: input.db,
            runtimeLookupInput: lookupInput.runtimeLookupInput,
          }),
      },
    });
    if (result.status === "invalid_identity") {
      return {
        ok: false,
        reason: "openmeld_service_runtime_identity_invalid",
      };
    }
    if (result.status === "missing") {
      return { ok: false, reason: "runtime_missing" };
    }
    if (result.status === "conflict") {
      return { ok: false, reason: "runtime_lookup_conflict" };
    }
    if (result.openMeldServiceRuntimeId.value !== submittedRuntimeId.value) {
      return {
        ok: false,
        reason: "openmeld_service_runtime_id_mismatch",
      };
    }
    return {
      ok: true,
      runtime: {
        deviceId: runtimeLookupInput.deviceId,
        lane: runtimeLookupInput.lane,
        ownerUserId: runtimeLookupInput.owner.id,
        openMeldServiceRuntimeId: submittedRuntimeId.value,
      },
    };
  } catch {
    return {
      ok: false,
      reason: "openmeld_service_runtime_id_invalid",
    };
  }
}
