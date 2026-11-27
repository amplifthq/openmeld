// Shared rules for Gateway routes that forward a WebSocket upgrade to Core.

// Core must answer an upgrade well inside the client's own connect timeout so
// a stalled upstream becomes an explicit rejection the client can retry.
export const UPSTREAM_WEBSOCKET_UPGRADE_TIMEOUT_MS = 15_000;

// A Close frame carries at most 123 bytes of UTF-8 reason text.
const MAX_CLOSE_REASON_BYTES = 123;
// Codes a close event can report but a Close frame must never carry: no status
// received (1005), abnormal closure (1006), and the other reserved values.
const RESERVED_CLOSE_CODES = new Set([1004, 1005, 1006, 1015]);
const RELAY_FAILURE_CLOSE_CODE = 1011;

export class UpstreamWebSocketUpgradeTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamWebSocketUpgradeTimeoutError";
  }
}

// Maps the code observed on one side of a relay to a code that can be written
// to the other side. An abnormal or codeless closure is relayed as 1011 so the
// peer still receives a real Close frame instead of a socket that stays open.
export function toSendableCloseCode(code: number): number {
  if (
    !Number.isInteger(code) ||
    code < 1000 ||
    code > 4999 ||
    RESERVED_CLOSE_CODES.has(code)
  ) {
    return RELAY_FAILURE_CLOSE_CODE;
  }
  return code;
}

export function toSendableCloseReason(reason: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(reason).byteLength <= MAX_CLOSE_REASON_BYTES) {
    return reason;
  }
  let truncated = "";
  let byteLength = 0;
  for (const character of reason) {
    byteLength += encoder.encode(character).byteLength;
    if (byteLength > MAX_CLOSE_REASON_BYTES) {
      break;
    }
    truncated += character;
  }
  return truncated;
}

// Closes one side of a relay with a code and reason that are always valid on
// the wire. Returns false only when the socket was already closed.
export function closeRelayedWebSocket(
  webSocket: WebSocket,
  code: number,
  reason: string
): boolean {
  try {
    webSocket.close(toSendableCloseCode(code), toSendableCloseReason(reason));
    return true;
  } catch {
    return false;
  }
}

// Forwards a WebSocket upgrade to Core and bounds how long Core may take to
// answer. On timeout the upstream request is aborted and the returned promise
// rejects with UpstreamWebSocketUpgradeTimeoutError.
export async function fetchUpstreamWebSocketUpgrade(input: {
  fetchUpstream: (request: Request) => Response | Promise<Response>;
  headers: Headers;
  timeoutMessage: string;
  timeoutMs?: number;
  url: string;
}): Promise<Response> {
  const timeoutMs = input.timeoutMs ?? UPSTREAM_WEBSOCKET_UPGRADE_TIMEOUT_MS;
  const abortController = new AbortController();
  const request = new Request(input.url, {
    method: "GET",
    headers: input.headers,
    signal: abortController.signal,
  });
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      Promise.resolve().then(() => input.fetchUpstream(request)),
      new Promise<Response>((_, reject) => {
        timeoutId = setTimeout(() => {
          const error = new UpstreamWebSocketUpgradeTimeoutError(
            input.timeoutMessage
          );
          abortController.abort(error);
          reject(error);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }
}
