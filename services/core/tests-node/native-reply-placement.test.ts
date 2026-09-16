import type {
  NativeReplyPlacement,
  ResolveNativeReplyPlacementInput,
  SpaceThreadContext,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { chooseNativeReplyPlacement } from "../src/space/application/native-reply-placement";

const request: ResolveNativeReplyPlacementInput = {
  spaceId: "space-1",
  dispatchId: "dispatch-1",
  sourceSignalId: "source-1",
  profileId: "agent-1",
  defaultToThread: true,
  lock: true,
};
const threadContext: SpaceThreadContext = {
  threadId: "thr_11111111-1111-4111-8111-111111111111",
  rootSignalId: "root-1",
};

describe("Center Agent reply placement", () => {
  it.each([
    {
      directMessage: false,
      sourceThread: null,
      placement: undefined,
      useThread: true,
    },
    {
      directMessage: true,
      sourceThread: null,
      placement: undefined,
      useThread: false,
    },
    {
      directMessage: false,
      sourceThread: threadContext,
      placement: undefined,
      useThread: true,
    },
    {
      directMessage: true,
      sourceThread: threadContext,
      placement: undefined,
      useThread: true,
    },
    {
      directMessage: false,
      sourceThread: threadContext,
      placement: "conversation" as const,
      useThread: false,
    },
    {
      directMessage: false,
      sourceThread: null,
      placement: "conversation" as const,
      useThread: false,
    },
  ])("uses the requested surface for $directMessage/$placement", ({
    directMessage,
    sourceThread,
    placement,
    useThread,
  }) => {
    expect(
      chooseNativeReplyPlacement({
        request: { ...request, ...(placement ? { placement } : {}) },
        current: null,
        directMessage,
        sourceThread,
      })
    ).toEqual({ useThread, threadContext: useThread ? sourceThread : null });
  });

  it.each([
    null,
    threadContext,
  ])("keeps output placement fixed through retries and rejects a late move", (context) => {
    const current: NativeReplyPlacement = {
      dispatchId: request.dispatchId,
      sourceSignalId: request.sourceSignalId,
      profileId: request.profileId,
      locked: true,
      threadContext: context,
    };
    expect(
      chooseNativeReplyPlacement({
        request,
        current,
        directMessage: false,
        sourceThread: null,
      })
    ).toEqual({ current });
    expect(() =>
      chooseNativeReplyPlacement({
        request: { ...request, placement: context ? "conversation" : "thread" },
        current,
        directMessage: false,
        sourceThread: null,
      })
    ).toThrow("already_started");
    expect(() =>
      chooseNativeReplyPlacement({
        request: { ...request, profileId: "another-agent" },
        current,
        directMessage: false,
        sourceThread: null,
      })
    ).toThrow("identity_mismatch");
  });
});
