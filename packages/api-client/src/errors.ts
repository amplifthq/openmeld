import { OPENMELD_HEADER_REQUEST_ID } from "@openmeld/gateway-contract";
import {
  gatewayErrorCodeSchema,
  gatewayErrorEnvelopeSchema,
} from "@openmeld/schemas";
import type { GatewayErrorCode } from "@openmeld/schemas/types";

const FALLBACK_GATEWAY_HTTP_ERROR_CODE = "gateway.http_error" as const;
const INVALID_RESPONSE_ERROR_CODE = "gateway.invalid_response" as const;
const GENERIC_NETWORK_ERROR_CODES = [
  "network.timeout",
  "network.request_failed",
] as const;
const KNOWN_API_CLIENT_ERROR_CODES = new Set<string>([
  ...gatewayErrorCodeSchema.options,
  FALLBACK_GATEWAY_HTTP_ERROR_CODE,
  INVALID_RESPONSE_ERROR_CODE,
  ...GENERIC_NETWORK_ERROR_CODES,
]);

type ApiClientHttpErrorCode =
  | GatewayErrorCode
  | typeof FALLBACK_GATEWAY_HTTP_ERROR_CODE
  | typeof INVALID_RESPONSE_ERROR_CODE
  | (typeof GENERIC_NETWORK_ERROR_CODES)[number];

export type StructuredApiClientFailure = {
  code: ApiClientHttpErrorCode | null;
  message: string;
  requestId: string | null;
  status: number | null;
  upstreamCode: string | null;
  schemaIssueMessage?: string | null;
  schemaIssuePath?: string | null;
};

type ApiClientSchemaIssue = {
  message?: unknown;
  path?: readonly unknown[];
};

export class OpenMeldApiClientHttpError extends Error {
  readonly code: ApiClientHttpErrorCode;
  readonly requestId: string | null;
  readonly status: number;
  readonly rawBody: string;
  readonly upstreamCode: string | null;

  constructor(input: {
    code: ApiClientHttpErrorCode;
    message: string;
    requestId?: string | null;
    status: number;
    rawBody: string;
    upstreamCode?: string | null;
  }) {
    super(input.message);
    this.name = "OpenMeldApiClientHttpError";
    this.code = input.code;
    this.requestId = normalizeOptionalText(input.requestId);
    this.status = input.status;
    this.rawBody = input.rawBody;
    this.upstreamCode = normalizeOptionalText(input.upstreamCode);
  }
}

export class OpenMeldApiClientInvalidResponseError extends Error {
  readonly code = INVALID_RESPONSE_ERROR_CODE;
  readonly operation: string;
  readonly requestId: string | null;
  readonly status: number;
  readonly rawBody: string;
  readonly schemaIssueMessage: string | null;
  readonly schemaIssuePath: string | null;
  readonly upstreamCode = null;

  constructor(input: {
    message: string;
    operation: string;
    requestId?: string | null;
    status: number;
    rawBody: string;
    schemaIssue?: ApiClientSchemaIssue | null;
  }) {
    super(input.message);
    this.name = "OpenMeldApiClientInvalidResponseError";
    this.operation = input.operation;
    this.requestId = normalizeOptionalText(input.requestId);
    this.status = input.status;
    this.rawBody = input.rawBody;
    this.schemaIssueMessage = normalizeOptionalText(input.schemaIssue?.message);
    this.schemaIssuePath = formatSchemaIssuePath(input.schemaIssue);
  }
}

export function toStructuredApiClientFailure(
  error: unknown
): StructuredApiClientFailure {
  if (error instanceof OpenMeldApiClientHttpError) {
    return {
      code: error.code,
      message: normalizeFailureMessage(error.message),
      requestId: error.requestId,
      status: error.status,
      upstreamCode: error.upstreamCode,
    };
  }

  if (error instanceof OpenMeldApiClientInvalidResponseError) {
    return withInvalidResponseDiagnostics(
      {
        code: error.code,
        message: normalizeFailureMessage(error.message),
        requestId: error.requestId,
        status: error.status,
        upstreamCode: null,
      },
      {
        schemaIssueMessage: error.schemaIssueMessage,
        schemaIssuePath: error.schemaIssuePath,
      }
    );
  }

  const genericErrorCode = readGenericErrorCode(error);
  return withInvalidResponseDiagnostics(
    {
      code: genericErrorCode,
      message: normalizeFailureMessage(readFailureMessage(error)),
      requestId: readOptionalObjectTextField(error, "requestId"),
      status: readOptionalObjectStatus(error),
      upstreamCode: readOptionalObjectTextField(error, "upstreamCode"),
    },
    {
      schemaIssueMessage: readOptionalObjectTextField(
        error,
        "schemaIssueMessage"
      ),
      schemaIssuePath: readOptionalObjectTextField(error, "schemaIssuePath"),
    }
  );
}

export function attachApiClientRequestDetails(
  error: unknown,
  input: { operation: string; requestId: string }
): void {
  if (error instanceof Error) {
    Object.assign(error, {
      operation: input.operation,
      requestId:
        toStructuredApiClientFailure(error).requestId ?? input.requestId,
    });
  }
}

export function readApiClientTextResponse(input: {
  response: Response;
}): Promise<string> {
  return input.response.text().then((raw) => {
    assertApiClientResponseOk({
      response: input.response,
      raw,
    });
    return raw;
  });
}

export async function readApiClientJsonResponse<T>(input: {
  response: Response;
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          error?: { issues?: readonly ApiClientSchemaIssue[] };
          success: false;
        };
  };
  invalidMessage: string;
  operation: string;
}): Promise<T> {
  let raw: string;
  try {
    raw = await input.response.text();
  } catch (error) {
    const bodyReadError = new Error(toErrorMessage(error), {
      cause: error,
    }) as Error & { code?: string; status?: number };
    bodyReadError.code = "network.request_failed";
    bodyReadError.status = input.response.status;
    throw bodyReadError;
  }
  assertApiClientResponseOk({
    response: input.response,
    raw,
  });

  const parsed = input.schema.safeParse(parseJsonResponse(raw));
  if (!parsed.success) {
    throw new OpenMeldApiClientInvalidResponseError({
      message: input.invalidMessage,
      operation: input.operation,
      requestId: input.response.headers.get(OPENMELD_HEADER_REQUEST_ID),
      status: input.response.status,
      rawBody: raw,
      schemaIssue: parsed.error?.issues?.[0] ?? null,
    });
  }
  return parsed.data;
}

function assertApiClientResponseOk(input: {
  response: Pick<Response, "ok" | "headers" | "status">;
  raw: string;
}): void {
  if (input.response.ok) {
    return;
  }
  throw parseApiClientErrorResponse(input);
}

function parseApiClientErrorResponse(input: {
  response: Pick<Response, "headers" | "status">;
  raw: string;
}): OpenMeldApiClientHttpError {
  const parsed = gatewayErrorEnvelopeSchema.safeParse(
    parseJsonResponse(input.raw)
  );
  const headerRequestId = normalizeOptionalText(
    input.response.headers.get(OPENMELD_HEADER_REQUEST_ID)
  );

  if (parsed.success) {
    return new OpenMeldApiClientHttpError({
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      requestId: parsed.data.error.requestId || headerRequestId,
      status: input.response.status,
      rawBody: input.raw,
      upstreamCode: parsed.data.error.upstreamCode ?? null,
    });
  }

  return new OpenMeldApiClientHttpError({
    code: FALLBACK_GATEWAY_HTTP_ERROR_CODE,
    message:
      normalizeOptionalText(input.raw) ??
      `Gateway request failed with HTTP ${input.response.status}.`,
    requestId: headerRequestId,
    status: input.response.status,
    rawBody: input.raw,
    upstreamCode: null,
  });
}

function parseJsonResponse(raw: string): unknown {
  if (!raw.trim()) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return normalizeOptionalText(error.message) ?? error.name;
  }
  return normalizeOptionalText(error) ?? "request failed";
}

function formatSchemaIssuePath(
  issue: ApiClientSchemaIssue | null | undefined
): string | null {
  const path = issue?.path;
  if (!path || path.length === 0) {
    return null;
  }
  return path.map((part) => String(part)).join(".");
}

function withInvalidResponseDiagnostics(
  failure: StructuredApiClientFailure,
  diagnostics: {
    schemaIssueMessage: string | null;
    schemaIssuePath: string | null;
  }
): StructuredApiClientFailure {
  if (!(diagnostics.schemaIssueMessage || diagnostics.schemaIssuePath)) {
    return failure;
  }
  return {
    ...failure,
    schemaIssueMessage: diagnostics.schemaIssueMessage,
    schemaIssuePath: diagnostics.schemaIssuePath,
  };
}

function normalizeFailureMessage(value: unknown): string {
  return normalizeOptionalText(value) ?? "Unknown error.";
}

function readFailureMessage(value: unknown): string | null {
  if (value instanceof Error) {
    return normalizeOptionalText(value.message);
  }

  if (typeof value === "string") {
    return normalizeOptionalText(value);
  }

  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    return typeof message === "string" ? normalizeOptionalText(message) : null;
  }

  if (value === null || value === undefined || typeof value === "object") {
    return null;
  }

  return normalizeOptionalText(value);
}

function readOptionalObjectTextField(
  value: unknown,
  fieldName:
    | "requestId"
    | "schemaIssueMessage"
    | "schemaIssuePath"
    | "upstreamCode"
): string | null {
  if (!value || typeof value !== "object" || !(fieldName in value)) {
    return null;
  }

  const fieldValue = (value as Record<typeof fieldName, unknown>)[fieldName];
  return typeof fieldValue === "string"
    ? normalizeOptionalText(fieldValue)
    : null;
}

function readOptionalObjectStatus(value: unknown): number | null {
  if (!value || typeof value !== "object" || !("status" in value)) {
    return null;
  }

  const status = (value as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function readGenericErrorCode(value: unknown): ApiClientHttpErrorCode | null {
  if (!value || typeof value !== "object" || !("code" in value)) {
    return null;
  }

  const normalized = normalizeOptionalText(
    (value as { code?: unknown }).code ?? null
  );
  if (!(normalized && KNOWN_API_CLIENT_ERROR_CODES.has(normalized))) {
    return null;
  }
  return normalized as ApiClientHttpErrorCode;
}
