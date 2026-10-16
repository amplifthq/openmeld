import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { watchSpaceActionReply } from "../src/local-service/dispatch/space-action-reply-stream";
import {
  createDispatchSpaceActionContext,
  readDispatchSpaceActionRecord,
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
  const stream = watchSpaceActionReply({
    context,
    publish,
    connection: () => connection,
  });
  cleanups.push(stream.stop);
  const reply = (text: string, placement?: "conversation" | "thread") =>
    writeDispatchSpaceActionRecord({
      context,
      command: "reply",
      action: {
        type: "post_message",
        ...(placement ? { placement } : {}),
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
    ...stream,
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
    reply("The result is ready.", "conversation");
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      "The result is ready.",
      "conversation"
    );
    vi.advanceTimersByTime(4750);
    expect(publish).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenLastCalledWith("The result is ready.", undefined);
    stop();
    vi.advanceTimersByTime(1000);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("updates a reviewed proposal in place and replays after reconnect", () => {
    const { context, publish, reply, reconnect, pause, resume } = setup();
    reply("First proposal.", "conversation");
    vi.advanceTimersByTime(250);
    pause();
    reconnect();
    vi.advanceTimersByTime(5250);
    expect(publish).toHaveBeenCalledTimes(1);
    resume();
    supersedeDispatchSpaceActionRecordForReconsideration({ context });
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenLastCalledWith("", undefined);
    reply("Reviewed proposal.", "thread");
    vi.advanceTimersByTime(250);
    expect(publish.mock.calls).toEqual([
      ["First proposal.", "conversation"],
      ["", undefined],
      ["Reviewed proposal.", "thread"],
    ]);
    reconnect();
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenLastCalledWith("Reviewed proposal.", undefined);
    expect(publish).toHaveBeenCalledTimes(4);
  });

  it("retracts an archived proposal during reconsideration and keeps silence on reconnect", () => {
    const { context, publish, reply, reconnect } = setup();
    reply("Retracted proposal.");
    vi.advanceTimersByTime(250);
    supersedeDispatchSpaceActionRecordForReconsideration({ context });
    publish.mockReturnValueOnce(false);
    vi.advanceTimersByTime(500);
    expect(publish).toHaveBeenLastCalledWith("", undefined);
    expect(publish).toHaveBeenCalledTimes(3);
    writeDispatchSpaceActionRecord({
      context,
      command: "silent",
      action: { type: "stay_silent", reason: "Review found no reply needed." },
    });
    reconnect();
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenLastCalledWith("", undefined);
    expect(publish).toHaveBeenCalledTimes(4);
  });

  it("retains an unsent proposal under transport backpressure", () => {
    const { publish, reply } = setup();
    publish.mockReturnValueOnce(false);
    reply("Saved while disconnected.", "conversation");
    vi.advanceTimersByTime(500);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls).toEqual([
      ["Saved while disconnected.", "conversation"],
      ["Saved while disconnected.", "conversation"],
    ]);
    vi.advanceTimersByTime(500);
    expect(publish).toHaveBeenCalledTimes(2);
  });

  it("replaces explicit reply revisions and preserves full text beyond the preview cap", () => {
    const { context, publish, reply } = setup();
    reply("First answer.");
    vi.advanceTimersByTime(250);
    const complete = "x".repeat(40 * 1024);
    reply(complete);
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenLastCalledWith(
      complete.slice(0, 32 * 1024),
      undefined
    );
    reply("First answer.");
    vi.advanceTimersByTime(250);
    expect(publish).toHaveBeenCalledTimes(2);
    expect(readDispatchSpaceActionRecord({ context })).toMatchObject({
      status: "loaded",
      record: { action: { messageEnvelope: { text: complete } } },
    });
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

  it("does not replace a reply with silence or write through an interrupted writer lock", () => {
    const { context, reply } = setup();
    reply("Keep the recorded reply.");
    expect(() =>
      writeDispatchSpaceActionRecord({
        context,
        command: "silent",
        action: { type: "stay_silent", reason: "Changed my mind." },
      })
    ).toThrow("already been recorded");
    mkdirSync(`${context.actionRecordPath}.lock`);
    expect(() => reply("A concurrent replacement.")).toThrow();
    expect(() =>
      supersedeDispatchSpaceActionRecordForReconsideration({ context })
    ).toThrow();
    expect(readDispatchSpaceActionRecord({ context })).toMatchObject({
      status: "loaded",
      record: {
        action: { messageEnvelope: { text: "Keep the recorded reply." } },
      },
    });
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
