import { describe, expect, it } from "vitest";
import {
  agentProfileIdSchema,
  CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
  coreReadinessFactsChangedSchema,
  helloAckSchema,
  helloSchema,
  incomingServerMessageSchema,
  MAX_PROFILE_NAME_LENGTH,
  MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH,
  MAX_TEXT_LENGTH,
  openMeldRuntimeProfileIdSchema,
  profileSchema,
  profileWorkspaceModeSchema,
  sanitizeSignalTextPreview,
  serverErrorFrameSchema,
  signalEnvelopeSchema,
  signalStatusEnvelopeSchema,
  signalStatusSchema,
  signalSystemNoticeEnvelopeSchema,
  signalSystemNoticeSchema,
  signalTextSchema,
  spaceLiveSignalFrameSchema,
  uuidProfileIdSchema,
} from "../../src/index";

const HUMAN_PROFILE_ID = "11111111-1111-4111-8111-111111111111";
const SECOND_HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const SECOND_AGENT_PROFILE_ID = "agt_44444444-4444-4444-8444-444444444444";
const THIRD_AGENT_PROFILE_ID = "agt_55555555-5555-4555-8555-555555555555";

describe("protocol schemas", () => {
  it("normalizes profile fallback/trimming/truncation", () => {
    const result = profileSchema.safeParse({
      kind: "invalid-kind",
      profileId: `  ${AGENT_PROFILE_ID}  `,
      profileHandle: "  mira-agent  ",
      profileName: `  ${"x".repeat(MAX_PROFILE_NAME_LENGTH + 12)} `,
      owner: ` ${"o".repeat(MAX_PROFILE_NAME_LENGTH + 8)} `,
      ignored: "drop-me",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toEqual({
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      profileHandle: "mira-agent",
      profileName: "x".repeat(MAX_PROFILE_NAME_LENGTH),
      owner: "o".repeat(MAX_PROFILE_NAME_LENGTH),
    });
  });

  it("keeps origin facts on agent profiles without rewriting workingDirectory", () => {
    const result = profileSchema.safeParse({
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      profileName: "OpenClaw Phase One",
      agentControllerRef: "builtin:openclaw",
      agentControllerConversationId: " runtime-session-1 ",
      workingDirectory: " /tmp/My Project ",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.agentControllerConversationId).toBe("runtime-session-1");
    expect(result.data.workingDirectory).toBe(" /tmp/My Project ");
  });

  it("keeps whitespace-only workingDirectory values verbatim", () => {
    const result = profileSchema.safeParse({
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      workingDirectory: " ",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.workingDirectory).toBe(" ");
  });

  it("drops invalid workingDirectory inputs instead of rewriting them", () => {
    const overlongWorkingDirectory = `/tmp/${"x".repeat(4097)}`;

    const nonString = profileSchema.safeParse({
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      workingDirectory: { cwd: "/tmp/demo" },
    });
    expect(nonString.success).toBe(true);
    if (nonString.success) {
      expect(nonString.data.workingDirectory).toBeUndefined();
    }

    const empty = profileSchema.safeParse({
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      workingDirectory: "",
    });
    expect(empty.success).toBe(true);
    if (empty.success) {
      expect(empty.data.workingDirectory).toBeUndefined();
    }

    const overlong = profileSchema.safeParse({
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      workingDirectory: overlongWorkingDirectory,
    });
    expect(overlong.success).toBe(true);
    if (overlong.success) {
      expect(overlong.data.workingDirectory).toBeUndefined();
    }

    const withNul = profileSchema.safeParse({
      kind: "agent",
      profileId: AGENT_PROFILE_ID,
      workingDirectory: "/tmp/demo\u0000bad",
    });
    expect(withNul.success).toBe(true);
    if (withNul.success) {
      expect(withNul.data.workingDirectory).toBeUndefined();
    }
  });

  it("accepts the shared profile workspace mode vocabulary", () => {
    expect(
      profileWorkspaceModeSchema.safeParse("openmeld_managed").success
    ).toBe(true);
    expect(profileWorkspaceModeSchema.safeParse("custom").success).toBe(true);
  });

  it("rejects invalid profile workspace modes", () => {
    expect(
      profileWorkspaceModeSchema.safeParse("provider_workspace").success
    ).toBe(false);
    expect(profileWorkspaceModeSchema.safeParse("daemon_cwd").success).toBe(
      false
    );
  });

  it("rejects invalid profile id", () => {
    const result = profileSchema.safeParse({
      profileId: "  ",
    });
    expect(result.success).toBe(false);
  });

  it("enforces runtime profile id formats", () => {
    expect(uuidProfileIdSchema.safeParse(HUMAN_PROFILE_ID).success).toBe(true);
    expect(agentProfileIdSchema.safeParse(AGENT_PROFILE_ID).success).toBe(true);
    expect(
      openMeldRuntimeProfileIdSchema.safeParse(SECOND_HUMAN_PROFILE_ID).success
    ).toBe(true);
    expect(
      openMeldRuntimeProfileIdSchema.safeParse(SECOND_AGENT_PROFILE_ID).success
    ).toBe(true);
    expect(uuidProfileIdSchema.safeParse(AGENT_PROFILE_ID).success).toBe(false);
    expect(agentProfileIdSchema.safeParse(HUMAN_PROFILE_ID).success).toBe(
      false
    );
    expect(openMeldRuntimeProfileIdSchema.safeParse("hum_fake").success).toBe(
      false
    );
  });

  it("parses hello with normalized profile", () => {
    const result = helloSchema.safeParse({
      type: "hello",
      profile: { profileId: `  ${SECOND_AGENT_PROFILE_ID} ` },
      capabilities: {
        liveSignalHistory: true,
        spaceMessageAddressing: true,
      },
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.profile.profileId).toBe(SECOND_AGENT_PROFILE_ID);
    expect(result.data.profile.kind).toBe("agent");
    expect(result.data.capabilities?.liveSignalHistory).toBe(true);
    expect(result.data.capabilities?.spaceMessageAddressing).toBe(true);
  });

  it("parses signal.text and trims text", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: { text: "   hello openmeld   " },
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.data.text).toBe("hello openmeld");
  });

  it("parses the Core readiness facts changed marker", () => {
    const result = coreReadinessFactsChangedSchema.safeParse({
      agentProfileId: AGENT_PROFILE_ID,
      kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
    });

    expect(result.success).toBe(true);
  });

  it("accepts the Core readiness facts changed marker on signal text meta", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        meta: {
          coreReadinessFactsChanged: {
            agentProfileId: AGENT_PROFILE_ID,
            kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
          },
        },
        text: "Runner replied.",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.data.meta?.coreReadinessFactsChanged).toEqual({
      agentProfileId: AGENT_PROFILE_ID,
      kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
    });
  });

  it("accepts optional reply staleness metadata on signal text", () => {
    const withStaleness = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "Reply written against earlier room context.",
        meta: {
          staleness: {
            newMessagesDuringComposition: 2,
          },
        },
      },
    });
    const withoutStaleness = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "Reply written against current room context.",
        meta: {},
      },
    });

    expect(withStaleness.success).toBe(true);
    expect(withoutStaleness.success).toBe(true);
    if (!withStaleness.success) {
      return;
    }
    expect(withStaleness.data.data.meta?.staleness).toEqual({
      newMessagesDuringComposition: 2,
    });
  });

  it("accepts signal.text with a canonical messageEnvelope carrier", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "@Budget Analyst(wake) Hello.",
        messageEnvelope: {
          activationTargets: [THIRD_AGENT_PROFILE_ID],
          referenceTargets: [],
          text: "@Budget Analyst(wake) Hello.",
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects signal.text when messageEnvelope.text does not match text", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "hello openmeld",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "different text",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects signal.text when messageEnvelope.replyToSignalId conflicts with replyTo.signalId", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "reply body",
        replyTo: {
          signalId: "sig-reply-1",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Felix",
          previewText: "hello there",
        },
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: "sig-other",
          text: "reply body",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("parses signal.status with canonical fields", () => {
    const result = signalStatusSchema.safeParse({
      type: "signal.status",
      data: {
        actorProfileId: SECOND_AGENT_PROFILE_ID,
        coreReadinessFactsChanged: {
          agentProfileId: SECOND_AGENT_PROFILE_ID,
          kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
        },
        status: "needs_input",
        dispatchId: " dispatch-1 ",
        resultRef: " result-1 ",
        replyTo: {
          signalId: " evt-source-5 ",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: " Felix ",
          previewText: " please clarify the theme ",
        },
        targetProfileId: SECOND_HUMAN_PROFILE_ID,
        text: " missing tone and length ",
        generatedBy: "openmeld",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toEqual({
      type: "signal.status",
      data: {
        actorProfileId: SECOND_AGENT_PROFILE_ID,
        coreReadinessFactsChanged: {
          agentProfileId: SECOND_AGENT_PROFILE_ID,
          kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
        },
        status: "needs_input",
        dispatchId: "dispatch-1",
        resultRef: "result-1",
        replyTo: {
          signalId: "evt-source-5",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Felix",
          previewText: "please clarify the theme",
        },
        targetProfileId: SECOND_HUMAN_PROFILE_ID,
        text: "missing tone and length",
        generatedBy: "openmeld",
      },
    });
  });

  it("rejects signal.status when text is blank", () => {
    const result = signalStatusSchema.safeParse({
      type: "signal.status",
      data: {
        actorProfileId: SECOND_AGENT_PROFILE_ID,
        status: "done",
        dispatchId: "dispatch-2",
        text: "   ",
        generatedBy: "openmeld",
      },
    });

    expect(result.success).toBe(false);
  });

  it("parses signal.system_notice with canonical fields", () => {
    const result = signalSystemNoticeSchema.safeParse({
      type: "signal.system_notice",
      data: {
        noticeType: "stay_silent",
        actorProfileId: SECOND_AGENT_PROFILE_ID,
        actorName: " Research Agent ",
        coreReadinessFactsChanged: {
          agentProfileId: SECOND_AGENT_PROFILE_ID,
          kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
        },
        dispatchId: " dispatch-activity-1 ",
        resultRef: " result-activity-1 ",
        replyTo: {
          signalId: " evt-source-8 ",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: " Felix ",
          previewText: " please keep this private ",
        },
        reason: " handled privately ",
        text: " Research Agent chose to stay silent: handled privately. ",
        generatedBy: "openmeld",
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toEqual({
      type: "signal.system_notice",
      data: {
        noticeType: "stay_silent",
        actorProfileId: SECOND_AGENT_PROFILE_ID,
        actorName: "Research Agent",
        coreReadinessFactsChanged: {
          agentProfileId: SECOND_AGENT_PROFILE_ID,
          kind: CORE_READINESS_FACTS_CHANGED_MARKER_KIND,
        },
        dispatchId: "dispatch-activity-1",
        resultRef: "result-activity-1",
        replyTo: {
          signalId: "evt-source-8",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Felix",
          previewText: "please keep this private",
        },
        reason: "handled privately",
        text: "Research Agent chose to stay silent: handled privately.",
        generatedBy: "openmeld",
      },
    });
  });

  it("preserves supported signal.text replyTo fields", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "Thanks, looking now.",
        replyTo: {
          signalId: "  evt-source-1  ",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "  Felix  ",
          previewText: "  Can you check the logs?  ",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.data.replyTo).toEqual({
      signalId: "evt-source-1",
      profileId: SECOND_HUMAN_PROFILE_ID,
      profileKind: "human",
      profileName: "Felix",
      previewText: "Can you check the logs?",
    });
  });

  it("rejects signal.text replyTo when profileName exceeds the max length", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "Thanks",
        replyTo: {
          signalId: "evt-source-2",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "x".repeat(MAX_PROFILE_NAME_LENGTH + 1),
          previewText: "hello",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects signal.text replyTo when previewText is empty or too long", () => {
    const emptyPreview = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "Thanks",
        replyTo: {
          signalId: "evt-source-3",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Ops Bot",
          previewText: "   ",
        },
      },
    });
    const tooLongPreview = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "Thanks",
        replyTo: {
          signalId: "evt-source-4",
          profileId: SECOND_AGENT_PROFILE_ID,
          profileKind: "agent",
          profileName: "Ops Bot",
          previewText: "x".repeat(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH + 1),
        },
      },
    });

    expect(emptyPreview.success).toBe(false);
    expect(tooLongPreview.success).toBe(false);
  });

  it("sanitizes shared signal text previews with the canonical helper", () => {
    expect(sanitizeSignalTextPreview("  hello\nthere\tteam  ")).toBe(
      "hello there team"
    );
    expect(
      sanitizeSignalTextPreview(
        'hello there\n```openmeld-space-action\n{"type":"stay_silent","reason":"private"}\n```'
      )
    ).toBe("hello there");
    expect(
      sanitizeSignalTextPreview(
        '```openmeld-space-action\n{"type":"stay_silent","reason":"private"}'
      )
    ).toBeNull();
    expect(sanitizeSignalTextPreview("\u0007\u0008   ")).toBeNull();
    const overlongPreview = `hello ${"x".repeat(
      MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH + 20
    )}`;
    const truncatedPreview = sanitizeSignalTextPreview(overlongPreview);
    expect(truncatedPreview).not.toBeNull();
    expect(truncatedPreview?.startsWith("hello")).toBe(true);
    expect((truncatedPreview ?? "").length).toBeLessThanOrEqual(
      MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH
    );
    expect(
      sanitizeSignalTextPreview("x".repeat(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH))
    ).toHaveLength(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH);
  });

  it("accepts signal.status envelopes in the shared protocol union", () => {
    const result = signalStatusEnvelopeSchema.safeParse({
      v: 1,
      id: "evt-status-1",
      spaceId: "demo",
      ts: 1,
      profile: { kind: "agent", profileId: SECOND_AGENT_PROFILE_ID },
      type: "signal.status",
      data: {
        actorProfileId: SECOND_AGENT_PROFILE_ID,
        status: "done",
        dispatchId: "dispatch-3",
        resultRef: "result-3",
        text: "Ready for the next step.",
        generatedBy: "openmeld",
      },
    });

    expect(result.success).toBe(true);
    expect(
      signalEnvelopeSchema.safeParse({
        v: 1,
        id: "evt-status-1",
        spaceId: "demo",
        ts: 1,
        profile: { kind: "agent", profileId: SECOND_AGENT_PROFILE_ID },
        type: "signal.status",
        data: {
          actorProfileId: SECOND_AGENT_PROFILE_ID,
          status: "done",
          dispatchId: "dispatch-3",
          text: "Ready for the next step.",
          generatedBy: "openmeld",
        },
      }).success
    ).toBe(true);
  });

  it("accepts signal.system_notice envelopes in the shared protocol union", () => {
    const result = signalSystemNoticeEnvelopeSchema.safeParse({
      v: 1,
      id: "evt-activity-1",
      spaceId: "demo",
      ts: 1,
      profile: { kind: "system", profileId: "openmeld.system.dispatch" },
      type: "signal.system_notice",
      data: {
        noticeType: "stay_silent",
        actorProfileId: SECOND_AGENT_PROFILE_ID,
        actorName: "Research Agent",
        dispatchId: "dispatch-activity-3",
        resultRef: "dispatch-result:dispatch-activity-3",
        reason: "Handled privately.",
        text: "Research Agent chose to stay silent: Handled privately.",
        generatedBy: "openmeld",
      },
    });

    expect(result.success).toBe(true);
    expect(
      incomingServerMessageSchema.safeParse({
        v: 1,
        id: "evt-activity-1",
        spaceId: "demo",
        ts: 1,
        profile: { kind: "system", profileId: "openmeld.system.dispatch" },
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: SECOND_AGENT_PROFILE_ID,
          actorName: "Research Agent",
          dispatchId: "dispatch-activity-3",
          resultRef: "dispatch-result:dispatch-activity-3",
          reason: "Handled privately.",
          text: "Research Agent chose to stay silent: Handled privately.",
          generatedBy: "openmeld",
        },
      }).success
    ).toBe(true);
  });

  it("preserves supported signal.text meta fields for member notices", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "host added helper to this space",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: SECOND_HUMAN_PROFILE_ID,
          targetProfileKind: "human",
          targetMentionLabel: "Helper Human",
          addedByProfileId: HUMAN_PROFILE_ID,
          addedByDisplayName: "  Felix  ",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.data.meta).toEqual({
      purpose: "space_membership_join_notice",
      targetProfileId: SECOND_HUMAN_PROFILE_ID,
      targetProfileKind: "human",
      targetMentionLabel: "Helper Human",
      addedByProfileId: HUMAN_PROFILE_ID,
      addedByDisplayName: "Felix",
    });
  });

  it("preserves supported Wake progress correlation fields in signal.text meta", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "Starting Wake for @Codex...",
        meta: {
          transient: true,
          purpose: "dispatch_activity_dispatching",
          dispatchId: "dispatch-1",
          sourceEventId: "sig-source-1",
          sourceClientMessageId: "client-message-1",
          errorCode: "daemon.profile.offline",
          runtimeDeviceDisplayName: "  Felix's MacBook Pro  ",
          targetProfileId: SECOND_AGENT_PROFILE_ID,
          targetMentionLabel: "Codex",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.data.meta).toMatchObject({
      dispatchId: "dispatch-1",
      errorCode: "daemon.profile.offline",
      runtimeDeviceDisplayName: "Felix's MacBook Pro",
      sourceClientMessageId: "client-message-1",
      sourceEventId: "sig-source-1",
    });
  });

  it("drops legacy targetProfileHandle from signal.text meta", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "host added helper to this space",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: SECOND_HUMAN_PROFILE_ID,
          targetProfileKind: "human",
          targetProfileHandle: "helper-human",
          addedByProfileId: HUMAN_PROFILE_ID,
          addedByDisplayName: "Felix",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.data.meta).toEqual({
      purpose: "space_membership_join_notice",
      targetProfileId: SECOND_HUMAN_PROFILE_ID,
      targetProfileKind: "human",
      addedByProfileId: HUMAN_PROFILE_ID,
      addedByDisplayName: "Felix",
    });
  });

  it("accepts optional signal.text correlation meta fields", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "hello",
        meta: {
          clientMessageId: "client-1",
          sourceEventId: "evt-1",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.data.meta).toMatchObject({
      clientMessageId: "client-1",
      sourceEventId: "evt-1",
    });
  });

  it("rejects non-string signal.text clientMessageId values", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "hello",
        meta: {
          clientMessageId: 123,
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("preserves supported signal.text meta fields for member removal notices", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "Felix removed Ops Bot from this space",
        meta: {
          purpose: "space_membership_remove_notice",
          targetProfileId: SECOND_AGENT_PROFILE_ID,
          targetProfileKind: "agent",
          targetProfileName: "  Ops Bot  ",
          removedByProfileId: HUMAN_PROFILE_ID,
          removedByDisplayName: "  Felix  ",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.data.meta).toEqual({
      purpose: "space_membership_remove_notice",
      targetProfileId: SECOND_AGENT_PROFILE_ID,
      targetProfileKind: "agent",
      targetProfileName: "Ops Bot",
      removedByProfileId: HUMAN_PROFILE_ID,
      removedByDisplayName: "Felix",
    });
  });

  it("preserves supported signal.text meta fields for transient preview signals", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "preview text",
        meta: {
          transient: true,
          purpose: "agent_reply_preview",
          dispatchId: "dispatch-preview-1",
          targetProfileId: THIRD_AGENT_PROFILE_ID,
          targetProfileName: "  Demo Bot  ",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.data.meta).toEqual({
      transient: true,
      purpose: "agent_reply_preview",
      dispatchId: "dispatch-preview-1",
      targetProfileId: THIRD_AGENT_PROFILE_ID,
      targetProfileName: "Demo Bot",
    });
  });

  it("preserves supported signal.text meta fields for transient continuity warnings", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "⚠️ Demo Bot conversation ID rotated unexpectedly; OpenMeld adopted the new ID to keep replies working.",
        meta: {
          transient: true,
          purpose: "conversation_continuity_warning",
          dispatchId: "dispatch-warning-1",
          targetProfileId: SECOND_AGENT_PROFILE_ID,
          targetProfileName: "  Demo Bot  ",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data.data.meta).toEqual({
      transient: true,
      purpose: "conversation_continuity_warning",
      dispatchId: "dispatch-warning-1",
      targetProfileId: SECOND_AGENT_PROFILE_ID,
      targetProfileName: "Demo Bot",
    });
  });

  it("rejects malformed member notices that omit required recovery fields", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "host added helper to this space",
        meta: {
          purpose: "space_membership_join_notice",
          targetProfileId: SECOND_HUMAN_PROFILE_ID,
          addedByProfileId: HUMAN_PROFILE_ID,
          addedByDisplayName: "Felix",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects malformed member removal notices that omit required actor fields", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: {
        text: "host removed helper from this space",
        meta: {
          purpose: "space_membership_remove_notice",
          targetProfileId: SECOND_HUMAN_PROFILE_ID,
          targetProfileKind: "human",
        },
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects too long signal.text", () => {
    const result = signalTextSchema.safeParse({
      type: "signal.text",
      data: { text: "x".repeat(MAX_TEXT_LENGTH + 1) },
    });
    expect(result.success).toBe(false);
  });

  it("parses signal envelope for text payload", () => {
    const result = signalEnvelopeSchema.safeParse({
      v: 1,
      id: " evt-1 ",
      spaceId: " room-a ",
      ts: 100,
      profile: { profileId: AGENT_PROFILE_ID },
      type: "signal.text",
      data: { text: "  hi  " },
      extraField: "ignored",
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toEqual({
      v: 1,
      id: "evt-1",
      spaceId: "room-a",
      ts: 100,
      profile: { kind: "agent", profileId: AGENT_PROFILE_ID },
      type: "signal.text",
      data: { text: "hi" },
    });
  });

  it("parses signal envelope with replyTo payload", () => {
    const result = signalEnvelopeSchema.safeParse({
      v: 1,
      id: " evt-reply-1 ",
      spaceId: " room-a ",
      ts: 200,
      profile: { profileId: AGENT_PROFILE_ID },
      type: "signal.text",
      data: {
        text: "  on it  ",
        replyTo: {
          signalId: " evt-source-5 ",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "  Felix  ",
          previewText: "  Please check prod  ",
        },
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }

    expect(result.data).toEqual({
      v: 1,
      id: "evt-reply-1",
      spaceId: "room-a",
      ts: 200,
      profile: { kind: "agent", profileId: AGENT_PROFILE_ID },
      type: "signal.text",
      data: {
        text: "on it",
        replyTo: {
          signalId: "evt-source-5",
          profileId: SECOND_HUMAN_PROFILE_ID,
          profileKind: "human",
          profileName: "Felix",
          previewText: "Please check prod",
        },
      },
    });
  });

  it("keeps legacy member-notice envelopes readable even when recovery fields are missing", () => {
    const result = signalEnvelopeSchema.safeParse({
      v: 1,
      id: "evt-legacy-notice",
      spaceId: "room-a",
      ts: 100,
      profile: { profileId: AGENT_PROFILE_ID },
      type: "signal.text",
      data: {
        text: "Felix added Helper to this space.",
        meta: {
          purpose: "space_membership_join_notice",
        },
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects presence envelope with non-object data", () => {
    const result = signalEnvelopeSchema.safeParse({
      v: 1,
      id: "evt-join",
      spaceId: "room-a",
      ts: 101,
      profile: { profileId: AGENT_PROFILE_ID },
      type: "presence.join",
      data: [],
    });
    expect(result.success).toBe(false);
  });

  it("accepts presence envelope with object data", () => {
    const result = signalEnvelopeSchema.safeParse({
      v: 1,
      id: "evt-join",
      spaceId: "room-a",
      ts: 101,
      profile: { profileId: AGENT_PROFILE_ID },
      type: "presence.join",
      data: { role: "observer" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts system.hello.ack via incoming schema", () => {
    const result = incomingServerMessageSchema.safeParse({
      type: "system.hello.ack",
      profile: { kind: "human", profileId: HUMAN_PROFILE_ID },
    });
    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(helloAckSchema.safeParse(result.data).success).toBe(true);
  });

  it("accepts thread-aware live signal frames via incoming schema", () => {
    const frame = {
      type: "space.signal",
      signal: {
        v: 1,
        id: "sig-thread-1",
        spaceId: "room-a",
        ts: 101,
        profile: { kind: "human", profileId: HUMAN_PROFILE_ID },
        type: "signal.text",
        data: { text: "Thread reply" },
      },
      threadContext: {
        threadId: "thr_11111111-1111-4111-8111-111111111111",
        rootSignalId: "sig-root-1",
      },
      threadPlacement: {
        threadId: "thr_11111111-1111-4111-8111-111111111111",
        signalId: "sig-thread-1",
        placement: "thread",
        createdAt: "2026-04-11T00:00:00.000Z",
      },
      history: {
        persisted: true,
      },
    };

    expect(spaceLiveSignalFrameSchema.safeParse(frame).success).toBe(true);
    expect(incomingServerMessageSchema.safeParse(frame).success).toBe(true);
  });

  it("accepts live invalidation frames via incoming schema", () => {
    expect(
      incomingServerMessageSchema.safeParse({
        type: "space.members.changed",
        spaceId: "room-a",
        version: 101,
        profileIds: [AGENT_PROFILE_ID],
        reason: "space.members.added",
      }).success
    ).toBe(true);
    expect(
      incomingServerMessageSchema.safeParse({
        type: "agent.readiness.invalidated",
        spaceId: "room-a",
        version: 102,
        agentProfileIds: [AGENT_PROFILE_ID],
        reason: "agent.readiness.refresh_requested",
      }).success
    ).toBe(true);
    expect(
      incomingServerMessageSchema.safeParse({
        type: "space.meta.changed",
        spaceId: "room-a",
        version: 103,
        reason: "space.name.updated",
      }).success
    ).toBe(true);
    expect(
      incomingServerMessageSchema.safeParse({
        type: "wake.progress.changed",
        spaceId: "room-a",
        version: 104,
        agentProfileIds: [AGENT_PROFILE_ID],
        clientMessageIds: ["client-message-1"],
        reason: "runtime_coordinator.wake_progress_changed",
      }).success
    ).toBe(true);
  });

  it("rejects unsupported incoming type", () => {
    const result = incomingServerMessageSchema.safeParse({
      type: "hello",
      profile: { profileId: AGENT_PROFILE_ID },
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-string websocket error frame clientMessageId values", () => {
    expect(
      serverErrorFrameSchema.safeParse({
        error: "internal_error",
        clientMessageId: 123,
      }).success
    ).toBe(false);
    expect(
      incomingServerMessageSchema.safeParse({
        error: "internal_error",
        clientMessageId: 123,
      }).success
    ).toBe(false);
  });
});
