export type CoreRpcStructuredError = {
  status: number;
  message: string;
  code?: string;
};

const RPC_RECEIVER_METHOD_NOT_IMPLEMENTED_MESSAGE =
  "The RPC receiver does not implement the method";
const HTTP_STYLE_STATUS_PATTERN = /\bHTTP\s+([1-5]\d{2})(?=[:\s]|$)/i;
const TRAILING_PERIOD_PATTERN = /\.$/;
const WRAPPING_DOUBLE_QUOTE_PATTERN = /^"|"$/g;

export function isRpcReceiverMethodNotImplementedError(
  error: unknown
): boolean {
  return (
    error instanceof Error &&
    error.message.includes(RPC_RECEIVER_METHOD_NOT_IMPLEMENTED_MESSAGE)
  );
}

export function isRpcReceiverMethodNotImplementedErrorForMethod(
  error: unknown,
  methodName: string
): boolean {
  if (
    !(
      error instanceof Error &&
      error.message.startsWith(RPC_RECEIVER_METHOD_NOT_IMPLEMENTED_MESSAGE)
    )
  ) {
    return false;
  }
  const receiverMethodName = error.message
    .slice(RPC_RECEIVER_METHOD_NOT_IMPLEMENTED_MESSAGE.length)
    .trim()
    .replace(TRAILING_PERIOD_PATTERN, "")
    .replace(WRAPPING_DOUBLE_QUOTE_PATTERN, "");
  return receiverMethodName === methodName;
}

export function createCoreRpcStructuredError(
  status: number,
  message: string,
  code?: string
): CoreRpcStructuredError {
  return {
    status,
    message,
    ...(code ? { code } : {}),
  };
}

export function toHttpStyleRpcErrorMessage(
  input: CoreRpcStructuredError
): string {
  if (input.code) {
    return `HTTP ${input.status}: ${JSON.stringify({
      ok: false,
      error: {
        code: input.code,
        message: input.message,
      },
    })}`;
  }
  return `HTTP ${input.status}: ${input.message}`;
}

export function createCoreRpcHttpError(input: {
  status: number;
  reason?: string;
  code?: string;
}): Error {
  const reason = input.reason?.trim() ?? "";
  const structured = createCoreRpcStructuredError(
    input.status,
    reason || `upstream_http_${input.status}`,
    input.code
  );

  // Worker RPC can drop custom Error fields at process boundaries. Keep a
  // parseable HTTP-style message so Gateway can still recover the stable code.
  // Structured fields on error.cause remain the primary in-process contract.
  const message = reason
    ? toHttpStyleRpcErrorMessage(
        createCoreRpcStructuredError(input.status, reason, input.code)
      )
    : `HTTP ${input.status}`;

  const error = new Error(message) as Error & {
    cause?: CoreRpcStructuredError;
    code?: string;
    status?: number;
  };
  error.cause = structured;
  error.status = structured.status;
  if (structured.code) {
    error.code = structured.code;
  }
  return error;
}

export function readCoreRpcHttpStatus(error: unknown): number | null {
  const visited = new Set<unknown>();
  let current = error;
  for (let depth = 0; depth < 4 && current !== null; depth += 1) {
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);

    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      const status = record.status;
      if (
        typeof status === "number" &&
        Number.isInteger(status) &&
        status >= 100 &&
        status <= 599
      ) {
        return status;
      }
      const messageStatus = readHttpStyleStatus(record.message);
      if (messageStatus !== null) {
        return messageStatus;
      }
      current = record.cause ?? null;
      continue;
    }

    const messageStatus = readHttpStyleStatus(current);
    if (messageStatus !== null) {
      return messageStatus;
    }
    return null;
  }
  return null;
}

function readHttpStyleStatus(value: unknown): number | null {
  if (typeof value !== "string") {
    return null;
  }
  const match = HTTP_STYLE_STATUS_PATTERN.exec(value);
  return match?.[1] ? Number(match[1]) : null;
}
