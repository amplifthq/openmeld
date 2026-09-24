import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopAccountStreamEvent,
  desktopAccountStreamInputSchema,
  desktopSpaceStreamIdSchema,
} from "@openmeld/schemas";
import WebSocket from "ws";

export function createPilotAccountStreams(input: {
  webOrigin: string;
  webBuild: string;
  cookie(): string;
  installed: boolean;
  ensureCompatible(): Promise<void>;
}) {
  const sockets = new Map<string, WebSocket>();
  return {
    async open(raw: unknown, emit: (event: DesktopAccountStreamEvent) => void) {
      const request = desktopAccountStreamInputSchema.parse(raw);
      if (sockets.has(request.id)) {
        throw new Error("Account stream is already open.");
      }
      if (input.installed) {
        await input.ensureCompatible();
      }
      const url = new URL("/v1/account/invalidation-stream", input.webOrigin);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.searchParams.set("organizationId", request.organizationId);
      const socket = new WebSocket(url, {
        followRedirects: false,
        headers: {
          origin: DESKTOP_APP_ORIGIN,
          cookie: input.cookie(),
          [input.installed
            ? DESKTOP_CONTRACT_HEADER
            : DESKTOP_WEB_BUILD_HEADER]: input.installed
            ? DESKTOP_CONTRACT_VERSION
            : input.webBuild,
        },
      });
      sockets.set(request.id, socket);
      const publish = (event: DesktopAccountStreamEvent) => {
        if (sockets.get(request.id) === socket) {
          emit(event);
        }
      };
      socket.on("open", () => publish({ id: request.id, type: "open" }));
      socket.on("message", (data, binary) => {
        if (binary) {
          socket.close(1003, "Only text frames are accepted");
          return;
        }
        publish({ id: request.id, type: "message", data: data.toString() });
      });
      socket.on("error", () => publish({ id: request.id, type: "error" }));
      socket.on("close", (code, reason) => {
        publish({
          id: request.id,
          type: "close",
          code,
          reason: reason.toString(),
        });
        if (sockets.get(request.id) === socket) {
          sockets.delete(request.id);
        }
      });
    },
    ping(raw: unknown) {
      const socket = sockets.get(desktopSpaceStreamIdSchema.parse(raw));
      if (socket?.readyState !== WebSocket.OPEN) {
        throw new Error("Account stream is not open.");
      }
      socket.send("ping");
    },
    close(raw: unknown) {
      const id = desktopSpaceStreamIdSchema.parse(raw);
      const socket = sockets.get(id);
      sockets.delete(id);
      socket?.terminate();
    },
    closeAll() {
      for (const socket of sockets.values()) {
        socket.terminate();
      }
      sockets.clear();
    },
  };
}
