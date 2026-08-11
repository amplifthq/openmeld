import { OpenMeldApiClientHttpError } from "@openmeld/api-client";
import { OPENMELD_HEADER_REQUEST_ID } from "@openmeld/gateway-contract";
import { gatewayErrorEnvelopeSchema } from "@openmeld/schemas";
import type { GatewayErrorCode } from "@openmeld/schemas/types";
import { parseJsonResponse } from "./api-json";

const FALLBACK_GATEWAY_HTTP_ERROR_CODE = "gateway.http_error" as const;
const GENERIC_NETWORK_ERROR_CODES = [
  "network.timeout",
  "network.request_failed",
] as const;

type SafeParseResult<T> = { success: true; data: T } | { success: false };

type GatewayResponseSchema<T> = {
  safeParse: (value: unknown) => SafeParseResult<T>;
};

export type GatewayResponseErrorCode =
  | GatewayErrorCode
  | typeof FALLBACK_GATEWAY_HTTP_ERROR_CODE
  | (typeof GENERIC_NETWORK_ERROR_CODES)[number]
  | string;

export type StructuredGatewayFailure = {
  code: GatewayResponseErrorCode | null;
  message: string;
  requestId: string | null;
  status: number | null;
  upstreamCode: string | null;
};

export class GatewayHttpError extends Error {
  readonly code: GatewayResponseErrorCode;
  readonly requestId: string | null;
  readonly status: number;
  readonly rawBody: string;
  readonly upstreamCode: string | null;

  constructor(input: {
    code: GatewayResponseErrorCode;
    message: string;
    requestId?: string | null;
    status: number;
    rawBody: string;
    upstreamCode?: string | null;
  }) {
    super(input.message);
    this.name = "GatewayHttpError";
    this.code = input.code;
    this.requestId = normalizeOptionalText(input.requestId);
    this.status = input.status;
    this.rawBody = input.rawBody;
    this.upstreamCode = normalizeOptionalText(input.upstreamCode);
  }
}

export async function readGatewayJsonResponse<T>(input: {
  response: Response;
  schema: GatewayResponseSchema<T>;
  invalidMessage: string;
}): Promise<T> {
  const raw = await input.response.text();
  assertGatewayResponseOk({
    response: input.response,
    raw,
  });

  const parsed = input.schema.safeParse(parseJsonResponse(raw));
  if (!parsed.success) {
    throw new Error(input.invalidMessage);
  }
  return parsed.data;
}

export async function readGatewayTextResponse(input: {
  response: Response;
}): Promise<string> {
  const raw = await input.response.text();
  assertGatewayResponseOk({
    response: input.response,
    raw,
  });
  return raw;
}

export function assertGatewayResponseOk(input: {
  response: Response;
  raw: string;
}): void {
  if (input.response.ok) {
    return;
  }
  throw parseGatewayErrorResponse(input);
}

export function parseGatewayErrorResponse(input: {
  response: Pick<Response, "headers" | "status">;
  raw: string;
}): GatewayHttpError {
  const payload = parseJsonResponse(input.raw);
  const parsed = gatewayErrorEnvelopeSchema.safeParse(payload);
  const headerRequestId = normalizeOptionalText(
    input.response.headers.get(OPENMELD_HEADER_REQUEST_ID)
  );

  if (parsed.success) {
    return new GatewayHttpError({
      code: parsed.data.error.code,
      message: parsed.data.error.message,
      requestId: parsed.data.error.requestId || headerRequestId,
      status: input.response.status,
      rawBody: input.raw,
      upstreamCode: parsed.data.error.upstreamCode ?? null,
    });
  }

  const looseEnvelope = readLooseGatewayErrorEnvelope(payload);
  if (looseEnvelope) {
    return new GatewayHttpError({
      code: looseEnvelope.code ?? FALLBACK_GATEWAY_HTTP_ERROR_CODE,
      message:
        looseEnvelope.message ??
        `Gateway request failed with HTTP ${input.response.status}.`,
      requestId: looseEnvelope.requestId ?? headerRequestId,
      status: input.response.status,
      rawBody: input.raw,
      upstreamCode: looseEnvelope.upstreamCode,
    });
  }

  return new GatewayHttpError({
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

export function toStructuredGatewayFailure(
  error: unknown
): StructuredGatewayFailure {
  if (error instanceof OpenMeldApiClientHttpError) {
    return {
      code: error.code,
      message: normalizeFailureMessage(error.message),
      requestId: error.requestId,
      status: error.status,
      upstreamCode: error.upstreamCode,
    };
  }

  if (error instanceof GatewayHttpError) {
    return {
      code: error.code,
      message: normalizeFailureMessage(error.message),
      requestId: error.requestId,
      status: error.status,
      upstreamCode: error.upstreamCode,
    };
  }

  const genericErrorCode = readGenericErrorCode(error);
  if (genericErrorCode) {
    return {
      code: genericErrorCode,
      message: normalizeFailureMessage(
        error instanceof Error ? error.message : String(error)
      ),
      requestId: null,
      status: null,
      upstreamCode: null,
    };
  }

  return {
    code: null,
    message: normalizeFailureMessage(
      error instanceof Error ? error.message : String(error)
    ),
    requestId: null,
    status: null,
    upstreamCode: null,
  };
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeFailureMessage(value: unknown): string {
  return normalizeOptionalText(value) ?? "Unknown error.";
}

function readGenericErrorCode(value: unknown): GatewayResponseErrorCode | null {
  if (!value || typeof value !== "object" || !("code" in value)) {
    return null;
  }

  const normalized = normalizeOptionalText(
    (value as { code?: unknown }).code ?? null
  );
  return normalized as GatewayResponseErrorCode | null;
}

function readLooseGatewayErrorEnvelope(value: unknown): {
  code: string | null;
  message: string | null;
  requestId: string | null;
  upstreamCode: string | null;
} | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as {
    error?: {
      code?: unknown;
      message?: unknown;
      requestId?: unknown;
      upstreamCode?: unknown;
    } | null;
  };
  const error = record.error;
  if (!error || typeof error !== "object") {
    return null;
  }

  const code = normalizeOptionalText(error.code);
  const message = normalizeOptionalText(error.message);
  const requestId = normalizeOptionalText(error.requestId);
  const upstreamCode = normalizeOptionalText(error.upstreamCode);
  if (!(code || message || requestId || upstreamCode)) {
    return null;
  }

  return {
    code,
    message,
    requestId,
    upstreamCode,
  };
}
