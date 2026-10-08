import { sanitizeDispatchErrorSummary } from "@openmeld/schemas";

/** Only server-owned environment and admitted Organization identity may grant
 * richer diagnostics. Request metadata and public feedback fields are not authority.
 */
export type RemoteAgentDiagnosticsEnv = {
  OPENMELD_WORKER_ENVIRONMENT?: string;
  CLOUDFLARE_OPENMELD_INTERNAL_DIAGNOSTICS_ORGANIZATION_ID?: string;
};

const ORGANIZATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const HTTP_ERROR_STATUS_PATTERN = /^HTTP ([45]\d{2})(?::|\s)/u;

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
): { errorName: string; status?: number; errorCode?: string; error?: string } {
  const name = error instanceof Error ? error.name : "Error";
  const errorName = [
    "Error",
    "TypeError",
    "RangeError",
    "SyntaxError",
    "AbortError",
    "TimeoutError",
    "RateLimitError",
    "AuthenticationError",
    "PermissionDeniedError",
    "APIConnectionError",
    "APITimeoutError",
  ].includes(name)
    ? name
    : "Error";
  const fields: { errorName: string; status?: number; errorCode?: string } = {
    errorName,
  };
  if (error && typeof error === "object") {
    const status =
      Reflect.get(error, "status") ?? Reflect.get(error, "statusCode");
    if (
      typeof status === "number" &&
      Number.isInteger(status) &&
      status >= 400 &&
      status <= 599
    ) {
      fields.status = status;
    }
    const code = Reflect.get(error, "code");
    if (
      typeof code === "string" &&
      [
        "ETIMEDOUT",
        "ECONNRESET",
        "ECONNREFUSED",
        "ENOTFOUND",
        "EAI_AGAIN",
        "UND_ERR_CONNECT_TIMEOUT",
        "UND_ERR_HEADERS_TIMEOUT",
        "EEXEC_LOST",
        "ENOENT",
      ].includes(code)
    ) {
      fields.errorCode = code;
    }
  }
  if (!fields.status && error instanceof Error) {
    const httpStatus = HTTP_ERROR_STATUS_PATTERN.exec(error.message)?.[1];
    if (httpStatus) {
      fields.status = Number(httpStatus);
    }
  }
  if (!allowsRemoteAgentContentDiagnostics(input)) {
    return fields;
  }
  const summary = sanitizeDispatchErrorSummary(
    error instanceof Error ? error.message : String(error)
  );
  return { ...fields, ...(summary ? { error: summary } : {}) };
}
