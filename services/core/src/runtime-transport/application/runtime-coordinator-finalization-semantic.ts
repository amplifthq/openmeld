import type {
  OpenMeldDaemonTaskResultEnvelope,
  RuntimeCoordinatorFinalizationFinalMessageKind,
} from "@openmeld/schemas/types";

export type RuntimeCoordinatorFinalizationSemantic = {
  reasonCode: string | null;
  status: "failed" | "stayed_silent" | "succeeded";
};

type PublishedFinalMessageKind =
  | RuntimeCoordinatorFinalizationFinalMessageKind
  | "unknown";

export function resolveRuntimeCoordinatorFinalizationSemantic(input: {
  finalMessageKind?: PublishedFinalMessageKind;
  publishState: "invalid_space_action" | "reply_published";
  taskResult: OpenMeldDaemonTaskResultEnvelope;
}): RuntimeCoordinatorFinalizationSemantic {
  const payload = input.taskResult.payload;
  if (payload.status === "failed") {
    return {
      reasonCode: payload.errorCode ?? "agent_task.child_failed",
      status: "failed",
    };
  }

  const publicFailureReason =
    "spaceActionFailureDiagnostics" in payload
      ? (payload.spaceActionFailureDiagnostics?.publicFailureReason ?? null)
      : null;
  if (input.publishState === "invalid_space_action") {
    return {
      reasonCode: publicFailureReason ?? "agent_task.invalid_space_action",
      status: "failed",
    };
  }

  if (input.finalMessageKind === "failure_notice") {
    return {
      reasonCode: publicFailureReason ?? "agent_task.invalid_space_action",
      status: "failed",
    };
  }
  if (input.finalMessageKind === "stay_silent") {
    return { reasonCode: null, status: "stayed_silent" };
  }
  if (input.finalMessageKind === "success_reply") {
    return { reasonCode: null, status: "succeeded" };
  }
  if (input.finalMessageKind === "unknown") {
    return {
      reasonCode: publicFailureReason ?? "agent_task.invalid_space_action",
      status: "failed",
    };
  }

  const spaceAction =
    "spaceAction" in payload ? payload.spaceAction : undefined;
  if (spaceAction?.type === "stay_silent") {
    return { reasonCode: null, status: "stayed_silent" };
  }
  if (spaceAction) {
    return { reasonCode: null, status: "succeeded" };
  }
  return {
    reasonCode: publicFailureReason ?? "agent_task.invalid_space_action",
    status: "failed",
  };
}
