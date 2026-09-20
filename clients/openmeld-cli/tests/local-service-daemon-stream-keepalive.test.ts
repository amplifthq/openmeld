import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDaemonStreamKeepalive } from "../src/local-service/carrier/daemon-stream-keepalive";
import {
  DAEMON_STREAM_KEEPALIVE_INTERVAL_MS,
  DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS,
} from "../src/local-service/core/constants";

type ControlledTimer = {
  active: boolean;
  callback: () => void;
  dueAtMs: number;
  kind: "interval" | "timeout";
  repeatMs: number | null;
};

function installPausedTimerHarness() {
  vi.useRealTimers();
  let nowMs = 0;
  const timers: ControlledTimer[] = [];

  const schedule = (
    kind: ControlledTimer["kind"],
    callback: () => void,
    delayMs = 0
  ): ReturnType<typeof setTimeout> => {
    const timer: ControlledTimer = {
      active: true,
      callback,
      dueAtMs: nowMs + delayMs,
      kind,
      repeatMs: kind === "interval" ? delayMs : null,
    };
    timers.push(timer);
    return timer as unknown as ReturnType<typeof setTimeout>;
  };

  const cancel = (handle: unknown): void => {
    const timer = timers.find((candidate) => candidate === handle);
    if (timer) {
      timer.active = false;
    }
  };

  vi.spyOn(globalThis, "setTimeout").mockImplementation(((
    callback: () => void,
    delayMs?: number
  ) => schedule("timeout", callback, delayMs)) as typeof setTimeout);
  vi.spyOn(globalThis, "clearTimeout").mockImplementation(((handle: unknown) =>
    cancel(handle)) as typeof clearTimeout);
  vi.spyOn(globalThis, "setInterval").mockImplementation(((
    callback: () => void,
    delayMs?: number
  ) => schedule("interval", callback, delayMs)) as typeof setInterval);
  vi.spyOn(globalThis, "clearInterval").mockImplementation(((handle: unknown) =>
    cancel(handle)) as typeof clearInterval);

  const deliver = (timer: ControlledTimer): boolean => {
    if (!(timer.active && timer.dueAtMs <= nowMs)) {
      return false;
    }
    if (timer.kind === "interval") {
      timer.dueAtMs += timer.repeatMs ?? 0;
    } else {
      timer.active = false;
    }
    timer.callback();
    return true;
  };

  return {
    activeTimerCount: () => timers.filter((timer) => timer.active).length,
    advanceClockTo: (nextNowMs: number) => {
      nowMs = nextNowMs;
    },
    deliver,
    deliverAllDue: () => {
      while (true) {
        const next = timers
          .filter((timer) => timer.active && timer.dueAtMs <= nowMs)
          .sort((left, right) => left.dueAtMs - right.dueAtMs)[0];
        if (!next) {
          return;
        }
        deliver(next);
      }
    },
    findActiveTimer: (
      kind: ControlledTimer["kind"],
      dueAtMs: number
    ): ControlledTimer => {
      const timer = timers.find(
        (candidate) =>
          candidate.active &&
          candidate.kind === kind &&
          candidate.dueAtMs === dueAtMs
      );
      if (!timer) {
        throw new Error(`missing active ${kind} timer due at ${dueAtMs}`);
      }
      return timer;
    },
  };
}

describe("createDaemonStreamKeepalive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function createHarness(input?: { sendResult?: () => boolean }) {
    const pings: number[] = [];
    const sendResult = input?.sendResult ?? (() => true);
    const onPongTimeout = vi.fn();
    const keepalive = createDaemonStreamKeepalive({
      intervalMs: 1000,
      onPongTimeout,
      pongTimeoutMs: 300,
      sendPing: () => {
        const sent = sendResult();
        if (sent) {
          pings.push(Date.now());
        }
        return sent;
      },
    });
    return { keepalive, onPongTimeout, pings };
  }

  it("sends pings on the interval and stays alive while pongs answer in time", () => {
    const { keepalive, onPongTimeout, pings } = createHarness();
    keepalive.start();

    for (let round = 0; round < 3; round += 1) {
      vi.advanceTimersByTime(1000);
      keepalive.observePong();
    }

    expect(pings).toHaveLength(3);
    expect(onPongTimeout).not.toHaveBeenCalled();
    keepalive.stop();
  });

  it("reports a pong timeout exactly once and stops pinging a dead socket", () => {
    const { keepalive, onPongTimeout, pings } = createHarness();
    keepalive.start();

    vi.advanceTimersByTime(1000);
    expect(pings).toHaveLength(1);

    vi.advanceTimersByTime(300);
    expect(onPongTimeout).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(5000);
    expect(onPongTimeout).toHaveBeenCalledTimes(1);
    expect(pings).toHaveLength(1);
  });

  it("does not postpone an unanswered probe when another ping becomes due", () => {
    const onPongTimeout = vi.fn();
    const sendPing = vi.fn(() => true);
    const keepalive = createDaemonStreamKeepalive({
      intervalMs: 100,
      onPongTimeout,
      pongTimeoutMs: 300,
      sendPing,
    });
    keepalive.start();

    vi.advanceTimersByTime(400);

    expect(onPongTimeout).toHaveBeenCalledTimes(1);
    expect(sendPing).toHaveBeenCalledTimes(1);
  });

  it.each([
    { callbackOrder: "overdue ping first", pingFirst: true },
    { callbackOrder: "overdue deadline first", pingFirst: false },
  ])("stops once after a scheduling pause with $callbackOrder", ({
    pingFirst,
  }) => {
    const timers = installPausedTimerHarness();
    try {
      const onPongTimeout = vi.fn();
      const sendPing = vi.fn(() => true);
      const keepalive = createDaemonStreamKeepalive({
        onPongTimeout,
        sendPing,
      });
      keepalive.start();

      timers.advanceClockTo(DAEMON_STREAM_KEEPALIVE_INTERVAL_MS);
      const pingTimer = timers.findActiveTimer(
        "interval",
        DAEMON_STREAM_KEEPALIVE_INTERVAL_MS
      );
      timers.deliver(pingTimer);
      expect(sendPing).toHaveBeenCalledTimes(1);

      const pongDeadline = timers.findActiveTimer(
        "timeout",
        DAEMON_STREAM_KEEPALIVE_INTERVAL_MS +
          DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS
      );
      const nextPing = timers.findActiveTimer(
        "interval",
        DAEMON_STREAM_KEEPALIVE_INTERVAL_MS * 2
      );

      // Simulate suspension by moving the clock without delivering either
      // callback that became overdue during the gap.
      timers.advanceClockTo(
        DAEMON_STREAM_KEEPALIVE_INTERVAL_MS * 2 +
          DAEMON_STREAM_KEEPALIVE_PONG_TIMEOUT_MS +
          5000
      );
      for (const timer of pingFirst
        ? [nextPing, pongDeadline]
        : [pongDeadline, nextPing]) {
        timers.deliver(timer);
      }

      expect.soft(onPongTimeout).toHaveBeenCalledTimes(1);
      expect.soft(sendPing).toHaveBeenCalledTimes(1);

      timers.advanceClockTo(100_000);
      timers.deliverAllDue();
      expect.soft(onPongTimeout).toHaveBeenCalledTimes(1);
      expect.soft(sendPing).toHaveBeenCalledTimes(1);
      expect(timers.activeTimerCount()).toBe(0);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("does not time out when the pong arrives within the deadline", () => {
    const { keepalive, onPongTimeout } = createHarness();
    keepalive.start();

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(100);
    keepalive.observePong();
    vi.advanceTimersByTime(400);

    expect(onPongTimeout).not.toHaveBeenCalled();
    keepalive.stop();
  });

  it("does not arm the pong deadline when the ping was not sent", () => {
    const { keepalive, onPongTimeout, pings } = createHarness({
      sendResult: () => false,
    });
    keepalive.start();

    vi.advanceTimersByTime(1000);
    vi.advanceTimersByTime(1000);

    expect(pings).toHaveLength(0);
    expect(onPongTimeout).not.toHaveBeenCalled();
    keepalive.stop();
  });

  it("treats a throwing send as not sent instead of arming a false deadline", () => {
    const onPongTimeout = vi.fn();
    const keepalive = createDaemonStreamKeepalive({
      intervalMs: 1000,
      onPongTimeout,
      pongTimeoutMs: 300,
      sendPing: () => {
        throw new Error("socket closing");
      },
    });
    keepalive.start();

    vi.advanceTimersByTime(2000);

    expect(onPongTimeout).not.toHaveBeenCalled();
    keepalive.stop();
  });

  it("stop cancels both the ping interval and a pending pong deadline", () => {
    const { keepalive, onPongTimeout, pings } = createHarness();
    keepalive.start();

    vi.advanceTimersByTime(1000);
    expect(pings).toHaveLength(1);
    keepalive.stop();

    vi.advanceTimersByTime(5000);
    expect(pings).toHaveLength(1);
    expect(onPongTimeout).not.toHaveBeenCalled();
  });

  it("restart resets the previous schedule", () => {
    const { keepalive, onPongTimeout, pings } = createHarness();
    keepalive.start();
    vi.advanceTimersByTime(1000);
    expect(pings).toHaveLength(1);

    keepalive.start();
    vi.advanceTimersByTime(300);
    expect(onPongTimeout).not.toHaveBeenCalled();

    vi.advanceTimersByTime(700);
    expect(pings).toHaveLength(2);
    keepalive.stop();
  });
});
