import type { Socket } from "node:net";
import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { connectWebSocket } from "../src/transport/ws";

describe("websocket transport", () => {
  let server: ReturnType<typeof createServer> | null = null;
  const sockets = new Set<Socket>();

  afterEach(async () => {
    for (const socket of sockets) {
      socket.destroy();
    }
    sockets.clear();
    if (!server) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      server?.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
    server = null;
  });

  it("fails instead of hanging when the websocket open handshake stalls", async () => {
    server = createServer();
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => {
        sockets.delete(socket);
      });
    });
    await new Promise<void>((resolve) => {
      server?.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected tcp server port");
    }

    await expect(
      connectWebSocket(`ws://127.0.0.1:${String(address.port)}`, {
        openTimeoutMs: 25,
      })
    ).rejects.toThrow("websocket open timeout after 25ms");
  });
});
