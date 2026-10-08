import { DurableObject } from "cloudflare:workers";
import {
  getPostgresDatabase,
  type PostgresDatabase,
  withPostgresRequest,
} from "@openmeld/db/postgresql";
import {
  PREPARE_SESSION_STREAM_PROTOCOL_VERSION,
  prepareSessionStreamClientFrameSchema,
  prepareSessionStreamServerFrameSchema,
} from "@openmeld/schemas";
import type {
  PrepareSessionSnapshot,
  PrepareSessionStreamClientFrame,
  PrepareSessionStreamRole,
  PrepareSessionStreamServerFrame,
} from "@openmeld/schemas/types";
import type { CoreBindings } from "../../../lib/bindings";
import {
  disconnectPrepareTerminalConnectionUseCase,
  PrepareSessionRevisionConflictError,
  PrepareSessionTerminalConnectionStaleError,
  readPrepareSessionSnapshotUseCase,
  registerPrepareTerminalConnectionUseCase,
  writeTerminalAgentSelectionUseCase,
  writeTerminalLocalAgentCatalogUseCase,
  writeTerminalStepUseCase,
  writeWebAgentSelectionUseCase,
} from "../../application/prepare-session-service";
import {
  PREPARE_SESSION_HUB_ROLE_HEADER,
  PREPARE_SESSION_HUB_SESSION_ID_HEADER,
  readPrepareSessionHubSocketAttachment,
  writePrepareSessionHubSocketAttachment,
} from "../../infrastructure/prepare-session-hub-socket-attachment";

type AcceptableWebSocket = WebSocket & {
  accept(): void;
};
type AcceptableWebSocketPair = [WebSocket, AcceptableWebSocket];
const createWebSocketPair = (): AcceptableWebSocketPair => {
  const WebSocketPairConstructor = (
    globalThis as typeof globalThis & {
      WebSocketPair: new () => AcceptableWebSocketPair;
    }
  ).WebSocketPair;
  return new WebSocketPairConstructor();
};
export class PrepareSessionHub extends DurableObject<CoreBindings> {
  private readonly activeTerminalBindings = new Map<
    string,
    {
      connectionEpoch: number;
      lastProgressSequence: number | null;
    }
  >();
  private readonly latestConnectionProgress = new Map<
    string,
    Extract<
      PrepareSessionStreamServerFrame,
      {
        type: "connection_progress";
      }
    >["payload"]
  >();
  fetch(request: Request): Promise<Response> {
    return Promise.resolve(this.handleFetch(request));
  }
  async webSocketMessage(
    webSocket: WebSocket,
    rawMessage: string | ArrayBuffer
  ): Promise<void> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      const attachment = readPrepareSessionHubSocketAttachment(webSocket);
      if (!(attachment.prepareSessionId && attachment.role)) {
        this.sendErrorFrame(webSocket, {
          code: "prepare.session.socket_unverified",
          message: "Socket is not attached to a prepare session.",
        });
        safeCloseSocket(webSocket, 1008, "prepare_session_socket_unverified");
        return;
      }
      const frame = parseClientFrame(rawMessage);
      if (!frame) {
        this.sendErrorFrame(webSocket, {
          code: "prepare.session.protocol_mismatch",
          message:
            "This OpenMeld CLI does not match the current setup protocol. Update OpenMeld, copy a fresh Agent Interface prompt, and run setup again.",
        });
        return;
      }
      await this.handleClientFrame(
        webSocket,
        {
          prepareSessionId: attachment.prepareSessionId,
          connectionEpoch: attachment.connectionEpoch ?? undefined,
          role: attachment.role,
        },
        frame
      );
    });
  }
  async webSocketClose(webSocket: WebSocket): Promise<void> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      await this.handleSocketClosed(webSocket, "socket_closed");
    });
  }
  async webSocketError(webSocket: WebSocket): Promise<void> {
    return await withPostgresRequest(this.env.OPENMELD_POSTGRESQL, async () => {
      await this.handleSocketClosed(webSocket, "socket_error");
    });
  }
  private async handleFetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/stream") {
      return Response.json(
        {
          ok: false,
          code: "not_found",
          message: "prepare session hub path not found",
        },
        { status: 404 }
      );
    }
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("expected websocket", { status: 400 });
    }
    const prepareSessionId = normalizeOptionalText(
      request.headers.get(PREPARE_SESSION_HUB_SESSION_ID_HEADER)
    );
    const role = normalizeRole(
      request.headers.get(PREPARE_SESSION_HUB_ROLE_HEADER)
    );
    if (!(prepareSessionId && role)) {
      return new Response("missing prepare session stream identity", {
        status: 400,
      });
    }
    const [client, server] = createWebSocketPair();
    this.ctx.acceptWebSocket(server);
    writePrepareSessionHubSocketAttachment(server, {
      prepareSessionId,
      role,
    });
    const snapshot = await this.loadSnapshot(prepareSessionId);
    const connectedSnapshot =
      role === "terminal"
        ? await this.replaceActiveTerminal(server, snapshot)
        : snapshot;
    this.syncTerminalBinding(connectedSnapshot);
    this.sendSnapshot(server, connectedSnapshot, "snapshot");
    this.sendFrame(server, {
      type: "server.capabilities",
      payload: { connectionProgress: 1 },
    });
    if (role === "web") {
      const progress = this.latestConnectionProgress.get(prepareSessionId);
      if (progress) {
        this.sendFrame(server, {
          type: "connection_progress",
          payload: progress,
        });
      }
    }
    if (role === "terminal") {
      this.broadcastSnapshot(connectedSnapshot, server);
    }
    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }
  private async handleClientFrame(
    webSocket: WebSocket,
    attachment: {
      connectionEpoch?: number;
      prepareSessionId: string;
      role: PrepareSessionStreamRole;
    },
    frame: PrepareSessionStreamClientFrame
  ): Promise<void> {
    if (frame.type === "client.ping") {
      this.sendFrame(webSocket, {
        type: "server.pong",
        payload: {
          sentAt: new Date().toISOString(),
        },
      });
      return;
    }
    if (frame.type === "client.hello") {
      if (
        frame.payload.protocolVersion !==
        PREPARE_SESSION_STREAM_PROTOCOL_VERSION
      ) {
        this.sendErrorFrame(webSocket, {
          code: "prepare.session.protocol_mismatch",
          message:
            "This OpenMeld CLI does not match the current setup protocol. Update OpenMeld, copy a fresh Agent Interface prompt, and run setup again.",
        });
      }
      return;
    }
    if (
      (frame.type === "terminal.step.write" ||
        frame.type === "terminal.connection_progress.write" ||
        frame.type === "terminal.local_agent_catalog.write" ||
        frame.type === "terminal.agent_selection.write") &&
      attachment.role !== "terminal"
    ) {
      this.sendErrorFrame(webSocket, {
        code: "prepare.session.role_mismatch",
        message: "Only Terminal can write Terminal setup state.",
      });
      return;
    }
    if (
      (frame.type === "terminal.step.write" ||
        frame.type === "terminal.connection_progress.write" ||
        frame.type === "terminal.local_agent_catalog.write" ||
        frame.type === "terminal.agent_selection.write") &&
      (!attachment.connectionEpoch ||
        frame.payload.connectionEpoch !== attachment.connectionEpoch)
    ) {
      this.sendErrorFrame(webSocket, {
        code: "prepare.session.terminal_stale",
        message: "This Terminal connection was replaced by a newer command.",
      });
      return;
    }
    if (
      frame.type === "web.agent_selection.write" &&
      attachment.role !== "web"
    ) {
      this.sendErrorFrame(webSocket, {
        code: "prepare.session.role_mismatch",
        message: "Only Web can choose local agents.",
      });
      return;
    }
    try {
      if (frame.type === "terminal.connection_progress.write") {
        await this.handleConnectionProgress(webSocket, attachment, frame);
        return;
      }
      const snapshot = await this.writeFrame(frame);
      this.syncTerminalBinding(snapshot);
      this.broadcastSnapshot(snapshot);
    } catch (error) {
      this.sendWriteError(webSocket, error);
    }
  }
  private async handleConnectionProgress(
    webSocket: WebSocket,
    attachment: {
      connectionEpoch?: number;
      prepareSessionId: string;
      role: PrepareSessionStreamRole;
    },
    frame: Extract<
      PrepareSessionStreamClientFrame,
      {
        type: "terminal.connection_progress.write";
      }
    >
  ): Promise<void> {
    if (frame.payload.prepareSessionId !== attachment.prepareSessionId) {
      this.sendErrorFrame(webSocket, {
        code: "prepare.session.identity_mismatch",
        message: "Progress belongs to a different setup session.",
      });
      return;
    }
    const binding = await this.readActiveTerminalBinding(
      attachment.prepareSessionId
    );
    if (
      !binding ||
      binding.connectionEpoch !== attachment.connectionEpoch ||
      binding.connectionEpoch !== frame.payload.connectionEpoch
    ) {
      this.sendErrorFrame(webSocket, {
        code: "prepare.session.terminal_stale",
        message: "This Terminal connection was replaced by a newer command.",
      });
      return;
    }
    if (
      binding.lastProgressSequence !== null &&
      frame.payload.sequence <= binding.lastProgressSequence
    ) {
      return;
    }
    binding.lastProgressSequence = frame.payload.sequence;
    this.latestConnectionProgress.set(
      attachment.prepareSessionId,
      frame.payload
    );
    this.broadcastConnectionProgress(
      attachment.prepareSessionId,
      frame.payload
    );
  }
  private async writeFrame(
    frame: PrepareSessionStreamClientFrame
  ): Promise<PrepareSessionSnapshot> {
    if (frame.type === "terminal.step.write") {
      return await writeTerminalStepUseCase({
        db: this.requireDb(),
        write: frame.payload,
      });
    }
    if (frame.type === "terminal.local_agent_catalog.write") {
      return await writeTerminalLocalAgentCatalogUseCase({
        db: this.requireDb(),
        write: frame.payload,
      });
    }
    if (frame.type === "terminal.agent_selection.write") {
      return await writeTerminalAgentSelectionUseCase({
        db: this.requireDb(),
        write: frame.payload,
      });
    }
    if (frame.type === "web.agent_selection.write") {
      return await writeWebAgentSelectionUseCase({
        db: this.requireDb(),
        write: frame.payload,
      });
    }
    throw new Error(`Unsupported prepare session frame: ${frame.type}`);
  }
  private async replaceActiveTerminal(
    newSocket: WebSocket,
    snapshot: PrepareSessionSnapshot
  ): Promise<PrepareSessionSnapshot> {
    this.latestConnectionProgress.delete(snapshot.prepareSessionId);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === newSocket) {
        continue;
      }
      const attachment = readPrepareSessionHubSocketAttachment(socket);
      if (
        attachment.prepareSessionId === snapshot.prepareSessionId &&
        attachment.role === "terminal"
      ) {
        this.sendFrame(socket, {
          type: "terminal.replaced",
          payload: {
            reasonCode: "prepare.terminal_replaced",
            message: "A newer Terminal command is now running this setup.",
          },
        });
        safeCloseSocket(socket, 4000, "terminal_replaced");
      }
    }
    const next = await registerPrepareTerminalConnectionUseCase({
      db: this.requireDb(),
      prepareSessionId: snapshot.prepareSessionId,
      connectionId: crypto.randomUUID(),
    });
    writePrepareSessionHubSocketAttachment(newSocket, {
      prepareSessionId: snapshot.prepareSessionId,
      role: "terminal",
      connectionEpoch: next.terminalConnection.connectionEpoch,
    });
    this.syncTerminalBinding(next);
    return next;
  }
  private async handleSocketClosed(
    webSocket: WebSocket,
    reasonCode: string
  ): Promise<void> {
    const attachment = readPrepareSessionHubSocketAttachment(webSocket);
    if (attachment.role !== "terminal" || !attachment.prepareSessionId) {
      return;
    }
    if (!attachment.connectionEpoch) {
      return;
    }
    try {
      const next = await disconnectPrepareTerminalConnectionUseCase({
        db: this.requireDb(),
        prepareSessionId: attachment.prepareSessionId,
        connectionEpoch: attachment.connectionEpoch,
        reasonCode,
      });
      this.syncTerminalBinding(next);
      this.broadcastSnapshot(next);
    } catch (error) {
      if (
        error instanceof PrepareSessionTerminalConnectionStaleError ||
        error instanceof PrepareSessionRevisionConflictError
      ) {
        return;
      }
      throw error;
    }
  }
  private async loadSnapshot(
    prepareSessionId: string
  ): Promise<PrepareSessionSnapshot> {
    return await readPrepareSessionSnapshotUseCase({
      db: this.requireDb(),
      prepareSessionId,
    });
  }
  private broadcastSnapshot(
    snapshot: PrepareSessionSnapshot,
    exceptSocket?: WebSocket
  ): void {
    this.syncTerminalBinding(snapshot);
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === exceptSocket) {
        continue;
      }
      const attachment = readPrepareSessionHubSocketAttachment(socket);
      if (attachment.prepareSessionId !== snapshot.prepareSessionId) {
        continue;
      }
      this.sendSnapshot(socket, snapshot, "snapshot_changed");
    }
  }
  private broadcastConnectionProgress(
    prepareSessionId: string,
    progress: Extract<
      PrepareSessionStreamServerFrame,
      {
        type: "connection_progress";
      }
    >["payload"]
  ): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = readPrepareSessionHubSocketAttachment(socket);
      if (
        attachment.prepareSessionId !== prepareSessionId ||
        attachment.role !== "web"
      ) {
        continue;
      }
      if (socket.readyState !== WebSocket.OPEN) {
        continue;
      }
      try {
        this.sendFrame(socket, {
          type: "connection_progress",
          payload: progress,
        });
      } catch {
        // Progress is optional observation. One stale viewer must not fail
        // authoritative setup or prevent healthy viewers from receiving it.
      }
    }
  }
  private async readActiveTerminalBinding(prepareSessionId: string): Promise<{
    connectionEpoch: number;
    lastProgressSequence: number | null;
  } | null> {
    const existing = this.activeTerminalBindings.get(prepareSessionId);
    if (existing) {
      return existing;
    }
    const snapshot = await this.loadSnapshot(prepareSessionId);
    this.syncTerminalBinding(snapshot);
    return this.activeTerminalBindings.get(prepareSessionId) ?? null;
  }
  private syncTerminalBinding(snapshot: PrepareSessionSnapshot): void {
    const epoch = snapshot.terminalConnection.connectionEpoch;
    if (
      snapshot.lifecycleStatus !== "active" ||
      snapshot.terminalConnection.status !== "connected" ||
      epoch === null
    ) {
      this.activeTerminalBindings.delete(snapshot.prepareSessionId);
      this.latestConnectionProgress.delete(snapshot.prepareSessionId);
      return;
    }
    const current = this.activeTerminalBindings.get(snapshot.prepareSessionId);
    if (current?.connectionEpoch === epoch) {
      return;
    }
    this.activeTerminalBindings.set(snapshot.prepareSessionId, {
      connectionEpoch: epoch,
      lastProgressSequence: null,
    });
    this.latestConnectionProgress.delete(snapshot.prepareSessionId);
  }
  private sendSnapshot(
    webSocket: WebSocket,
    snapshot: PrepareSessionSnapshot,
    type: "snapshot" | "snapshot_changed"
  ): void {
    this.sendFrame(webSocket, {
      type,
      payload: {
        snapshot,
      },
    });
  }
  private sendWriteError(webSocket: WebSocket, error: unknown): void {
    if (error instanceof PrepareSessionRevisionConflictError) {
      this.sendErrorFrame(webSocket, {
        code: "prepare.session.revision_conflict",
        message: "This setup changed. Refresh the prepare state and try again.",
      });
      return;
    }
    if (error instanceof PrepareSessionTerminalConnectionStaleError) {
      this.sendErrorFrame(webSocket, {
        code: "prepare.session.terminal_stale",
        message: "This Terminal connection was replaced by a newer command.",
      });
      return;
    }
    this.sendErrorFrame(webSocket, {
      code: "prepare.session.write_failed",
      message: "Setup state could not be saved.",
    });
  }
  private sendErrorFrame(
    webSocket: WebSocket,
    input: {
      code: string;
      message: string;
    }
  ): void {
    this.sendFrame(webSocket, {
      type: "server.error",
      payload: input,
    });
  }
  private sendFrame(
    webSocket: WebSocket,
    frame: PrepareSessionStreamServerFrame
  ): void {
    const parsed = prepareSessionStreamServerFrameSchema.safeParse(frame);
    if (!parsed.success) {
      throw new Error(
        `invalid prepare session server frame: ${parsed.error.message}`
      );
    }
    webSocket.send(JSON.stringify(parsed.data));
  }
  private requireDb(): PostgresDatabase {
    const db = getPostgresDatabase(this.env);
    if (!db) {
      throw new Error("prepare session store unavailable");
    }
    return db;
  }
}
function parseClientFrame(
  rawMessage: string | ArrayBuffer
): PrepareSessionStreamClientFrame | null {
  if (typeof rawMessage !== "string") {
    return null;
  }
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(rawMessage) as unknown;
  } catch {
    return null;
  }
  const parsed = prepareSessionStreamClientFrameSchema.safeParse(rawJson);
  return parsed.success ? parsed.data : null;
}
function normalizeOptionalText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}
function normalizeRole(value: unknown): PrepareSessionStreamRole | null {
  return value === "web" || value === "terminal" ? value : null;
}
function safeCloseSocket(
  webSocket: WebSocket,
  code: number,
  reason: string
): void {
  try {
    webSocket.close(code, reason);
  } catch {
    // Socket may already be closed by the runtime.
  }
}
