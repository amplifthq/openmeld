import { DurableObject } from "cloudflare:workers";
import type { AccountInvalidationFrame } from "@openmeld/schemas";
import type { CoreBindings } from "../lib/bindings";

const PING = "ping";
const PONG = "pong";

/** One hibernating connection group per account and Organization. */
export class AccountInvalidationHub extends DurableObject<CoreBindings> {
  constructor(ctx: DurableObjectState, env: CoreBindings) {
    super(ctx, env);
    // Keep idle proxy connections alive without waking the object.
    this.ctx.setWebSocketAutoResponse(
      // biome-ignore lint/correctness/noUndeclaredVariables: Provided by Workers.
      new WebSocketRequestResponsePair(PING, PONG)
    );
  }

  fetch(request: Request): Response {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected WebSocket", { status: 400 });
    }
    // biome-ignore lint/correctness/noUndeclaredVariables: Provided by Workers.
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  notify(frame: AccountInvalidationFrame): void {
    const payload = JSON.stringify(frame);
    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(payload);
      } catch {
        socket.close(1011, "Delivery failed");
      }
    }
  }

  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): void {
    if (message !== PING) {
      socket.close(1003, "Only keepalive pings are accepted");
    }
  }
}
