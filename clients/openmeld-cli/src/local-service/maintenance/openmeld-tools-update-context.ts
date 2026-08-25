import { openMeldToolsUpdateRequestSourceSchema } from "@openmeld/schemas";
import type { OpenMeldToolsUpdateRequestSource } from "@openmeld/schemas/types";

const OPERATION_ID_ENV = "OPENMELD_INTERNAL_TOOLS_UPDATE_OPERATION_ID";
const REQUESTED_AT_ENV = "OPENMELD_INTERNAL_TOOLS_UPDATE_REQUESTED_AT";
const REQUEST_SOURCE_ENV = "OPENMELD_INTERNAL_TOOLS_UPDATE_REQUEST_SOURCE";

export type OpenMeldToolsUpdateContext = {
  operationId: string;
  requestedAt: string;
  requestSource: OpenMeldToolsUpdateRequestSource;
};

export function buildOpenMeldToolsUpdateContextEnv(
  context: OpenMeldToolsUpdateContext
): NodeJS.ProcessEnv {
  return {
    [OPERATION_ID_ENV]: context.operationId,
    [REQUESTED_AT_ENV]: context.requestedAt,
    [REQUEST_SOURCE_ENV]: context.requestSource,
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
  };
}

function normalize(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
