import {
  OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
  OPENMELD_SPACE_ADDRESSING_VERSION,
} from "@openmeld/gateway-contract";
import { normalizeSpacePasswordText } from "@openmeld/schemas";
import {
  getSpaceAccessPassword,
  getSpaceAccessRequestContext,
  type SpaceAccessContext,
} from "@openmeld/space";
import { createCoreRpcHttpError } from "../../../rpc/errors";
import type { CoreRpcContextInput } from "../../../rpc/methods";
import {
  applyResolvedOpenMeldContextHeaders,
  OPENMELD_HEADER_SPACE_PASSWORD,
} from "../../../shared/context/openmeld-context";
import {
  parseRpcErrorPayload,
  readRpcJsonOrThrow,
} from "../../../shared/rpc/rpc-json";

export type SpaceRpcJsonResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      status: number;
      message: string;
      code?: string;
    };

export function buildSpaceRpcRequest(input: {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  spacePassword?: string;
  query?: Record<string, string | readonly string[]>;
  body?: unknown;
}): Request {
  // This request never leaves the DO process.
  // It is only used to reuse the same HTTP handlers for RPC and HTTP paths.
  const url = new URL(input.path, "https://openmeld-space.internal");
  appendSpaceRpcQuery(url, input.query);
  const headers = buildSpaceRpcHeaders(input);
  headers.set(
    OPENMELD_HEADER_SPACE_ADDRESSING_VERSION,
    OPENMELD_SPACE_ADDRESSING_VERSION
  );
  if (input.body !== undefined) {
    headers.set("content-type", "application/json");
  }

  return new Request(url.toString(), {
    method: input.method,
    headers,
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
}

function appendSpaceRpcQuery(
  url: URL,
  query: Record<string, string | readonly string[]> | undefined
): void {
  if (!query) {
    return;
  }
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") {
      url.searchParams.set(key, value);
      continue;
    }
    for (const item of value) {
      url.searchParams.append(key, item);
    }
  }
}

function buildSpaceRpcHeaders(input: {
  context?: CoreRpcContextInput;
  spaceAccess?: SpaceAccessContext;
  spacePassword?: string;
}): Headers {
  const requestContext = input.spaceAccess
    ? getSpaceAccessRequestContext(input.spaceAccess)
    : (input.context ?? null);
  const headers = requestContext
    ? applyResolvedOpenMeldContextHeaders(new Headers(), {
        context: requestContext,
      })
    : new Headers();
  const spacePassword = input.spaceAccess
    ? getSpaceAccessPassword(input.spaceAccess)
    : input.spacePassword;
  if (spacePassword !== undefined) {
    const normalizedSpacePassword = normalizeSpacePasswordText(spacePassword);
    if (normalizedSpacePassword.length > 0) {
      headers.set(OPENMELD_HEADER_SPACE_PASSWORD, normalizedSpacePassword);
    }
  }
  return headers;
}

export async function readSpaceRpcJsonOrThrow<T>(
  response: Response
): Promise<T> {
  return await readRpcJsonOrThrow<T>({
    response,
    createHttpError: (input) =>
      createCoreRpcHttpError({
        status: input.status,
        ...(input.reason ? { reason: input.reason } : {}),
        ...(input.code ? { code: input.code } : {}),
      }),
  });
}

export async function readSpaceRpcJsonResult<T>(
  response: Response
): Promise<SpaceRpcJsonResult<T>> {
  const rawBody = (await response.text().catch(() => "")).trim();
  if (!response.ok) {
    const parsedError = parseRpcErrorPayload(rawBody);
    return {
      ok: false,
      status: response.status,
      message: parsedError?.message ?? (rawBody ? rawBody : "request failed"),
      ...(parsedError?.code ? { code: parsedError.code } : {}),
    };
  }

  try {
    return {
      ok: true,
      value: JSON.parse(rawBody) as T,
    };
  } catch (error) {
    const parseMessage =
      error instanceof Error ? error.message : String(error ?? "unknown_error");
    return {
      ok: false,
      status: response.status,
      message: rawBody
        ? `invalid JSON response (${parseMessage}); raw=${rawBody}`
        : `invalid JSON response (${parseMessage})`,
    };
  }
}

export function unwrapSpaceRpcJsonResult<T>(result: SpaceRpcJsonResult<T>): T {
  if (result.ok) {
    return result.value;
  }

  throw createCoreRpcHttpError({
    status: result.status,
    reason: result.message,
    ...(result.code ? { code: result.code } : {}),
  });
}
