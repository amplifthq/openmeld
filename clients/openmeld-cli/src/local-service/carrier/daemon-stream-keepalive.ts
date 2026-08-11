import {
  DAEMON_STREAM_KEEPALIVE_INTERVAL_MS,
  DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS,
} from "../core/constants";

export type DaemonStreamKeepalive = {
  observePong(): void;
  start(): void;
  stop(): void;
};

// Daemon stream keepalive with a PONG watchdog. Every PING must be answered
// by the hub's auto-responded PONG within the pong timeout; a missed PONG
// means the socket is half-open (sends silently dropped), so the watchdog
// reports the timeout and stops. The owner terminates the socket, which
// hands control to the normal reconnect path — the hub redelivers in-flight
// dispatch pushes on reconnect. A blind PING with no response check cannot
// detect a half-open socket at all.
export function createDaemonStreamKeepalive(input: {
  intervalMs?: number;
  onPongTimeout: () => void;
  pongTimeoutMs?: number;
  // Returns true only when a PING was actually written to the socket; the
  // watchdog arms its PONG deadline only for pings that went out.
  sendPing: () => boolean;
}): DaemonStreamKeepalive {
  const intervalMs = input.intervalMs ?? DAEMON_STREAM_KEEPALIVE_INTERVAL_MS;
  const pongTimeoutMs =
    input.pongTimeoutMs ?? DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS;
  let pingTimer: NodeJS.Timeout | null = null;
  let pongDeadlineTimer: NodeJS.Timeout | null = null;

  const clearPongDeadline = (): void => {
    if (!pongDeadlineTimer) {
      return;
    }
    clearTimeout(pongDeadlineTimer);
    pongDeadlineTimer = null;
  };

  const stop = (): void => {
    if (pingTimer) {
      clearInterval(pingTimer);
      pingTimer = null;
    }
    clearPongDeadline();
  };

  const armPongDeadline = (): void => {
    clearPongDeadline();
    pongDeadlineTimer = setTimeout(() => {
      pongDeadlineTimer = null;
      // Stop before reporting so a dead socket is never pinged again while
      // the owner tears it down.
      stop();
      input.onPongTimeout();
    }, pongTimeoutMs);
  };

  return {
    observePong(): void {
      clearPongDeadline();
    },
    start(): void {
      stop();
      pingTimer = setInterval(() => {
        let sent = false;
        try {
          sent = input.sendPing();
        } catch {
          // Socket already closing; the close path stops this keepalive.
          sent = false;
        }
        if (sent) {
          armPongDeadline();
        }
      }, intervalMs);
    },
    stop,
  };
}
