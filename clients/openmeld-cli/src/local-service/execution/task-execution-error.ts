import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";
import { toErrorMessage } from "../core/logger";
import {
  DaemonServiceRunError,
  type OpenMeldDaemonTaskErrorType,
} from "../core/types";

const EXECUTION_CONTEXT_ERROR_PATTERN = /^execution_context\.[a-z_]+$/u;

export function toTaskExecutionError(error: unknown): {
  errorCode: string;
  errorType: OpenMeldDaemonTaskErrorType;
  message: string;
  openClawGatewayVisibility?: OpenMeldDaemonTaskResultPayload["openClawGatewayVisibility"];
  projectFailureContext?: OpenMeldDaemonTaskResultPayload["projectFailureContext"];
} {
  if (error instanceof DaemonServiceRunError) {
    return {
      errorCode: error.code,
      errorType: "config",
      message: error.message,
      openClawGatewayVisibility: error.openClawGatewayVisibility,
      projectFailureContext: error.projectFailureContext,
    };
  }
  if (
    error instanceof Error &&
    EXECUTION_CONTEXT_ERROR_PATTERN.test(error.message)
  ) {
    return {
      errorCode: error.message,
      errorType: "config",
      message: error.message,
    };
  }
  return {
    errorCode: "dispatch.execution_failed",
    errorType: "internal",
    message: toErrorMessage(error),
  };
}
