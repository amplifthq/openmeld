type RpcErrorPayload = {
  code?: string;
  message: string;
};

type RpcHttpErrorFactory = (input: {
  status: number;
  reason?: string;
  code?: string;
}) => Error;

export async function readRpcJsonOrThrow<T>(input: {
  response: Response;
  createHttpError: RpcHttpErrorFactory;
}): Promise<T> {
  const rawBody = (await input.response.text().catch(() => "")).trim();
  if (!input.response.ok) {
    const parsedError = parseRpcErrorPayload(rawBody);
    const reason = parsedError?.message ?? (rawBody ? rawBody : undefined);
    throw input.createHttpError({
      status: input.response.status,
      ...(reason ? { reason } : {}),
      ...(parsedError?.code ? { code: parsedError.code } : {}),
    });
  }

  try {
    return JSON.parse(rawBody) as T;
  } catch (error) {
    const parseMessage =
      error instanceof Error ? error.message : String(error ?? "unknown_error");
    throw input.createHttpError({
      status: input.response.status,
      reason: rawBody
        ? `invalid JSON response (${parseMessage}); raw=${rawBody}`
        : `invalid JSON response (${parseMessage})`,
    });
  }
}

export function parseRpcErrorPayload(rawBody: string): RpcErrorPayload | null {
  if (!rawBody) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }

  return extractRpcErrorPayload(parsed);
}

function extractRpcErrorPayload(value: unknown): RpcErrorPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const object = value as {
    error?: unknown;
    message?: unknown;
    code?: unknown;
  };
  const nested = extractRpcErrorPayload(object.error);
  if (nested) {
    return nested;
  }

  const message =
    typeof object.message === "string" ? object.message.trim() : "";
  if (message.length === 0) {
    return null;
  }

  const code = typeof object.code === "string" ? object.code.trim() : "";
  return {
    message,
    ...(code.length > 0 ? { code } : {}),
  };
}
