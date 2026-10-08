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
  const sockets = new Map<string, { socket?: WebSocket }>();
  return {
    async open(raw: unknown, emit: (event: DesktopAccountStreamEvent) => void) {
      const request = desktopAccountStreamInputSchema.parse(raw);
      if (sockets.has(request.id)) {
        throw new Error("Account stream is already open.");
      }
      const entry: { socket?: WebSocket } = {};
      sockets.set(request.id, entry);
      try {
        if (input.installed) {
          await input.ensureCompatible();
        }
        if (sockets.get(request.id) !== entry) {
          return;
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
        entry.socket = socket;
        const publish = (event: DesktopAccountStreamEvent) => {
          if (sockets.get(request.id) === entry) {
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
          if (sockets.get(request.id) === entry) {
            sockets.delete(request.id);
          }
        });
      } catch (error) {
        if (sockets.get(request.id) === entry) {
          sockets.delete(request.id);
        }
        throw error;
      }
    },
    ping(raw: unknown) {
      const socket = sockets.get(desktopSpaceStreamIdSchema.parse(raw))?.socket;
      if (socket?.readyState !== WebSocket.OPEN) {
        throw new Error("Account stream is not open.");
      }
      socket.send("ping");
    },
    close(raw: unknown) {
      const id = desktopSpaceStreamIdSchema.parse(raw);
      const entry = sockets.get(id);
      sockets.delete(id);
      entry?.socket?.terminate();
    },
    closeAll() {
      const active = [...sockets.values()];
      sockets.clear();
      for (const entry of active) {
        entry.socket?.terminate();
      }
    },
  };
}
