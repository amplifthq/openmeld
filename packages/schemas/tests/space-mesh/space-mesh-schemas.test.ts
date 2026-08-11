import { describe, expect, it } from "vitest";
import {
  continuitySchema,
  dispatchBriefSchema,
  dispatchResultSchema,
  entryBriefSchema,
  openMeldSpaceActionSchema,
  SPACE_UPDATES_MAX_LIMIT,
  signalSystemNoticeFailureStageSchema,
  spaceContractSchema,
  spaceMeshSignalSystemNoticeSchema,
} from "../../src/index";
import { MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH } from "../../src/schemas/protocol/signal-reply-to";

const ACTOR_PROFILE_ID = "agt_33333333-3333-4333-8333-333333333333";
const TARGET_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

describe("space-mesh schemas", () => {
  it("accepts signal.system_notice reasonCode and failureStage as optional structured fields", () => {
    expect(
      spaceMeshSignalSystemNoticeSchema.safeParse({
        type: "signal.system_notice",
        data: {
          noticeType: "terminal_failure",
          actorProfileId: ACTOR_PROFILE_ID,
          actorName: "Research Agent",
          dispatchId: "dispatch-activity-1",
          replyTo: {
            signalId: "evt-1",
            profileId: TARGET_PROFILE_ID,
            profileKind: "human",
            profileName: "Felix",
            previewText: "Can you check this space?",
          },
          reason:
            "The model provider was unreachable. Check provider status or network access, then wake the agent again. (upstream_unreachable: the model provider had an issue)",
          reasonCode: "upstream_unreachable",
          failureStage: "execution",
          text: "Research Agent couldn't reply: The model provider was unreachable.",
          generatedBy: "openmeld",
        },
      }).success
    ).toBe(true);

    // Back-compat: both new fields stay optional so existing producers that
    // never send them keep parsing.
    expect(
      spaceMeshSignalSystemNoticeSchema.safeParse({
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: ACTOR_PROFILE_ID,
          dispatchId: "dispatch-activity-2",
          text: "Agent chose to stay silent.",
          generatedBy: "openmeld",
        },
      }).success
    ).toBe(true);

    expect(signalSystemNoticeFailureStageSchema.options).toEqual([
      "execution",
      "publication",
    ]);
    expect(
      spaceMeshSignalSystemNoticeSchema.safeParse({
        type: "signal.system_notice",
        data: {
          noticeType: "terminal_failure",
          dispatchId: "dispatch-activity-3",
          failureStage: "not_a_real_stage",
          text: "Agent couldn't reply.",
          generatedBy: "openmeld",
        },
      }).success
    ).toBe(false);
  });

  it("accepts the canonical space contract shape", () => {
    const parsed = spaceContractSchema.safeParse({
      version: 1,
      updatedAt: "2026-03-19T00:00:00.000Z",
      updatedBy: TARGET_PROFILE_ID,
      dispatchPolicy: {
        mode: "mention_only",
      },
      publicationMode: "collaboration",
      allowedActions: ["post_message", "post_status", "stay_silent"],
      resultArchivePolicy: {
        mode: "all_final_results",
      },
      spaceNote: "Keep public updates short and useful.",
      authorityOrder: "default",
      entryBrief: "default",
      dispatchBrief: "default",
    });

    expect(parsed.success).toBe(true);
  });

  it("accepts all canonical OpenMeld Space Actions", () => {
    const inputs = [
      {
        type: "post_message",
        observedThroughSignalId: "evt-observed-1",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: "evt-1",
          text: "Draft is ready.",
        },
        saveResult: true,
      },
      {
        type: "post_status",
        status: "needs_input",
        targetProfileId: TARGET_PROFILE_ID,
        text: "Need the target tone.",
        replyTo: { signalId: "evt-1" },
      },
      {
        type: "stay_silent",
        reason: "Handled privately.",
        saveResult: true,
      },
      {
        type: "read_updates",
        from: "last_public_reply",
        limit: 20,
      },
      {
        type: "read_result",
        by: { dispatchId: "dispatch-1" },
      },
    ];

    for (const input of inputs) {
      expect(openMeldSpaceActionSchema.safeParse(input).success).toBe(true);
    }

    const postMessage = openMeldSpaceActionSchema.parse(inputs[0]);
    expect(postMessage).toMatchObject({
      observedThroughSignalId: "evt-observed-1",
    });
  });

  it("rejects invalid OpenMeld Space Action payloads", () => {
    expect(
      openMeldSpaceActionSchema.safeParse({
        type: "post_status",
        status: "custom",
      }).success
    ).toBe(false);

    expect(
      openMeldSpaceActionSchema.safeParse({
        type: "read_updates",
        from: "last_public_reply",
        limit: 0,
      }).success
    ).toBe(false);

    expect(
      openMeldSpaceActionSchema.safeParse({
        type: "read_updates",
        from: "last_public_reply",
        limit: SPACE_UPDATES_MAX_LIMIT + 1,
      }).success
    ).toBe(false);

    expect(
      openMeldSpaceActionSchema.safeParse({
        type: "post_status",
        status: "done",
        text: "x".repeat(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH + 1),
      }).success
    ).toBe(false);
  });

  it("accepts continuity, entry brief, and dispatch brief", () => {
    expect(
      continuitySchema.safeParse({
        messagesSinceThen: 12,
        higherAuthorityUpdates: true,
      }).success
    ).toBe(true);

    expect(
      entryBriefSchema.safeParse({
        whatThisRoomIs: "OpenMeld Space is a thin collaboration layer.",
        youAre: "Poet Agent (@poet)",
        thisRoomIsFor: "Creative coordination and lightweight discussion.",
        howThisRoomWorks:
          "Mention wakes you. Choose an OpenMeld Space action if you want to affect the space.",
        ifUnsure: "Ask one short clarifying question first.",
      }).success
    ).toBe(true);

    expect(
      dispatchBriefSchema.safeParse({
        activatedBy: "Felix",
        sourceMessage: "@poet 写一首关于雨夜的诗",
        replyTarget: "Felix's current message",
        continuity: {
          messagesSinceThen: 3,
          higherAuthorityUpdates: false,
        },
        whatYouCanDoNow:
          "Choose one OpenMeld Space action: post_message, post_status, or stay_silent.",
      }).success
    ).toBe(true);
  });

  it("accepts signal.system_notice for stay_silent", () => {
    expect(
      spaceMeshSignalSystemNoticeSchema.safeParse({
        type: "signal.system_notice",
        data: {
          noticeType: "stay_silent",
          actorProfileId: ACTOR_PROFILE_ID,
          actorName: "Research Agent",
          dispatchId: "dispatch-activity-1",
          resultRef: "dispatch-result:dispatch-activity-1",
          replyTo: {
            signalId: "evt-1",
            profileId: TARGET_PROFILE_ID,
            profileKind: "human",
            profileName: "Felix",
            previewText: "Can you check this space?",
          },
          reason: "Handled privately.",
          text: "Research Agent chose to stay silent: Handled privately.",
          generatedBy: "openmeld",
        },
      }).success
    ).toBe(true);
  });

  it("accepts signal.system_notice for stopped Wake outcomes", () => {
    expect(
      spaceMeshSignalSystemNoticeSchema.safeParse({
        type: "signal.system_notice",
        data: {
          noticeType: "wake_stopped",
          actorProfileId: ACTOR_PROFILE_ID,
          actorName: "Research Agent",
          dispatchId: "dispatch-activity-1",
          resultRef: "wake-stop:dispatch-activity-1",
          replyTo: {
            signalId: "evt-1",
            profileId: TARGET_PROFILE_ID,
            profileKind: "human",
            profileName: "Felix",
            previewText: "Can you check this space?",
          },
          reason: "runtime_coordinator.wake_stop_local_control_accepted",
          text: "Wake was stopped for Research Agent.",
          generatedBy: "openmeld",
        },
      }).success
    ).toBe(true);
  });

  it("accepts dispatch results and enforces result kind boundaries", () => {
    expect(
      dispatchResultSchema.safeParse({
        resultRef: "result-1",
        dispatchId: "dispatch-1",
        spaceId: "space-1",
        actorProfileId: ACTOR_PROFILE_ID,
        replyToSignalId: "evt-1",
        resultKind: "text",
        finalText: "The poem is ready.",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: "evt-1",
          text: "The poem is ready.",
        },
        previewText: "The poem is ready.",
        publicOutcome: "system_notice",
        publishedSignalId: "evt-status-1",
        createdAt: "2026-03-19T00:00:00.000Z",
      }).success
    ).toBe(true);

    expect(
      dispatchResultSchema.safeParse({
        resultRef: "result-2",
        dispatchId: "dispatch-2",
        spaceId: "space-1",
        actorProfileId: ACTOR_PROFILE_ID,
        resultKind: "status",
        statusType: "done",
        publicOutcome: "post_status",
        createdAt: "2026-03-19T00:00:00.000Z",
      }).success
    ).toBe(true);

    expect(
      dispatchResultSchema.safeParse({
        resultRef: "result-3",
        dispatchId: "dispatch-3",
        spaceId: "space-1",
        actorProfileId: ACTOR_PROFILE_ID,
        resultKind: "text",
        publicOutcome: "stay_silent",
        createdAt: "2026-03-19T00:00:00.000Z",
      }).success
    ).toBe(false);

    expect(
      dispatchResultSchema.safeParse({
        resultRef: "result-4",
        dispatchId: "dispatch-4",
        spaceId: "space-1",
        actorProfileId: ACTOR_PROFILE_ID,
        resultKind: "status",
        statusType: "done",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "should fail",
        },
        publicOutcome: "post_status",
        createdAt: "2026-03-19T00:00:00.000Z",
      }).success
    ).toBe(false);
  });
});
