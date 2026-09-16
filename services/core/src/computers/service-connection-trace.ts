import { daemonServiceLaneSchema } from "@openmeld/schemas";
import type {
  RuntimeCoordinatorExecutionRecord,
  SpaceDispatchTraceResponse,
} from "@openmeld/schemas/types";
import {
  type CoreBindings,
  localStateDb,
  wakeEvidenceDb,
} from "../lib/bindings";
import { readRuntimeRegistryRecordByRuntimeId } from "../runtime-registry/infrastructure/d1/runtime-registry-repo";
import { readServiceConnectionIncidents } from "./service-connection-evidence-repo";

// Time overlap is diagnostic correlation, never a cause or execution decision.
// Called only after normal Space trace authorization, and only on client opt-in.
export async function readOwnerServiceConnectionTrace(input: {
  env: CoreBindings;
  ownerUserId: string | undefined;
  execution: RuntimeCoordinatorExecutionRecord | null;
}): Promise<SpaceDispatchTraceResponse["serviceConnectionDiagnostics"]> {
  const execution = input.execution;
  const registryDb = localStateDb(input.env);
  const evidenceDb = wakeEvidenceDb(input.env);
  if (!(input.ownerUserId && execution && registryDb && evidenceDb)) {
    return undefined;
  }
  try {
    const runtime = await readRuntimeRegistryRecordByRuntimeId({
      db: registryDb,
      openMeldServiceRuntimeId: execution.openMeldServiceRuntimeId.value,
    });
    if (runtime.status !== "found") {
      return undefined;
    }
    const lookup = runtime.record.runtimeLookupInput;
    if (
      lookup.owner.kind !== "owner_account" ||
      lookup.owner.id !== input.ownerUserId
    ) {
      return undefined;
    }
    const lane = daemonServiceLaneSchema.safeParse(lookup.lane);
    if (!lane.success) {
      return undefined;
    }
    const history = await readServiceConnectionIncidents({
      db: evidenceDb,
      ownerUserId: input.ownerUserId,
      target: { deviceId: lookup.deviceId, runtimeLane: lane.data },
      nowMs: Date.now(),
      interval: {
        startedAtMs: execution.createdAtMs,
        endedAtMs: execution.terminalOutcome
          ? execution.updatedAtMs
          : Date.now(),
      },
    });
    return {
      status: "available",
      incidents: history.incidents.map(
        ({
          incidentId,
          deviceId,
          runtimeLane,
          startedAtMs,
          endedAtMs,
          outcome,
        }) => ({
          incidentId,
          deviceId,
          runtimeLane,
          startedAtMs,
          endedAtMs,
          outcome,
        })
      ),
    };
  } catch {
    console.warn("[core.connection_trace] Connection history is unavailable.");
    return { status: "unavailable", incidents: [] };
  }
}
