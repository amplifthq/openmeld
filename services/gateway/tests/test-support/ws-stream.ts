export type JsonValue = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 2000;

export function decodeEventData(data: unknown): string {
  if (typeof data === "string") {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(
      new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    );
  }
  return "";
}

export function waitForJsonMessage(
  socket: WebSocket,
  predicate: (data: JsonValue) => boolean,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<JsonValue> {
  return new Promise<JsonValue>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, timeoutMs);

    const onMessage = (event: MessageEvent) => {
      const payload = decodeEventData(event.data);
      if (!payload) {
        return;
      }

      let parsed: JsonValue;
      try {
        parsed = JSON.parse(payload) as JsonValue;
      } catch {
        return;
      }

      let matched = false;
      try {
        matched = predicate(parsed);
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }

      if (matched) {
        cleanup();
        resolve(parsed);
      }
    };

    const onClose = () => {
      cleanup();
      reject(new Error("WebSocket closed before receiving message"));
    };

    const onError = (event: Event) => {
      cleanup();
      reject(resolveSocketError(event));
    };

    const cleanup = () => {
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("close", onClose);
      socket.removeEventListener("error", onError);
    };

    socket.addEventListener("message", onMessage);
    socket.addEventListener("close", onClose);
    socket.addEventListener("error", onError);
  });
}

function resolveSocketError(event: Event): Error {
  const errorEvent = event as Event & {
    error?: unknown;
    message?: unknown;
  };
  if (errorEvent.error instanceof Error) {
    return errorEvent.error;
  }
  if (typeof errorEvent.message === "string" && errorEvent.message.length > 0) {
    return new Error(`WebSocket error: ${errorEvent.message}`);
  }
  return new Error("WebSocket error before receiving message");
}
