import type { AuthRpcResolveProfileByIdResult } from "@openmeld/schemas/types";
import type { AuthProfileFacts } from "../../auth/application/profile-facts-reader";
import type { CoreBindings } from "../../lib/bindings";
import { readCurrentRuntimeAgentControllerReports } from "../../runtime-registry/infrastructure/d1/runtime-agent-controller-report-repo";
import {
  readRuntimeRegistryRecord,
  readRuntimeRegistryRecordByRuntimeId,
} from "../../runtime-registry/infrastructure/d1/runtime-registry-repo";

// One read set belongs to one readiness request. Profiles sharing a Runtime or
// Controller share in-flight reads, including failures, but no result survives
// into another request. The repositories still validate every stored fact.
export function createAgentExecutionReadinessReads(input?: {
  // Validated Auth facts from this request, never client state. Undefined means
  // not read; null means the batch failed and must not fan out into scalar reads.
  profileFacts?: AuthProfileFacts | null;
}) {
  const runtimeById = new Map<
    D1Database,
    Map<string, ReturnType<typeof readRuntimeRegistryRecordByRuntimeId>>
  >();
  const runtimeByLookup = new Map<
    D1Database,
    Map<string, ReturnType<typeof readRuntimeRegistryRecord>>
  >();
  const controllerReports = new Map<
    D1Database,
    Map<string, ReturnType<typeof readCurrentRuntimeAgentControllerReports>>
  >();
  return {
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
      return await request.authWorker.resolveProfileById({
        openMeldProfileId: request.profileId,
      });
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

function shareRead<T>(
  reads: Map<D1Database, Map<string, Promise<T>>>,
  db: D1Database,
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
