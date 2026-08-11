import type { OpenMeldDaemonTaskResultPayload } from "@openmeld/schemas/types";
import { toErrorMessage } from "../core/logger";
import {
  DaemonServiceRunError,
  type OpenMeldDaemonTaskErrorType,
} from "../core/types";

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
  return {
    errorCode: "dispatch.execution_failed",
    errorType: "internal",
    message: toErrorMessage(error),
  };
}
