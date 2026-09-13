import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  SPACE_STREAM_KEEPALIVE_PING,
  SPACE_STREAM_KEEPALIVE_PONG,
} from "@openmeld/protocol";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopSpaceStreamEvent,
} from "@openmeld/schemas";
import { expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { createPilotSpaceStreams } from "../src/main/pilot-space-stream";

const id = "10000000-0000-4000-8000-000000000001";

it("opens only the fixed authenticated Space stream and carries the existing keepalive frames", async () => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await once(server, "listening");
  const streams = createPilotSpaceStreams({
    webOrigin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    webBuild: "a".repeat(64),
    cookie: () => "session=main-only",
  });
  try {
    const connected = once(server, "connection");
    const opened = Promise.withResolvers<void>();
    const received = Promise.withResolvers<string>();
    const emit = (event: DesktopSpaceStreamEvent) => {
      if (event.type === "open") {
        opened.resolve();
      }
      if (event.type === "message") {
        received.resolve(event.data);
      }
    };
    expect(() =>
      streams.open(
        {
          id,
          spaceId: "space-a",
          profileId: "profile-a",
          url: "https://other.invalid",
        },
        emit
      )
    ).toThrow();
    streams.open({ id, spaceId: "space-a", profileId: "profile-a" }, emit);
    const [socket, request] = await connected;
    expect(request.url).toBe("/v1/spaces/space-a/stream?profileId=profile-a");
    expect(request.headers.cookie).toBe("session=main-only");
    expect(request.headers.origin).toBe(DESKTOP_APP_ORIGIN);
    expect(request.headers[DESKTOP_WEB_BUILD_HEADER]).toBe("a".repeat(64));
    await opened.promise;
    const ping = once(socket, "message");
    streams.ping(id);
    expect((await ping)[0].toString()).toBe(SPACE_STREAM_KEEPALIVE_PING);
    socket.send(SPACE_STREAM_KEEPALIVE_PONG);
    expect(await received.promise).toBe(SPACE_STREAM_KEEPALIVE_PONG);
    const closed = once(socket, "close");
    streams.closeAll();
    await closed;
    expect(() => streams.ping(id)).toThrow("not open");
  } finally {
    streams.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("refuses an upgrade redirect without forwarding the authenticated connection", async () => {
  const server = createServer();
  const paths: string[] = [];
  server.on("upgrade", (request, socket) => {
    paths.push(request.url ?? "");
    socket.end(
      "HTTP/1.1 302 Found\r\nLocation: /other-stream\r\nContent-Length: 0\r\n\r\n"
    );
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const streams = createPilotSpaceStreams({
    webOrigin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    webBuild: "a".repeat(64),
    cookie: () => "session=main-only",
  });
  try {
    const closed = Promise.withResolvers<void>();
    const events: string[] = [];
    streams.open(
      { id, spaceId: "space-a", profileId: "profile-a" },
      (event) => {
        events.push(event.type);
        if (event.type === "close") {
          closed.resolve();
        }
      }
    );
    await closed.promise;
    expect(events).toEqual(["error", "close"]);
    expect(paths).toEqual(["/v1/spaces/space-a/stream?profileId=profile-a"]);
  } finally {
    streams.closeAll();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
