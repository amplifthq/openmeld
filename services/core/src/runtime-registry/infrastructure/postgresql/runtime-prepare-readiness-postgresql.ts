import type {
  AuthorityOpenMeldServiceRuntimeId,
  RuntimeLookupInput,
} from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  type RuntimePrepareReadinessResult,
  resolveRuntimePrepareReadiness,
} from "../../application/runtime-prepare-readiness-service";
import { readCurrentRuntimeAgentControllerReports } from "./runtime-agent-controller-report-repo";
import { readRuntimeRegistryRecord } from "./runtime-registry-repo";
export function resolveRuntimePrepareReadinessFromPostgres(input: {
  agentControllerRefsToEvaluate?: readonly string[];
  db: PostgresDatabase;
  nowMs: number;
  openMeldServiceRuntimeId?: AuthorityOpenMeldServiceRuntimeId;
  runtimeLookupInput: RuntimeLookupInput;
}): Promise<RuntimePrepareReadinessResult> {
  return resolveRuntimePrepareReadiness({
    agentControllerRefsToEvaluate: input.agentControllerRefsToEvaluate,
    nowMs: input.nowMs,
    reportReadStore: {
      readCurrentRuntimeAgentControllerReports: async (readInput) =>
        await readCurrentRuntimeAgentControllerReports({
          agentControllerRefs: readInput.agentControllerRefs,
          db: input.db,
          openMeldServiceRuntimeId: readInput.openMeldServiceRuntimeId,
        }),
    },
    openMeldServiceRuntimeId: input.openMeldServiceRuntimeId,
    runtimeLookupInput: input.runtimeLookupInput,
    runtimeLookupStore: {
      readRuntimeRecord: async (readInput) =>
        await readRuntimeRegistryRecord({
          db: input.db,
          runtimeLookupInput: readInput.runtimeLookupInput,
        }),
    },
  });
}
