import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchSpaceActionReply } from "../src/local-service/dispatch/space-action-reply-stream";
import {
  createDispatchSpaceActionContext,
  supersedeDispatchSpaceActionRecordForReconsideration,
  writeDispatchSpaceActionRecord,
} from "../src/runtime/dispatch-space-action-context";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) {
    cleanup();
  }
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const home = mkdtempSync(`${tmpdir()}/openmeld-reply-stream-`);
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  const { context } = createDispatchSpaceActionContext({
    env: { OPENMELD_HOME: home },
    attemptId: "attempt-1",
    dispatchId: "dispatch-1",
    replyToSignalId: "source-1",
    sourceEventId: "source-1",
    spaceId: "space-1",
    targetProfileId: "agt_current",
    taskId: "task-1",
    spaceContractSnapshot: null,
    sendTargetReference: {
      status: "loaded",
      projection: [],
      referenceLines: [],
    },
  });
  const publish = vi.fn(() => true);
  let connection = {};
  const stop = watchSpaceActionReply({
    context,
    publish,
    connection: () => connection,
  });
  cleanups.push(stop);
  const reply = (text: string) =>
    writeDispatchSpaceActionRecord({
      context,
      command: "reply",
      action: {
        type: "post_message",
        messageEnvelope: {
          text,
          activationTargets: [],
          referenceTargets: [],
          mentionTargets: [],
        },
      },
    });
  return {
    context,
    publish,
    reply,
    stop,
    reconnect: () => {
      connection = {};
    },
  };
}

describe("durable Space Action reply streaming", () => {
  it("shows a saved reply while the controller is still running and deduplicates it", () => {
    const { publish, reply, stop } = setup();
    vi.advanceTimersByTime(500);
    expect(publish).not.toHaveBeenCalled();
    reply("The result is ready.");
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      "The result is ready.",
      undefined
    );
    vi.advanceTimersByTime(750_000);
    expect(publish).toHaveBeenCalledTimes(1);
    stop();
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("updates a reviewed proposal in place and replays after reconnect", () => {
    const { context, publish, reply, reconnect } = setup();
    reply("First proposal.");
    vi.advanceTimersByTime(250);
    supersedeDispatchSpaceActionRecordForReconsideration({ context });
    reply("Reviewed proposal.");
    vi.advanceTimersByTime(250);
    expect(publish.mock.calls).toEqual([
      ["First proposal.", undefined],
      ["Reviewed proposal.", undefined],
    ]);
    reconnect();
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenLastCalledWith("Reviewed proposal.", undefined);
    expect(publish).toHaveBeenCalledTimes(3);
  });

  it("retains an unsent proposal under transport backpressure", () => {
    const { publish, reply } = setup();
    publish.mockReturnValueOnce(false);
    reply("Saved while disconnected.");
    vi.advanceTimersByTime(500);
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("does not publish a silent action as reply text", () => {
    const { context, publish } = setup();
    writeDispatchSpaceActionRecord({
      context,
      command: "silent",
      action: { type: "stay_silent", reason: "No reply needed." },
    });
    vi.advanceTimersByTime(500);
    expect(publish).not.toHaveBeenCalled();
  });

  it("retries a socket that closes during send without crashing the controller", () => {
    const { publish, reply } = setup();
    publish.mockImplementationOnce(() => {
      throw new Error("Socket closed");
    });
    reply("Saved before disconnect.");
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
