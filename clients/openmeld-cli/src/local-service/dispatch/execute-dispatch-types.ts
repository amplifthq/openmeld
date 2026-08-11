import type { RuntimeTaskResult } from "@openmeld/local-execution";
import type {
  ConversationBootstrapReason,
  OpenMeldDaemonTaskResultPayload,
} from "@openmeld/schemas/types";
import type { DispatchSpaceActionRecord } from "../../runtime/dispatch-space-action-context";
import type { OpenMeldDaemonTaskErrorType } from "../core/types";
import type { resolveLocalRuntimeControllerSupport } from "../routing/resolve-controller-support";
import type {
  buildDispatchCorrelation,
  parseDispatchTask,
} from "./parse-dispatch-task";
import type { sendDispatchLifecycleFrame } from "./send-dispatch-result";
import type { resolveDispatchSendTargetReference } from "./send-target-reference";

export type BootstrapPlan = {
  reason: ConversationBootstrapReason | null;
  shouldInject: boolean;
};

export type DispatchCorrelation = ReturnType<typeof buildDispatchCorrelation>;
export type ParsedDispatchTask = NonNullable<
  ReturnType<typeof parseDispatchTask>
>;
export type DispatchSendTargetReferenceLoadResult = Awaited<
  ReturnType<typeof resolveDispatchSendTargetReference>
>;
export type SupportedRuntimeControllerSupport = Extract<
  ReturnType<typeof resolveLocalRuntimeControllerSupport>,
  { supported: true }
>;
export type DispatchRuntimeCompletion =
  | {
      kind: "runtime";
      runtimeResult: RuntimeTaskResult;
    }
  | {
      kind: "cli_space_action_invalid";
      errorMessage: string;
    }
  | {
      kind: "cli_space_action_recorded";
      record: DispatchSpaceActionRecord;
    }
  | {
      kind: "cli_space_action_poll_aborted";
    };
export type StructuredActionFailureDiagnostics = NonNullable<
  OpenMeldDaemonTaskResultPayload["spaceActionFailureDiagnostics"]
>;
export type DispatchLifecyclePhase = Parameters<
  typeof sendDispatchLifecycleFrame
>[0]["phase"];
export type DispatchLocalJournalPhase =
  | "bootstrap_context_ready"
  | "ledger_context_ready"
  | "preflight_ready"
  | "process_exit"
  | "process_spawned"
  | "runtime_context_ready"
  | "runtime_completed"
  | "runtime_invocation_started"
  | "send_target_reference_ready"
  | "task_started";
export type DispatchBootstrapContextPhase =
  | "bootstrap_context_ready"
  | "send_target_reference_ready";
export type DispatchRejectionPayloadInput = {
  attemptId: string;
  agentControllerRef: string | null;
  errorCode: string;
  errorMessage: string;
  errorType: OpenMeldDaemonTaskErrorType;
  sourceEventId: string;
  targetProfileId: string;
  taskId: string;
};
export type DispatchPromptTrace = NonNullable<
  OpenMeldDaemonTaskResultPayload["promptTrace"]
>;
export type StructuredActionRepairResult = {
  finalFailureDiagnostics: StructuredActionFailureDiagnostics | null;
  runtimeResult: RuntimeTaskResult | null;
};
