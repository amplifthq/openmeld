import { getPostgresDatabase } from "@openmeld/db/postgresql";
import {
  centerAgentListRoutineRunsToolResponseSchema,
  centerAgentListRoutineRunsToolRpcInputSchema,
  centerAgentReadRoutineRunDiagnosticsResponseSchema,
  centerAgentReadRoutineRunDiagnosticsRpcInputSchema,
  centerAgentRoutineRuntimeEvidenceSchema,
  resolveMappedPublicAgentFailureReason,
} from "@openmeld/schemas";
import type {
  CenterAgentListRoutineRunsToolRpcInput,
  CenterAgentReadRoutineRunDiagnosticsResponse,
  CenterAgentReadRoutineRunDiagnosticsRpcInput,
  CenterAgentRoutineRun,
  CenterAgentRoutineRunEvidence,
} from "@openmeld/schemas/types";
import { createCenterAgentEvidenceSourceAccess } from "../center-agent/application/evidence-source-access";
import type { CoreBindings } from "../lib/bindings";
import { attachCenterAgentTurnRuntimeEvidence } from "../remote-agent/application/center-agent-turn-diagnostics";
import { listRemoteAgentRoutineDeliveryDiagnosticRecords } from "../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import { createCoreRpcHttpError } from "../rpc/errors";
import {
  listAccessibleRoutineRuns,
  requireRoutineHistoryAccess,
} from "./routine-access";
import { readRoutineRunExecutionRecord } from "./routine-repository";
import { prepareRoutineEvidenceRequest } from "./routine-request-preparation";
import { parseRoutinePayload } from "./routine-rpc-contract";

type SourceAccess = Awaited<
  ReturnType<typeof createCenterAgentEvidenceSourceAccess>
>;

export async function rpcCenterAgentListRoutineRuns(
  env: CoreBindings,
  input: CenterAgentListRoutineRunsToolRpcInput
) {
  const request = parseRoutinePayload(
    centerAgentListRoutineRunsToolRpcInputSchema,
    input
  );
  const { prepared, db, organizationId } = await prepareRead(env, request);
  const access = await createCenterAgentEvidenceSourceAccess({ env, prepared });
  const limit = request.limit ?? 20;
  const records = await listAccessibleRoutineRuns({
    allowPersonal: access.audience === "requester_private",
    db,
    organizationId,
    routineId: request.routineId,
    userId: prepared.representedHuman.userId,
    humanProfileId: prepared.representedHuman.profileId,
    beforeScheduledFor: request.beforeScheduledFor,
    limit: limit + 1,
  });

  const runs = await Promise.all(
    records.slice(0, limit).map((run) => projectRun(run, access))
  );
  return centerAgentListRoutineRunsToolResponseSchema.parse({
    organizationId,
    routineId: request.routineId,
    observedAtMs: Date.now(),
    runs,
    nextBeforeScheduledFor:
      records.length > limit ? (runs.at(-1)?.scheduledFor ?? null) : null,
    coverage: "retained_run_history_page",
  });
}

export async function rpcCenterAgentReadRoutineRunDiagnostics(
  env: CoreBindings,
  input: CenterAgentReadRoutineRunDiagnosticsRpcInput
) {
  const request = parseRoutinePayload(
    centerAgentReadRoutineRunDiagnosticsRpcInputSchema,
    input
  );
  const {
    db,
    organizationId,
    prepared: initialAuthority,
  } = await prepareRead(env, request);
  const record = await readRoutineRunExecutionRecord({
    db,
    runId: request.runId,
  });
  if (!record || record.organizationId !== organizationId) {
    throw createCoreRpcHttpError({
      code: "routine.not_found",
      reason: "Routine Run was not found.",
      status: 404,
    });
  }
  const initialAccess = await createCenterAgentEvidenceSourceAccess({
    env,
    prepared: initialAuthority,
  });
  await requireRoutineHistoryAccess({
    allowPersonal: initialAccess.audience === "requester_private",
    db,
    organizationId,
    routineId: record.routineId,
    runId: record.id,
    userId: initialAuthority.representedHuman.userId,
    humanProfileId: initialAuthority.representedHuman.profileId,
  });
  const nativeDelivery = await readNativeEvidence(env, organizationId, record);
  // Runtime reads cross a service boundary. Recheck both the represented
  // member and current reply audience before exposing destination references.
  const { prepared } = await prepareRead(env, request);
  const access = await createCenterAgentEvidenceSourceAccess({ env, prepared });
  await requireRoutineHistoryAccess({
    allowPersonal: access.audience === "requester_private",
    db,
    organizationId,
    routineId: record.routineId,
    runId: record.id,
    userId: prepared.representedHuman.userId,
    humanProfileId: prepared.representedHuman.profileId,
  });
  return centerAgentReadRoutineRunDiagnosticsResponseSchema.parse({
    organizationId,
    observedAtMs: Date.now(),
    run: await projectRun(record, access),
    executionEngine: record.executionEngine,
    continuationRecorded: record.continuationDelegationId !== null,
    nativeDelivery,
    coverage: "independent_owner_observations_not_atomic_history",
  });
}

async function prepareRead(
  env: CoreBindings,
  request:
    | CenterAgentReadRoutineRunDiagnosticsRpcInput
    | CenterAgentListRoutineRunsToolRpcInput
) {
  const prepared = await prepareRoutineEvidenceRequest(
    env,
    request.context,
    request.speakerMember
  );
  const db = getPostgresDatabase(env);
  if (!db) {
    throw createCoreRpcHttpError({
      code: "routine.store_unavailable",
      reason: "Routine storage is unavailable.",
      status: 503,
    });
  }
  return {
    prepared,
    db,
    organizationId: prepared.authorization.activeOrganization.organizationId,
  };
}

async function projectRun(
  run: CenterAgentRoutineRun,
  access: SourceAccess
): Promise<CenterAgentRoutineRunEvidence> {
  const space =
    run.destinationKind === "space" && run.targetSpaceId
      ? await access.readPermittedSpace(run.targetSpaceId)
      : null;
  let coverage: CenterAgentRoutineRunEvidence["destination"]["coverage"] =
    "unsupported_source";
  if (run.destinationKind === "space") {
    coverage = "not_recorded";
    if (run.targetSpaceId) {
      coverage = space ? "available" : "redacted";
    }
  }
  const publishedSignalReadable = Boolean(
    space &&
      run.publishedSignalId &&
      (await access.canReadSignal(space.spaceId, run.publishedSignalId))
  );
  return {
    id: run.id,
    routineId: run.routineId,
    scheduledFor: run.scheduledFor,
    status: run.status,
    startedAtMs: run.startedAtMs,
    finishedAtMs: run.finishedAtMs,
    failure: projectFailure(run.failureCode),
    destination: {
      kind: coverage === "not_recorded" ? null : run.destinationKind,
      coverage,
      spaceId: space?.spaceId ?? null,
    },
    publication: {
      status: run.publishedSignalId ? "recorded" : "not_recorded",
      signalId: publishedSignalReadable ? run.publishedSignalId : null,
    },
  };
}

function projectFailure(
  code: string | null
): CenterAgentRoutineRunEvidence["failure"] {
  return {
    status: code ? "recorded" : "not_recorded",
    publicReason: code
      ? (resolveMappedPublicAgentFailureReason(code, "This Routine") ??
        "A failure was recorded. Raw failure details are not included in this read.")
      : null,
    rawDetails: "not_included",
  };
}

async function readNativeEvidence(
  env: CoreBindings,
  organizationId: string,
  run: CenterAgentRoutineRun
): Promise<CenterAgentReadRoutineRunDiagnosticsResponse["nativeDelivery"]> {
  const empty = {
    currentResultOwnerId: run.nativeDeliveryId,
    currentResultOwnerRecorded: false,
    historyTruncated: false,
    deliveries: [],
  };
  const db = getPostgresDatabase(env);
  if (!db) {
    return { ...empty, coverage: "unavailable" };
  }
  try {
    const history = await listRemoteAgentRoutineDeliveryDiagnosticRecords({
      db,
      organizationId,
      routineRunId: run.id,
      currentDeliveryId: run.nativeDeliveryId,
    });
    const turns = await attachCenterAgentTurnRuntimeEvidence({
      deliveries: history.deliveries,
      remoteAgentWorker: env.OPENMELD_REMOTE_AGENT_WORKER,
    });
    return {
      coverage: history.deliveries.length ? "available" : "not_recorded",
      currentResultOwnerId: run.nativeDeliveryId,
      currentResultOwnerRecorded: history.deliveries.some(
        (row) => row.deliveryId === run.nativeDeliveryId
      ),
      historyTruncated: history.truncated,
      deliveries: turns.map((turn) => ({
        deliveryId: turn.deliveryId,
        isCurrentResultOwner: turn.deliveryId === run.nativeDeliveryId,
        status: turn.status,
        createdAtMs: turn.createdAtMs,
        updatedAtMs: turn.updatedAtMs,
        submittedAtMs: turn.submittedAtMs,
        acceptedAtMs: turn.acceptedAtMs,
        callbackReceivedAtMs: turn.callbackReceivedAtMs,
        completedAtMs: turn.completedAtMs,
        failure: projectFailure(turn.failureCode),
        publicationState: turn.publicationState,
        runtimeEvidenceStatus: turn.submissionId
          ? turn.runtimeEvidenceStatus
          : "not_recorded",
        runtimeEvidence: turn.runtimeEvidence
          ? centerAgentRoutineRuntimeEvidenceSchema.parse(
              Object.fromEntries(
                Object.keys(centerAgentRoutineRuntimeEvidenceSchema.shape).map(
                  (key) => [
                    key,
                    turn.runtimeEvidence?.[
                      key as keyof typeof turn.runtimeEvidence
                    ],
                  ]
                )
              )
            )
          : null,
      })),
    };
  } catch (error) {
    console.warn("[core.routine.evidence.native_unavailable]", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return { ...empty, coverage: "unavailable" };
  }
}
