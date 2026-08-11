import {
  isTaskResultStatusSuccessLike,
  resolveTaskResultDeliverySemantic,
  type TaskResultDeliverySemantic,
  type TaskResultDeliverySemanticKind,
} from "@openmeld/agent-runtime";
import type {
  OpenMeldDaemonTaskResultEnvelope,
  OpenMeldDaemonTaskResultPayload,
} from "@openmeld/schemas";
import {
  OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE,
  OPENMELD_DAEMON_DISPATCH_STATE,
  type OpenMeldDaemonDispatchAttemptState,
  type OpenMeldDaemonDispatchState,
} from "./dispatch-lifecycle-contract";
import type {
  DispatchAttemptTransitionKind,
  DispatchLedgerTransitionKind,
} from "./dispatch-state-transition-contract";

export type CoreRuntimeTaskResultDeliverySemanticKind =
  TaskResultDeliverySemanticKind;

export type CoreRuntimeTaskResultDeliveryContract =
  | (TaskResultDeliverySemantic & {
      kind: "success_like";
      successLike: true;
      dispatchState: typeof OPENMELD_DAEMON_DISPATCH_STATE.succeeded;
      attemptState: typeof OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded;
      ledgerTransitionKind: Extract<
        DispatchLedgerTransitionKind,
        "settle_dispatch_succeeded"
      >;
      attemptTransitionKind: Extract<
        DispatchAttemptTransitionKind,
        "settle_attempt_succeeded"
      >;
    })
  | (TaskResultDeliverySemantic & {
      kind: "failed_requires_classification";
      successLike: false;
      dispatchState: null;
      attemptState: null;
      ledgerTransitionKind: null;
      attemptTransitionKind: null;
    });

const CORE_RUNTIME_TASK_RESULT_SETTLEMENT_BY_SEMANTIC_KIND = {
  success_like: {
    dispatchState: OPENMELD_DAEMON_DISPATCH_STATE.succeeded,
    attemptState: OPENMELD_DAEMON_DISPATCH_ATTEMPT_STATE.succeeded,
    ledgerTransitionKind: "settle_dispatch_succeeded",
    attemptTransitionKind: "settle_attempt_succeeded",
  },
  failed_requires_classification: {
    dispatchState: null,
    attemptState: null,
    ledgerTransitionKind: null,
    attemptTransitionKind: null,
  },
} as const;

export const isRuntimeTaskResultStatusSuccessLike = (
  status: OpenMeldDaemonTaskResultPayload["status"]
): status is Extract<
  OpenMeldDaemonTaskResultPayload["status"],
  "success" | "partial_success"
> => isTaskResultStatusSuccessLike(status);

export const isSuccessfulRuntimeTaskResultPayload = (
  payload: OpenMeldDaemonTaskResultEnvelope["payload"]
): payload is Extract<
  OpenMeldDaemonTaskResultEnvelope["payload"],
  { status: "success" | "partial_success" }
> => isRuntimeTaskResultStatusSuccessLike(payload.status);

export const resolveCoreRuntimeTaskResultDeliveryContract = (input: {
  payloadStatus: OpenMeldDaemonTaskResultPayload["status"];
}): CoreRuntimeTaskResultDeliveryContract => {
  const semantic = resolveTaskResultDeliverySemantic({
    payloadStatus: input.payloadStatus,
  });
  switch (semantic.kind) {
    case "success_like":
      return {
        kind: "success_like",
        successLike: true,
        ...CORE_RUNTIME_TASK_RESULT_SETTLEMENT_BY_SEMANTIC_KIND.success_like,
      };
    case "failed_requires_classification":
      return {
        kind: "failed_requires_classification",
        successLike: false,
        ...CORE_RUNTIME_TASK_RESULT_SETTLEMENT_BY_SEMANTIC_KIND.failed_requires_classification,
      };
    default: {
      const unsupportedKind: never = semantic.kind;
      throw new Error(
        `Unsupported runtime task result semantic: ${unsupportedKind}`
      );
    }
  }
};

export const resolveCoreRuntimeTaskResultSettledDispatchState = (input: {
  payloadStatus: OpenMeldDaemonTaskResultPayload["status"];
}): OpenMeldDaemonDispatchState | null =>
  resolveCoreRuntimeTaskResultDeliveryContract(input).dispatchState;

export const resolveCoreRuntimeTaskResultSettledAttemptState = (input: {
  payloadStatus: OpenMeldDaemonTaskResultPayload["status"];
}): OpenMeldDaemonDispatchAttemptState | null =>
  resolveCoreRuntimeTaskResultDeliveryContract(input).attemptState;
