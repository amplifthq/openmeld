import { SPACE_STREAM_KEEPALIVE_PING } from "@openmeld/protocol";
import {
  DESKTOP_APP_ORIGIN,
  DESKTOP_CONTRACT_HEADER,
  DESKTOP_CONTRACT_VERSION,
  DESKTOP_WEB_BUILD_HEADER,
  type DesktopSpaceStreamEvent,
  desktopSpaceStreamIdSchema,
  desktopSpaceStreamInputSchema,
} from "@openmeld/schemas";
import WebSocket from "ws";
import type { TransportObservation } from "./transport-diagnostics";

/** Transport only: the shared Web consumer owns reconnect and snapshot refresh. */
export function createPilotSpaceStreams(input: {
  webOrigin: string;
  webBuild: string;
  cookie(): string;
  installed?: boolean;
  ensureCompatible?: () => Promise<void>;
  observe?: (event: TransportObservation) => void;
}) {
  const sockets = new Map<string, { socket?: WebSocket; spaceId: string }>();
  return {
    open(raw: unknown, emit: (event: DesktopSpaceStreamEvent) => void) {
      const request = desktopSpaceStreamInputSchema.parse(raw);
      if (sockets.has(request.id)) {
        throw new Error("Space stream is already open.");
      }
      const entry: { socket?: WebSocket; spaceId: string } = {
        spaceId: request.spaceId,
      };
      sockets.set(request.id, entry);
      const connect = () => {
        if (sockets.get(request.id) !== entry) {
          return;
        }
        const url = new URL(
          `/v1/spaces/${encodeURIComponent(request.spaceId)}/stream`,
          input.webOrigin
        );
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.searchParams.set("profileId", request.profileId);
        input.observe?.({
          kind: "stream",
          spaceId: request.spaceId,
          event: "connecting",
        });
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
        const publish = (event: DesktopSpaceStreamEvent) => {
          if (sockets.get(request.id) === entry) {
            emit(event);
          }
        };
        socket.on("open", () => {
          input.observe?.({
            kind: "stream",
            spaceId: request.spaceId,
            event: "open",
          });
          publish({ id: request.id, type: "open" });
        });
        socket.on("message", (data, binary) => {
          if (binary) {
            socket.close(1003, "Space streams require text frames");
            return;
          }
          publish({ id: request.id, type: "message", data: data.toString() });
        });
        socket.on("error", () => {
          input.observe?.({
            kind: "stream",
            spaceId: request.spaceId,
            event: "error",
          });
          publish({ id: request.id, type: "error" });
        });
        socket.on("close", (code, reason) => {
          input.observe?.({
            kind: "stream",
            spaceId: request.spaceId,
            event: "close",
            code,
          });
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
      };
      if (!input.installed) {
        return connect();
      }
      if (!input.ensureCompatible) {
        sockets.delete(request.id);
        throw new Error("Desktop compatibility admission is unavailable.");
      }
      return input
        .ensureCompatible()
        .then(connect)
        .catch((error: unknown) => {
          input.observe?.({
            kind: "stream",
            spaceId: request.spaceId,
            event: "admission",
          });
          if (sockets.get(request.id) === entry) {
            sockets.delete(request.id);
          }
          throw error;
        });
    },
    ping(raw: unknown) {
      const socket = sockets.get(desktopSpaceStreamIdSchema.parse(raw))?.socket;
      if (socket?.readyState !== WebSocket.OPEN) {
        throw new Error("Space stream is not open.");
      }
      socket.send(SPACE_STREAM_KEEPALIVE_PING);
    },
    close(raw: unknown) {
      const id = desktopSpaceStreamIdSchema.parse(raw);
      const entry = sockets.get(id);
      sockets.delete(id);
      if (entry) {
        input.observe?.({
          kind: "stream",
          spaceId: entry.spaceId,
          event: "cancelled",
        });
      }
      entry?.socket?.terminate();
    },
    closeAll() {
      const active = [...sockets.values()];
      sockets.clear();
      for (const entry of active) {
        input.observe?.({
          kind: "stream",
          spaceId: entry.spaceId,
          event: "cancelled",
        });
        entry.socket?.terminate();
      }
    },
  };
}
