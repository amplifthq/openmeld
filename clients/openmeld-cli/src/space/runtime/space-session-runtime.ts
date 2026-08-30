import type { Profile } from "@openmeld/protocol";
import {
  parseOptionalClientMessageId,
  toCompatibleSpaceAddressingRequestWireValue,
} from "@openmeld/schemas";
import type {
  MessageEnvelope,
  SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import {
  makeHello,
  makeTextSignal,
  parseIncoming,
  parseServerErrorFrame,
} from "../../protocol/wire";
import { connectWebSocket, type WsClient } from "../../transport/ws";
import { normalizePendingOutboundSourceText } from "../pending-outbound-confirmation";
import type {
  SpaceRuntimeEvent,
  SpaceRuntimeMessage,
} from "./space-runtime-events";

const DEFAULT_BUFFERED_LIVE_EVENT_LIMIT = 2000;
const DEFAULT_PENDING_SEND_LIMIT = 200;

export type SpaceSessionRuntimeStartResult = {
  closed: Promise<void>;
};

type SpaceSessionRuntimeInput = {
  wsUrl: string;
  wsHeaders: Record<string, string>;
  helloProfile: Profile;
  selfProfileId: string;
  loadMembers: () => Promise<SpaceMembersSnapshot | null>;
  replayHistory: (
    onEvent: (event: SpaceRuntimeMessage) => void
  ) => Promise<{ synced: boolean }>;
  formatError: (error: unknown) => string;
  scheduleDeferredWork?: (work: () => void) => void;
  bufferedLiveEventLimit?: number;
  pendingSendLimit?: number;
};

type SpaceRuntimeListener = (event: SpaceRuntimeEvent) => void;
type PendingSentMessage = {
  clientMessageId: string;
  normalizedText: string | null;
  text: string;
};

export type SpaceSessionSendReceipt =
  | {
      queued: true;
      clientMessageId: string;
    }
  | {
      queued: false;
    };

export class SpaceSessionRuntime {
  readonly #input: SpaceSessionRuntimeInput;
  readonly #listeners = new Set<SpaceRuntimeListener>();
  readonly #bufferedLiveEvents: SpaceRuntimeMessage[] = [];
  readonly #pendingSentMessages: PendingSentMessage[] = [];

  #ws: WsClient | null = null;
  #started = false;
  #stopRequested = false;
  #replayFinished = false;
  #bufferLiveEventsUntilReplayComplete = true;
  #closeEventDispatched = false;
  #forceTerminateTimer: NodeJS.Timeout | null = null;
  #historyLoadedReason: "replay_error" | "live_buffer_overflow" | null = null;

  constructor(input: SpaceSessionRuntimeInput) {
    this.#input = input;
  }

  subscribe(listener: SpaceRuntimeListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  async start(): Promise<SpaceSessionRuntimeStartResult> {
    if (this.#started) {
      throw new Error("SpaceSessionRuntime.start() can only be called once");
    }
    this.#started = true;

    const ws = await connectWebSocket(this.#input.wsUrl, {
      headers: this.#input.wsHeaders,
    });
    this.#ws = ws;

    ws.onMessage((raw) => {
      if (this.#stopRequested) {
        return;
      }
      const parsed = safeJsonParse(raw);
      const serverError = parseServerErrorFrame(parsed);
      if (serverError) {
        this.#maybeEmitSendFailed(serverError);
        return;
      }
      const event = parseIncoming(parsed);
      if (!event) {
        return;
      }
      this.#handleLiveEvent(event);
    });
    ws.onClose((code, reason) => {
      this.#emitConnectionClosed({
        source: "close",
        code,
        reason,
      });
    });
    ws.onError((error) => {
      this.#emitConnectionClosed({
        source: "error",
        reason: this.#input.formatError(error),
        error,
      });
    });

    const membersSnapshot = await this.#input.loadMembers();
    this.#emit({
      type: "members.updated",
      snapshot: membersSnapshot,
    });

    ws.send(JSON.stringify(makeHello(this.#input.helloProfile)));
    this.#emit({ type: "connected" });

    const scheduleDeferredWork =
      this.#input.scheduleDeferredWork ??
      ((work: () => void) => setImmediate(work));
    scheduleDeferredWork(() => {
      this.#startReplayAndDrain().catch(() => undefined);
    });

    return {
      closed: ws.waitUntilClosed(),
    };
  }

  stop(reason = "stop requested"): void {
    this.#stopRequested = true;
    if (!this.#ws) {
      return;
    }
    this.#ws.close(1000, reason);
    this.#forceTerminateTimer = setTimeout(() => {
      this.#ws?.terminate();
    }, 800);
    this.#ws
      .waitUntilClosed()
      .finally(() => {
        if (!this.#forceTerminateTimer) {
          return;
        }
        clearTimeout(this.#forceTerminateTimer);
        this.#forceTerminateTimer = null;
      })
      .catch(() => undefined);
  }

  sendText(input: {
    text: string;
    messageEnvelope?: MessageEnvelope;
  }): SpaceSessionSendReceipt {
    const text = input.text;
    if (!this.#ws) {
      this.#emit({
        type: "send.failed",
        clientMessageId: "unknown-client-message",
        text,
        error: "space connection is not started",
      });
      return {
        queued: false,
      };
    }

    const clientMessageId = crypto.randomUUID();
    try {
      this.#ws.send(
        JSON.stringify(
          toCompatibleSpaceAddressingRequestWireValue(
            makeTextSignal(text, {
              ...(input.messageEnvelope
                ? { messageEnvelope: input.messageEnvelope }
                : {}),
              meta: {
                clientMessageId,
              },
            })
          )
        )
      );
      this.#rememberPendingSentMessage({
        clientMessageId,
        normalizedText: normalizePendingOutboundSourceText(text),
        text,
      });
      this.#emit({
        type: "send.queued",
        clientMessageId,
        text,
      });
      return {
        queued: true,
        clientMessageId,
      };
    } catch (error) {
      this.#emit({
        type: "send.failed",
        clientMessageId,
        text,
        error: this.#input.formatError(error),
      });
      return {
        queued: false,
      };
    }
  }

  #emit(event: SpaceRuntimeEvent): void {
    for (const listener of this.#listeners) {
      listener(event);
    }
  }

  #handleLiveEvent(event: SpaceRuntimeMessage): void {
    if (this.#bufferLiveEventsUntilReplayComplete) {
      if (
        this.#bufferedLiveEvents.length <
        (this.#input.bufferedLiveEventLimit ??
          DEFAULT_BUFFERED_LIVE_EVENT_LIMIT)
      ) {
        this.#bufferedLiveEvents.push(event);
        return;
      }

      this.#historyLoadedReason = "live_buffer_overflow";
      this.#bufferLiveEventsUntilReplayComplete = false;
      this.#drainBufferedLiveEvents();
    }

    this.#emitSignalReceived(event, "live");
  }

  async #startReplayAndDrain(): Promise<void> {
    if (this.#replayFinished || this.#stopRequested) {
      return;
    }

    const replayState = await this.#input.replayHistory((event) => {
      this.#emitSignalReceived(event, "history");
    });
    if (this.#stopRequested) {
      this.#replayFinished = true;
      this.#bufferLiveEventsUntilReplayComplete = false;
      this.#bufferedLiveEvents.length = 0;
      return;
    }

    this.#replayFinished = true;
    this.#bufferLiveEventsUntilReplayComplete = false;
    const historyLoadedReason = resolveHistoryLoadedReason({
      replaySynced: replayState.synced,
      historyLoadedReason: this.#historyLoadedReason,
    });
    this.#emit({
      type: "history.loaded",
      synced: historyLoadedReason === null,
      ...(historyLoadedReason ? { reason: historyLoadedReason } : {}),
    });
    this.#drainBufferedLiveEvents();
  }

  #drainBufferedLiveEvents(): void {
    if (this.#bufferedLiveEvents.length === 0) {
      return;
    }
    const bufferedEvents = this.#bufferedLiveEvents.splice(0);
    for (const event of bufferedEvents) {
      this.#emitSignalReceived(event, "live");
    }
  }

  #emitSignalReceived(
    event: SpaceRuntimeMessage,
    source: "history" | "live"
  ): void {
    if (source === "live") {
      this.#maybeEmitSendConfirmed(event);
    }

    this.#emit({
      type: "signal.received",
      event,
      source,
    });
  }

  #rememberPendingSentMessage(message: PendingSentMessage): void {
    const pendingLimit =
      this.#input.pendingSendLimit ?? DEFAULT_PENDING_SEND_LIMIT;
    if (this.#pendingSentMessages.length >= pendingLimit) {
      this.#pendingSentMessages.shift();
    }
    this.#pendingSentMessages.push(message);
  }

  #maybeEmitSendConfirmed(event: SpaceRuntimeMessage): void {
    if (event.type !== "signal.text") {
      return;
    }
    const profileId = String(event.profile?.profileId ?? "").trim();
    if (!profileId || profileId !== this.#input.selfProfileId) {
      return;
    }
    const text = typeof event.data?.text === "string" ? event.data.text : "";
    const clientMessageId = resolveClientMessageId(event);
    if (clientMessageId) {
      const matchingIndex = this.#pendingSentMessages.findIndex(
        (message) => message.clientMessageId === clientMessageId
      );
      if (matchingIndex < 0) {
        return;
      }
      this.#pendingSentMessages.splice(matchingIndex, 1);
      this.#emit({
        type: "send.confirmed",
        clientMessageId,
        text,
        event,
      });
      return;
    }

    if (
      this.#pendingSentMessages[0]?.normalizedText !==
      normalizePendingOutboundSourceText(text)
    ) {
      return;
    }
    const pendingMessage = this.#pendingSentMessages.shift() ?? null;
    this.#emit({
      type: "send.confirmed",
      clientMessageId: pendingMessage?.clientMessageId ?? null,
      text,
      event,
    });
  }

  #maybeEmitSendFailed(input: {
    error: string;
    requestId?: string;
    clientMessageId?: string;
  }): void {
    if (this.#pendingSentMessages.length === 0) {
      return;
    }

    let matchingIndex = -1;
    const clientMessageId =
      typeof input.clientMessageId === "string" &&
      input.clientMessageId.trim().length > 0
        ? input.clientMessageId.trim()
        : null;
    if (clientMessageId) {
      matchingIndex = this.#pendingSentMessages.findIndex(
        (message) => message.clientMessageId === clientMessageId
      );
    }
    const failedMessage =
      matchingIndex >= 0
        ? (this.#pendingSentMessages.splice(matchingIndex, 1)[0] ?? null)
        : (this.#pendingSentMessages.shift() ?? null);
    if (!failedMessage) {
      return;
    }

    this.#emit({
      type: "send.failed",
      clientMessageId: failedMessage.clientMessageId,
      text: failedMessage.text,
      error: formatServerSendError(input),
    });
  }

  #emitConnectionClosed(input: {
    source: "close" | "error";
    reason: string;
    code?: number;
    error?: unknown;
  }): void {
    if (this.#closeEventDispatched) {
      return;
    }
    this.#closeEventDispatched = true;
    this.#emit({
      type: "connection.closed",
      source: input.source,
      reason: input.reason,
      ...(typeof input.code === "number" ? { code: input.code } : {}),
      ...(input.error === undefined ? {} : { error: input.error }),
    });
  }
}

function resolveHistoryLoadedReason(input: {
  replaySynced: boolean;
  historyLoadedReason: "replay_error" | "live_buffer_overflow" | null;
}): "replay_error" | "live_buffer_overflow" | null {
  if (input.historyLoadedReason) {
    return input.historyLoadedReason;
  }
  if (!input.replaySynced) {
    return "replay_error";
  }
  return null;
}

function safeJsonParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function resolveClientMessageId(event: { data?: unknown }): string | null {
  const meta =
    event.data && typeof event.data === "object" && !Array.isArray(event.data)
      ? (event.data as { meta?: unknown }).meta
      : null;
  if (!(meta && typeof meta === "object") || Array.isArray(meta)) {
    return null;
  }
  return parseOptionalClientMessageId(
    (meta as { clientMessageId?: unknown }).clientMessageId
  );
}

function formatServerSendError(input: {
  error: string;
  requestId?: string;
}): string {
  const error = String(input.error ?? "").trim() || "unknown_error";
  const requestId =
    typeof input.requestId === "string" ? input.requestId.trim() : "";
  if (!requestId) {
    return error;
  }
  return `${error} (requestId: ${requestId})`;
}
