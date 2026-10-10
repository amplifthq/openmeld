const RPC_RECEIVER_METHOD_NOT_IMPLEMENTED_MESSAGE =
  "The RPC receiver does not implement the method";
const TRAILING_PERIOD_PATTERN = /\.$/;
const WRAPPING_DOUBLE_QUOTE_PATTERN = /^"|"$/g;
const HTTP_STYLE_RPC_ERROR_PATTERN = /^HTTP\s+\d{3}:\s*(\{[\s\S]*\})\s*$/u;

/** Core preserves this envelope in Error.message across Worker RPC. */
export function readCoreRpcErrorCode(error: unknown): string | null {
  if (!(error instanceof Error)) {
    return null;
  }
  const cause = error.cause;
  if (
    cause &&
    typeof cause === "object" &&
    "code" in cause &&
    typeof cause.code === "string"
  ) {
    return cause.code;
  }
  const match = HTTP_STYLE_RPC_ERROR_PATTERN.exec(error.message);
  if (!match?.[1]) {
    return null;
  }
  try {
    const envelope: unknown = JSON.parse(match[1]);
    if (envelope && typeof envelope === "object" && "error" in envelope) {
      const detail = envelope.error;
      if (
        detail &&
        typeof detail === "object" &&
        "code" in detail &&
        typeof detail.code === "string"
      ) {
        return detail.code;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function requireCoreRpc<T extends (input: unknown) => Promise<unknown>>(
  rpc: T | undefined,
  name: string
): T {
  if (!rpc) {
    throw coreRpcUnavailableError(name);
  }
  return (async (input: unknown) => {
    try {
      return await rpc(input);
    } catch (error) {
      if (isRpcReceiverMethodNotImplementedError(error, name)) {
        throw coreRpcUnavailableError(name);
      }
      throw error;
    }
  }) as T;
}

export async function callCoreRpc<TBinding extends object, TInput, TOutput>(
  binding: TBinding | undefined,
  name: string,
  input: TInput,
  invoke: (binding: TBinding, input: TInput) => Promise<TOutput> | undefined
): Promise<TOutput> {
  if (!binding) {
    throw coreRpcUnavailableError(name);
  }
  try {
    const result = invoke(binding, input);
    if (!result) {
      throw coreRpcUnavailableError(name);
    }
    return await result;
  } catch (error) {
    if (isRpcReceiverMethodNotImplementedError(error, name)) {
      throw coreRpcUnavailableError(name);
    }
    throw error;
  }
}

export function isRpcReceiverMethodNotImplementedError(
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
  const receiverMethod = error.message
    .slice(RPC_RECEIVER_METHOD_NOT_IMPLEMENTED_MESSAGE.length)
    .trim()
    .replace(TRAILING_PERIOD_PATTERN, "")
    .replace(WRAPPING_DOUBLE_QUOTE_PATTERN, "");
  return receiverMethod === methodName;
}

function coreRpcUnavailableError(name: string): Error {
  const message = `OpenMeld Core RPC ${name} is unavailable.`;
  return new Error(message, {
    cause: {
      code: "core.rpc.unavailable",
      message,
      status: 503,
    },
  });
}
