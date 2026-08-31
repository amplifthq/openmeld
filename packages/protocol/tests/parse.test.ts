import { describe, expect, it } from "vitest";
import {
  MAX_TEXT_LENGTH,
  parseEnvelope,
  parseHello,
  parseIncoming,
  parseJsonObject,
  parseProfile,
  parseServerErrorFrame,
  parseSignalText,
} from "../src";

const MEMBER_NOTICE_HOST_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_NOTICE_TARGET_PROFILE_ID = "22222222-2222-4222-8222-222222222222";

describe("protocol parse", () => {
  it("parses profile", () => {
    const res = parseProfile({
      kind: "agent",
      profileId: "mira",
      profileHandle: "mira-agent",
      profileName: "Mira",
      owner: "Felix",
      agentControllerRef: "builtin:openclaw",
      agentControllerConversationId: "agent:ops:openmeld-space:demo--deadbeef",
      workingDirectory: " /tmp/demo ",
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.value.kind).toBe("agent");
    expect(res.value.profileId).toBe("mira");
    expect(res.value.profileHandle).toBe("mira-agent");
    expect(res.value.profileName).toBe("Mira");
    expect(res.value.owner).toBe("Felix");
    expect(res.value.agentControllerConversationId).toBe(
      "agent:ops:openmeld-space:demo--deadbeef"
    );
    expect(res.value.workingDirectory).toBe(" /tmp/demo ");
  });

  it("drops invalid workingDirectory while keeping the profile valid", () => {
    const res = parseProfile({
      kind: "agent",
      profileId: "mira",
      workingDirectory: { cwd: "/tmp/demo" },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }

    expect(res.value.workingDirectory).toBeUndefined();
  });

  it("parses hello", () => {
    const res = parseHello({
      type: "hello",
      profile: {
        kind: "agent",
        profileId: "mira",
        profileHandle: "mira-agent",
        profileName: "Mira",
        owner: "Felix",
      },
      capabilities: {
        liveSignalHistory: true,
        spaceMessageAddressing: true,
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.value.type).toBe("hello");
    expect(res.value.profile.profileId).toBe("mira");
    expect(res.value.profile.profileHandle).toBe("mira-agent");
    expect(res.value.profile.owner).toBe("Felix");
    expect(res.value.capabilities?.liveSignalHistory).toBe(true);
    expect(res.value.capabilities?.spaceMessageAddressing).toBe(true);
  });

  it("rejects hello without profile", () => {
    const res = parseHello({ type: "hello" });
    expect(res.ok).toBe(false);
  });

  it("parses signal.text", () => {
    const res = parseSignalText({
      type: "signal.text",
      data: {
        text: "hi",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: MEMBER_NOTICE_TARGET_PROFILE_ID,
          targetProfileKind: "human",
          targetMentionLabel: "Helper Human",
          addedByProfileId: MEMBER_NOTICE_HOST_PROFILE_ID,
          addedByDisplayName: "Felix",
        },
      },
    });
    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.value.data.text).toBe("hi");
    expect(res.value.data.meta).toEqual({
      purpose: "space_membership_join_notice",
      targetProfileId: MEMBER_NOTICE_TARGET_PROFILE_ID,
      targetProfileKind: "human",
      targetMentionLabel: "Helper Human",
      addedByProfileId: MEMBER_NOTICE_HOST_PROFILE_ID,
      addedByDisplayName: "Felix",
    });
  });

  it("parses signal.text attachment references", () => {
    const attachments = [
      {
        id: "attachment-1",
        mimeType: "image/png" as const,
        sizeBytes: 1024,
        width: 800,
        height: 600,
        fileName: "diagram.png",
      },
    ];
    const res = parseSignalText({
      type: "signal.text",
      data: {
        text: "Here is the diagram.",
        attachments,
      },
    });

    expect(res.ok).toBe(true);
    if (!res.ok) {
      return;
    }
    expect(res.value.data.attachments).toEqual(attachments);
  });

  it("rejects empty signal.text", () => {
    const res = parseSignalText({ type: "signal.text", data: { text: "   " } });
    expect(res.ok).toBe(false);
  });

  it("rejects malformed member notice meta that omits targetProfileKind", () => {
    const res = parseSignalText({
      type: "signal.text",
      data: {
        text: "hi",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: MEMBER_NOTICE_TARGET_PROFILE_ID,
          addedByProfileId: MEMBER_NOTICE_HOST_PROFILE_ID,
          addedByDisplayName: "Felix",
        },
      },
    });
    expect(res.ok).toBe(false);
  });

  it("rejects too long signal.text", () => {
    const res = parseSignalText({
      type: "signal.text",
      data: { text: "x".repeat(MAX_TEXT_LENGTH + 1) },
    });
    expect(res.ok).toBe(false);
  });

  it("parses json object", () => {
    const res = parseJsonObject('{"type":"hello"}');
    expect(res.ok).toBe(true);
  });

  it("rejects invalid json", () => {
    const res = parseJsonObject("{");
    expect(res.ok).toBe(false);
  });

  it("rejects json arrays", () => {
    const res = parseJsonObject('["hello"]');
    expect(res.ok).toBe(false);
  });

  it("parses signal envelope", () => {
    const res = parseEnvelope({
      v: 1,
      id: "evt-1",
      spaceId: "demo",
      ts: 1,
      profile: { kind: "agent", profileId: "mira" },
      type: "signal.text",
      data: { text: "hello" },
    });
    expect(res).not.toBeNull();
  });

  it("parses signal.status envelopes", () => {
    const res = parseEnvelope({
      v: 1,
      id: "evt-status-1",
      spaceId: "demo",
      ts: 2,
      profile: { kind: "agent", profileId: "mira" },
      type: "signal.status",
      data: {
        actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
        status: "done",
        dispatchId: "dispatch-1",
        text: "Ready for the next step.",
        generatedBy: "openmeld",
      },
    });
    expect(res).not.toBeNull();
  });

  it("parses signal.system_notice envelopes", () => {
    const res = parseEnvelope({
      v: 1,
      id: "evt-activity-1",
      spaceId: "demo",
      ts: 3,
      profile: { kind: "system", profileId: "openmeld.system.dispatch" },
      type: "signal.system_notice",
      data: {
        noticeType: "stay_silent",
        actorProfileId: "agt_33333333-3333-4333-8333-333333333333",
        dispatchId: "dispatch-activity-1",
        reason: "Handled privately.",
        text: "Research Agent chose to stay silent: Handled privately.",
        generatedBy: "openmeld",
      },
    });
    expect(res).not.toBeNull();
  });

  it("keeps legacy member-notice envelopes parseable", () => {
    const res = parseEnvelope({
      v: 1,
      id: "evt-legacy-notice",
      spaceId: "demo",
      ts: 1,
      profile: { kind: "human", profileId: "felix" },
      type: "signal.text",
      data: {
        text: "Felix added Helper to this space.",
        meta: {
          purpose: "space_membership_join_notice",
        },
      },
    });
    expect(res).not.toBeNull();
  });

  it("rejects envelope without required fields", () => {
    const res = parseEnvelope({
      v: 1,
      type: "signal.text",
      data: { text: "hello" },
    });
    expect(res).toBeNull();
  });

  it("rejects invalid signal envelope payload", () => {
    const res = parseEnvelope({
      v: 1,
      id: "evt-1",
      spaceId: "demo",
      ts: 1,
      profile: { kind: "agent", profileId: "mira" },
      type: "signal.text",
      data: { text: "   " },
    });
    expect(res).toBeNull();
  });

  it("parses presence envelope with object data", () => {
    const res = parseEnvelope({
      v: 1,
      id: "evt-join-1",
      spaceId: "demo",
      ts: 1,
      profile: { kind: "agent", profileId: "mira" },
      type: "presence.join",
      data: {},
    });
    expect(res).not.toBeNull();
  });

  it("rejects envelope with array data", () => {
    const res = parseEnvelope({
      v: 1,
      id: "evt-join-1",
      spaceId: "demo",
      ts: 1,
      profile: { kind: "agent", profileId: "mira" },
      type: "presence.join",
      data: [],
    });
    expect(res).toBeNull();
  });

  it("parses incoming hello ack", () => {
    const res = parseIncoming({
      type: "system.hello.ack",
      profile: { kind: "agent", profileId: "mira" },
    });
    expect(res).not.toBeNull();
  });

  it("parses incoming live invalidation frames", () => {
    const res = parseIncoming({
      type: "space.members.changed",
      spaceId: "demo",
      version: 101,
      profileIds: ["profile-1"],
      reason: "space.members.added",
    });
    expect(res).toEqual({
      type: "space.members.changed",
      spaceId: "demo",
      version: 101,
      profileIds: ["profile-1"],
      reason: "space.members.added",
    });

    expect(
      parseIncoming({
        type: "space.meta.changed",
        spaceId: "demo",
        version: 102,
        reason: "space.name.updated",
      })
    ).toEqual({
      type: "space.meta.changed",
      spaceId: "demo",
      version: 102,
      reason: "space.name.updated",
    });
  });

  it("parses incoming Agent stream snapshot frames", () => {
    const res = parseIncoming({
      type: "space.agent_stream_delta",
      v: 1,
      spaceId: "demo",
      streamId: "stream:sub_123",
      sequence: 1,
      profileId: "agt_11111111-1111-4111-8111-111111111111",
      triggerMessageId: "signal_1",
      dispatchId: "dispatch_1",
      textSnapshot: "Draft reply",
      state: "streaming",
      updatedAtMs: 1_805_000_000_000,
    });

    expect(res).toMatchObject({
      type: "space.agent_stream_delta",
      streamId: "stream:sub_123",
      sequence: 1,
      textSnapshot: "Draft reply",
    });
  });

  it("parses incoming websocket error frames", () => {
    const res = parseIncoming({
      error: "internal_error",
      requestId: "req-1",
      clientMessageId: "client-1",
    });
    expect(res).toEqual({
      error: "internal_error",
      requestId: "req-1",
      clientMessageId: "client-1",
    });
  });

  it("parses websocket error frames directly", () => {
    const res = parseServerErrorFrame({
      error: "internal_error",
      requestId: "req-1",
    });
    expect(res).toEqual({
      error: "internal_error",
      requestId: "req-1",
    });
  });

  it("rejects websocket error frames with non-string clientMessageId", () => {
    expect(
      parseIncoming({
        error: "internal_error",
        clientMessageId: 123,
      })
    ).toBeNull();
    expect(
      parseServerErrorFrame({
        error: "internal_error",
        clientMessageId: 123,
      })
    ).toBeNull();
  });
});
