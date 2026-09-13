import { SPACE_STREAM_KEEPALIVE_PING } from "@openmeld/protocol";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopSpaceStreamEvent,
  desktopSpaceStreamIdSchema,
  desktopSpaceStreamInputSchema,
} from "@openmeld/schemas";
import WebSocket from "ws";

/** Transport only: the shared Web consumer owns reconnect and snapshot refresh. */
export function createPilotSpaceStreams(input: {
  webOrigin: string;
  webBuild: string;
  cookie(): string;
}) {
  const sockets = new Map<string, WebSocket>();
  return {
    open(raw: unknown, emit: (event: DesktopSpaceStreamEvent) => void) {
      const request = desktopSpaceStreamInputSchema.parse(raw);
      if (sockets.has(request.id)) {
        throw new Error("Space stream is already open.");
      }
      const url = new URL(
        `/v1/spaces/${encodeURIComponent(request.spaceId)}/stream`,
        input.webOrigin
      );
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("profileId", request.profileId);
      const socket = new WebSocket(url, {
        followRedirects: false,
        headers: {
          origin: DESKTOP_APP_ORIGIN,
          cookie: input.cookie(),
          [DESKTOP_WEB_BUILD_HEADER]: input.webBuild,
        },
      });
      sockets.set(request.id, socket);
      const publish = (event: DesktopSpaceStreamEvent) => {
        if (sockets.get(request.id) === socket) {
          emit(event);
        }
      };
      socket.on("open", () => publish({ id: request.id, type: "open" }));
      socket.on("message", (data, binary) => {
        if (binary) {
          socket.close(1003, "Space streams require text frames");
          return;
        }
        publish({ id: request.id, type: "message", data: data.toString() });
      });
      socket.on("error", () => publish({ id: request.id, type: "error" }));
      socket.on("close", () => {
        publish({ id: request.id, type: "close" });
        if (sockets.get(request.id) === socket) {
          sockets.delete(request.id);
        }
      });
    },
    ping(raw: unknown) {
      const socket = sockets.get(desktopSpaceStreamIdSchema.parse(raw));
      if (socket?.readyState !== WebSocket.OPEN) {
        throw new Error("Space stream is not open.");
      }
      socket.send(SPACE_STREAM_KEEPALIVE_PING);
    },
    close(raw: unknown) {
      const id = desktopSpaceStreamIdSchema.parse(raw);
      const socket = sockets.get(id);
      sockets.delete(id);
      socket?.terminate();
    },
    closeAll() {
      const active = [...sockets.values()];
      sockets.clear();
      for (const socket of active) {
        socket.terminate();
      }
    },
  };
}
