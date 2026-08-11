import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectWebSocket } from "../src/transport/ws";

const servers: Server[] = [];

describe("connectWebSocket", () => {
  afterEach(async () => {
    vi.unstubAllGlobals();
    await Promise.all(servers.splice(0).map(closeServer));
  });

  it("preserves request evidence when a websocket upgrade is rejected", async () => {
    const body = JSON.stringify({
      ok: false,
      code: "upstream_unreachable",
      message: "core daemon stream upgrade timeout after 15000ms",
      requestId: "req_ws_123",
    });
    const url = await startUpgradeRejectionServer({
      body,
      headers: {
        "cf-ray": "8f00abc123-SJC",
        "content-type": "application/json",
        "x-openmeld-request-id": "req_ws_123",
      },
      status: 502,
    });

    const message = await captureRejectedMessage(
      connectWebSocket(url, { openTimeoutMs: 1000 })
    );

    expect(message).toContain("daemon stream upgrade rejected");
    expect(message).toContain("status=502");
    expect(message).toContain('requestId="req_ws_123"');
    expect(message).toContain('cfRay="8f00abc123-SJC"');
    expect(message).toContain(
      'bodyExcerpt="{\\"ok\\":false,\\"code\\":\\"upstream_unreachable\\"'
    );
  });

  it("falls back to the JSON body request id when the header is missing", async () => {
    const url = await startUpgradeRejectionServer({
      body: JSON.stringify({
        ok: false,
        message: "runtime transport path failed",
        requestId: "req_body_only",
      }),
      headers: {
        "content-type": "application/json",
      },
      status: 500,
    });

    const message = await captureRejectedMessage(
      connectWebSocket(url, { openTimeoutMs: 1000 })
    );

    expect(message).toContain("status=500");
    expect(message).toContain('requestId="req_body_only"');
    expect(message).toContain("runtime transport path failed");
  });

  it("does not register the Node-only unexpected-response listener under Bun", async () => {
    vi.stubGlobal("Bun", {});
    const url = await startUpgradeRejectionServer({
      body: JSON.stringify({
        ok: false,
        message: "runtime transport path failed",
        requestId: "req_bun_runtime",
      }),
      headers: {
        "content-type": "application/json",
      },
      status: 500,
    });

    const message = await captureRejectedMessage(
      connectWebSocket(url, { openTimeoutMs: 1000 })
    );

    expect(message).not.toContain("[bun]");
    expect(message).toContain("Unexpected server response: 500");
  });
});

async function startUpgradeRejectionServer(input: {
  body: string;
  headers: Record<string, string>;
  status: number;
}): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(input.status, input.headers);
    response.end(input.body);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server did not bind to a TCP port");
  }
  return `ws://127.0.0.1:${String(address.port)}/v1/daemon/stream`;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function captureRejectedMessage(
  promise: Promise<unknown>
): Promise<string> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }
  throw new Error("expected websocket connection to be rejected");
}
