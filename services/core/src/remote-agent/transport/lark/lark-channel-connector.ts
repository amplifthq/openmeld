import { DurableObject } from "cloudflare:workers";
import { type CoreBindings, localStateDb } from "../../../lib/bindings";
import { decryptLarkPlatformCredential } from "../../application/lark-platform-credential-crypto";
import { normalizeLarkPlatformEvent } from "../../application/lark-platform-event-normalizer";
import { getLarkPlatformApiHost } from "../../application/lark-platform-openapi-client";
import { isLarkPlatformProviderEnabledForOrganization } from "../../application/lark-platform-provider-policy";
import {
  bindRemoteAgentLarkPlatformConnectionTenant,
  type RemoteAgentLarkPlatformChannelConnectionRecord,
  readRemoteAgentLarkPlatformChannelConnection,
  readRemoteAgentLarkPlatformChannelCredentials,
} from "../../infrastructure/d1/lark-platform-channel-connection-repo";
import {
  decodeLarkFrame,
  encodeLarkFrame,
  LarkPayloadAssembler,
  larkAckFrame,
  larkFrameHeader,
  larkPingFrame,
} from "./lark-frame";

const RECOVERY_INTERVAL_MS = 60_000;
const MAX_PENDING_EVENTS = 1000;
const CONNECTOR_REASON_PATTERN = /^lark\.[a-z_]+$/u;
type ProviderClientConfig = {
  PingInterval?: number;
  ReconnectInterval?: number;
  ReconnectNonce?: number;
};
type PendingEvent = {
  event_id: string;
  generation: number;
  payload: string;
  received_at_ms: number;
};
type ProviderPayload = {
  schema?: string;
  header?: {
    app_id?: string;
    tenant_key?: string;
    event_id?: string;
    event_type?: string;
  };
  event?: unknown;
};

/** One named object per connection. D1 owns identity/authority; this object
 * owns the live socket and the durable handoff to the existing ingress Queue. */
export class LarkChannelConnector extends DurableObject<CoreBindings> {
  private get db(): D1Database {
    const db = localStateDb(this.env);
    if (!db) {
      throw new Error("lark.database_unavailable");
    }
    return db;
  }
  private connection: RemoteAgentLarkPlatformChannelConnectionRecord | null =
    null;
  private socket: WebSocket | null = null;
  private connecting: Promise<boolean> | null = null;
  private draining: Promise<void> | null = null;
  private heartbeat: ReturnType<typeof setTimeout> | null = null;
  private lastReceivedAt = 0;
  private pingIntervalMs = 30_000;
  private reconnectIntervalMs = 120_000;
  private reconnectNonceMs = 30_000;
  private serviceId = 0;
  private epoch = 0;
  private assembler = new LarkPayloadAssembler();

  constructor(ctx: DurableObjectState, env: CoreBindings) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS pending_events (
      event_id TEXT PRIMARY KEY, generation INTEGER NOT NULL,
      payload TEXT NOT NULL, received_at_ms INTEGER NOT NULL)`);
  }

  async ensureConnected(connectionId: string): Promise<boolean> {
    const saved = await this.ctx.storage.get<string>("connectionId");
    if (saved && saved !== connectionId) {
      throw new Error("lark.connector_identity_mismatch");
    }
    await this.ctx.storage.put("connectionId", connectionId);
    await this.ctx.storage.setAlarm(Date.now() + RECOVERY_INTERVAL_MS);
    if (this.connecting) {
      return this.connecting;
    }
    const operation = this.openConnection(connectionId);
    this.connecting = operation;
    try {
      return await operation;
    } catch (error) {
      if (this.connection) {
        await this.ctx.storage.setAlarm(Date.now() + this.reconnectIntervalMs);
      }
      throw error;
    } finally {
      if (this.connecting === operation) {
        this.connecting = null;
      }
    }
  }

  async disconnect(): Promise<void> {
    this.closeSocket();
    this.connection = null;
    await this.ctx.storage.deleteAlarm();
    // A revoked connection must never forward its accepted pending messages.
    this.ctx.storage.sql.exec("DELETE FROM pending_events");
  }

  async alarm(): Promise<void> {
    const id = await this.ctx.storage.get<string>("connectionId");
    if (!id) {
      return;
    }
    try {
      // The socket heartbeat owns idle liveness. Authority is checked at
      // reconnection and before queued work; idle bots need no D1 polling.
      if (this.socket?.readyState === WebSocket.OPEN) {
        await this.ctx.storage.setAlarm(Date.now() + RECOVERY_INTERVAL_MS);
      } else {
        await this.ensureConnected(id);
      }
      await this.drain();
    } catch (error) {
      console.error("[core.lark_connector.recovery_failed]", {
        connectionId: id,
        reasonCode: connectorFailureReason(error),
      });
    }
  }

  private async openConnection(connectionId: string): Promise<boolean> {
    const openingEpoch = this.epoch;
    const connection = await readRemoteAgentLarkPlatformChannelConnection({
      connectionId,
      db: this.db,
    });
    if (openingEpoch !== this.epoch) {
      return false;
    }
    if (
      !connection ||
      connection.transport !== "websocket" ||
      !["configuring", "connected"].includes(connection.status) ||
      !isLarkPlatformProviderEnabledForOrganization({
        env: this.env,
        organizationId: connection.organizationId,
        provider: connection.provider,
      })
    ) {
      await this.disconnect();
      return false;
    }
    if (
      this.socket?.readyState === WebSocket.OPEN &&
      this.connection?.connectionGeneration === connection.connectionGeneration
    ) {
      this.connection = connection;
      this.drainInBackground();
      return true;
    }
    this.closeSocket();
    const epoch = this.epoch;
    this.connection = connection;
    const credentials = await readRemoteAgentLarkPlatformChannelCredentials({
      connectionId,
      db: this.db,
    });
    const cryptoKey = this.env.LARK_OPENMELD_PLATFORM_CREDENTIAL_CRYPTO_KEY;
    if (!(credentials && cryptoKey)) {
      throw new Error("lark.connection_credentials_unavailable");
    }
    const appSecret = await decryptLarkPlatformCredential({
      credentialName: "app secret",
      cryptoKey,
      encryptedCredential: credentials.encryptedAppSecret,
    });
    const response = await fetch(
      `${getLarkPlatformApiHost(connection.provider)}/callback/ws/endpoint`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "openmeld/lark-channel",
        },
        body: JSON.stringify({ AppID: connection.appId, AppSecret: appSecret }),
        signal: AbortSignal.timeout(15_000),
      }
    );
    const endpoint = (await response.json()) as {
      code?: number;
      data?: { URL?: string; ClientConfig?: ProviderClientConfig };
    };
    if (!response.ok || endpoint.code !== 0 || !endpoint.data?.URL) {
      throw new Error("lark.connection_endpoint_failed");
    }
    const url = new URL(endpoint.data.URL);
    if (url.protocol !== "wss:") {
      throw new Error("lark.connection_endpoint_invalid");
    }
    this.serviceId = Number(url.searchParams.get("service_id"));
    if (!Number.isSafeInteger(this.serviceId) || this.serviceId <= 0) {
      throw new Error("lark.connection_endpoint_invalid");
    }
    this.applyProviderConfig(endpoint.data.ClientConfig);
    url.protocol = "https:";
    const upgraded = await fetch(url, {
      headers: { Upgrade: "websocket" },
      signal: AbortSignal.timeout(15_000),
    });
    const socket = upgraded.webSocket;
    if (!socket || upgraded.status !== 101) {
      throw new Error("lark.connection_handshake_failed");
    }
    socket.accept();
    if (epoch !== this.epoch) {
      socket.close(1000);
      return false;
    }
    this.socket = socket;
    this.lastReceivedAt = Date.now();
    this.assembler = new LarkPayloadAssembler();
    socket.addEventListener("message", (event) => {
      this.ctx.waitUntil(
        this.receive(socket, event.data).catch((error) => {
          console.error("[core.lark_connector.receive_failed]", {
            connectionId,
            reasonCode: connectorFailureReason(error),
          });
          if (this.socket === socket) {
            this.closeSocket();
            this.scheduleReconnect();
          }
        })
      );
    });
    const closed = () => {
      if (this.socket !== socket) {
        return;
      }
      this.closeSocket();
      this.scheduleReconnect();
    };
    socket.addEventListener("close", closed);
    socket.addEventListener("error", closed);
    this.scheduleHeartbeat();
    console.info("[core.lark_connector.connected]", {
      connectionId,
      provider: connection.provider,
    });
    this.drainInBackground();
    return true;
  }

  private closeSocket(): void {
    this.epoch++;
    if (this.heartbeat) {
      clearTimeout(this.heartbeat);
    }
    this.heartbeat = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && socket.readyState < WebSocket.CLOSING) {
      socket.close(1000);
    }
  }

  private scheduleHeartbeat(): void {
    this.heartbeat = setTimeout(() => {
      if (!this.socket) {
        return;
      }
      if (Date.now() - this.lastReceivedAt > this.pingIntervalMs * 2 + 10_000) {
        this.closeSocket();
        this.scheduleReconnect();
        return;
      }
      this.socket.send(encodeLarkFrame(larkPingFrame(this.serviceId)));
      this.scheduleHeartbeat();
    }, this.pingIntervalMs);
  }

  private async receive(
    socket: WebSocket,
    data: string | ArrayBuffer
  ): Promise<void> {
    if (this.socket !== socket || !this.connection) {
      return;
    }
    if (typeof data === "string") {
      throw new Error("lark.binary_frame_required");
    }
    const receivedAtMs = Date.now();
    this.lastReceivedAt = receivedAtMs;
    const frame = decodeLarkFrame(new Uint8Array(data));
    if (frame.method === 0) {
      if (larkFrameHeader(frame, "type") === "pong" && frame.payload?.length) {
        this.applyProviderConfig(
          JSON.parse(
            new TextDecoder().decode(frame.payload)
          ) as ProviderClientConfig
        );
      }
      return;
    }
    if (frame.method !== 1 || larkFrameHeader(frame, "type") !== "event") {
      return;
    }
    const bytes = this.assembler.accept(frame, receivedAtMs);
    if (!bytes) {
      return;
    }
    const raw = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes);
    const payload = JSON.parse(raw) as ProviderPayload;
    const header = payload.header;
    if (
      payload.schema !== "2.0" ||
      !header?.event_id ||
      header.app_id !== this.connection.appId ||
      !header.tenant_key ||
      (this.connection.tenantKey !== null &&
        this.connection.tenantKey !== header.tenant_key)
    ) {
      throw new Error("lark.event_identity_mismatch");
    }
    const count = this.ctx.storage.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM pending_events")
      .one().count;
    if (count >= MAX_PENDING_EVENTS) {
      throw new Error("lark.ingress_backpressure");
    }
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO pending_events VALUES (?, ?, ?, ?)",
      header.event_id,
      this.connection.connectionGeneration,
      raw,
      receivedAtMs
    );
    // Output gate: the local durable write must survive a process loss before
    // Feishu is told to stop retrying. Slow D1, Queue and agent work happen later.
    await this.ctx.storage.sync();
    if (this.socket !== socket) {
      return;
    }
    socket.send(
      encodeLarkFrame(larkAckFrame(frame, Date.now() - receivedAtMs))
    );
    console.info("[core.lark_connector.accepted]", {
      connectionId: this.connection.connectionId,
      providerEventId: header.event_id,
      acknowledgementMs: Date.now() - receivedAtMs,
    });
    this.drainInBackground();
  }

  private drainInBackground(): void {
    this.ctx.waitUntil(
      this.drain().catch((error) => {
        console.error("[core.lark_connector.handoff_failed]", {
          connectionId: this.connection?.connectionId,
          reasonCode: connectorFailureReason(error),
        });
      })
    );
  }

  private applyProviderConfig(config: ProviderClientConfig | undefined): void {
    if (!config) {
      return;
    }
    this.pingIntervalMs = providerInterval(
      config.PingInterval,
      this.pingIntervalMs
    );
    this.reconnectIntervalMs = providerInterval(
      config.ReconnectInterval,
      this.reconnectIntervalMs
    );
    this.reconnectNonceMs = providerInterval(
      config.ReconnectNonce,
      this.reconnectNonceMs
    );
  }

  private scheduleReconnect(): void {
    // Match the provider's randomized first reconnect window to avoid all
    // organization bots reconnecting together after a Worker deployment.
    const delay = Math.max(1000, Math.random() * this.reconnectNonceMs);
    this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + delay));
  }

  private async drain(): Promise<void> {
    if (this.draining) {
      return this.draining;
    }
    const operation = this.flushPending();
    this.draining = operation;
    try {
      await operation;
    } finally {
      if (this.draining === operation) {
        this.draining = null;
      }
    }
  }

  private async flushPending(): Promise<void> {
    const epoch = this.epoch;
    const id = this.connection?.connectionId;
    if (!id) {
      return;
    }
    const rows = this.ctx.storage.sql
      .exec<PendingEvent>(
        "SELECT * FROM pending_events ORDER BY received_at_ms LIMIT 50"
      )
      .toArray();
    if (rows.length === 0) {
      return;
    }
    const db = this.db;
    let current = await readRemoteAgentLarkPlatformChannelConnection({
      connectionId: id,
      db,
    });
    if (
      !current ||
      current.transport !== "websocket" ||
      !["configuring", "connected"].includes(current.status)
    ) {
      await this.disconnect();
      return;
    }
    if (current.status === "configuring") {
      return;
    }
    const queue = this.env.OPENMELD_REMOTE_AGENT_MESSAGE_CHANNEL_EVENTS_QUEUE;
    if (!queue) {
      throw new Error("lark.ingress_queue_unavailable");
    }
    for (const row of rows) {
      if (epoch !== this.epoch) {
        return;
      }
      if (row.generation !== current.connectionGeneration) {
        this.ctx.storage.sql.exec(
          "DELETE FROM pending_events WHERE event_id = ?",
          row.event_id
        );
        continue;
      }
      const payload = JSON.parse(row.payload) as ProviderPayload;
      const tenantKey = requireEventTenant(payload);
      current = await this.bindTenant(current, tenantKey);
      if (epoch !== this.epoch) {
        return;
      }
      this.connection = current;
      const normalized = normalizeLarkPlatformEvent({
        connection: current,
        payload: payload as Record<string, unknown>,
        gatewayRequestId: `lark-ws:${row.event_id}`,
        receivedAtMs: row.received_at_ms,
        surface:
          payload.header?.event_type === "card.action.trigger"
            ? "callbacks"
            : "events",
      });
      if (normalized.status === "enqueue") {
        await queue.send({
          ...normalized.envelope,
          connectionGeneration: row.generation,
        });
      } else if (normalized.status === "rejected") {
        console.error("[core.lark_connector.event_rejected]", {
          connectionId: id,
          providerEventId: row.event_id,
          reasonCode: normalized.reasonCode,
        });
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM pending_events WHERE event_id = ?",
        row.event_id
      );
    }
    if (
      this.ctx.storage.sql
        .exec("SELECT 1 FROM pending_events LIMIT 1")
        .toArray().length > 0
    ) {
      await this.ctx.storage.setAlarm(Date.now() + 1000);
    }
  }

  private async bindTenant(
    connection: RemoteAgentLarkPlatformChannelConnectionRecord,
    tenantKey: string
  ): Promise<RemoteAgentLarkPlatformChannelConnectionRecord> {
    const current = connection.tenantKey
      ? connection
      : await bindRemoteAgentLarkPlatformConnectionTenant({
          connectionId: connection.connectionId,
          db: this.db,
          appId: connection.appId,
          organizationId: connection.organizationId,
          provider: connection.provider,
          tenantKey,
          nowMs: Date.now(),
        });
    if (!current) {
      throw new Error("lark.tenant_binding_failed");
    }
    if (current.tenantKey !== tenantKey) {
      throw new Error("lark.event_tenant_mismatch");
    }
    return current;
  }
}

function requireEventTenant(payload: ProviderPayload): string {
  const tenantKey = payload.header?.tenant_key;
  if (!tenantKey) {
    throw new Error("lark.event_tenant_missing");
  }
  return tenantKey;
}

function providerInterval(
  seconds: number | undefined,
  current: number
): number {
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? Math.min(300_000, Math.max(1000, seconds * 1000))
    : current;
}

function connectorFailureReason(error: unknown): string {
  return error instanceof Error && CONNECTOR_REASON_PATTERN.test(error.message)
    ? error.message
    : "lark.connector_operation_failed";
}
