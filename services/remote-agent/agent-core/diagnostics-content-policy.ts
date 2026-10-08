/** Only server-owned environment and admitted Organization identity may grant
 * richer diagnostics. Request metadata and public feedback fields are not authority.
 */
export type RemoteAgentDiagnosticsEnv = {
  OPENMELD_WORKER_ENVIRONMENT?: string;
  CLOUDFLARE_OPENMELD_INTERNAL_DIAGNOSTICS_ORGANIZATION_ID?: string;
};

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export function allowsRemoteAgentContentDiagnostics(input: {
  env?: RemoteAgentDiagnosticsEnv;
  organizationId?: string | null;
}): boolean {
  const environment = input.env?.OPENMELD_WORKER_ENVIRONMENT;
  if (
    environment === "local" ||
    environment === "dev" ||
    environment === "stg"
  ) {
    return true;
  }
  const internalOrganizationId =
    input.env?.CLOUDFLARE_OPENMELD_INTERNAL_DIAGNOSTICS_ORGANIZATION_ID;
  return Boolean(
    environment === "prod" &&
      internalOrganizationId &&
      ORGANIZATION_ID_PATTERN.test(internalOrganizationId) &&
      input.organizationId === internalOrganizationId
  );
}

/** Raw provider/RPC errors can echo prompts or private tool results. Preserve
 * correlation at the caller and use the existing credential redactor for rich errors.
 */
export function remoteAgentDiagnosticErrorFields(
  error: unknown,
  input: { env?: RemoteAgentDiagnosticsEnv; organizationId?: string | null }
): { errorName: string; error?: string } {
  const name = error instanceof Error ? error.name : "Error";
  const errorName = [
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "AbortError",
    "TimeoutError",
  ].includes(name)
    ? name
    : "Error";
  if (!allowsRemoteAgentContentDiagnostics(input)) {
    return { errorName };
  }
  const summary = sanitizeDispatchErrorSummary(
    error instanceof Error ? error.message : String(error)
  );
  return { errorName, ...(summary ? { error: summary } : {}) };
}

import { sanitizeDispatchErrorSummary } from "@openmeld/schemas";
