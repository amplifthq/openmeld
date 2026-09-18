import { openMeldToolsUpdateRequestSourceSchema } from "@openmeld/schemas";
import type { OpenMeldToolsUpdateRequestSource } from "@openmeld/schemas/types";

const OPERATION_ID_ENV = "OPENMELD_INTERNAL_TOOLS_UPDATE_OPERATION_ID";
const REQUESTED_AT_ENV = "OPENMELD_INTERNAL_TOOLS_UPDATE_REQUESTED_AT";
const REQUEST_SOURCE_ENV = "OPENMELD_INTERNAL_TOOLS_UPDATE_REQUEST_SOURCE";
const TARGET_CLI_VERSION_ENV =
  "OPENMELD_INTERNAL_TOOLS_UPDATE_TARGET_CLI_VERSION";
const TARGET_SERVICE_VERSION_ENV =
  "OPENMELD_INTERNAL_TOOLS_UPDATE_TARGET_SERVICE_VERSION";

export type OpenMeldToolsUpdateContext = {
  operationId: string;
  requestedAt: string;
  requestSource: OpenMeldToolsUpdateRequestSource;
  targetCliVersion?: string;
  targetServiceVersion?: string;
};

export function buildOpenMeldToolsUpdateContextEnv(
  context: OpenMeldToolsUpdateContext
): NodeJS.ProcessEnv {
  return {
    [OPERATION_ID_ENV]: context.operationId,
    [REQUESTED_AT_ENV]: context.requestedAt,
    [REQUEST_SOURCE_ENV]: context.requestSource,
    ...(context.targetCliVersion
      ? { [TARGET_CLI_VERSION_ENV]: context.targetCliVersion }
      : {}),
    ...(context.targetServiceVersion
      ? { [TARGET_SERVICE_VERSION_ENV]: context.targetServiceVersion }
      : {}),
  };
}

export function readOpenMeldToolsUpdateContextFromEnv(
  env: NodeJS.ProcessEnv = process.env
): OpenMeldToolsUpdateContext | null {
  const operationId = normalize(env[OPERATION_ID_ENV]);
  const requestedAt = normalize(env[REQUESTED_AT_ENV]);
  const requestSource = openMeldToolsUpdateRequestSourceSchema.safeParse(
    env[REQUEST_SOURCE_ENV]
  );
  const targetCliVersion = normalize(env[TARGET_CLI_VERSION_ENV]);
  const targetServiceVersion = normalize(env[TARGET_SERVICE_VERSION_ENV]);
  if (!(operationId && requestedAt && requestSource.success)) {
    return null;
  }
  const requestedAtMs = Date.parse(requestedAt);
  if (!Number.isFinite(requestedAtMs)) {
    return null;
  }
  return {
    operationId,
    requestedAt: new Date(requestedAtMs).toISOString(),
    requestSource: requestSource.data,
    ...(targetCliVersion ? { targetCliVersion } : {}),
    ...(targetServiceVersion ? { targetServiceVersion } : {}),
  };
}

function normalize(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
