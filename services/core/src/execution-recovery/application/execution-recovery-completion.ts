import type {
  ExecuteExecutionRecoveryBody,
  ExecuteExecutionRecoveryResponse,
} from "@openmeld/schemas/types";

export function resolveExecutionRecoveryCompletionReasonCode(input: {
  action: ExecuteExecutionRecoveryBody["action"];
  status: ExecuteExecutionRecoveryResponse["status"];
}): string {
  if (input.status === "already_completed") {
    return "execution_recovery.result_already_recovered";
  }
  if (input.status === "outcome_unknown") {
    return "execution_recovery.operation_outcome_unknown";
  }
  if (input.action === "recover_result") {
    return "execution_recovery.result_replayed";
  }
  if (input.action === "resume_controller_conversation") {
    return input.status === "new_execution_requested"
      ? "execution_recovery.controller_conversation_resume_requested"
      : "execution_recovery.controller_conversation_resumed";
  }
  return "execution_recovery.new_execution_requested";
}
