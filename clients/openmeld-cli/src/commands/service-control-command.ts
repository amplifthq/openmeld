import { randomUUID } from "node:crypto";
import { OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION } from "@openmeld/schemas";
import { validateDaemonControlTargetInput } from "../command-contracts/service-control-target";
import type { DaemonServiceRuntimeStatus } from "../config/daemon-state";
import {
  LocalDaemonControlPlaneClientError,
  sendLocalDaemonControlPlaneRequest,
} from "../local-service/control-plane/client";
import { normalizeOptionalText } from "../local-service/core/logger";
import { readCurrentDaemonRuntimeContext } from "../local-service/lifecycle/daemon-service-runtime";
import { type RuntimeContext, resolveRuntimeContext } from "../runtime/context";
import { createPresenter } from "../runtime/presenter/index";
import type { DaemonControlInput } from "./service-inputs";
import { emitDaemonOverviewIfAgent } from "./service-output";
import { describeDaemonRuntimeStatus } from "./service-status-view";

export async function runDaemonControlCommand(
  input: DaemonControlInput & {
    command: "cancel" | "interrupt";
  }
): Promise<void> {
  const runtime = await resolveRuntimeContext({
    view: input.view,
  });
  const presenter = createPresenter(runtime);
  emitDaemonOverviewIfAgent({
    presenter,
    resolvedView: runtime.resolvedView,
    command: input.command,
    handled: input.agentOverviewHandled,
  });

  let target:
    | import("@openmeld/schemas/types").OpenMeldDaemonControlTargetSelector
    | null = null;
  try {
    target = resolveDaemonControlTargetSelector({
      dispatch: input.dispatch,
      task: input.task,
    });
  } catch (error) {
    failDaemonControlCommand({
      command: input.command,
      error,
      errorCode: "daemon.control.invalid_target_selector",
      presenter,
      runtime,
      target: null,
    });
  }
  const runtimeStatus = await resolveDaemonControlRuntimeStatus().catch(
    (error) => {
      failDaemonControlCommand({
        command: input.command,
        error,
        presenter,
        runtime,
        target,
      });
    }
  );
  if (!runtimeStatus.controlReachable) {
    emitDaemonControlNotRunning({
      command: input.command,
      presenter,
      runtime,
      runtimeStatus: runtimeStatus.runtimeStatus,
      target,
    });
    throw new Error("daemon.control.not_running");
  }

  const response = await sendLocalDaemonControlPlaneRequest({
    request: {
      v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
      command: input.command,
      requestId: randomUUID(),
      payload: {
        ...(input.reason ? { reason: input.reason } : {}),
        target,
      },
    },
  }).catch((error) => {
    failDaemonControlCommand({
      command: input.command,
      error,
      presenter,
      runtime,
      target,
    });
  });

  if (input.command === "interrupt") {
    if (response.code !== "service.interrupt") {
      failDaemonControlCommand({
        command: input.command,
        error: new Error(
          `daemon.control.invalid_response: expected service.interrupt, received ${response.code}`
        ),
        errorCode: "daemon.control.invalid_response",
        presenter,
        runtime,
        target,
      });
    }
    const payload = response.payload;
    emitDaemonControlResult({
      command: input.command,
      payload,
      presenter,
      runtime,
    });
    if (!payload.accepted) {
      throw buildDaemonControlRejectedError({
        command: input.command,
        payload,
      });
    }
    return;
  }

  if (response.code !== "service.cancel") {
    failDaemonControlCommand({
      command: input.command,
      error: new Error(
        `daemon.control.invalid_response: expected service.cancel, received ${response.code}`
      ),
      errorCode: "daemon.control.invalid_response",
      presenter,
      runtime,
      target,
    });
  }
  const payload = response.payload;
  emitDaemonControlResult({
    command: input.command,
    payload,
    presenter,
    runtime,
  });
  if (!payload.accepted) {
    throw buildDaemonControlRejectedError({
      command: input.command,
      payload,
    });
  }
}

export async function resolveDaemonControlRuntimeStatus(): Promise<{
  controlReachable: boolean;
  runtimeStatus: DaemonServiceRuntimeStatus;
}> {
  const runtimeContext = await readCurrentDaemonRuntimeContext();
  if (runtimeContext.effectiveRuntimeStatus === "running") {
    return {
      controlReachable: true,
      runtimeStatus: runtimeContext.runtimeStatus,
    };
  }
  if (
    runtimeContext.effectiveRuntimeStatus === "not_running" ||
    runtimeContext.status.installed !== true
  ) {
    return {
      controlReachable: false,
      runtimeStatus: runtimeContext.runtimeStatus,
    };
  }

  const controlReachable = await probeLocalDaemonControlPlaneReachability();
  return {
    controlReachable,
    runtimeStatus: runtimeContext.runtimeStatus,
  };
}

export async function probeLocalDaemonControlPlaneReachability(): Promise<boolean> {
  try {
    const response = await sendLocalDaemonControlPlaneRequest({
      request: {
        v: OPENMELD_DAEMON_CONTROL_PLANE_SCHEMA_VERSION,
        command: "health",
        requestId: randomUUID(),
      },
    });
    return response.code === "service.health";
  } catch (error) {
    if (
      error instanceof LocalDaemonControlPlaneClientError &&
      error.code === "daemon.control.endpoint_missing"
    ) {
      return false;
    }
    throw error;
  }
}

export function buildDaemonControlRejectedError(input: {
  command: "cancel" | "interrupt";
  payload:
    | Extract<
        import("@openmeld/schemas/types").OpenMeldDaemonControlPlaneResponse,
        { code: "service.cancel" }
      >["payload"]
    | Extract<
        import("@openmeld/schemas/types").OpenMeldDaemonControlPlaneResponse,
        { code: "service.interrupt" }
      >["payload"];
}): Error {
  const targetLabel =
    input.payload.target.by === "dispatch"
      ? `dispatch ${input.payload.target.dispatchId}`
      : `task ${input.payload.target.taskId}`;
  const note = normalizeOptionalText(input.payload.note);
  const detail = note ? ` (${note})` : "";
  return new Error(
    `daemon.control.rejected: ${input.command} request was not accepted for ${targetLabel}${detail}`
  );
}

export function resolveDaemonControlTargetSelector(input: {
  dispatch?: string;
  task?: string;
}): import("@openmeld/schemas/types").OpenMeldDaemonControlTargetSelector {
  const selection = validateDaemonControlTargetInput({
    dispatch: input.dispatch,
    task: input.task,
  });
  if (selection.dispatch) {
    return {
      by: "dispatch",
      dispatchId: selection.dispatch,
    };
  }
  return {
    by: "task",
    taskId: selection.task ?? "",
  };
}

export function emitDaemonControlNotRunning(input: {
  command: "cancel" | "interrupt";
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  runtimeStatus: DaemonServiceRuntimeStatus;
  target: import("@openmeld/schemas/types").OpenMeldDaemonControlTargetSelector;
}) {
  const payload = {
    accepted: false,
    reason: "service_not_running",
    status: input.runtimeStatus,
    target: input.target,
  } as const;
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: `daemon.${input.command}.not_running`,
      payload,
    });
    return;
  }
  input.presenter.line({
    code: `daemon.${input.command}.not_running`,
    text: describeDaemonRuntimeStatus(input.runtimeStatus),
  });
}

export function emitDaemonControlFailure(input: {
  command: "cancel" | "interrupt";
  error: unknown;
  errorCode?: string;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  target:
    | import("@openmeld/schemas/types").OpenMeldDaemonControlTargetSelector
    | null;
}) {
  const errorCode =
    input.errorCode ??
    (input.error instanceof LocalDaemonControlPlaneClientError
      ? input.error.code
      : "daemon.control.request_failed");
  const errorMessage =
    input.error instanceof Error
      ? input.error.message
      : "failed to send daemon control request";
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: `daemon.${input.command}.failed`,
      payload: {
        accepted: false,
        errorCode,
        errorMessage,
        target: input.target,
      },
    });
    return;
  }
  input.presenter.line({
    code: `daemon.${input.command}.failed`,
    text: `${capitalizeDaemonControlCommand(input.command)} request failed: ${errorMessage}`,
  });
}

export function failDaemonControlCommand(input: {
  command: "cancel" | "interrupt";
  error: unknown;
  errorCode?: string;
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
  target:
    | import("@openmeld/schemas/types").OpenMeldDaemonControlTargetSelector
    | null;
}): never {
  emitDaemonControlFailure(input);
  throw input.error instanceof Error
    ? input.error
    : new Error("daemon.control.request_failed");
}

export function emitDaemonControlResult(input: {
  command: "cancel" | "interrupt";
  payload:
    | Extract<
        import("@openmeld/schemas/types").OpenMeldDaemonControlPlaneResponse,
        { code: "service.cancel" }
      >["payload"]
    | Extract<
        import("@openmeld/schemas/types").OpenMeldDaemonControlPlaneResponse,
        { code: "service.interrupt" }
      >["payload"];
  presenter: ReturnType<typeof createPresenter>;
  runtime: RuntimeContext;
}) {
  if (input.runtime.resolvedView === "agent") {
    input.presenter.data({
      code: `daemon.${input.command}.result`,
      payload: input.payload,
    });
    return;
  }

  const targetLabel =
    input.payload.target.by === "dispatch"
      ? `dispatch ${input.payload.target.dispatchId}`
      : `task ${input.payload.target.taskId}`;
  const resolvedDispatchId = normalizeOptionalText(
    input.payload.resolvedDispatchId
  );
  const resolvedTaskId = normalizeOptionalText(input.payload.resolvedTaskId);
  const acceptedVerb = capitalizeDaemonControlCommand(input.command);
  const acceptedText = [
    `${acceptedVerb} request accepted for ${targetLabel}.`,
    resolvedDispatchId ? `Dispatch: ${resolvedDispatchId}.` : null,
    resolvedTaskId ? `Task: ${resolvedTaskId}.` : null,
    input.payload.note ? `Note: ${input.payload.note}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const rejectedText = [
    `${acceptedVerb} request was not accepted for ${targetLabel}.`,
    input.payload.note ? `Reason: ${input.payload.note}.` : null,
    resolvedDispatchId ? `Dispatch: ${resolvedDispatchId}.` : null,
    resolvedTaskId ? `Task: ${resolvedTaskId}.` : null,
  ]
    .filter(Boolean)
    .join(" ");
  input.presenter.line({
    code: `daemon.${input.command}.${input.payload.accepted ? "accepted" : "rejected"}`,
    text: input.payload.accepted ? acceptedText : rejectedText,
  });
}

export function capitalizeDaemonControlCommand(
  command: "cancel" | "interrupt"
): string {
  return command === "cancel" ? "Cancel" : "Interrupt";
}
