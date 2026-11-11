import { HOSTED_CENTER_AGENT_CONTROLLER_REF } from "@openmeld/agent-runtime";
import type { PostgresDatabase } from "@openmeld/db/postgresql";
import {
  agentControllerConversationKindSchema,
  dispatchExecutionSchema,
  listSpaceDispatchTraceFinalVisibleSignalCandidates,
  openMeldDaemonTaskResultEnvelopeSchema,
  projectObservabilityWakeCorrelation,
  projectSpaceDispatchTraceFinalVisibleOutcome,
  projectSpaceNativeDeliveryTraceFinalVisibleOutcome,
  projectTargetWakeLifecycleIdentity,
  RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
  RUNTIME_TRANSPORT_SCHEMA_VERSION,
  SPACE_DISPATCH_TRACE_EXECUTION_CONTEXT_CONTRACT_VERSION,
  SPACE_DISPATCH_TRACE_NATIVE_DELIVERY_CONTRACT_VERSION,
  SPACE_DISPATCH_TRACE_WAITING_EVIDENCE_CONTRACT_VERSION,
  spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV1Schema,
  spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV2Schema,
  spaceDispatchTraceRuntimeCoordinatorHeadNoExecutionDecisionV2Schema,
  spaceDispatchTraceRuntimeCoordinatorHeadPublicationIntentV2Schema,
} from "@openmeld/schemas";
import type {
  CenterAgentTurnDiagnostic,
  DispatchResult,
  GetSpaceDispatchLookupResponse,
  RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceRequest,
  RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse,
  SpaceDispatchTraceResponse,
  SpaceDispatchTraceResponseContractVersion,
  SpaceDispatchTraceSnapshot,
} from "@openmeld/schemas/types";
import {
  DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE,
  DISPATCH_EXECUTION_LIFECYCLE_DECISION_CODE,
  DISPATCH_OPENCLAW_BINDING_DECISION_CODE,
  DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE,
  DISPATCH_STREAMING_TELEMETRY_DECISION_CODE,
  DISPATCH_STRUCTURED_ACTION_FAILURE_DECISION_CODE,
} from "../../../dispatch/application/dispatch-trace-decision-codes";
import {
  listRecentOpenMeldDaemonOpsDecisions,
  type OpenMeldDaemonOpsDecisionRecord,
} from "../../../dispatch/infrastructure/postgresql/dispatch-ledger-postgresql";
import {
  projectRemoteAgentNativeDeliveryTurnDiagnostic,
  type RemoteAgentNativeDeliveryRecord,
  readRemoteAgentNativeDeliveryByDispatchAndConversation,
} from "../../../remote-agent/infrastructure/postgresql/native-delivery-ledger-repo";
import {
  listRuntimeCoordinatorCreationDiagnosticsByDispatch,
  listRuntimeCoordinatorExecutionEventsByExecutionId,
  readRuntimeCoordinatorExecutionProjectionByDispatch,
} from "../../../runtime-transport/infrastructure/postgresql/runtime-coordinator-execution-repo";
import {
  type DispatchRuntimeTelemetryDecisionPayload,
  normalizeDispatchOpenClawGatewayVisibilityTraceRecord,
  normalizeDispatchOriginTraceRecord,
  normalizeDispatchPromptTraceRecord,
  normalizeDispatchRuntimeTraceRecord,
  normalizeOptionalText,
  toDispatchTraceAttemptStatus,
  toDispatchTraceDispatchStatus,
  toIsoDateTime,
  toNullableInteger,
  toNullableIsoDateTime,
  toSafeInteger,
} from "./space-dispatch-trace-normalization";

type DispatchTraceDispatchRecord = SpaceDispatchTraceSnapshot["dispatch"];
type DispatchTraceLatestAttemptRecord = NonNullable<
  SpaceDispatchTraceSnapshot["latestAttempt"]
>;
type DispatchTraceNativeDeliveryRecord = NonNullable<
  SpaceDispatchTraceSnapshot["nativeDelivery"]
>;
type HostedNativeDeliveryTraceRead = {
  publishedSignalId: string | null;
  record: DispatchTraceNativeDeliveryRecord;
};
type DispatchTraceExecutionIdentityRecord = NonNullable<
  SpaceDispatchTraceSnapshot["executionIdentity"]
>;
type DispatchTraceRuntimeCoordinatorCreationDiagnosticRecord =
  SpaceDispatchTraceSnapshot["runtimeCoordinatorCreationDiagnostics"][number];
type DispatchTraceRuntimeCoordinatorExecutionRecord = NonNullable<
  SpaceDispatchTraceSnapshot["runtimeCoordinatorExecution"]
>;
type DispatchTraceRuntimeCoordinatorEventRecord =
  SpaceDispatchTraceSnapshot["runtimeCoordinatorEvents"][number];
type DispatchTraceRuntimeCoordinatorHeadLifecycleRecord = NonNullable<
  SpaceDispatchTraceSnapshot["runtimeCoordinatorHeadLifecycle"]
>;
type DispatchTraceResultRecord = NonNullable<
  SpaceDispatchTraceSnapshot["result"]
>;
type DispatchTraceResultInboxRecord = NonNullable<
  SpaceDispatchTraceSnapshot["resultInbox"]
>;
type DispatchTraceOpsDecisionRecord =
  SpaceDispatchTraceSnapshot["recentOpsDecisions"][number];
type DispatchTraceStreamingRecord = NonNullable<
  SpaceDispatchTraceSnapshot["streaming"]
>;
type DispatchTraceExecutionRecord = NonNullable<
  SpaceDispatchTraceSnapshot["execution"]
>;
type DispatchTraceDispatchExecutionRecord = NonNullable<
  SpaceDispatchTraceSnapshot["dispatchExecution"]
>;
type DispatchTraceStructuredActionFailureRecord = NonNullable<
  SpaceDispatchTraceSnapshot["structuredActionFailure"]
>;
type DispatchStreamingTelemetryDecisionPayload = {
  firstOutputAtMs?: unknown;
  firstStdoutAtMs?: unknown;
  previewEmitted?: unknown;
  streamingMode?: unknown;
};
type DispatchExecutionLifecycleDecisionPayload = {
  finalizationTimeoutMs?: unknown;
  lastLifecycleAtMs?: unknown;
  phase?: unknown;
  phaseEnteredAtMs?: unknown;
  progressEvidenceState?: unknown;
  startTimeoutMs?: unknown;
  taskProgressEvidenceStaleAfterMs?: unknown;
  waitWindowMs?: unknown;
};
type DispatchDispatchExecutionDecisionPayload =
  DispatchTraceDispatchExecutionRecord;
type DispatchStructuredActionFailureDecisionPayload =
  DispatchTraceStructuredActionFailureRecord;
type DispatchOpenClawBindingDecisionPayload = {
  bindingSource?: unknown;
  classification?: unknown;
  upgradeApplied?: unknown;
};
export type SpaceDispatchLedgerStatus = {
  status: string;
  lastAttemptAtMs: number;
  latestAttemptStatus: string | null;
  latestAttemptErrorCode: string | null;
  daemonSessionId: string | null;
  connectionGeneration: number | null;
  leaseEpoch: number | null;
};
type ReplySignalTraceReader = (input: {
  dispatchId: string;
  publishedSignalId: string | null;
}) =>
  | SpaceDispatchTraceSnapshot["replySignal"]
  | Promise<SpaceDispatchTraceSnapshot["replySignal"]>;
type FinalVisibleMessageTraceResult = {
  finalVisibleMessage: SpaceDispatchTraceSnapshot["finalVisibleMessage"];
  finalVisibleMessageLinkage: SpaceDispatchTraceSnapshot["finalVisibleMessageLinkage"];
};
type FinalVisibleMessageTraceReader = (input: {
  dispatchId: string;
  publishedSignalIdCandidates: readonly string[];
  targetProfileId: string;
}) => FinalVisibleMessageTraceResult | Promise<FinalVisibleMessageTraceResult>;
type RuntimeCoordinatorHeadLifecycleTraceReader = (input: {
  dispatch: DispatchTraceDispatchRecord;
  ownerUserId: string;
  request: RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceRequest;
}) =>
  | RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse
  | Promise<RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse>;
type DispatchOpsDecisionProjection = {
  latestByDecisionCode: ReadonlyMap<string, OpenMeldDaemonOpsDecisionRecord>;
  records: readonly OpenMeldDaemonOpsDecisionRecord[];
};
const EMPTY_DISPATCH_OPS_DECISION_PROJECTION: DispatchOpsDecisionProjection = {
  latestByDecisionCode: new Map(),
  records: [],
};
export const readDispatchLedgerStatus = async (input: {
  db?: PostgresDatabase | null;
  idempotencyKey: string;
  onReadError?: (error: unknown) => void;
}): Promise<SpaceDispatchLedgerStatus | null> => {
  if (!(input.db && typeof input.db.query === "function")) {
    return null;
  }
  try {
    const row = await input.db
      .query<{
        status?: unknown;
        lastAttemptAtMs?: unknown;
        latestAttemptStatus?: unknown;
        latestAttemptErrorCode?: unknown;
        daemonSessionId?: unknown;
        connectionGeneration?: unknown;
        leaseEpoch?: unknown;
      }>({
        text: `
          SELECT
            ledger.status,
            ledger.last_attempt_at_ms AS "lastAttemptAtMs",
            attempts.status AS "latestAttemptStatus",
            attempts.error_code AS "latestAttemptErrorCode",
            attempts.daemon_session_id AS "daemonSessionId",
            attempts.connection_generation AS "connectionGeneration",
            attempts.lease_epoch AS "leaseEpoch"
          FROM "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
          LEFT JOIN "openmeld"."openMeldDaemon_dispatch_attempts" AS attempts
            ON attempts.attempt_id = ledger.latest_attempt_id
          WHERE ledger.idempotency_key = $1
          LIMIT 1
        `,
        values: [input.idempotencyKey],
      })
      .then((result) => result.rows[0] ?? null);
    const status = String(row?.status ?? "").trim();
    if (status.length === 0) {
      return null;
    }
    const lastAttemptAtMs = Number(row?.lastAttemptAtMs ?? 0);
    return {
      status,
      lastAttemptAtMs: Number.isFinite(lastAttemptAtMs)
        ? Math.max(0, Math.trunc(lastAttemptAtMs))
        : 0,
      latestAttemptStatus:
        typeof row?.latestAttemptStatus === "string" &&
        row.latestAttemptStatus.trim().length > 0
          ? row.latestAttemptStatus
          : null,
      latestAttemptErrorCode:
        typeof row?.latestAttemptErrorCode === "string" &&
        row.latestAttemptErrorCode.trim().length > 0
          ? row.latestAttemptErrorCode
          : null,
      daemonSessionId:
        typeof row?.daemonSessionId === "string" &&
        row.daemonSessionId.trim().length > 0
          ? row.daemonSessionId
          : null,
      connectionGeneration:
        typeof row?.connectionGeneration === "number" &&
        Number.isInteger(row.connectionGeneration)
          ? row.connectionGeneration
          : null,
      leaseEpoch:
        typeof row?.leaseEpoch === "number" && Number.isInteger(row.leaseEpoch)
          ? row.leaseEpoch
          : null,
    };
  } catch (error) {
    input.onReadError?.(error);
    return null;
  }
};
export const readSpaceDispatchTrace = async (input: {
  db?: PostgresDatabase | null;
  dispatchId: string;
  readFinalVisibleMessageTrace?: FinalVisibleMessageTraceReader;
  readNativeDeliveryTurnDiagnostic?: (
    delivery: RemoteAgentNativeDeliveryRecord
  ) => Promise<CenterAgentTurnDiagnostic>;
  readRuntimeCoordinatorHeadLifecycleTrace?: RuntimeCoordinatorHeadLifecycleTraceReader;
  readReplySignalTrace: ReplySignalTraceReader;
  responseContractVersion?: SpaceDispatchTraceResponseContractVersion;
  spaceId: string;
}): Promise<SpaceDispatchTraceResponse> => {
  const normalizedDispatchId = normalizeOptionalText(input.dispatchId);
  if (!normalizedDispatchId) {
    throw new Error("dispatchId is required");
  }
  const dispatch = await readDispatchLedgerTrace({
    db: input.db,
    dispatchId: normalizedDispatchId,
    spaceId: input.spaceId,
  });
  if (!dispatch) {
    return (
      (await readSpaceNativeDeliveryTrace({
        ...input,
        dispatchId: normalizedDispatchId,
      })) ?? {
        correlation: projectObservabilityWakeCorrelation({
          selector: {
            kind: "dispatch",
            spaceId: input.spaceId,
            dispatchId: normalizedDispatchId,
          },
        }),
        query: {
          spaceId: input.spaceId,
          dispatchId: normalizedDispatchId,
        },
        trace: null,
      }
    );
  }
  const latestAttempt = await readDispatchAttemptTrace({
    attemptId: dispatch.latestAttemptId,
    db: input.db,
  });
  const nativeDeliveryRead = await readHostedNativeDeliveryTrace({
    db: input.db,
    dispatch,
    spaceId: input.spaceId,
  });
  const nativeDelivery = nativeDeliveryRead?.record ?? null;
  const runtimeCoordinatorExecution = nativeDelivery
    ? null
    : await readRuntimeCoordinatorExecutionTrace({
        db: input.db,
        dispatch,
        spaceId: input.spaceId,
      });
  const runtimeCoordinatorCreationDiagnostics = nativeDelivery
    ? []
    : await readRuntimeCoordinatorCreationDiagnosticTrace({
        db: input.db,
        dispatch,
        spaceId: input.spaceId,
      });
  const runtimeCoordinatorEvents = nativeDelivery
    ? []
    : await readRuntimeCoordinatorEventTrace({
        db: input.db,
        runtimeCoordinatorExecution,
      });
  const runtimeCoordinatorHeadLifecycle = nativeDelivery
    ? null
    : await readRuntimeCoordinatorHeadLifecycleTrace({
        dispatch,
        readRuntimeCoordinatorHeadLifecycleTrace:
          input.readRuntimeCoordinatorHeadLifecycleTrace,
        spaceId: input.spaceId,
      });
  let executionIdentity: SpaceDispatchTraceSnapshot["executionIdentity"] = null;
  if (!nativeDelivery) {
    executionIdentity = runtimeCoordinatorExecution
      ? toRuntimeCoordinatorExecutionIdentityTrace(runtimeCoordinatorExecution)
      : await readDispatchAttemptExecutionIdentityTrace({
          attemptId: latestAttempt?.attemptId ?? null,
          db: input.db,
          dispatch,
          spaceId: input.spaceId,
        });
  }
  const result = await readDispatchResultTrace({
    db: input.db,
    dispatch,
    spaceId: input.spaceId,
  });
  const resultInbox = await readDispatchResultInboxTrace({
    db: input.db,
    dispatch,
    latestAttempt,
  });
  const opsDecisionProjection = await readDispatchOpsDecisionProjection({
    db: input.db,
    dispatchId: normalizedDispatchId,
  });
  const recentOpsDecisions = projectRecentDispatchOpsDecisions({
    opsDecisionProjection,
  });
  const streaming = readDispatchStreamingTrace({ opsDecisionProjection });
  const runtimeTelemetryPayload = readDispatchRuntimeTelemetryDecisionPayload({
    opsDecisionProjection,
  });
  const runtime = normalizeDispatchRuntimeTraceRecord(runtimeTelemetryPayload);
  const execution = readDispatchExecutionTrace({ opsDecisionProjection });
  const origin = normalizeDispatchOriginTraceRecord(runtimeTelemetryPayload);
  const prompt = normalizeDispatchPromptTraceRecord(runtimeTelemetryPayload);
  const dispatchExecution = readDispatchExecutionProjectionTrace({
    opsDecisionProjection,
  });
  const openClawGatewayVisibility =
    normalizeDispatchOpenClawGatewayVisibilityTraceRecord(
      runtimeTelemetryPayload
    );
  const openClawBinding = readDispatchOpenClawBindingTrace({
    opsDecisionProjection,
  });
  const structuredActionFailure = readDispatchStructuredActionFailureTrace({
    opsDecisionProjection,
  });
  const replySignal = await input.readReplySignalTrace({
    dispatchId: normalizedDispatchId,
    publishedSignalId: result?.publishedSignalId ?? null,
  });
  const finalVisibleMessageTrace =
    (await input.readFinalVisibleMessageTrace?.({
      dispatchId: normalizedDispatchId,
      publishedSignalIdCandidates: prependFinalVisibleSignalCandidate(
        nativeDeliveryRead,
        listSpaceDispatchTraceFinalVisibleSignalCandidates({
          result,
          resultInbox,
          runtimeCoordinatorEvents,
          runtimeCoordinatorHeadLifecycle,
        })
      ),
      targetProfileId: dispatch.targetProfileId,
    })) ?? null;
  const finalVisibleMessage =
    finalVisibleMessageTrace?.finalVisibleMessage ?? null;
  const finalVisibleMessageLinkage =
    finalVisibleMessageTrace?.finalVisibleMessageLinkage ?? null;
  const trace: SpaceDispatchTraceSnapshot = {
    dispatch,
    nativeDelivery,
    runtimeCoordinatorExecution,
    runtimeCoordinatorCreationDiagnostics,
    runtimeCoordinatorEvents,
    runtimeCoordinatorHeadLifecycle,
    latestAttempt,
    executionIdentity,
    claimLease: null,
    result,
    resultInbox,
    recentOpsDecisions,
    replySignal,
    finalVisibleMessage,
    finalVisibleMessageLinkage,
    streaming,
    runtime,
    execution,
    origin,
    prompt,
    dispatchExecution,
    openClawGatewayVisibility,
    openClawBinding,
    structuredActionFailure,
  };
  const response: SpaceDispatchTraceResponse = {
    correlation: projectObservabilityWakeCorrelation({
      selector: {
        kind: "dispatch",
        spaceId: input.spaceId,
        dispatchId: normalizedDispatchId,
      },
      facts: {
        coordinatorExecution: runtimeCoordinatorExecution
          ? {
              bindingId: runtimeCoordinatorExecution.bindingId,
              agentControllerRef:
                runtimeCoordinatorExecution.agentControllerRef,
              dispatchId: runtimeCoordinatorExecution.dispatchId,
              runtimeCoordinatorExecutionId:
                runtimeCoordinatorExecution.runtimeCoordinatorExecutionId,
              openMeldServiceRuntimeId:
                runtimeCoordinatorExecution.openMeldServiceRuntimeId.value,
              sourceClientMessageId:
                runtimeCoordinatorExecution.sourceClientMessageId,
              targetProfileId: runtimeCoordinatorExecution.targetProfileId,
            }
          : null,
        dispatch,
        latestAttempt,
        replySignal,
        result,
      },
      claimLeaseId: null,
      bindingId:
        runtimeCoordinatorExecution?.bindingId ??
        executionIdentity?.core.bindingId ??
        nativeDelivery?.bindingId ??
        null,
      openMeldServiceRuntimeId:
        runtimeCoordinatorExecution?.openMeldServiceRuntimeId.value ??
        executionIdentity?.core.openMeldServiceRuntimeId.value ??
        null,
      agentControllerRef:
        runtimeCoordinatorExecution?.agentControllerRef ??
        executionIdentity?.core.agentControllerRef ??
        nativeDelivery?.controllerNormalization.canonicalAgentControllerRef ??
        null,
    }),
    query: {
      spaceId: input.spaceId,
      dispatchId: normalizedDispatchId,
    },
    trace: {
      ...trace,
      finalVisibleOutcome: projectSpaceDispatchTraceFinalVisibleOutcome(trace),
    },
  };
  return projectSpaceDispatchTraceResponseForContractVersion({
    response,
    responseContractVersion: input.responseContractVersion,
  });
};
export const readDispatchResultConversationFacts = async (input: {
  db?: PostgresDatabase | null;
  dispatchId: string;
}): Promise<
  Pick<
    DispatchResult,
    "dispatchExecution" | "runtimeWorkspace" | "agentControllerConversation"
  >
> => {
  const opsDecisionProjection = await readDispatchOpsDecisionProjection({
    db: input.db,
    dispatchId: input.dispatchId,
  });
  const runtimeTelemetryPayload = readDispatchRuntimeTelemetryDecisionPayload({
    opsDecisionProjection,
  });
  const dispatchExecution = readDispatchExecutionProjectionTrace({
    opsDecisionProjection,
  });
  const origin = normalizeDispatchOriginTraceRecord(runtimeTelemetryPayload);
  const agentControllerConversation =
    toObservedAgentControllerConversation(origin);
  return {
    ...(dispatchExecution ? { dispatchExecution } : {}),
    ...(origin?.effectiveRuntimeWorkingDirectory
      ? {
          runtimeWorkspace: {
            path: origin.effectiveRuntimeWorkingDirectory,
            fingerprint: origin.runtimeWorkspaceFingerprint ?? null,
          },
        }
      : {}),
    ...(agentControllerConversation ? { agentControllerConversation } : {}),
  };
};
export const readSpaceDispatchLookup = async (input: {
  clientMessageId?: string | null;
  db?: PostgresDatabase | null;
  sourceSignalId: string;
  spaceId: string;
  targetProfileId?: string;
}): Promise<GetSpaceDispatchLookupResponse> => {
  const sourceSignalId = normalizeOptionalText(input.sourceSignalId);
  if (!sourceSignalId) {
    throw new Error("sourceSignalId is required");
  }
  if (!(input.db && typeof input.db.query === "function")) {
    return {
      query: {
        spaceId: input.spaceId,
        sourceSignalId,
        clientMessageId: normalizeOptionalText(input.clientMessageId),
        targetProfileId: normalizeOptionalText(input.targetProfileId),
      },
      matches: [],
    };
  }
  const targetProfileId = normalizeOptionalText(input.targetProfileId);
  const whereTargetSql = targetProfileId
    ? "AND ledger.target_profile_id = $3"
    : "";
  const statement = {
    text: `
      SELECT
        ledger.dispatch_id AS "dispatchId",
        ledger.source_event_id AS "sourceSignalId",
        ledger.target_profile_id AS "targetProfileId",
        ledger.status AS "dispatchStatus",
        ledger.attempt_count AS "attemptCount",
        ledger.latest_attempt_id AS "latestAttemptId",
        attempt.status AS "latestAttemptStatus",
        attempt.error_code AS "latestAttemptErrorCode",
        attempt.error_message AS "latestAttemptErrorMessage"
      FROM "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
      LEFT JOIN "openmeld"."openMeldDaemon_dispatch_attempts" AS attempt
        ON attempt.attempt_id = ledger.latest_attempt_id
      WHERE ledger.space_id = $1
        AND ledger.source_event_id = $2
        ${whereTargetSql}
      ORDER BY ledger.first_seen_at_ms DESC NULLS LAST, ledger.dispatch_id DESC NULLS LAST
    `,
    values: [],
  };
  const query = targetProfileId
    ? {
        ...statement,
        values: [input.spaceId, sourceSignalId, targetProfileId],
      }
    : {
        ...statement,
        values: [input.spaceId, sourceSignalId],
      };
  const rows = await input.db.query<{
    attemptCount?: unknown;
    dispatchId?: unknown;
    dispatchStatus?: unknown;
    latestAttemptErrorCode?: unknown;
    latestAttemptErrorMessage?: unknown;
    latestAttemptId?: unknown;
    latestAttemptStatus?: unknown;
    sourceSignalId?: unknown;
    targetProfileId?: unknown;
  }>(query);
  const matches = normalizeDispatchLookupRows(rows.rows);
  return {
    query: {
      spaceId: input.spaceId,
      sourceSignalId,
      clientMessageId: normalizeOptionalText(input.clientMessageId),
      targetProfileId,
    },
    matches,
  };
};
export const readSpaceDispatchLookupByClientMessageId = async (input: {
  clientMessageId: string;
  db?: PostgresDatabase | null;
  spaceId: string;
  targetProfileId?: string;
}): Promise<GetSpaceDispatchLookupResponse> => {
  const clientMessageId = normalizeOptionalText(input.clientMessageId);
  if (!clientMessageId) {
    throw new Error("clientMessageId is required");
  }
  const targetProfileId = normalizeOptionalText(input.targetProfileId);
  if (!(input.db && typeof input.db.query === "function")) {
    return {
      query: {
        spaceId: input.spaceId,
        sourceSignalId: null,
        clientMessageId,
        targetProfileId,
      },
      matches: [],
    };
  }
  const whereTargetSql = targetProfileId
    ? "AND ledger.target_profile_id = $3"
    : "";
  const statement = {
    text: `
      SELECT
        ledger.dispatch_id AS "dispatchId",
        ledger.source_event_id AS "sourceSignalId",
        ledger.target_profile_id AS "targetProfileId",
        ledger.status AS "dispatchStatus",
        ledger.attempt_count AS "attemptCount",
        ledger.latest_attempt_id AS "latestAttemptId",
        attempt.status AS "latestAttemptStatus",
        attempt.error_code AS "latestAttemptErrorCode",
        attempt.error_message AS "latestAttemptErrorMessage"
      FROM "openmeld"."openMeldDaemon_dispatch_ledger" AS ledger
      LEFT JOIN "openmeld"."openMeldDaemon_dispatch_attempts" AS attempt
        ON attempt.attempt_id = ledger.latest_attempt_id
      WHERE ledger.space_id = $1
        AND ledger.source_client_message_id = $2
        ${whereTargetSql}
      ORDER BY ledger.first_seen_at_ms DESC NULLS LAST, ledger.dispatch_id DESC NULLS LAST
    `,
    values: [],
  };
  const query = targetProfileId
    ? {
        ...statement,
        values: [input.spaceId, clientMessageId, targetProfileId],
      }
    : {
        ...statement,
        values: [input.spaceId, clientMessageId],
      };
  const rows = await input.db.query<DispatchLookupRow>(query);
  const matches = normalizeDispatchLookupRows(rows.rows);
  return {
    query: {
      spaceId: input.spaceId,
      sourceSignalId: resolveSingleLookupSourceSignalId(matches),
      clientMessageId,
      targetProfileId,
    },
    matches,
  };
};
type DispatchLookupRow = {
  attemptCount?: unknown;
  dispatchId?: unknown;
  dispatchStatus?: unknown;
  latestAttemptErrorCode?: unknown;
  latestAttemptErrorMessage?: unknown;
  latestAttemptId?: unknown;
  latestAttemptStatus?: unknown;
  sourceSignalId?: unknown;
  targetProfileId?: unknown;
};
const normalizeDispatchLookupRows = (
  rows: DispatchLookupRow[] | undefined
): GetSpaceDispatchLookupResponse["matches"] => {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => {
      const dispatchId = normalizeOptionalText(row.dispatchId);
      const rowSourceSignalId = normalizeOptionalText(row.sourceSignalId);
      const rowTargetProfileId = normalizeOptionalText(row.targetProfileId);
      const status = toDispatchTraceDispatchStatus(row.dispatchStatus);
      if (!(dispatchId && rowSourceSignalId && rowTargetProfileId && status)) {
        return null;
      }
      return {
        dispatchId,
        sourceSignalId: rowSourceSignalId,
        targetProfileId: rowTargetProfileId,
        status,
        attemptCount: Math.max(0, toSafeInteger(row.attemptCount)),
        latestAttemptId: normalizeOptionalText(row.latestAttemptId),
        latestAttemptStatus: toDispatchTraceAttemptStatus(
          row.latestAttemptStatus
        ),
        latestAttemptErrorCode: normalizeOptionalText(
          row.latestAttemptErrorCode
        ),
        latestAttemptErrorMessage: normalizeOptionalText(
          row.latestAttemptErrorMessage
        ),
      };
    })
    .filter(
      (row): row is GetSpaceDispatchLookupResponse["matches"][number] =>
        row !== null
    );
};
const resolveSingleLookupSourceSignalId = (
  matches: GetSpaceDispatchLookupResponse["matches"]
): string | null => {
  const sourceSignalIds = new Set(matches.map((match) => match.sourceSignalId));
  if (sourceSignalIds.size !== 1) {
    return null;
  }
  return sourceSignalIds.values().next().value ?? null;
};
const readDispatchLedgerTrace = async (input: {
  db?: PostgresDatabase | null;
  dispatchId: string;
  spaceId: string;
}): Promise<DispatchTraceDispatchRecord | null> => {
  if (!(input.db && typeof input.db.query === "function")) {
    return null;
  }
  const row = await input.db
    .query<{
      attemptCount?: unknown;
      dispatchOwnerId?: unknown;
      dispatchOwnerKind?: unknown;
      dispatchId?: unknown;
      firstSeenAtMs?: unknown;
      idempotencyKey?: unknown;
      lastAttemptAtMs?: unknown;
      latestAttemptId?: unknown;
      sourceClientMessageId?: unknown;
      sourceEventId?: unknown;
      spaceId?: unknown;
      status?: unknown;
      targetProfileId?: unknown;
    }>({
      text: `
        SELECT
          dispatch_id AS "dispatchId",
          idempotency_key AS "idempotencyKey",
          source_event_id AS "sourceEventId",
          source_client_message_id AS "sourceClientMessageId",
          dispatch_owner_kind AS "dispatchOwnerKind",
          dispatch_owner_id AS "dispatchOwnerId",
          target_profile_id AS "targetProfileId",
          status,
          space_id AS "spaceId",
          first_seen_at_ms AS "firstSeenAtMs",
          last_attempt_at_ms AS "lastAttemptAtMs",
          attempt_count AS "attemptCount",
          latest_attempt_id AS "latestAttemptId"
        FROM "openmeld"."openMeldDaemon_dispatch_ledger"
        WHERE dispatch_id = $1
          AND space_id = $2
        LIMIT 1
      `,
      values: [input.dispatchId, input.spaceId],
    })
    .then((result) => result.rows[0] ?? null)
    .catch(() => null);
  const normalizedDispatchId = normalizeOptionalText(row?.dispatchId);
  const idempotencyKey = normalizeOptionalText(row?.idempotencyKey);
  const sourceEventId = normalizeOptionalText(row?.sourceEventId);
  const targetProfileId = normalizeOptionalText(row?.targetProfileId);
  const spaceId = normalizeOptionalText(row?.spaceId);
  const status = toDispatchTraceDispatchStatus(row?.status);
  if (
    !(
      normalizedDispatchId &&
      idempotencyKey &&
      sourceEventId &&
      targetProfileId &&
      spaceId === input.spaceId &&
      status
    )
  ) {
    return null;
  }
  return {
    factSource: "dispatch_ledger",
    dispatchId: normalizedDispatchId,
    idempotencyKey,
    sourceEventId,
    sourceClientMessageId: normalizeOptionalText(row?.sourceClientMessageId),
    owner: toDispatchTraceOwner({
      id: row?.dispatchOwnerId,
      kind: row?.dispatchOwnerKind,
    }),
    targetProfileId,
    status,
    firstSeenAt: toIsoDateTime(row?.firstSeenAtMs),
    lastAttemptAt: toIsoDateTime(row?.lastAttemptAtMs),
    attemptCount: toSafeInteger(row?.attemptCount),
    latestAttemptId: normalizeOptionalText(row?.latestAttemptId),
  };
};
function toDispatchTraceOwner(input: {
  id: unknown;
  kind: unknown;
}): DispatchTraceDispatchRecord["owner"] {
  const id = normalizeOptionalText(input.id);
  const kind = normalizeOptionalText(input.kind);
  if (!(id && kind)) {
    return null;
  }
  return { id, kind };
}
function toObservedAgentControllerConversation(
  origin: SpaceDispatchTraceSnapshot["origin"]
): NonNullable<DispatchResult["agentControllerConversation"]> | null {
  if (
    !(
      origin?.agentControllerRef &&
      origin.agentControllerConversationKind &&
      origin.resolvedAgentControllerConversationId
    )
  ) {
    return null;
  }
  const conversationKind = agentControllerConversationKindSchema.safeParse(
    origin.agentControllerConversationKind
  );
  if (!conversationKind.success) {
    return null;
  }
  return {
    agentControllerRef: origin.agentControllerRef,
    agentControllerConversationId: origin.resolvedAgentControllerConversationId,
    agentControllerConversationKind: conversationKind.data,
  };
}
const readRuntimeCoordinatorExecutionTrace = async (input: {
  db?: PostgresDatabase | null;
  dispatch: DispatchTraceDispatchRecord;
  spaceId: string;
}): Promise<DispatchTraceRuntimeCoordinatorExecutionRecord | null> => {
  if (!(input.db && typeof input.db.query === "function")) {
    return null;
  }
  const record = await readRuntimeCoordinatorExecutionProjectionByDispatch({
    db: input.db,
    dispatchId: input.dispatch.dispatchId,
    spaceId: input.spaceId,
    targetProfileId: input.dispatch.targetProfileId,
  }).catch(() => null);
  return record
    ? {
        ...record,
        factSource: "runtime_coordinator_projection",
      }
    : null;
};
const readRuntimeCoordinatorCreationDiagnosticTrace = async (input: {
  db?: PostgresDatabase | null;
  dispatch: DispatchTraceDispatchRecord;
  spaceId: string;
}): Promise<DispatchTraceRuntimeCoordinatorCreationDiagnosticRecord[]> => {
  if (!(input.db && typeof input.db.query === "function")) {
    return [];
  }
  const diagnostics = await listRuntimeCoordinatorCreationDiagnosticsByDispatch(
    {
      db: input.db,
      dispatchId: input.dispatch.dispatchId,
      spaceId: input.spaceId,
      targetProfileId: input.dispatch.targetProfileId,
    }
  ).catch(() => []);
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    factSource: "runtime_coordinator_projection",
  }));
};
const readRuntimeCoordinatorEventTrace = async (input: {
  db?: PostgresDatabase | null;
  runtimeCoordinatorExecution: DispatchTraceRuntimeCoordinatorExecutionRecord | null;
}): Promise<DispatchTraceRuntimeCoordinatorEventRecord[]> => {
  if (
    !(
      input.db &&
      typeof input.db.query === "function" &&
      input.runtimeCoordinatorExecution
    )
  ) {
    return [];
  }
  const events = await listRuntimeCoordinatorExecutionEventsByExecutionId({
    db: input.db,
    runtimeCoordinatorExecutionId:
      input.runtimeCoordinatorExecution.runtimeCoordinatorExecutionId,
  }).catch(() => []);
  return events.map((event) => ({
    ...event,
    factSource: "runtime_coordinator_projection",
  }));
};
const readRuntimeCoordinatorHeadLifecycleTrace = async (input: {
  dispatch: DispatchTraceDispatchRecord;
  readRuntimeCoordinatorHeadLifecycleTrace?: RuntimeCoordinatorHeadLifecycleTraceReader;
  spaceId: string;
}): Promise<DispatchTraceRuntimeCoordinatorHeadLifecycleRecord | null> => {
  const targetWakeLifecycleIdentity = projectTargetWakeLifecycleIdentity({
    clientMessageId: input.dispatch.sourceClientMessageId,
    dispatchId: input.dispatch.dispatchId,
    sourceSignalId: input.dispatch.sourceEventId,
    spaceId: input.spaceId,
    targetProfileId: input.dispatch.targetProfileId,
  });
  const ownerUserId =
    input.dispatch.owner?.kind === "owner_account"
      ? normalizeOptionalText(input.dispatch.owner.id)
      : null;
  if (!(ownerUserId && input.readRuntimeCoordinatorHeadLifecycleTrace)) {
    return {
      factSource: "runtime_coordinator_head_lifecycle",
      readStatus: "authority_unavailable",
      reasonCode: "runtime_coordinator.head_owner_evidence_unavailable",
      targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
    };
  }
  const reader = input.readRuntimeCoordinatorHeadLifecycleTrace;
  const response = await Promise.resolve()
    .then(() =>
      reader({
        dispatch: input.dispatch,
        ownerUserId,
        request: {
          v: RUNTIME_TRANSPORT_SCHEMA_VERSION,
          targetWakeLifecycleIdentity,
        },
      })
    )
    .catch(() => ({
      ok: false as const,
      readStatus: "authority_unavailable" as const,
      reasonCode: "runtime_coordinator.head_lifecycle_trace_unavailable",
      targetWakeLifecycleId: targetWakeLifecycleIdentity.targetWakeLifecycleId,
    }));
  return toRuntimeCoordinatorHeadLifecycleTraceRecord(response);
};
function toRuntimeCoordinatorHeadLifecycleTraceRecord(
  response: RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse
): DispatchTraceRuntimeCoordinatorHeadLifecycleRecord {
  if (response.readStatus === "missing") {
    return {
      ...(response.executionContext
        ? { executionContext: response.executionContext }
        : {}),
      factSource: "runtime_coordinator_head_lifecycle",
      readStatus: "missing",
      reasonCode: response.reasonCode,
      targetWakeLifecycleId: response.targetWakeLifecycleId,
    };
  }
  if (response.readStatus === "authority_unavailable") {
    return {
      ...(response.executionContext
        ? { executionContext: response.executionContext }
        : {}),
      factSource: "runtime_coordinator_head_lifecycle",
      readStatus: "authority_unavailable",
      reasonCode: response.reasonCode,
      targetWakeLifecycleId: response.targetWakeLifecycleId,
    };
  }
  const sourcePublicationIntent = response.lifecycle.publicationIntent;
  const sourceWaitingBoundary = response.lifecycle.waitingBoundary;
  let publicationIntent: Extract<
    DispatchTraceRuntimeCoordinatorHeadLifecycleRecord,
    {
      readStatus: "found";
    }
  >["publicationIntent"] = null;
  if (sourcePublicationIntent?.kind === "no_execution_failure") {
    publicationIntent = {
      intentId: sourcePublicationIntent.intentId,
      kind: sourcePublicationIntent.kind,
      publicationCategory: sourcePublicationIntent.publicationCategory,
      readyAt: toIsoDateTime(sourcePublicationIntent.readyAtMs),
      reasonCode: sourcePublicationIntent.reasonCode,
      status: sourcePublicationIntent.status,
      userRecoveryAction: sourcePublicationIntent.userRecoveryAction,
    };
  } else if (sourcePublicationIntent?.kind === "stopped_notice") {
    publicationIntent = {
      intentId: sourcePublicationIntent.intentId,
      kind: sourcePublicationIntent.kind,
      readyAt: toIsoDateTime(sourcePublicationIntent.readyAtMs),
      reasonCode: sourcePublicationIntent.reasonCode,
      status: sourcePublicationIntent.status,
    };
  }
  return {
    ...(response.executionContext
      ? { executionContext: response.executionContext }
      : {}),
    createdAt: toIsoDateTime(response.lifecycle.createdAtMs),
    duplicateDispatchCount: response.lifecycle.duplicateDispatchCount,
    executionLinkedAt: toNullableIsoDateTime(
      response.lifecycle.executionLinkedAtMs
    ),
    factSource: "runtime_coordinator_head_lifecycle",
    modelVersion: response.lifecycle.modelVersion,
    noExecutionDecision: response.lifecycle.noExecutionDecision
      ? {
          decidedAt: toIsoDateTime(
            response.lifecycle.noExecutionDecision.decidedAtMs
          ),
          publicationCategory:
            response.lifecycle.noExecutionDecision.publicationCategory,
          reasonCode: response.lifecycle.noExecutionDecision.reasonCode,
          source: response.lifecycle.noExecutionDecision.source,
          userRecoveryAction:
            response.lifecycle.noExecutionDecision.userRecoveryAction,
        }
      : null,
    ownerUserId: response.lifecycle.ownerUserId,
    primaryDispatchId: response.lifecycle.primaryDispatchId,
    publicationIntent,
    ...(response.lifecycle.publicationExhaustion
      ? {
          publicationExhaustion: {
            attemptCount: response.lifecycle.publicationExhaustion.attemptCount,
            exhaustedAt: toIsoDateTime(
              response.lifecycle.publicationExhaustion.exhaustedAtMs
            ),
            lastFailureAt: toIsoDateTime(
              response.lifecycle.publicationExhaustion.lastFailureAtMs
            ),
            lastReasonCode:
              response.lifecycle.publicationExhaustion.lastReasonCode,
            reasonCode: response.lifecycle.publicationExhaustion.reasonCode,
            status: response.lifecycle.publicationExhaustion.status,
          },
        }
      : {}),
    ...(response.lifecycle.publicationOutcome
      ? {
          publicationOutcome: {
            failurePublicationCommandId:
              response.lifecycle.publicationOutcome.failurePublicationCommandId,
            finalMessageKind:
              response.lifecycle.publicationOutcome.finalMessageKind,
            observedAt: toIsoDateTime(
              response.lifecycle.publicationOutcome.observedAtMs
            ),
            publicationErrorCode:
              response.lifecycle.publicationOutcome.publicationErrorCode,
            publishedSignalId:
              response.lifecycle.publicationOutcome.publishedSignalId,
            status: response.lifecycle.publicationOutcome.status,
          },
        }
      : {}),
    readStatus: "found",
    runtimeCoordinatorExecutionId:
      response.lifecycle.runtimeCoordinatorExecutionId ?? null,
    status: response.lifecycle.status,
    targetWakeLifecycleIdentity: response.lifecycle.targetWakeLifecycleIdentity,
    targetWakeLifecycleId: response.lifecycle.targetWakeLifecycleId,
    ...(response.lifecycle.targetDisplay
      ? { targetDisplay: response.lifecycle.targetDisplay }
      : {}),
    updatedAt: toIsoDateTime(response.lifecycle.updatedAtMs),
    waitingBoundary: projectRuntimeCoordinatorHeadWaitingBoundary(
      sourceWaitingBoundary
    ),
  };
}
function projectRuntimeCoordinatorHeadWaitingBoundary(
  source: Extract<
    RuntimeTransportRuntimeCoordinatorHeadLifecycleTraceResponse,
    {
      readStatus: "found";
    }
  >["lifecycle"]["waitingBoundary"]
): Extract<
  DispatchTraceRuntimeCoordinatorHeadLifecycleRecord,
  {
    readStatus: "found";
  }
>["waitingBoundary"] {
  if (!source) {
    return null;
  }
  const {
    deadlineAtMs,
    observedAtMs,
    softDeadlineAtMs,
    waitingSinceMs,
    ...policy
  } = source;
  return {
    ...policy,
    deadlineAt: toIsoDateTime(deadlineAtMs),
    observedAt: toIsoDateTime(observedAtMs),
    softDeadlineAt: toIsoDateTime(softDeadlineAtMs),
    waitingSince: toIsoDateTime(waitingSinceMs),
  };
}
function projectSpaceDispatchTraceResponseV1(
  response: SpaceDispatchTraceResponse
): SpaceDispatchTraceResponse {
  const v2Response = projectSpaceDispatchTraceResponseV2(response);
  const headLifecycle = v2Response.trace?.runtimeCoordinatorHeadLifecycle;
  if (headLifecycle?.readStatus !== "found") {
    return v2Response;
  }
  const noExecutionDecision = headLifecycle.noExecutionDecision;
  const publicationIntent = headLifecycle.publicationIntent;
  const legacyHeadLifecycle =
    spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV1Schema.parse({
      ...headLifecycle,
      noExecutionDecision:
        noExecutionDecision?.reasonCode ===
          "daemon.profile.pending_first_report" ||
        noExecutionDecision?.publicationCategory ===
          "wake_route_registration_pending" ||
        noExecutionDecision?.userRecoveryAction === "wait_for_wake_route_report"
          ? null
          : noExecutionDecision,
      publicationIntent:
        publicationIntent?.kind === "no_execution_failure" &&
        (publicationIntent.reasonCode ===
          "daemon.profile.pending_first_report" ||
          publicationIntent.publicationCategory ===
            "wake_route_registration_pending" ||
          publicationIntent.userRecoveryAction === "wait_for_wake_route_report")
          ? null
          : publicationIntent,
      waitingBoundary:
        headLifecycle.waitingBoundary?.reasonCode === "daemon.profile.offline"
          ? headLifecycle.waitingBoundary
          : null,
    });
  return {
    ...v2Response,
    trace: v2Response.trace
      ? {
          ...v2Response.trace,
          runtimeCoordinatorHeadLifecycle: legacyHeadLifecycle,
        }
      : null,
  };
}

async function readSpaceNativeDeliveryTrace(
  input: Parameters<typeof readSpaceDispatchTrace>[0]
): Promise<SpaceDispatchTraceResponse | null> {
  if (
    input.db &&
    (input.responseContractVersion ?? 1) >=
      SPACE_DISPATCH_TRACE_NATIVE_DELIVERY_CONTRACT_VERSION
  ) {
    const delivery =
      await readRemoteAgentNativeDeliveryByDispatchAndConversation({
        db: input.db,
        dispatchId: input.dispatchId,
        conversationId: input.spaceId,
      });
    if (delivery?.conversationKind === "space") {
      const projectedTurn =
        projectRemoteAgentNativeDeliveryTurnDiagnostic(delivery);
      const {
        runtimeEvidence: _runtimeEvidence,
        runtimeEvidenceStatus: _runtimeEvidenceStatus,
        ...compactTurn
      } = projectedTurn;
      const turn = input.readNativeDeliveryTurnDiagnostic
        ? await input.readNativeDeliveryTurnDiagnostic(delivery)
        : compactTurn;
      const visible = await input.readFinalVisibleMessageTrace?.({
        dispatchId: delivery.dispatchId,
        publishedSignalIdCandidates: delivery.publishedSignalId
          ? [delivery.publishedSignalId]
          : [],
        targetProfileId: delivery.profileId,
      });
      const nativeDeliveryTrace = {
        factSource: "remote_agent_native_delivery_ledger" as const,
        bindingId: delivery.bindingId,
        destination: {
          conversationKind: "space" as const,
          organizationId: delivery.organizationId,
          spaceId: delivery.spaceId,
          targetProfileId: delivery.profileId,
        },
        turn,
        finalVisibleMessage: visible?.finalVisibleMessage ?? null,
        finalVisibleMessageLinkage: visible?.finalVisibleMessageLinkage ?? null,
        finalVisibleOutcome: projectSpaceNativeDeliveryTraceFinalVisibleOutcome(
          {
            finalVisibleMessage: visible?.finalVisibleMessage ?? null,
          }
        ),
      };
      return {
        correlation: projectObservabilityWakeCorrelation({
          selector: {
            kind: "dispatch",
            spaceId: input.spaceId,
            dispatchId: input.dispatchId,
          },
          targetProfileId: delivery.profileId,
          bindingId: delivery.bindingId,
          agentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
          publishedSignalId: delivery.publishedSignalId,
          replySignalId:
            nativeDeliveryTrace.finalVisibleMessage?.signalId ?? null,
        }),
        query: { spaceId: input.spaceId, dispatchId: input.dispatchId },
        nativeDeliveryTrace,
        trace: null,
      };
    }
  }
  return null;
}

function projectSpaceDispatchTraceExecutionContext(
  response: SpaceDispatchTraceResponse
): SpaceDispatchTraceResponse {
  const head = response.trace?.runtimeCoordinatorHeadLifecycle;
  if (!(response.trace && head) || head.executionContext) {
    return response;
  }
  return {
    ...response,
    trace: {
      ...response.trace,
      runtimeCoordinatorHeadLifecycle: {
        ...head,
        executionContext: {
          readStatus: "authority_unavailable",
          reasonCode:
            head.readStatus === "authority_unavailable"
              ? head.reasonCode
              : "execution_context.diagnostics_not_reported",
        },
      },
    },
  };
}

function projectSpaceDispatchTraceResponseForContractVersion(input: {
  response: SpaceDispatchTraceResponse;
  responseContractVersion?: SpaceDispatchTraceResponseContractVersion;
}): SpaceDispatchTraceResponse {
  const currentHead = input.response.trace?.runtimeCoordinatorHeadLifecycle;
  if (
    (input.responseContractVersion ?? 1) >=
    SPACE_DISPATCH_TRACE_EXECUTION_CONTEXT_CONTRACT_VERSION
  ) {
    return projectSpaceDispatchTraceExecutionContext(input.response);
  }
  let response = input.response;
  if (response.trace && currentHead?.executionContext) {
    const { executionContext: _executionContext, ...legacyHead } = currentHead;
    response = {
      ...response,
      trace: { ...response.trace, runtimeCoordinatorHeadLifecycle: legacyHead },
    };
  }
  if (
    (input.responseContractVersion ?? 1) >=
    SPACE_DISPATCH_TRACE_WAITING_EVIDENCE_CONTRACT_VERSION
  ) {
    return response;
  }
  const head = response.trace?.runtimeCoordinatorHeadLifecycle;
  if (
    response.trace &&
    head?.readStatus === "found" &&
    (head.waitingBoundary || head.noExecutionDecision || head.publicationIntent)
  ) {
    response = {
      ...response,
      trace: {
        ...response.trace,
        runtimeCoordinatorHeadLifecycle: {
          ...head,
          waitingBoundary:
            head.waitingBoundary &&
            head.waitingBoundary.reasonCode !== "daemon.profile.offline" &&
            head.waitingBoundary.reasonCode !==
              "daemon.profile.pending_first_report"
              ? null
              : head.waitingBoundary,
          noExecutionDecision: head.noExecutionDecision
            ? {
                ...head.noExecutionDecision,
                ...projectPreV5HeadDecision(head.noExecutionDecision),
              }
            : head.noExecutionDecision,
          publicationIntent:
            head.publicationIntent?.kind === "no_execution_failure"
              ? {
                  ...head.publicationIntent,
                  ...projectPreV5HeadDecision(head.publicationIntent),
                }
              : head.publicationIntent,
        },
      },
    };
  }
  if (
    input.responseContractVersion === 4 ||
    input.responseContractVersion === 3
  ) {
    return response;
  }
  if (input.responseContractVersion === 2) {
    return projectSpaceDispatchTraceResponseV2(response);
  }
  return projectSpaceDispatchTraceResponseV1(response);
}
type PublishedHeadDecision = Pick<
  NonNullable<
    Extract<
      DispatchTraceRuntimeCoordinatorHeadLifecycleRecord,
      {
        readStatus: "found";
      }
    >["noExecutionDecision"]
  >,
  "publicationCategory" | "userRecoveryAction"
>;
function projectPreV5HeadDecision(
  decision: PublishedHeadDecision
): PublishedHeadDecision {
  return {
    publicationCategory:
      decision.publicationCategory === "space_access_unavailable"
        ? "local_agent_unavailable"
        : decision.publicationCategory,
    userRecoveryAction:
      decision.userRecoveryAction === "send_new_wake"
        ? "check_status"
        : decision.userRecoveryAction,
  };
}
function projectSpaceDispatchTraceResponseV2(
  response: SpaceDispatchTraceResponse
): SpaceDispatchTraceResponse {
  const headLifecycle = response.trace?.runtimeCoordinatorHeadLifecycle;
  if (headLifecycle?.readStatus !== "found") {
    return response;
  }
  const noExecutionDecision = headLifecycle.noExecutionDecision;
  const publicationIntent = headLifecycle.publicationIntent;
  const v2HeadLifecycle =
    spaceDispatchTraceRuntimeCoordinatorHeadLifecycleV2Schema.parse({
      ...headLifecycle,
      noExecutionDecision:
        noExecutionDecision &&
        spaceDispatchTraceRuntimeCoordinatorHeadNoExecutionDecisionV2Schema.safeParse(
          noExecutionDecision
        ).success
          ? noExecutionDecision
          : null,
      publicationIntent:
        publicationIntent?.kind === "no_execution_failure" &&
        !spaceDispatchTraceRuntimeCoordinatorHeadPublicationIntentV2Schema.safeParse(
          publicationIntent
        ).success
          ? null
          : publicationIntent,
    });
  return {
    ...response,
    trace: response.trace
      ? {
          ...response.trace,
          runtimeCoordinatorHeadLifecycle: v2HeadLifecycle,
        }
      : null,
  };
}
const toRuntimeCoordinatorExecutionIdentityTrace = (
  execution: DispatchTraceRuntimeCoordinatorExecutionRecord
): DispatchTraceExecutionIdentityRecord => {
  return {
    authority: "authoritative",
    core: {
      bindingId: execution.bindingId,
      agentControllerRef: execution.agentControllerRef,
      dispatchId: execution.dispatchId,
      modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
      openMeldServiceRuntimeId: execution.openMeldServiceRuntimeId,
      spaceId: execution.spaceId,
      targetProfileId: execution.targetProfileId,
    },
    factSource: "runtime_coordinator_projection",
  };
};
const readHostedNativeDeliveryTrace = async (input: {
  db?: PostgresDatabase | null;
  dispatch: DispatchTraceDispatchRecord;
  spaceId: string;
}): Promise<HostedNativeDeliveryTraceRead | null> => {
  if (!(input.db && typeof input.db.query === "function")) {
    return null;
  }
  const row = await input.db
    .query<{
      bindingId?: unknown;
      bindingUpdatedAtMs?: unknown;
      conversationKind?: unknown;
      createdAtMs?: unknown;
      deliveryId?: unknown;
      dispatchId?: unknown;
      idempotencyKey?: unknown;
      organizationId?: unknown;
      profileId?: unknown;
      publishedSignalId?: unknown;
      spaceId?: unknown;
      status?: unknown;
      storedAgentControllerRef?: unknown;
      storedAgentControllerRefStatus?: unknown;
      submissionId?: unknown;
      updatedAtMs?: unknown;
    }>({
      text: `
        SELECT
          deliveries.delivery_id AS "deliveryId",
          deliveries.dispatch_id AS "dispatchId",
          deliveries.idempotency_key AS "idempotencyKey",
          deliveries.binding_id AS "bindingId",
          deliveries.controller_stored_agent_controller_ref AS "storedAgentControllerRef",
          deliveries.controller_stored_agent_controller_ref_status AS "storedAgentControllerRefStatus",
          deliveries.controller_binding_updated_at_ms AS "bindingUpdatedAtMs",
          deliveries.status,
          deliveries.submission_id AS "submissionId",
          deliveries.published_signal_id AS "publishedSignalId",
          deliveries.conversation_kind AS "conversationKind",
          deliveries.organization_id AS "organizationId",
          deliveries.space_id AS "spaceId",
          deliveries.profile_id AS "profileId",
          deliveries.created_at_ms AS "createdAtMs",
          deliveries.updated_at_ms AS "updatedAtMs"
        FROM "openmeld"."openMeldRemoteAgent_native_delivery_ledger" AS deliveries
        WHERE deliveries.dispatch_id = $1
          AND deliveries.space_id = $2
          AND deliveries.profile_id = $3
        ORDER BY deliveries.updated_at_ms DESC NULLS LAST, deliveries.delivery_id DESC NULLS LAST
        LIMIT 1
      `,
      values: [
        input.dispatch.dispatchId,
        input.spaceId,
        input.dispatch.targetProfileId,
      ],
    })
    .then((result) => result.rows[0] ?? null);
  if (!row) {
    return null;
  }
  const deliveryId = normalizeOptionalText(row.deliveryId);
  const dispatchId = normalizeOptionalText(row.dispatchId);
  const idempotencyKey = normalizeOptionalText(row.idempotencyKey);
  const bindingId = normalizeOptionalText(row.bindingId);
  const organizationId = normalizeOptionalText(row.organizationId);
  const spaceId = normalizeOptionalText(row.spaceId);
  const profileId = normalizeOptionalText(row.profileId);
  const conversationKind = toNativeDeliveryConversationKind(
    row.conversationKind
  );
  const status = toNativeDeliveryStatus(row.status);
  if (
    !(
      deliveryId &&
      dispatchId === input.dispatch.dispatchId &&
      idempotencyKey &&
      bindingId &&
      organizationId &&
      spaceId === input.spaceId &&
      profileId === input.dispatch.targetProfileId &&
      conversationKind &&
      status
    )
  ) {
    throw new Error(
      "Remote Agent native delivery trace has mismatched or invalid durable identity"
    );
  }
  const storedAgentControllerRef = normalizeOptionalText(
    row.storedAgentControllerRef
  );
  const storedAgentControllerRefStatus =
    row.storedAgentControllerRefStatus === "canonical" ||
    row.storedAgentControllerRefStatus === "malformed" ||
    row.storedAgentControllerRefStatus === "stale"
      ? row.storedAgentControllerRefStatus
      : "missing";
  return {
    publishedSignalId: normalizeOptionalText(row.publishedSignalId),
    record: {
      bindingId,
      controllerNormalization: {
        bindingUpdatedAt: toNullableIsoDateTime(row.bindingUpdatedAtMs),
        canonicalAgentControllerRef: HOSTED_CENTER_AGENT_CONTROLLER_REF,
        factSource: "remote_agent_native_delivery_ledger",
        reasonCode: "hosted_runtime_family_controller_canonicalized",
        storedAgentControllerRef,
        storedAgentControllerRefStatus,
      },
      createdAt: toIsoDateTime(row.createdAtMs),
      deliveryId,
      destination: {
        conversationKind,
        organizationId,
        spaceId,
        targetProfileId: profileId,
      },
      dispatchId,
      factSource: "remote_agent_native_delivery_ledger",
      idempotencyKey,
      runtimeFamily: "hosted_center_agent",
      status,
      submissionId: normalizeOptionalText(row.submissionId),
      updatedAt: toIsoDateTime(row.updatedAtMs),
    },
  };
};
function prependFinalVisibleSignalCandidate(
  nativeDeliveryRead: HostedNativeDeliveryTraceRead | null,
  rest: readonly string[]
): string[] {
  const first = nativeDeliveryRead?.publishedSignalId;
  return first
    ? [first, ...rest.filter((candidate) => candidate !== first)]
    : [...rest];
}
function toNativeDeliveryConversationKind(
  value: unknown
): DispatchTraceNativeDeliveryRecord["destination"]["conversationKind"] | null {
  return value === "message_channel" || value === "slack" || value === "space"
    ? value
    : null;
}
function toNativeDeliveryStatus(
  value: unknown
): DispatchTraceNativeDeliveryRecord["status"] | null {
  switch (value) {
    case "guardrail_rejected":
    case "flag_rejected":
    case "worker_unavailable":
    case "submitted":
    case "accepted":
    case "retry_observed":
    case "completed":
    case "callback_rejected":
    case "failed":
      return value;
    default:
      return null;
  }
}
const readDispatchAttemptTrace = async (input: {
  attemptId: string | null;
  db?: PostgresDatabase | null;
}): Promise<DispatchTraceLatestAttemptRecord | null> => {
  const normalizedAttemptId = normalizeOptionalText(input.attemptId);
  if (
    !(normalizedAttemptId && input.db && typeof input.db.query === "function")
  ) {
    return null;
  }
  const row = await input.db
    .query<{
      attemptId?: unknown;
      attemptNo?: unknown;
      connectionGeneration?: unknown;
      createdAtMs?: unknown;
      daemonSessionId?: unknown;
      dispatchId?: unknown;
      errorCode?: unknown;
      errorMessage?: unknown;
      finishedAtMs?: unknown;
      idempotencyKey?: unknown;
      leaseEpoch?: unknown;
      startedAtMs?: unknown;
      status?: unknown;
    }>({
      text: `
        SELECT
          attempt_id AS "attemptId",
          dispatch_id AS "dispatchId",
          idempotency_key AS "idempotencyKey",
          attempt_no AS "attemptNo",
          status,
          daemon_session_id AS "daemonSessionId",
          connection_generation AS "connectionGeneration",
          lease_epoch AS "leaseEpoch",
          created_at_ms AS "createdAtMs",
          started_at_ms AS "startedAtMs",
          finished_at_ms AS "finishedAtMs",
          error_code AS "errorCode",
          error_message AS "errorMessage"
        FROM "openmeld"."openMeldDaemon_dispatch_attempts"
        WHERE attempt_id = $1
        LIMIT 1
      `,
      values: [normalizedAttemptId],
    })
    .then((result) => result.rows[0] ?? null)
    .catch(() => null);
  const resolvedAttemptId = normalizeOptionalText(row?.attemptId);
  const dispatchIdValue = normalizeOptionalText(row?.dispatchId);
  const idempotencyKey = normalizeOptionalText(row?.idempotencyKey);
  const status = toDispatchTraceAttemptStatus(row?.status);
  if (!(resolvedAttemptId && dispatchIdValue && idempotencyKey && status)) {
    return null;
  }
  return {
    factSource: "dispatch_attempt",
    attemptId: resolvedAttemptId,
    dispatchId: dispatchIdValue,
    idempotencyKey,
    attemptNo: Math.max(1, toSafeInteger(row?.attemptNo)),
    status,
    daemonSessionId: normalizeOptionalText(row?.daemonSessionId),
    connectionGeneration: toNullableInteger(row?.connectionGeneration),
    leaseEpoch: toNullableInteger(row?.leaseEpoch),
    createdAt: toIsoDateTime(row?.createdAtMs),
    startedAt: toNullableIsoDateTime(row?.startedAtMs),
    finishedAt: toNullableIsoDateTime(row?.finishedAtMs),
    errorCode: normalizeOptionalText(row?.errorCode),
    errorMessage: normalizeOptionalText(row?.errorMessage),
  };
};
const readDispatchAttemptExecutionIdentityTrace = async (input: {
  attemptId: string | null;
  db?: PostgresDatabase | null;
  dispatch: DispatchTraceDispatchRecord;
  spaceId: string;
}): Promise<DispatchTraceExecutionIdentityRecord | null> => {
  const normalizedAttemptId = normalizeOptionalText(input.attemptId);
  if (normalizedAttemptId && input.db && typeof input.db.query === "function") {
    const row = await input.db
      .query<{
        bindingId?: unknown;
        agentControllerRef?: unknown;
        modelVersion?: unknown;
        openMeldServiceRuntimeId?: unknown;
      }>({
        text: `
          SELECT
            execution_identity_model_version AS "modelVersion",
            execution_binding_id AS "bindingId",
            execution_openmeld_service_runtime_id AS "openMeldServiceRuntimeId",
            execution_agent_controller_ref AS "agentControllerRef"
          FROM "openmeld"."openMeldDaemon_dispatch_attempts"
          WHERE attempt_id = $1
          LIMIT 1
        `,
        values: [normalizedAttemptId],
      })
      .then((result) => result.rows[0] ?? null)
      .catch(() => null);
    const modelVersion = normalizeOptionalText(row?.modelVersion);
    const bindingId = normalizeOptionalText(row?.bindingId);
    const openMeldServiceRuntimeId = normalizeOptionalText(
      row?.openMeldServiceRuntimeId
    );
    const agentControllerRef = normalizeOptionalText(row?.agentControllerRef);
    if (
      modelVersion === RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION &&
      bindingId &&
      openMeldServiceRuntimeId &&
      agentControllerRef
    ) {
      return {
        factSource: "dispatch_attempt_execution_identity",
        authority: "authoritative",
        core: {
          modelVersion: RUNTIME_EXECUTION_IDENTITY_MODEL_VERSION,
          spaceId: input.spaceId,
          dispatchId: input.dispatch.dispatchId,
          targetProfileId: input.dispatch.targetProfileId,
          openMeldServiceRuntimeId: {
            source: "runtime_registry_authority",
            value: openMeldServiceRuntimeId,
          },
          bindingId,
          agentControllerRef,
        },
      };
    }
  }
  return null;
};
const readDispatchResultTrace = async (input: {
  db?: PostgresDatabase | null;
  dispatch: DispatchTraceDispatchRecord;
  spaceId: string;
}): Promise<DispatchTraceResultRecord | null> => {
  if (!(input.db && typeof input.db.query === "function")) {
    return null;
  }
  let row: {
    actorProfileId?: unknown;
    createdAtMs?: unknown;
    dispatchId?: unknown;
    publicOutcome?: unknown;
    publishedSignalId?: unknown;
    replyToSignalId?: unknown;
    resultKind?: unknown;
    resultRef?: unknown;
    spaceId?: unknown;
    statusType?: unknown;
  } | null;
  try {
    row = await input.db
      .query({
        text: `
          SELECT
            result_ref AS "resultRef",
            dispatch_id AS "dispatchId",
            space_id AS "spaceId",
            actor_profile_id AS "actorProfileId",
            reply_to_signal_id AS "replyToSignalId",
            result_kind AS "resultKind",
            public_outcome AS "publicOutcome",
            published_signal_id AS "publishedSignalId",
            status_type AS "statusType",
            created_at_ms AS "createdAtMs"
          FROM "openmeld"."openMeldDaemon_dispatch_results"
          WHERE dispatch_id = $1
          LIMIT 1
        `,
        values: [input.dispatch.dispatchId],
      })
      .then((result) => result.rows[0] ?? null);
  } catch {
    throw new Error(
      `dispatch result trace read failed for dispatch ${input.dispatch.dispatchId}`
    );
  }
  const resultRef = normalizeOptionalText(row?.resultRef);
  const dispatchId = normalizeOptionalText(row?.dispatchId);
  const spaceId = normalizeOptionalText(row?.spaceId);
  const actorProfileId = normalizeOptionalText(row?.actorProfileId);
  const replyToSignalId = normalizeOptionalText(row?.replyToSignalId);
  const resultKind = normalizeOptionalText(row?.resultKind);
  const publicOutcome = normalizeOptionalText(row?.publicOutcome);
  const createdAtMs = toNullableInteger(row?.createdAtMs);
  if (!row) {
    return null;
  }
  if (
    !(
      resultRef &&
      dispatchId === input.dispatch.dispatchId &&
      spaceId === input.spaceId &&
      actorProfileId === input.dispatch.targetProfileId &&
      (replyToSignalId === null ||
        replyToSignalId === input.dispatch.sourceEventId) &&
      resultKind &&
      publicOutcome &&
      createdAtMs !== null
    )
  ) {
    throw new Error("invalid dispatch result trace evidence");
  }
  return {
    factSource: "dispatch_result",
    resultRef,
    dispatchId,
    resultKind,
    publicOutcome,
    publishedSignalId: normalizeOptionalText(row?.publishedSignalId),
    statusType: normalizeOptionalText(row?.statusType),
    createdAt: toIsoDateTime(createdAtMs),
  };
};
const readDispatchResultInboxTrace = async (input: {
  db?: PostgresDatabase | null;
  dispatch: DispatchTraceDispatchRecord;
  latestAttempt: DispatchTraceLatestAttemptRecord | null;
}): Promise<DispatchTraceResultInboxRecord | null> => {
  if (!(input.db && typeof input.db.query === "function")) {
    return null;
  }
  const latestAttemptId = normalizeOptionalText(input.latestAttempt?.attemptId);
  const query = latestAttemptId
    ? `
          SELECT
            result_key AS "resultKey",
            dispatch_id AS "dispatchId",
            attempt_id AS "attemptId",
            task_id AS "taskId",
            target_profile_id AS "targetProfileId",
            daemon_session_id AS "daemonSessionId",
            lease_epoch AS "leaseEpoch",
            submitted_connection_generation AS "submittedConnectionGeneration",
            result_payload_json AS "resultPayloadJson",
            accepted_at_ms AS "acceptedAtMs",
            publish_state AS "publishState",
            published_signal_id AS "publishedSignalId",
            publication_error_code AS "publicationErrorCode",
            updated_at_ms AS "updatedAtMs"
          FROM "openmeld"."openMeldDaemon_dispatch_result_inbox"
          WHERE dispatch_id = $1
            AND attempt_id = $2
          LIMIT 1
        `
    : `
          SELECT
            result_key AS "resultKey",
            dispatch_id AS "dispatchId",
            attempt_id AS "attemptId",
            task_id AS "taskId",
            target_profile_id AS "targetProfileId",
            daemon_session_id AS "daemonSessionId",
            lease_epoch AS "leaseEpoch",
            submitted_connection_generation AS "submittedConnectionGeneration",
            result_payload_json AS "resultPayloadJson",
            accepted_at_ms AS "acceptedAtMs",
            publish_state AS "publishState",
            published_signal_id AS "publishedSignalId",
            publication_error_code AS "publicationErrorCode",
            updated_at_ms AS "updatedAtMs"
          FROM "openmeld"."openMeldDaemon_dispatch_result_inbox"
          WHERE dispatch_id = $1
          ORDER BY accepted_at_ms DESC NULLS LAST
          LIMIT 1
        `;
  let constrainedAttemptId = latestAttemptId;
  let row: {
    acceptedAtMs?: unknown;
    attemptId?: unknown;
    daemonSessionId?: unknown;
    dispatchId?: unknown;
    leaseEpoch?: unknown;
    publicationErrorCode?: unknown;
    publishedSignalId?: unknown;
    publishState?: unknown;
    resultKey?: unknown;
    resultPayloadJson?: unknown;
    submittedConnectionGeneration?: unknown;
    targetProfileId?: unknown;
    taskId?: unknown;
    updatedAtMs?: unknown;
  } | null;
  try {
    const statement = {
      text: query,
      values: [],
    };
    row = latestAttemptId
      ? await input.db
          .query({
            ...statement,
            values: [input.dispatch.dispatchId, latestAttemptId],
          })
          .then((result) => result.rows[0] ?? null)
      : await input.db
          .query({
            ...statement,
            values: [input.dispatch.dispatchId],
          })
          .then((result) => result.rows[0] ?? null);
    if (latestAttemptId && !row) {
      constrainedAttemptId = null;
      row = await input.db
        .query({
          text: `
            SELECT
              result_key AS "resultKey",
              dispatch_id AS "dispatchId",
              attempt_id AS "attemptId",
              task_id AS "taskId",
              target_profile_id AS "targetProfileId",
              daemon_session_id AS "daemonSessionId",
              lease_epoch AS "leaseEpoch",
              submitted_connection_generation AS "submittedConnectionGeneration",
              result_payload_json AS "resultPayloadJson",
              accepted_at_ms AS "acceptedAtMs",
              publish_state AS "publishState",
              published_signal_id AS "publishedSignalId",
              publication_error_code AS "publicationErrorCode",
              updated_at_ms AS "updatedAtMs"
            FROM "openmeld"."openMeldDaemon_dispatch_result_inbox"
            WHERE dispatch_id = $1
            ORDER BY accepted_at_ms DESC NULLS LAST
            LIMIT 1
          `,
          values: [input.dispatch.dispatchId],
        })
        .then((result) => result.rows[0] ?? null);
    }
  } catch {
    throw new Error(
      `dispatch result inbox trace read failed for dispatch ${input.dispatch.dispatchId}`
    );
  }
  if (!row) {
    return null;
  }
  const resultKey = normalizeOptionalText(row.resultKey);
  const dispatchId = normalizeOptionalText(row.dispatchId);
  const attemptId = normalizeOptionalText(row.attemptId);
  const taskId = normalizeOptionalText(row.taskId);
  const targetProfileId = normalizeOptionalText(row.targetProfileId);
  const daemonSessionId = normalizeOptionalText(row.daemonSessionId);
  const leaseEpoch = toNullableInteger(row.leaseEpoch);
  const submittedConnectionGeneration = toNullableInteger(
    row.submittedConnectionGeneration
  );
  const publishState = toDispatchResultInboxPublishState(row.publishState);
  const projectFailureContext = readProjectFailureContext(
    row.resultPayloadJson
  );
  const acceptedAtMs = toNullableInteger(row.acceptedAtMs);
  const updatedAtMs = toNullableInteger(row.updatedAtMs);
  if (
    !(
      resultKey &&
      dispatchId === input.dispatch.dispatchId &&
      (!constrainedAttemptId || attemptId === constrainedAttemptId) &&
      attemptId &&
      taskId &&
      targetProfileId === input.dispatch.targetProfileId &&
      daemonSessionId &&
      leaseEpoch !== null &&
      submittedConnectionGeneration !== null &&
      publishState &&
      acceptedAtMs !== null &&
      updatedAtMs !== null
    )
  ) {
    throw new Error("invalid dispatch result inbox trace evidence");
  }
  return {
    factSource: "dispatch_result_inbox",
    resultKey,
    dispatchId,
    attemptId,
    taskId,
    targetProfileId,
    daemonSessionId,
    leaseEpoch,
    submittedConnectionGeneration,
    ...(projectFailureContext ? { projectFailureContext } : {}),
    publishState,
    publishedSignalId: normalizeOptionalText(row.publishedSignalId),
    publicationErrorCode: normalizeOptionalText(row.publicationErrorCode),
    acceptedAt: toIsoDateTime(acceptedAtMs),
    updatedAt: toIsoDateTime(updatedAtMs),
  };
};
function readProjectFailureContext(
  resultPayloadJson: unknown
): DispatchTraceResultInboxRecord["projectFailureContext"] {
  if (typeof resultPayloadJson !== "string" || resultPayloadJson.length === 0) {
    throw new Error("dispatch result inbox trace is missing its task result");
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(resultPayloadJson);
  } catch (error) {
    throw new Error(
      "dispatch result inbox trace has invalid task result JSON",
      {
        cause: error,
      }
    );
  }
  const parsed = openMeldDaemonTaskResultEnvelopeSchema.safeParse(decoded);
  if (!parsed.success) {
    const firstIssue = parsed.error.issues[0];
    const issueLocation = firstIssue?.path.join(".") || "root";
    const issueCode = firstIssue?.code ?? "unknown";
    throw new Error(
      `dispatch result inbox trace has invalid task result (${issueCode} at ${issueLocation})`
    );
  }
  if (!("projectFailureContext" in parsed.data.payload)) {
    return undefined;
  }
  return parsed.data.payload.projectFailureContext;
}
function toDispatchResultInboxPublishState(
  value: unknown
): DispatchTraceResultInboxRecord["publishState"] | null {
  if (
    value === "result_accepted" ||
    value === "late_result_available" ||
    value === "reply_published" ||
    value === "reply_suppressed_stopped" ||
    value === "reply_publication_failed" ||
    value === "invalid_space_action" ||
    value === "legacy_result_quarantined"
  ) {
    return value;
  }
  return null;
}
const readDispatchOpsDecisionProjection = async (input: {
  db?: PostgresDatabase | null;
  dispatchId: string;
}): Promise<DispatchOpsDecisionProjection> => {
  if (!(input.db && typeof input.db.query === "function")) {
    return EMPTY_DISPATCH_OPS_DECISION_PROJECTION;
  }
  const records = await listRecentOpenMeldDaemonOpsDecisions({
    db: input.db,
    correlationId: input.dispatchId,
    limit: 200,
  }).catch(() => []);
  const latestByDecisionCode = new Map<
    string,
    OpenMeldDaemonOpsDecisionRecord
  >();
  for (const record of records) {
    if (!latestByDecisionCode.has(record.decisionCode)) {
      latestByDecisionCode.set(record.decisionCode, record);
    }
  }
  return {
    latestByDecisionCode,
    records,
  };
};
const projectRecentDispatchOpsDecisions = (input: {
  opsDecisionProjection: DispatchOpsDecisionProjection;
}): DispatchTraceOpsDecisionRecord[] => {
  return input.opsDecisionProjection.records
    .filter((record) => {
      return (
        record.decisionCode !== DISPATCH_STREAMING_TELEMETRY_DECISION_CODE &&
        record.decisionCode !== DISPATCH_EXECUTION_LIFECYCLE_DECISION_CODE &&
        record.decisionCode !== DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE &&
        record.decisionCode !== DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE &&
        record.decisionCode !== DISPATCH_OPENCLAW_BINDING_DECISION_CODE &&
        record.decisionCode !== DISPATCH_STRUCTURED_ACTION_FAILURE_DECISION_CODE
      );
    })
    .slice(0, 8)
    .map((record) => {
      return {
        factSource: "ops_decision",
        id: record.id,
        decisionCode: record.decisionCode,
        decidedBy: record.decidedBy,
        source: record.source,
        decidedAt: new Date(record.decidedAtMs).toISOString(),
        correlationId: record.correlationId,
        expectedRecoveryCriteria: record.expectedRecoveryCriteria,
      };
    });
};
const readDispatchStreamingTrace = (input: {
  opsDecisionProjection: DispatchOpsDecisionProjection;
}): DispatchTraceStreamingRecord | null => {
  const record = readLatestDecisionRecord({
    decisionCode: DISPATCH_STREAMING_TELEMETRY_DECISION_CODE,
    opsDecisionProjection: input.opsDecisionProjection,
  });
  if (!record) {
    return null;
  }
  const parsedPayload =
    parseDecisionPayload<DispatchStreamingTelemetryDecisionPayload>(
      record.decisionPayloadJson
    );
  if (!parsedPayload) {
    return null;
  }
  return {
    streamingMode:
      parsedPayload.streamingMode === "stream" ? "stream" : "final",
    previewEmitted: parsedPayload.previewEmitted === true,
    firstStdoutAt: toNullableIsoDateTime(parsedPayload.firstStdoutAtMs),
    firstOutputAt: toNullableIsoDateTime(parsedPayload.firstOutputAtMs),
  };
};
const readDispatchExecutionProjectionTrace = (input: {
  opsDecisionProjection: DispatchOpsDecisionProjection;
}): DispatchTraceDispatchExecutionRecord | null => {
  const record = readLatestDecisionRecord({
    decisionCode: DISPATCH_CONVERSATION_LIFECYCLE_DECISION_CODE,
    opsDecisionProjection: input.opsDecisionProjection,
  });
  if (!record) {
    return null;
  }
  const parsedPayload =
    parseDecisionPayload<DispatchDispatchExecutionDecisionPayload>(
      record.decisionPayloadJson
    );
  if (!parsedPayload) {
    return null;
  }
  const normalizedDispatchExecution = dispatchExecutionSchema.safeParse({
    agentControllerConversationResume:
      parsedPayload.agentControllerConversationResume,
    localRuntimeContext: parsedPayload.localRuntimeContext,
    bootstrap: parsedPayload.bootstrap,
  });
  if (!normalizedDispatchExecution.success) {
    return null;
  }
  return normalizedDispatchExecution.data;
};
const readDispatchStructuredActionFailureTrace = (input: {
  opsDecisionProjection: DispatchOpsDecisionProjection;
}): DispatchTraceStructuredActionFailureRecord | null => {
  const record = readLatestDecisionRecord({
    decisionCode: DISPATCH_STRUCTURED_ACTION_FAILURE_DECISION_CODE,
    opsDecisionProjection: input.opsDecisionProjection,
  });
  if (!record) {
    return null;
  }
  const parsedPayload =
    parseDecisionPayload<DispatchStructuredActionFailureDecisionPayload>(
      record.decisionPayloadJson
    );
  if (!parsedPayload) {
    return null;
  }
  return {
    carrierKind:
      parsedPayload.carrierKind === "fenced_block" ||
      parsedPayload.carrierKind === "invalid_json" ||
      parsedPayload.carrierKind === "trailing_json"
        ? parsedPayload.carrierKind
        : "none",
    invalidOutputPreview:
      normalizeOptionalText(parsedPayload.invalidOutputPreview) ?? null,
    publicFailureReason:
      normalizeOptionalText(parsedPayload.publicFailureReason) ?? null,
    repairMode:
      parsedPayload.repairMode === "required_check" ||
      parsedPayload.repairMode === "local_synthetic" ||
      parsedPayload.repairMode === "controller_roundtrip"
        ? parsedPayload.repairMode
        : "required_check",
    spaceActionCandidatePresent:
      parsedPayload.spaceActionCandidatePresent === true,
    spaceActionParseError:
      normalizeOptionalText(parsedPayload.spaceActionParseError) ?? null,
  };
};
const readDispatchOpenClawBindingTrace = (input: {
  opsDecisionProjection: DispatchOpsDecisionProjection;
}): SpaceDispatchTraceSnapshot["openClawBinding"] => {
  const record = readLatestDecisionRecord({
    decisionCode: DISPATCH_OPENCLAW_BINDING_DECISION_CODE,
    opsDecisionProjection: input.opsDecisionProjection,
  });
  if (!record) {
    return null;
  }
  const parsedPayload =
    parseDecisionPayload<DispatchOpenClawBindingDecisionPayload>(
      record.decisionPayloadJson
    );
  if (!parsedPayload) {
    return null;
  }
  const classification = normalizeOptionalText(parsedPayload.classification);
  const bindingSource = normalizeOptionalText(parsedPayload.bindingSource);
  if (
    classification !== "missing" &&
    classification !== "canonical_owned" &&
    classification !== "legacy" &&
    classification !== "foreign"
  ) {
    return null;
  }
  return {
    classification,
    bindingSource:
      bindingSource === "daemon-launch" || bindingSource === "imported"
        ? bindingSource
        : null,
    upgradeApplied: parsedPayload.upgradeApplied === true,
  };
};
const readDispatchRuntimeTelemetryDecisionPayload = (input: {
  opsDecisionProjection: DispatchOpsDecisionProjection;
}): DispatchRuntimeTelemetryDecisionPayload | null => {
  const record = readLatestDecisionRecord({
    decisionCode: DISPATCH_RUNTIME_TELEMETRY_DECISION_CODE,
    opsDecisionProjection: input.opsDecisionProjection,
  });
  if (!record) {
    return null;
  }
  return parseDecisionPayload<DispatchRuntimeTelemetryDecisionPayload>(
    record.decisionPayloadJson
  );
};
const readDispatchExecutionTrace = (input: {
  opsDecisionProjection: DispatchOpsDecisionProjection;
}): DispatchTraceExecutionRecord | null => {
  const record = readLatestDecisionRecord({
    decisionCode: DISPATCH_EXECUTION_LIFECYCLE_DECISION_CODE,
    opsDecisionProjection: input.opsDecisionProjection,
  });
  if (!record) {
    return null;
  }
  const parsedPayload =
    parseDecisionPayload<DispatchExecutionLifecycleDecisionPayload>(
      record.decisionPayloadJson
    );
  if (!parsedPayload) {
    return null;
  }
  const phase =
    parsedPayload.phase === "accepted_local" ||
    parsedPayload.phase === "running" ||
    parsedPayload.phase === "completed_local" ||
    parsedPayload.phase === "result_received"
      ? parsedPayload.phase
      : "starting";
  const progressEvidenceState =
    parsedPayload.progressEvidenceState === "active" ||
    parsedPayload.progressEvidenceState === "stalled"
      ? parsedPayload.progressEvidenceState
      : "unknown";
  return {
    phase,
    phaseEnteredAt: toNullableIsoDateTime(parsedPayload.phaseEnteredAtMs),
    lastLifecycleAt: toNullableIsoDateTime(parsedPayload.lastLifecycleAtMs),
    progressEvidenceState,
    timeoutPolicy: {
      taskProgressEvidenceStaleAfterMs: toNullableInteger(
        parsedPayload.taskProgressEvidenceStaleAfterMs
      ),
      finalizationTimeoutMs: toNullableInteger(
        parsedPayload.finalizationTimeoutMs
      ),
      startTimeoutMs: toNullableInteger(parsedPayload.startTimeoutMs),
      waitWindowMs: toNullableInteger(parsedPayload.waitWindowMs),
    },
  };
};
const readLatestDecisionRecord = (input: {
  decisionCode: string;
  opsDecisionProjection: DispatchOpsDecisionProjection;
}): OpenMeldDaemonOpsDecisionRecord | null => {
  return (
    input.opsDecisionProjection.latestByDecisionCode.get(input.decisionCode) ??
    null
  );
};
const parseDecisionPayload = <TPayload extends Record<string, unknown>>(
  decisionPayloadJson: string
): TPayload | null => {
  try {
    const rawPayload = JSON.parse(decisionPayloadJson) as unknown;
    return rawPayload &&
      typeof rawPayload === "object" &&
      !Array.isArray(rawPayload)
      ? (rawPayload as TPayload)
      : null;
  } catch {
    return null;
  }
};
