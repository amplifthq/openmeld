import type { AdapterComputerFileAccessBoundary } from "@openmeld/adapter-core";
import type { LocalDaemonAdapterContainer } from "@openmeld/local-service";
import {
  buildAgentControllerConversationRef,
  resolveBuiltinAgentControllerConversationKind,
} from "@openmeld/schemas";
import type {
  RuntimeTransportResumeControllerConversationFramePayload,
  RuntimeTransportResumeControllerConversationResult,
} from "@openmeld/schemas/types";
import type { DaemonProfileRouteConfig } from "../core/types";
import { assertComputerFileAccessWorkingDirectoryAllowed } from "../file-access/computer-file-access-admission";
import { COMPUTER_FILE_ACCESS_AWARENESS } from "../file-access/computer-file-access-prompt";
import { readComputerFileAccessPolicy } from "../file-access/computer-file-access-store";
import { resolveLocalRuntimeControllerSupport } from "../routing/resolve-controller-support";

type RecoveryRouteConfig = Pick<
  DaemonProfileRouteConfig,
  | "agentControllerPermissionMode"
  | "agentControllerRef"
  | "launchContract"
  | "profileId"
  | "transportMode"
>;

const RECOVERY_PROMPT = [
  "OpenMeld execution recovery.",
  "Continue this exact controller conversation.",
  "Do not redo the task, call tools, edit files, or perform external actions.",
  "Return only the final answer that was already completed in this conversation.",
  "If the conversation has no completed final answer, return exactly RECOVERY_RESULT_UNAVAILABLE.",
].join(" ");

export async function resumeExactControllerConversation(input: {
  computerFileAccessStorePath: string;
  localAdapterContainer: LocalDaemonAdapterContainer;
  request: RuntimeTransportResumeControllerConversationFramePayload;
  routeConfig?: RecoveryRouteConfig | null;
}): Promise<RuntimeTransportResumeControllerConversationResult> {
  const identity = input.request.identity;
  const controllerRef = identity.agentControllerRef;
  const conversationId = identity.agentControllerConversationId;
  if (!(controllerRef && conversationId)) {
    return rejected(input.request, "execution_recovery.identity_incomplete");
  }
  const support = resolveLocalRuntimeControllerSupport({
    agentControllerRef: controllerRef,
    localAdapterContainer: input.localAdapterContainer,
  });
  if (!support.supported) {
    return rejected(input.request, support.reasonCode, support.reasonDetail);
  }
  if (
    !support.localAdapterEntry.transportModes.includes(
      input.request.transportMode
    )
  ) {
    return rejected(
      input.request,
      "execution_recovery.transport_mode_unsupported"
    );
  }
  const conversationKind =
    resolveBuiltinAgentControllerConversationKind(controllerRef);
  if (!conversationKind) {
    return rejected(
      input.request,
      "execution_recovery.controller_conversation_kind_unsupported"
    );
  }
  const exactConversation = buildAgentControllerConversationRef({
    agentControllerConversationId: conversationId,
    agentControllerConversationKind: conversationKind,
    agentControllerRef: controllerRef,
  });
  const fileAccess = await resolveRecoveryComputerFileAccess({
    computerFileAccessStorePath: input.computerFileAccessStorePath,
    request: input.request,
    routeConfig: input.routeConfig ?? null,
    support,
  });
  if (fileAccess.status === "rejected") {
    return fileAccess.result;
  }
  const computerFileAccessBoundary = fileAccess.boundary;
  const result = await support.localAdapterEntry.adapter.dispatch({
    agentControllerConversation: exactConversation,
    agentControllerConversationId: conversationId,
    agentId: identity.targetProfileId,
    dispatchId: identity.dispatchId,
    executionMode: "repair",
    ...(computerFileAccessBoundary ? { computerFileAccessBoundary } : {}),
    prompt: computerFileAccessBoundary
      ? `${COMPUTER_FILE_ACCESS_AWARENESS} ${RECOVERY_PROMPT}`
      : RECOVERY_PROMPT,
    runtimeContext: {
      providerRuntimeWorkingDirectory:
        input.request.providerRuntimeWorkingDirectory,
    },
    sourceEventId: input.request.sourceEventId,
    spaceId: identity.spaceId,
    streamingMode: "final",
    taskId:
      identity.taskId ?? `execution-recovery:${input.request.operationId}`,
    transportMode: input.request.transportMode,
  });
  if (result.status !== "success") {
    return {
      destination: input.request.destination,
      identity,
      message: result.errorMessage,
      operationId: input.request.operationId,
      reasonCode:
        result.errorCode ?? "execution_recovery.controller_resume_failed",
      status: "outcome_unknown",
    };
  }
  const observedConversationId =
    result.contextDelta?.agentControllerConversationId ?? conversationId;
  if (observedConversationId !== conversationId) {
    return {
      destination: input.request.destination,
      identity,
      message:
        "The controller returned a different conversation during recovery.",
      operationId: input.request.operationId,
      reasonCode: "execution_recovery.controller_conversation_mismatch",
      status: "outcome_unknown",
    };
  }
  const output = result.output.trim();
  if (!output || output === "RECOVERY_RESULT_UNAVAILABLE") {
    return {
      destination: input.request.destination,
      identity,
      message: "The exact conversation did not contain a completed result.",
      operationId: input.request.operationId,
      reasonCode: "execution_recovery.completed_result_unavailable",
      status: "outcome_unknown",
    };
  }
  return {
    agentControllerConversationId: conversationId,
    destination: input.request.destination,
    identity,
    operationId: input.request.operationId,
    output,
    status: "completed",
  };
}

async function resolveRecoveryComputerFileAccess(input: {
  computerFileAccessStorePath: string;
  request: RuntimeTransportResumeControllerConversationFramePayload;
  routeConfig: RecoveryRouteConfig | null;
  support: Extract<
    ReturnType<typeof resolveLocalRuntimeControllerSupport>,
    { supported: true }
  >;
}): Promise<
  | {
      boundary: AdapterComputerFileAccessBoundary | null;
      status: "ready";
    }
  | {
      result: RuntimeTransportResumeControllerConversationResult;
      status: "rejected";
    }
> {
  const policy = await readComputerFileAccessPolicy(
    input.computerFileAccessStorePath
  );
  if (policy.mode === "local_agent_settings") {
    return { boundary: null, status: "ready" };
  }
  if (
    input.support.localAdapterEntry.adapterId !== "codex" ||
    (input.request.transportMode !== "codex-app-server" &&
      input.request.transportMode !== "local-cli")
  ) {
    return {
      result: rejected(
        input.request,
        "execution_recovery.computer_file_access_unverified",
        "OpenMeld could not verify this Computer’s file access boundary for execution recovery."
      ),
      status: "rejected",
    };
  }
  try {
    await assertComputerFileAccessWorkingDirectoryAllowed({
      boundary: policy,
      providerRuntimeWorkingDirectory:
        input.request.providerRuntimeWorkingDirectory,
    });
  } catch {
    return {
      result: rejected(
        input.request,
        "computer.file_access.working_directory_denied",
        "This recovery working folder is outside the Computer file access boundary."
      ),
      status: "rejected",
    };
  }

  const routeConfig = input.routeConfig;
  const verifyBoundary =
    input.support.localAdapterEntry.adapter.verifyComputerFileAccessBoundary;
  if (
    !(verifyBoundary && routeConfig) ||
    routeConfig.profileId !== input.request.identity.targetProfileId ||
    routeConfig.agentControllerRef !==
      input.request.identity.agentControllerRef ||
    routeConfig.transportMode !== input.request.transportMode
  ) {
    return unverifiedComputerFileAccess(input.request);
  }
  try {
    const verification = await verifyBoundary({
      agentControllerPermissionMode: routeConfig.agentControllerPermissionMode,
      boundary: policy,
      executionMode: "repair",
      launchContract: routeConfig.launchContract ?? null,
      transportMode: input.request.transportMode,
      workingDirectory: input.request.providerRuntimeWorkingDirectory,
    });
    if (!verification.supported) {
      return unverifiedComputerFileAccess(input.request);
    }
  } catch {
    return unverifiedComputerFileAccess(input.request);
  }
  return { boundary: policy, status: "ready" };
}

function unverifiedComputerFileAccess(
  request: RuntimeTransportResumeControllerConversationFramePayload
): {
  result: RuntimeTransportResumeControllerConversationResult;
  status: "rejected";
} {
  return {
    result: rejected(
      request,
      "execution_recovery.computer_file_access_unverified",
      "OpenMeld could not verify this Computer’s file access boundary for execution recovery."
    ),
    status: "rejected",
  };
}

function rejected(
  request: RuntimeTransportResumeControllerConversationFramePayload,
  reasonCode: string,
  message = reasonCode
): RuntimeTransportResumeControllerConversationResult {
  return {
    destination: request.destination,
    identity: request.identity,
    message,
    operationId: request.operationId,
    reasonCode,
    status: "rejected",
  };
}
