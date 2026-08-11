import { MAX_TEXT_LENGTH } from "@openmeld/protocol";
import { describe, expect, it } from "vitest";
import {
  parseIncoming,
  parseServerErrorFrame,
  sanitizeText,
} from "../src/protocol/wire";

describe("wire", () => {
  it("sanitizes text and enforces protocol max length", () => {
    expect(sanitizeText(" hello ")).toEqual({ ok: true, value: "hello" });

    const tooLong = sanitizeText("x".repeat(MAX_TEXT_LENGTH + 1));
    expect(tooLong.ok).toBe(false);
    if (tooLong.ok) {
      return;
    }
    expect(tooLong.reason).toContain(String(MAX_TEXT_LENGTH));
  });

  it("parses hello ack through protocol parser", () => {
    const event = parseIncoming({
      type: "system.hello.ack",
      profile: {
        kind: "agent",
        profileId: "mira",
      },
    });
    expect(event).not.toBeNull();
  });

  it("parses websocket server error frames", () => {
    const frame = parseServerErrorFrame({
      error: "internal_error",
      requestId: "req-1",
      clientMessageId: "client-1",
    });
    expect(frame).toEqual({
      error: "internal_error",
      requestId: "req-1",
      clientMessageId: "client-1",
    });
  });

  it("keeps websocket server error frames out of live message parsing", () => {
    expect(
      parseIncoming({
        error: "internal_error",
        requestId: "req-1",
        clientMessageId: "client-1",
      })
    ).toBeNull();
  });

  it("keeps thread-scoped live signal frames out of the main CLI stream", () => {
    expect(
      parseIncoming({
        type: "space.signal",
        signal: {
          v: 1,
          id: "sig-thread-reply",
          spaceId: "space-1",
          ts: 1_762_874_400_000,
          type: "signal.text",
          profile: {
            kind: "agent",
            profileId: "felix-codex",
          },
          data: {
            text: "Thread reply",
          },
        },
        threadContext: {
          threadId: "thr_11111111-1111-4111-8111-111111111111",
          rootSignalId: "sig-root",
        },
        threadPlacement: {
          threadId: "thr_11111111-1111-4111-8111-111111111111",
          signalId: "sig-thread-reply",
          placement: "thread",
          createdAt: "2026-05-12T00:00:00.000Z",
        },
      })
    ).toBeNull();
  });

  it("quietly ignores Center Agent stream delta frames", () => {
    expect(
      parseIncoming({
        type: "space.agent_stream_delta",
        v: 1,
        spaceId: "space-1",
        streamId: "stream:submission-1",
        sequence: 1,
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        triggerMessageId: "signal-1",
        dispatchId: "dispatch-1",
        textSnapshot: "Draft reply",
        state: "streaming",
        updatedAtMs: 1_805_000_000_000,
      })
    ).toBeNull();
  });

  it("quietly ignores Center Agent stream part frames", () => {
    expect(
      parseIncoming({
        type: "space.agent_stream_part",
        v: 1,
        spaceId: "space-1",
        streamId: "stream:submission-1",
        sequence: 2,
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        triggerMessageId: "signal-1",
        dispatchId: "dispatch-1",
        part: {
          type: "tool",
          toolCallId: "tool-call-1",
          toolName: "openmeld_list_spaces",
          state: "input-available",
        },
        updatedAtMs: 1_805_000_000_001,
      })
    ).toBeNull();
  });

  it("quietly ignores Center Agent stream terminal frames", () => {
    expect(
      parseIncoming({
        type: "space.agent_stream_terminal",
        v: 1,
        spaceId: "space-1",
        streamId: "stream:submission-1",
        sequence: 2,
        profileId: "agt_11111111-1111-4111-8111-111111111111",
        triggerMessageId: "signal-1",
        dispatchId: "dispatch-1",
        terminal: {
          kind: "final_message",
          publishedSignalId: "signal-final-1",
        },
        updatedAtMs: 1_805_000_000_001,
      })
    ).toBeNull();
  });

  it("keeps Web live invalidation frames out of the main CLI stream", () => {
    expect(
      parseIncoming({
        type: "space.members.changed",
        spaceId: "space-1",
        version: 1_762_874_400_000,
        profileIds: ["agent-1"],
        reason: "space.members.added",
      })
    ).toBeNull();

    expect(
      parseIncoming({
        type: "agent.readiness.invalidated",
        spaceId: "space-1",
        version: 1_762_874_400_001,
        agentProfileIds: ["agent-1"],
        reason: "agent.profile.changed",
      })
    ).toBeNull();

    expect(
      parseIncoming({
        type: "space.meta.changed",
        spaceId: "space-1",
        version: 1_762_874_400_002,
        reason: "space.name.updated",
      })
    ).toBeNull();
  });
});
