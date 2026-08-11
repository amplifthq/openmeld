import { describe, expect, it } from "vitest";
import { waitForJsonMessage } from "./test-support/ws-stream";

class MockSocket extends EventTarget {
  removeCallCount = 0;

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void {
    this.removeCallCount += 1;
    super.removeEventListener(type, callback, options);
  }

  emitJson(value: unknown): void {
    this.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify(value),
      })
    );
  }
}

describe("waitForJsonMessage", () => {
  it("cleans up and rejects when predicate throws", async () => {
    const socket = new MockSocket();
    const pending = waitForJsonMessage(
      socket as unknown as WebSocket,
      () => {
        throw new Error("predicate exploded");
      },
      1000
    );

    socket.emitJson({ type: "signal.text", data: { text: "hi" } });

    await expect(pending).rejects.toThrow("predicate exploded");
    expect(socket.removeCallCount).toBe(3);
  });
});
