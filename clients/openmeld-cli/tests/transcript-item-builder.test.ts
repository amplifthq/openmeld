import type { SignalEnvelope, SignalTextReplyTo } from "@openmeld/protocol";
import { AGENT_REPLY_PREVIEW_PURPOSE } from "@openmeld/schemas";
import type { MessageEnvelope } from "@openmeld/schemas/types";
import { buildSignalIndex } from "@openmeld/space";
import { describe, expect, it } from "vitest";
import { buildHumanTranscriptItemFromEvent } from "../src/space/transcript/transcript-item-builder";

const TEST_REPLY_REF: SignalTextReplyTo = {
  signalId: "sig-source-1",
  profileId: "agt_source",
  profileKind: "agent",
  profileName: "Source Agent",
  previewText: "Earlier reply preview",
};

function createTextSignal(input?: {
  id?: string;
  profile?: SignalEnvelope["profile"];
  text?: string;
  messageEnvelope?: MessageEnvelope;
  replyTo?: SignalTextReplyTo;
  meta?: Record<string, unknown>;
}): SignalEnvelope {
  return {
    v: 1,
    id: input?.id ?? "sig-1",
    spaceId: "space-1",
    ts: Date.UTC(2026, 2, 17, 12, 0, 0),
    profile: input?.profile ?? {
      kind: "human",
      profileId: "hum_felix",
      profileName: "Felix",
    },
    type: "signal.text",
    data: {
      text: input?.text ?? "hello",
      ...(input?.messageEnvelope
        ? { messageEnvelope: input.messageEnvelope }
        : {}),
      ...(input?.replyTo ? { replyTo: input.replyTo } : {}),
      ...(input?.meta ? { meta: input.meta } : {}),
    },
  };
}

function createStatusSignal(input?: {
  profile?: SignalEnvelope["profile"];
  text?: string;
  replyTo?: SignalTextReplyTo;
}): SignalEnvelope {
  return {
    v: 1,
    id: "status-1",
    spaceId: "space-1",
    ts: Date.UTC(2026, 2, 17, 12, 5, 0),
    profile: input?.profile ?? {
      kind: "agent",
      profileId: "agt_hi_agent",
      profileName: "hi-agent",
    },
    type: "signal.status",
    data: {
      actorProfileId: "agt_hi_agent",
      status: "done",
      dispatchId: "dispatch-1",
      text: input?.text ?? "Status update",
      generatedBy: "openmeld",
      ...(input?.replyTo ? { replyTo: input.replyTo } : {}),
    },
  };
}

function createSystemNoticeSignal(input?: {
  profile?: SignalEnvelope["profile"];
  text?: string;
  replyTo?: SignalTextReplyTo;
}): SignalEnvelope {
  return {
    v: 1,
    id: "system-notice-1",
    spaceId: "space-1",
    ts: Date.UTC(2026, 2, 17, 12, 6, 0),
    profile: input?.profile ?? {
      kind: "system",
      profileId: "openmeld-system",
      profileName: "OpenMeld System",
    },
    type: "signal.system_notice",
    data: {
      noticeType: "stay_silent",
      actorProfileId: "agt_hi_agent",
      dispatchId: "dispatch-1",
      text:
        input?.text ?? "hi-agent chose to stay silent: keeping this private.",
      generatedBy: "openmeld",
      ...(input?.replyTo ? { replyTo: input.replyTo } : {}),
    },
  };
}

function buildItem(
  event: SignalEnvelope,
  signalIndex?: ReadonlyMap<string, SignalEnvelope>
) {
  return buildHumanTranscriptItemFromEvent({
    event,
    ownerDisplayNameByUserId: new Map(),
    selfProfileId: "hum_felix",
    sessionProfileIdentity: {
      kind: "human",
      openMeldProfileId: "hum_felix",
      ownerUserId: "owner-felix",
      ownerName: "Felix",
    },
    signalIndex,
  });
}

describe("transcript item builder", () => {
  it("extracts signal text replyTo into transcript replyRef", () => {
    const item = buildItem(
      createTextSignal({
        text: "Reply body",
        replyTo: TEST_REPLY_REF,
      })
    );

    expect(item).toMatchObject({
      kind: "message",
      replyRef: TEST_REPLY_REF,
    });
  });

  it("does not create a transcript replyRef when signal text has no replyTo", () => {
    const item = buildItem(createTextSignal({ text: "Plain body" }));

    expect(item).toMatchObject({
      kind: "message",
    });
    expect(item?.replyRef).toBeUndefined();
  });

  it("does not attach workflow projection to plain source signals", () => {
    const item = buildItem(createTextSignal({ text: "Plain body" }));

    expect(item?.replyWorkflowProjection).toBeUndefined();
  });

  it("does not attach replyRef to system-profile signal.text notices", () => {
    const item = buildItem(
      createTextSignal({
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        text: "System notice",
        replyTo: TEST_REPLY_REF,
      })
    );

    expect(item).toMatchObject({
      kind: "system_notice",
    });
    expect(item?.replyRef).toBeUndefined();
  });

  it("treats OpenMeld system signal.status as a system notice without replyRef", () => {
    const item = buildItem(
      createStatusSignal({
        profile: {
          kind: "system",
          profileId: "openmeld-system",
          profileName: "OpenMeld System",
        },
        text: "Permission denied while finalizing the reply.",
        replyTo: TEST_REPLY_REF,
      })
    );

    expect(item).toMatchObject({
      kind: "system_notice",
      line: expect.stringContaining(
        "Permission denied while finalizing the reply."
      ),
    });
    expect(item?.replyRef).toBeUndefined();
  });

  it("preserves replyRef for signal.system_notice events", () => {
    const item = buildItem(
      createSystemNoticeSignal({
        replyTo: TEST_REPLY_REF,
      })
    );

    expect(item).toMatchObject({
      kind: "system_notice",
      replyRef: TEST_REPLY_REF,
    });
  });

  it("returns null for transient hint signals even if they carry replyTo", () => {
    const item = buildItem(
      createTextSignal({
        text: "preview",
        replyTo: TEST_REPLY_REF,
        meta: {
          transient: true,
          purpose: AGENT_REPLY_PREVIEW_PURPOSE,
        },
      })
    );

    expect(item).toBeNull();
  });

  it("derives transcript replyRef from shared read projection when signal text only has messageEnvelope.replyToSignalId", () => {
    const source = createTextSignal({
      id: "sig-source-2",
      profile: {
        kind: "agent",
        profileId: "agt_source",
        profileName: "Source Agent",
      },
      text: "Earlier reply preview",
    });
    const reply = createTextSignal({
      id: "sig-reply-2",
      text: "Reply body",
      messageEnvelope: {
        text: "Reply body",
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-source-2",
      },
    });

    const item = buildItem(reply, buildSignalIndex([source, reply]));

    expect(item).toMatchObject({
      kind: "message",
      replyRef: {
        signalId: "sig-source-2",
        profileId: "agt_source",
        profileKind: "agent",
        profileName: "Source Agent",
        previewText: "Earlier reply preview",
      },
    });
    expect(item?.messageReadProjection?.replyToSignalId).toBe("sig-source-2");
    expect(item?.replyWorkflowProjection).toMatchObject({
      publicOutcome: "post_message",
      publishedSignalId: "sig-reply-2",
      publishedSignalType: "signal.text",
      replyToSignalId: "sig-source-2",
    });
  });

  it("attaches shared workflow projection to public status updates", () => {
    const source = createTextSignal({
      id: "sig-source-3",
      text: "@hi-agent wake up",
    });
    const status = createStatusSignal({
      text: "Status update",
      replyTo: {
        signalId: "sig-source-3",
        profileId: "hum_felix",
        profileKind: "human",
        profileName: "Felix",
        previewText: "@hi-agent wake up",
      },
    });

    const item = buildItem(status, buildSignalIndex([source, status]));

    expect(item?.replyWorkflowProjection).toMatchObject({
      publicOutcome: "post_status",
      publishedSignalType: "signal.status",
      hasPublicSignal: true,
      replyToSignalId: "sig-source-3",
    });
  });
});
