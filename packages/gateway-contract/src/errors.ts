import { gatewayErrorEnvelopeSchema } from "@openmeld/schemas";
import type {
  GatewayErrorCode as SharedGatewayErrorCode,
  GatewayErrorEnvelope as SharedGatewayErrorEnvelope,
} from "@openmeld/schemas/types";
import { toErrorMessage as sharedToErrorMessage } from "@openmeld/utils";
import { OPENMELD_HEADER_REQUEST_ID } from "./headers";

export type {
  GatewayErrorCode,
  GatewayErrorEnvelope,
} from "@openmeld/schemas/types";

export function jsonErrorResponse(input: {
  status: number;
  code: SharedGatewayErrorCode;
  message: string;
  requestId: string;
  upstreamCode?: string;
}): Response {
  const payload = gatewayErrorEnvelopeSchema.parse({
    ok: false,
    error: {
      code: input.code,
      message: input.message,
      requestId: input.requestId,
      ...(input.upstreamCode ? { upstreamCode: input.upstreamCode } : {}),
    },
  }) satisfies SharedGatewayErrorEnvelope;

  const response = Response.json(payload, { status: input.status });
  response.headers.set(OPENMELD_HEADER_REQUEST_ID, input.requestId);
  return response;
}

export function wsErrorFrame(input: {
  code: SharedGatewayErrorCode;
  message: string;
  requestId: string;
}): string {
  const payload = gatewayErrorEnvelopeSchema.parse({
    ok: false,
    error: {
      code: input.code,
      message: input.message,
      requestId: input.requestId,
    },
  });

  return JSON.stringify({
    type: "system.error",
    error: payload.error,
  });
}

export function withRequestIdHeader(
  response: Response,
  requestId: string
): Response {
  const headers = new Headers(response.headers);
  headers.set(OPENMELD_HEADER_REQUEST_ID, requestId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function readUpstreamErrorMessage(
  response: Response
): Promise<string> {
  const rawText = await response.text().catch(() => "");
  const text = rawText.trim();
  if (!text) {
    return `upstream_http_${response.status}`;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return text;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return text;
  }

  if (typeof parsed !== "object" || parsed === null) {
    return text;
  }

  const body = parsed as {
    detail?: unknown;
    error?: { message?: unknown } | unknown;
    message?: unknown;
  };

  const nestedMessage =
    typeof body.error === "object" && body.error !== null
      ? String((body.error as { message?: unknown }).message ?? "").trim()
      : "";
  if (nestedMessage) {
    return nestedMessage;
  }

  const errorMessage = typeof body.error === "string" ? body.error.trim() : "";
  if (errorMessage) {
    return errorMessage;
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (message) {
    return message;
  }

  const detail = typeof body.detail === "string" ? body.detail.trim() : "";
  return detail || text;
}

export const toErrorMessage: (err: unknown) => string = sharedToErrorMessage;
