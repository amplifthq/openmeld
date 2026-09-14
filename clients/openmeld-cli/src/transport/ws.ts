import type { IncomingMessage } from "node:http";
import WebSocket from "ws";

export type WsClient = {
  readonly bufferedAmount?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate(): void;
  onMessage(handler: (data: string) => void): void;
  onClose(handler: (code: number, reason: string) => void): void;
  onError(handler: (err: unknown) => void): void;
  waitUntilClosed(): Promise<void>;
};

const MAX_UPGRADE_REJECTION_BODY_BYTES = 2048;
const UPGRADE_REJECTION_BODY_READ_TIMEOUT_MS = 1000;
const OPENMELD_REQUEST_ID_HEADER = "x-openmeld-request-id";
const CLOUDFLARE_RAY_HEADER = "cf-ray";

export async function connectWebSocket(
  url: string,
  input?: { headers?: Record<string, string>; openTimeoutMs?: number }
): Promise<WsClient> {
  return await new Promise((resolve, reject) => {
    let settled = false;
    const ws = new WebSocket(url, {
      headers: input?.headers,
    });
    const openTimeoutMs = normalizeOpenTimeoutMs(input?.openTimeoutMs);
    const openTimeout =
      openTimeoutMs === null
        ? null
        : setTimeout(() => {
            if (settled) {
              return;
            }
            settled = true;
            ws.terminate();
            reject(
              new Error(`websocket open timeout after ${openTimeoutMs}ms`)
            );
          }, openTimeoutMs);
    const closePromise = new Promise<void>((r) => {
      ws.on("close", () => r());
      ws.on("error", () => r());
    });
    ws.on("close", (code, reason) => {
      if (settled) {
        return;
      }
      settled = true;
      if (openTimeout) {
        clearTimeout(openTimeout);
      }
      reject(
        new Error(
          `websocket closed before open (code=${String(code)}, reason=${reason.toString("utf8")})`
        )
      );
    });

    if (!isBunRuntime()) {
      ws.on("unexpected-response", (_request, response) => {
        if (settled) {
          return;
        }
        settled = true;
        if (openTimeout) {
          clearTimeout(openTimeout);
        }
        buildWebSocketUpgradeRejectedError(response)
          .then(reject)
          .catch((error: unknown) =>
            reject(
              new Error(
                `daemon stream upgrade rejected (status=${String(
                  response.statusCode ?? "unknown"
                )}, evidenceReadError=${JSON.stringify(toErrorMessage(error))})`
              )
            )
          );
      });
    }

    ws.on("open", () => {
      if (settled) {
        return;
      }
      settled = true;
      if (openTimeout) {
        clearTimeout(openTimeout);
      }
      resolve({
        get bufferedAmount() {
          return ws.bufferedAmount;
        },
        send: (data) => ws.send(data),
        close: (code, reason) => ws.close(code, reason),
        terminate: () => ws.terminate(),
        onMessage: (handler) => {
          ws.on("message", (buf) => handler(toUtf8(buf)));
        },
        onClose: (handler) => {
          ws.on("close", (code, reason) =>
            handler(code, reason.toString("utf8"))
          );
        },
        onError: (handler) => {
          ws.on("error", handler);
        },
        waitUntilClosed: async () => {
          await closePromise;
        },
      });
    });

    ws.on("error", (err) => {
      if (settled) {
        return;
      }
      settled = true;
      if (openTimeout) {
        clearTimeout(openTimeout);
      }
      reject(err);
    });
  });
}

function isBunRuntime(): boolean {
  return Boolean((globalThis as unknown as { Bun?: unknown }).Bun);
}

function normalizeOpenTimeoutMs(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : null;
}

async function buildWebSocketUpgradeRejectedError(
  response: IncomingMessage
): Promise<Error> {
  const body = await readBodyExcerpt(response);
  const requestId =
    readHeaderValue(response, OPENMELD_REQUEST_ID_HEADER) ??
    readRequestIdFromJsonBody(body.excerpt);
  const cfRay = readHeaderValue(response, CLOUDFLARE_RAY_HEADER);
  const fields = [
    `status=${String(response.statusCode ?? "unknown")}`,
    ...(response.statusMessage
      ? [`statusText=${JSON.stringify(response.statusMessage)}`]
      : []),
    ...(requestId ? [`requestId=${JSON.stringify(requestId)}`] : []),
    ...(cfRay ? [`cfRay=${JSON.stringify(cfRay)}`] : []),
    ...(body.excerpt
      ? [
          `bodyExcerpt=${JSON.stringify(body.excerpt)}${
            body.truncated ? " bodyTruncated=true" : ""
          }`,
        ]
      : []),
  ];
  return new Error(`daemon stream upgrade rejected (${fields.join(", ")})`);
}

function readBodyExcerpt(
  response: IncomingMessage
): Promise<{ excerpt: string; truncated: boolean }> {
  return new Promise((resolve) => {
    let totalBytes = 0;
    let bufferedBytes = 0;
    let done = false;
    const chunks: Buffer[] = [];

    const finish = (): void => {
      if (done) {
        return;
      }
      done = true;
      clearTimeout(timeout);
      response.off("data", onData);
      response.off("end", finish);
      response.off("error", finish);
      response.off("close", finish);

      resolve({
        excerpt: normalizeBodyExcerpt(Buffer.concat(chunks).toString("utf8")),
        truncated: totalBytes > MAX_UPGRADE_REJECTION_BODY_BYTES,
      });
    };

    const onData = (chunk: Buffer | string): void => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_UPGRADE_REJECTION_BODY_BYTES - bufferedBytes;
      if (remaining > 0) {
        const excerptChunk = buffer.subarray(0, remaining);
        chunks.push(excerptChunk);
        bufferedBytes += excerptChunk.byteLength;
      }
      totalBytes += buffer.byteLength;
      if (totalBytes >= MAX_UPGRADE_REJECTION_BODY_BYTES) {
        response.destroy();
        finish();
      }
    };

    const timeout = setTimeout(finish, UPGRADE_REJECTION_BODY_READ_TIMEOUT_MS);

    response.on("data", onData);
    response.on("end", finish);
    response.on("error", finish);
    response.on("close", finish);
  });
}

function readHeaderValue(
  response: IncomingMessage,
  headerName: string
): string | null {
  const value = response.headers[headerName.toLowerCase()];
  if (Array.isArray(value)) {
    return normalizeOptionalText(value[0]);
  }
  return normalizeOptionalText(value);
}

function readRequestIdFromJsonBody(bodyExcerpt: string): string | null {
  if (!bodyExcerpt) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(bodyExcerpt);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "requestId" in parsed
    ) {
      return normalizeOptionalText(parsed.requestId);
    }
  } catch {
    return null;
  }
  return null;
}

function normalizeBodyExcerpt(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizeOptionalText(value: unknown): string | null {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function toUtf8(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof Buffer) {
    return value.toString("utf8");
  }
  if (Array.isArray(value)) {
    return Buffer.concat(value).toString("utf8");
  }
  return String(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
