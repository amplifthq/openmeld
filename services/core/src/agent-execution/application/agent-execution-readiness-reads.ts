import type { PostgresDatabase } from "@openmeld/db/postgresql";
import type { AuthRpcResolveProfileByIdResult } from "@openmeld/schemas/types";
import {
  listEnabledPrimaryAgentProfileBindingRecords,
  readPrimaryAgentProfileBindingRecord,
  readPrimaryAgentProfileBindingRecordByControllerConversation,
} from "../../agent-profile-binding/infrastructure/postgresql/agent-profile-binding-repo";
import type { AuthProfileFacts } from "../../auth/application/profile-facts-reader";
import {
  readAgentProfileOrganizationContext,
  readAgentProfileOrganizationContexts,
} from "../../center-agent/center-agent-organization-scope";
import type { CoreBindings } from "../../lib/bindings";
import { readCurrentRuntimeAgentControllerReports } from "../../runtime-registry/infrastructure/postgresql/runtime-agent-controller-report-repo";
import {
  readRuntimeRegistryRecord,
  readRuntimeRegistryRecordByRuntimeId,
} from "../../runtime-registry/infrastructure/postgresql/runtime-registry-repo";
import {
  readFreshAgentExecutionReadinessImpactForBinding,
  readFreshAgentExecutionReadinessImpactsForBindings,
} from "../infrastructure/postgresql/agent-execution-readiness-impact-repo";
import {
  readFreshProviderAccessEvidenceForBinding,
  readFreshProviderAccessEvidenceForBindings,
} from "../infrastructure/postgresql/provider-access-evidence-repo";
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
  const ownerBindings = new Map<
    PostgresDatabase,
    Map<string, ReturnType<typeof listEnabledPrimaryAgentProfileBindingRecords>>
  >();
  const organizationContexts = new Map<
    PostgresDatabase,
    Map<string, ReturnType<typeof readAgentProfileOrganizationContexts>>
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
      ReturnType<typeof readFreshProviderConversationProofsForBindings>
    >
  >();
  const providerAccessByBinding = new Map<
    PostgresDatabase,
    Map<string, ReturnType<typeof readFreshProviderAccessEvidenceForBindings>>
  >();
  const impactsByBinding = new Map<
    PostgresDatabase,
    Map<
      string,
      ReturnType<typeof readFreshAgentExecutionReadinessImpactsForBindings>
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
      const recordsRead = shareRead(
        ownerBindings,
        request.db,
        JSON.stringify([request.owner.kind, request.owner.id]),
        () =>
          listEnabledPrimaryAgentProfileBindingRecords({
            ...request,
            orderBy: "controller_conversation_conflict",
          })
      );
      const contextsRead = readAgentProfileOrganizationContexts({
        db: request.db,
        agentProfileIds: request.profileIds,
      });
      storeBatchRead(
        organizationContexts,
        request.db,
        request.profileIds,
        contextsRead
      );
      // Keep successes and failures independent. A failed preload is consumed by
      // the original per-Profile error branch, without retrying once per Profile.
      const [recordsResult] = await Promise.allSettled([
        recordsRead,
        contextsRead,
      ]);
      if (recordsResult.status === "rejected") {
        throw recordsResult.reason;
      }
      const records = recordsResult.value;
      const requestedProfileIds = new Set(request.profileIds);
      const selected = records.filter((record) =>
        requestedProfileIds.has(record.agentProfileId)
      );
      const proofsRead = readFreshProviderConversationProofsForBindings({
        db: request.db,
        nowMs: request.nowMs,
        bindingIds: selected.map((record) => record.bindingId),
      });
      const accessRead = readFreshProviderAccessEvidenceForBindings({
        db: request.db,
        nowMs: request.nowMs,
        bindings: selected,
      });
      const impactsRead = readFreshAgentExecutionReadinessImpactsForBindings({
        db: request.db,
        nowMs: request.nowMs,
        bindings: selected,
      });
      const bindingIds = selected.map((record) => record.bindingId);
      storeBatchRead(proofsByBinding, request.db, bindingIds, proofsRead);
      storeBatchRead(
        providerAccessByBinding,
        request.db,
        bindingIds,
        accessRead
      );
      storeBatchRead(impactsByBinding, request.db, bindingIds, impactsRead);
      await Promise.allSettled([proofsRead, accessRead, impactsRead]);
    },
    async readAgentProfileOrganizationContext(
      request: Parameters<typeof readAgentProfileOrganizationContext>[0]
    ) {
      const contexts = organizationContexts
        .get(request.db)
        ?.get(request.agentProfileId);
      if (contexts) {
        return (await contexts).get(request.agentProfileId) ?? null;
      }
      return readAgentProfileOrganizationContext(request);
    },
    async readFreshProviderAccessEvidenceForBinding(
      request: Parameters<typeof readFreshProviderAccessEvidenceForBinding>[0]
    ) {
      const batch = providerAccessByBinding
        .get(request.db)
        ?.get(request.bindingId);
      if (!batch) {
        return readFreshProviderAccessEvidenceForBinding(request);
      }
      return (
        (await batch).find((evidence) =>
          matchesFreshBindingEvidence(evidence, request)
        ) ?? null
      );
    },
    async readFreshAgentExecutionReadinessImpactForBinding(
      request: Parameters<
        typeof readFreshAgentExecutionReadinessImpactForBinding
      >[0]
    ) {
      const batch = impactsByBinding.get(request.db)?.get(request.bindingId);
      if (!batch) {
        return readFreshAgentExecutionReadinessImpactForBinding(request);
      }
      return (
        (await batch).find((impact) =>
          matchesFreshBindingEvidence(impact, request)
        ) ?? null
      );
    },
    async readFreshProviderConversationProofForBinding(
      request: Parameters<
        typeof readFreshProviderConversationProofForBinding
      >[0]
    ) {
      const batch = proofsByBinding.get(request.db)?.get(request.bindingId);
      if (!batch) {
        return readFreshProviderConversationProofForBinding(request);
      }
      return (
        (await batch).find(
          (proof) =>
            proof.bindingId === request.bindingId &&
            proof.agentProfileId === request.agentProfileId &&
            proof.openMeldServiceRuntimeId.value ===
              request.openMeldServiceRuntimeId &&
            proof.agentControllerRef === request.agentControllerRef &&
            proof.agentControllerConversationId ===
              request.agentControllerConversationId &&
            proof.provider === request.provider &&
            request.methods.includes(proof.method) &&
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
    async readPrimaryAgentProfileBindingRecord(
      request: Parameters<typeof readPrimaryAgentProfileBindingRecord>[0]
    ) {
      const batch = ownerBindings
        .get(request.db)
        ?.get(JSON.stringify([request.owner.kind, request.owner.id]));
      if (batch) {
        return (
          (await batch).find(
            (record) => record.agentProfileId === request.agentProfileId
          ) ?? null
        );
      }
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
    async readPrimaryAgentProfileBindingRecordByControllerConversation(
      request: Parameters<
        typeof readPrimaryAgentProfileBindingRecordByControllerConversation
      >[0]
    ) {
      const batch = ownerBindings
        .get(request.db)
        ?.get(JSON.stringify([request.owner.kind, request.owner.id]));
      if (!batch) {
        return readPrimaryAgentProfileBindingRecordByControllerConversation(
          request
        );
      }
      const conversationId = request.agentControllerConversationId?.trim();
      if (!conversationId) {
        return null;
      }
      // The owner inventory is ordered by the scalar conflict query's SQL
      // ordering. Conflicting Profiles can be outside the visible batch.
      return (
        (await batch).find(
          (record) =>
            record.agentControllerRef === request.agentControllerRef &&
            record.agentControllerConversationId === conversationId &&
            record.agentProfileId !== (request.excludeAgentProfileId ?? "")
        ) ?? null
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
function storeBatchRead<T>(
  reads: Map<PostgresDatabase, Map<string, Promise<T>>>,
  db: PostgresDatabase,
  ids: readonly string[],
  result: Promise<T>
): void {
  let databaseReads = reads.get(db);
  if (!databaseReads) {
    databaseReads = new Map();
    reads.set(db, databaseReads);
  }
  for (const id of ids) {
    databaseReads.set(id, result);
  }
}
function matchesFreshBindingEvidence(
  evidence: {
    agentProfileId: string;
    bindingId: string;
    agentControllerRef: string;
    openMeldServiceRuntimeId: string;
    expiresAtMs: number;
  },
  request: {
    agentProfileId: string;
    bindingId: string;
    agentControllerRef: string;
    openMeldServiceRuntimeId: string;
    nowMs: number;
  }
): boolean {
  return (
    evidence.agentProfileId === request.agentProfileId &&
    evidence.bindingId === request.bindingId &&
    evidence.agentControllerRef === request.agentControllerRef &&
    evidence.openMeldServiceRuntimeId === request.openMeldServiceRuntimeId &&
    evidence.expiresAtMs > request.nowMs
  );
}
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
