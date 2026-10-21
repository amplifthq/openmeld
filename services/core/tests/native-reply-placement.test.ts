import { runInDurableObject } from "cloudflare:test";
import type { ResolveNativeReplyPlacementInput } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { upsertSpaceMetaRecord } from "../src/space/infrastructure/sql/space-meta-repo";
import { insertSignalRecord } from "../src/space/infrastructure/sql/space-signal-repo";
import { insertSpaceThreadSignalPlacement } from "../src/space/infrastructure/sql/space-thread-repo";
import type { Space } from "../src/space/transport/do/space";
import { env } from "../test-support/worker-env";

const PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";

describe("Space-owned native reply placement", () => {
  it.each([
    false,
    true,
  ])("persists the destination, keeps source scope, and honors an explicit main reply (DM=%s)", async (directMessage) => {
    const namespace = (
      env as unknown as { OPENMELD_SPACES: DurableObjectNamespace<Space> }
    ).OPENMELD_SPACES;
    const stub = namespace.get(namespace.newUniqueId());
    const spaceId = stub.id.toString();
    const now = new Date().toISOString();
    await runInDurableObject(stub, (_instance, state) => {
      upsertSpaceMetaRecord(state.storage.sql, {
        v: 1,
        spaceId,
        organizationId: "org-placement",
        visibility: "private",
        accessMode: "members_only",
        createdAt: now,
        updatedAt: now,
        ...(directMessage ? { directMessage: { pairKey: "human-agent" } } : {}),
      });
      for (const id of ["source", "follow-up"]) {
        insertSignalRecord(state.storage.sql, {
          v: 1,
          id,
          spaceId,
          ts: Date.now(),
          type: "signal.text",
          profile: {
            kind: "human",
            profileId: "55555555-5555-4555-8555-555555555555",
            profileName: "Maya",
          },
          data: { text: "Please review this." },
        });
      }
    });
    const request: ResolveNativeReplyPlacementInput = {
      spaceId,
      dispatchId: "dispatch-default",
      sourceSignalId: "source",
      profileId: PROFILE_ID,
      defaultToThread: true,
      lock: true,
    };
    const result = await stub.rpcResolveNativeReplyPlacement(request);
    if (directMessage) {
      expect(result.threadContext).toBeNull();
    } else {
      expect(result.threadContext?.rootSignalId).toBe("source");
      const sibling = await stub.rpcResolveNativeReplyPlacement({
        ...request,
        dispatchId: "dispatch-sibling",
        profileId: "agt_44444444-4444-4444-8444-444444444444",
      });
      expect(sibling.threadContext).toEqual(result.threadContext);
    }
    expect(await stub.rpcResolveNativeReplyPlacement(request)).toEqual(result);
    await runInDurableObject(stub, async (instance) => {
      await expect(
        instance.rpcResolveNativeReplyPlacement({
          ...request,
          profileId: "another-agent",
        })
      ).rejects.toThrow("identity_mismatch");
    });
    // An expected rejection must not reset the object or lose the original decision.
    expect(await stub.rpcResolveNativeReplyPlacement(request)).toEqual(result);

    const explicitMain = await stub.rpcResolveNativeReplyPlacement({
      ...request,
      dispatchId: "dispatch-main",
      placement: "conversation",
    });
    expect(explicitMain.threadContext).toBeNull();
    await runInDurableObject(stub, async (instance) => {
      await expect(
        instance.rpcResolveNativeReplyPlacement({
          ...request,
          dispatchId: "dispatch-main",
          placement: "thread",
        })
      ).rejects.toThrow("already_started");
    });

    const thread = await stub.rpcResolveNativeReplyPlacement({
      ...request,
      dispatchId: "dispatch-thread",
      placement: "thread",
    });
    expect(thread.threadContext?.rootSignalId).toBe("source");
    const threadId = thread.threadContext?.threadId;
    if (!threadId) {
      throw new Error("Expected a Thread destination");
    }
    await runInDurableObject(stub, (_instance, state) => {
      insertSpaceThreadSignalPlacement(state.storage.sql, {
        signalId: "follow-up",
        threadId,
        placement: "thread",
        createdAt: now,
      });
    });
    const followUp = await stub.rpcResolveNativeReplyPlacement({
      ...request,
      dispatchId: "dispatch-follow-up",
      sourceSignalId: "follow-up",
    });
    expect(followUp.threadContext).toEqual(thread.threadContext);
    const mainFromThread = await stub.rpcResolveNativeReplyPlacement({
      ...request,
      dispatchId: "dispatch-exit-thread",
      sourceSignalId: "follow-up",
      placement: "conversation",
    });
    expect(mainFromThread.threadContext).toBeNull();

    const movable = { ...request, dispatchId: "dispatch-movable", lock: false };
    await stub.rpcResolveNativeReplyPlacement({
      ...movable,
      placement: "thread",
    });
    await stub.rpcApplyAgentStreamDelta({
      v: 1,
      spaceId,
      dispatchId: movable.dispatchId,
      triggerMessageId: "source",
      profileId: PROFILE_ID,
      streamId: "movable-stream",
      sequence: 1,
      kind: "text",
      textSnapshot: "Partial answer",
    });
    // Receiving answer text must not freeze the Agent's choice.
    const mainChoice = await stub.rpcResolveNativeReplyPlacement({
      ...movable,
      placement: "conversation",
    });
    expect(mainChoice).toMatchObject({ threadContext: null, locked: false });
    expect(
      (
        await stub.rpcResolveNativeReplyPlacement({
          ...movable,
          placement: "thread",
        })
      ).threadContext
    ).toEqual(thread.threadContext);
    await stub.rpcResolveNativeReplyPlacement({
      ...movable,
      placement: "conversation",
      lock: true,
    });
    const terminal = await stub.rpcCloseAgentStream({
      spaceId,
      streamId: "movable-stream",
      terminal: { kind: "final_message", publishedSignalId: "final-reply" },
    });
    expect(terminal?.replyThreadRootSignalId).toBeNull();
    await runInDurableObject(stub, async (instance) => {
      await expect(
        instance.rpcResolveNativeReplyPlacement({
          ...movable,
          placement: "thread",
        })
      ).rejects.toThrow("already_started");
    });
  });
});
