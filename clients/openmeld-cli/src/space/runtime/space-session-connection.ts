import { connectWebSocket, type WsClient } from "../../transport/ws";

const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000] as const;
const STABLE_CONNECTION_MS = 30_000;
const OPEN_TIMEOUT_MS = 5000;

type Disconnection = {
  source: "close" | "error";
  code?: number;
  reason: string;
  error?: unknown;
};
type WatchRecovery = {
  onReconnecting: (attempt: number) => void;
  onReconnected: (client: WsClient, isCurrent: () => boolean) => Promise<void>;
};
type ConnectionInput = {
  url: string;
  headers: () => Promise<Record<string, string>>;
  recovery: WatchRecovery;
};

// The Space session owns its socket lifetime. Recovery never queues or resends
// outbound messages, and its read owner must reconcile history before success.
export async function connectSpaceSessionWebSocket(input: {
  url: string;
  headers: () => Promise<Record<string, string>>;
  recovery?: WatchRecovery;
}): Promise<WsClient> {
  if (!input.recovery) {
    return await connectWebSocket(input.url, {
      headers: await input.headers(),
    });
  }
  const initial = await connectWebSocket(input.url, {
    headers: await input.headers(),
    openTimeoutMs: OPEN_TIMEOUT_MS,
  });
  return new SpaceSessionConnection(initial, {
    ...input,
    recovery: input.recovery,
  });
}

class SpaceSessionConnection implements WsClient {
  readonly #input: ConnectionInput;
  readonly #abort = new AbortController();
  readonly #messageHandlers = new Set<(data: string) => void>();
  readonly #closeHandlers = new Set<(code: number, reason: string) => void>();
  readonly #errorHandlers = new Set<(error: unknown) => void>();
  readonly #closed: Promise<void>;
  readonly #resolveClosed: () => void;
  #client: WsClient | null = null;
  #recovering = false;
  #finished = false;
  #attempts = 0;
  #connectedAt = Date.now();
  #lastDisconnection: Disconnection | null = null;
  #manualClose: { code: number; reason: string } | null = null;

  constructor(initial: WsClient, input: ConnectionInput) {
    this.#input = input;
    let resolveClosed: () => void = () => undefined;
    this.#closed = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });
    this.#resolveClosed = resolveClosed;
    this.#attach(initial);
  }

  get bufferedAmount(): number {
    return this.#client?.bufferedAmount ?? 0;
  }
  send(data: string): void {
    if (
      this.#finished ||
      this.#manualClose ||
      this.#recovering ||
      !this.#client
    ) {
      throw new Error(
        "The Space connection is recovering. Your message was not sent."
      );
    }
    this.#client.send(data);
  }
  close(code = 1000, reason = "stop requested"): void {
    const client = this.#client;
    this.#manualClose = { code, reason };
    this.#abort.abort();
    if (client) {
      client.close(code, reason);
    } else {
      this.#finish({ source: "close", code, reason });
    }
  }
  terminate(): void {
    const client = this.#client;
    this.#finish({ source: "close", code: 1000, reason: "stop requested" });
    client?.terminate();
  }
  onMessage(handler: (data: string) => void): void {
    this.#messageHandlers.add(handler);
  }
  onClose(handler: (code: number, reason: string) => void): void {
    this.#closeHandlers.add(handler);
  }
  onError(handler: (error: unknown) => void): void {
    this.#errorHandlers.add(handler);
  }
  async waitUntilClosed(): Promise<void> {
    await this.#closed;
  }

  #attach(client: WsClient): void {
    this.#client = client;
    this.#connectedAt = Date.now();
    client.onMessage((data) => {
      if (this.#finished || this.#client !== client) {
        return;
      }
      for (const handler of this.#messageHandlers) {
        handler(data);
      }
    });
    client.onClose((code, reason) =>
      this.#disconnect(client, { source: "close", code, reason })
    );
    client.onError((error) => {
      this.#disconnect(client, {
        source: "error",
        error,
        reason: error instanceof Error ? error.message : String(error),
      });
      client.terminate();
    });
  }

  #disconnect(client: WsClient, event: Disconnection): void {
    if (this.#finished || this.#client !== client) {
      return;
    }
    this.#client = null;
    if (this.#manualClose) {
      this.#finish({ source: "close", ...this.#manualClose });
      return;
    }
    this.#lastDisconnection = event;
    if (
      event.source === "close" &&
      ![1000, 1001, 1005, 1006, 1011, 1012, 1013, 1014].includes(
        event.code ?? 0
      )
    ) {
      this.#finish(event);
      return;
    }
    if (
      !this.#recovering &&
      Date.now() - this.#connectedAt >= STABLE_CONNECTION_MS
    ) {
      this.#attempts = 0;
    }
    if (this.#recovering) {
      return;
    }
    this.#recovering = true;
    this.#recover()
      .catch((error: unknown) => {
        if (this.#manualClose) {
          if (!this.#client) {
            this.#finish({ source: "close", ...this.#manualClose });
          }
          return;
        }
        this.#finish({
          source: "error",
          error,
          reason: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.#recovering = false;
      });
  }

  async #recover(): Promise<void> {
    while (!this.#finished) {
      if (this.#manualClose) {
        return;
      }
      const delayMs = RECONNECT_DELAYS_MS[this.#attempts];
      if (delayMs === undefined) {
        throw new Error(
          `Space watch could not reconnect after ${RECONNECT_DELAYS_MS.length} attempts. ${this.#lastDisconnection?.reason || "Connection unavailable."} Start another watch when the connection is available.`
        );
      }
      this.#attempts += 1;
      this.#input.recovery.onReconnecting(this.#attempts);
      await this.#waitForReconnect(delayMs);
      const client = await this.#connectForRecovery();
      if (!client) {
        continue;
      }
      if (this.#finished || this.#manualClose) {
        client.close(1000, "stop requested");
        return;
      }
      this.#attach(client);
      // A replay refusal is final. Falling back to recent history could hide a
      // missing anchor or a gap beyond the page budget.
      await this.#input.recovery.onReconnected(
        client,
        () => this.#client === client && !this.#finished && !this.#manualClose
      );
      if (this.#client === client && !this.#finished) {
        // Stability starts after complete catch-up, rather than socket open.
        // An unfinished recovery must consume the same bounded retry episode.
        this.#connectedAt = Date.now();
        return;
      }
    }
  }

  async #connectForRecovery(): Promise<WsClient | null> {
    if (this.#finished || this.#manualClose) {
      return null;
    }
    try {
      return await connectWebSocket(this.#input.url, {
        headers: await this.#input.headers(),
        openTimeoutMs: OPEN_TIMEOUT_MS,
      });
    } catch (error) {
      if (this.#finished || this.#manualClose) {
        return null;
      }
      const status =
        error && typeof error === "object" && "status" in error
          ? error.status
          : undefined;
      if (
        typeof status === "number" &&
        status < 500 &&
        ![408, 429].includes(status)
      ) {
        throw error;
      }
      this.#lastDisconnection = {
        source: "error",
        error,
        reason: error instanceof Error ? error.message : String(error),
      };
      return null;
    }
  }

  async #waitForReconnect(delayMs: number): Promise<void> {
    await new Promise<void>((resolve) => {
      const signal = this.#abort.signal;
      const finish = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, delayMs);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) {
        finish();
      }
    });
  }

  #finish(event: Disconnection): void {
    if (this.#finished) {
      return;
    }
    this.#finished = true;
    this.#abort.abort();
    const client = this.#client;
    this.#client = null;
    if (event.source === "error") {
      client?.terminate();
      for (const handler of this.#errorHandlers) {
        handler(event.error ?? new Error(event.reason));
      }
    } else {
      for (const handler of this.#closeHandlers) {
        handler(event.code ?? 1006, event.reason);
      }
    }
    this.#resolveClosed();
  }
}
