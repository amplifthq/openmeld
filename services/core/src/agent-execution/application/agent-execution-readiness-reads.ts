import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { AuthRpcResolveProfileByIdResult } from "@openmeld/schemas/types";
import {
  listEnabledPrimaryAgentProfileBindingRecords,
  readPrimaryAgentProfileBindingRecord,
} from "../../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import type { AuthProfileFacts } from "../../auth/application/profile-facts-reader";
import type { CoreBindings } from "../../lib/bindings";
import { readCurrentRuntimeAgentControllerReports } from "../../runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import {
  readRuntimeRegistryRecord,
  readRuntimeRegistryRecordByRuntimeId,
} from "../../runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import {
  readFreshProviderConversationProofForBinding,
  readFreshProviderConversationProofsForBindings,
} from "../infrastructure/postgresql/provider-conversation-proof-repo";
// One read set belongs to one readiness request. Profiles sharing a Runtime or
// Controller share in-flight reads, including failures, but no result survives
// into another request. The repositories still validate every stored fact.
export function createAgentExecutionReadinessReads(input?: {
  // Validated Auth facts from this request, never client state. Undefined means
  // not read; null means the batch failed and must not fan out into scalar reads.
  profileFacts?: AuthProfileFacts | null;
}) {
  const profiles = new Map<
    object,
    Map<string, Promise<AuthRpcResolveProfileByIdResult>>
  >();
  const bindings = new Map<
    PostgresDatabase,
    Map<string, ReturnType<typeof readPrimaryAgentProfileBindingRecord>>
  >();
  const runtimeById = new Map<
    PostgresDatabase,
    Map<string, ReturnType<typeof readRuntimeRegistryRecordByRuntimeId>>
  >();
  const runtimeByLookup = new Map<
    PostgresDatabase,
    Map<string, ReturnType<typeof readRuntimeRegistryRecord>>
  >();
  const controllerReports = new Map<
    PostgresDatabase,
    Map<string, ReturnType<typeof readCurrentRuntimeAgentControllerReports>>
  >();
  const proofsByBinding = new Map<
    PostgresDatabase,
    Map<
      string,
      Awaited<ReturnType<typeof readFreshProviderConversationProofsForBindings>>
    >
  >();
  return {
    async preloadPrimaryBindings(request: {
      db: PostgresDatabase;
      owner: Parameters<
        typeof readPrimaryAgentProfileBindingRecord
      >[0]["owner"];
      profileIds: readonly string[];
      nowMs: number;
    }): Promise<void> {
      const records =
        await listEnabledPrimaryAgentProfileBindingRecords(request);
      const byProfile = new Map(
        records.map((record) => [record.agentProfileId, record])
      );
      let databaseReads = bindings.get(request.db);
      if (!databaseReads) {
        databaseReads = new Map();
        bindings.set(request.db, databaseReads);
      }
      for (const profileId of request.profileIds) {
        const key = JSON.stringify([
          profileId,
          request.owner.kind,
          request.owner.id,
        ]);
        if (!databaseReads.has(key)) {
          databaseReads.set(
            key,
            Promise.resolve(byProfile.get(profileId) ?? null)
          );
        }
      }
      const selected = records.filter((record) =>
        request.profileIds.includes(record.agentProfileId)
      );
      const proofs = await readFreshProviderConversationProofsForBindings({
        db: request.db,
        nowMs: request.nowMs,
        bindingIds: selected.map((record) => record.bindingId),
      });
      let databaseProofs = proofsByBinding.get(request.db);
      if (!databaseProofs) {
        databaseProofs = new Map();
        proofsByBinding.set(request.db, databaseProofs);
      }
      for (const record of selected) {
        databaseProofs.set(
          record.bindingId,
          proofs.filter((proof) => proof.bindingId === record.bindingId)
        );
      }
    },
    readFreshProviderConversationProofForBinding(
      request: Parameters<
        typeof readFreshProviderConversationProofForBinding
      >[0]
    ) {
      const proofs = proofsByBinding.get(request.db)?.get(request.bindingId);
      if (!proofs) {
        return readFreshProviderConversationProofForBinding(request);
      }
      return Promise.resolve(
        proofs.find(
          (proof) =>
            proof.agentProfileId === request.agentProfileId &&
            proof.openMeldServiceRuntimeId.value ===
              request.openMeldServiceRuntimeId &&
            proof.agentControllerRef === request.agentControllerRef &&
            proof.agentControllerConversationId ===
              request.agentControllerConversationId &&
            proof.provider === request.provider &&
            proof.method === request.method &&
            proof.expiresAtMs > request.nowMs
        ) ?? null
      );
    },
    async resolveProfileById(request: {
      authWorker: Required<
        Pick<
          NonNullable<CoreBindings["OPENMELD_AUTH_WORKER"]>,
          "resolveProfileById"
        >
      >;
      profileId: string;
    }): Promise<AuthRpcResolveProfileByIdResult> {
      if (input?.profileFacts === null) {
        return {
          ok: false,
          code: "profile.lookup_failed",
          message: "Profile facts are temporarily unavailable.",
        };
      }
      const profile = input?.profileFacts?.get(request.profileId);
      if (profile === null) {
        return {
          ok: false,
          code: "profile.not_found",
          message: "Profile not found.",
        };
      }
      if (profile !== undefined) {
        return { ok: true, profile };
      }
      return await shareRead(
        profiles,
        request.authWorker,
        request.profileId,
        () =>
          request.authWorker.resolveProfileById({
            openMeldProfileId: request.profileId,
          })
      );
    },
    readPrimaryAgentProfileBindingRecord(
      request: Parameters<typeof readPrimaryAgentProfileBindingRecord>[0]
    ) {
      return shareRead(
        bindings,
        request.db,
        JSON.stringify([
          request.agentProfileId,
          request.owner.kind,
          request.owner.id,
        ]),
        () => readPrimaryAgentProfileBindingRecord(request)
      );
    },
    readRuntimeRegistryRecordByRuntimeId(
      input: Parameters<typeof readRuntimeRegistryRecordByRuntimeId>[0]
    ) {
      return shareRead(
        runtimeById,
        input.db,
        input.openMeldServiceRuntimeId,
        () => readRuntimeRegistryRecordByRuntimeId(input)
      );
    },
    readRuntimeRegistryRecord(
      input: Parameters<typeof readRuntimeRegistryRecord>[0]
    ) {
      const lookup = input.runtimeLookupInput;
      return shareRead(
        runtimeByLookup,
        input.db,
        JSON.stringify([
          lookup.owner.kind,
          lookup.owner.id,
          lookup.deviceId,
          lookup.lane,
        ]),
        () => readRuntimeRegistryRecord(input)
      );
    },
    readCurrentRuntimeAgentControllerReports(
      input: Parameters<typeof readCurrentRuntimeAgentControllerReports>[0]
    ) {
      return shareRead(
        controllerReports,
        input.db,
        JSON.stringify([
          input.openMeldServiceRuntimeId.value,
          input.agentControllerRefs ?? [],
        ]),
        () => readCurrentRuntimeAgentControllerReports(input)
      );
    },
  };
}
export type AgentExecutionReadinessReads = ReturnType<
  typeof createAgentExecutionReadinessReads
>;
function shareRead<Key, T>(
  reads: Map<Key, Map<string, Promise<T>>>,
  db: Key,
  key: string,
  read: () => Promise<T>
): Promise<T> {
  let databaseReads = reads.get(db);
  if (!databaseReads) {
    databaseReads = new Map();
    reads.set(db, databaseReads);
  }
  let result = databaseReads.get(key);
  if (!result) {
    result = read();
    databaseReads.set(key, result);
  }
  return result;
}
