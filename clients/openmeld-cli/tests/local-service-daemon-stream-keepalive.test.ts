import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDaemonStreamKeepalive } from "../src/local-service/carrier/daemon-stream-keepalive";

describe("createDaemonStreamKeepalive", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
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
