import { MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  buildAgentFacingMentalModelLines,
  buildAgentFacingMentalModelParagraph,
  buildAgentFacingPublicationModeGuideLines,
  buildCompactDispatchActionGuidanceLines,
  buildDefaultSpaceContract,
  buildSpaceEntryBriefNeedMoreLine,
  buildSystemNoticeText,
  composeDispatchBrief,
  composeEntryBrief,
  DEFAULT_SPACE_CONTRACT_FIELDS,
  deriveContinuity,
  normalizeOpenMeldSpaceAction,
  normalizeOpenMeldSpaceEgressAction,
  OPENMELD_GUIDE_URL,
  renderSpaceEntryBrief,
  resolveGuideEntry,
  resolveResultArchiveBehavior,
  resolveSpacePublicationRequirement,
} from "../src";

describe("space-mesh", () => {
  it("builds the canonical default space contract", () => {
    expect(
      buildDefaultSpaceContract({
        updatedAt: "2026-03-19T00:00:00.000Z",
        updatedBy: "system",
      })
    ).toEqual({
      version: 1,
      updatedAt: "2026-03-19T00:00:00.000Z",
      updatedBy: "system",
      ...DEFAULT_SPACE_CONTRACT_FIELDS,
    });
  });

  it("resolves a skill guide entry", () => {
    expect(resolveGuideEntry({ source: "skill" })).toBe(
      "Use the OpenMeld guide only if you need exact command details."
    );
    expect(
      resolveGuideEntry({
        source: "skill",
        label: "the installed OpenMeld skill",
      })
    ).toBe(
      "Use the installed OpenMeld skill only if you need exact OpenMeld command details."
    );
  });

  it("resolves a CLI prompt guide entry", () => {
    expect(
      resolveGuideEntry({
        source: "cli_prompt",
        command: " openmeld prompt ",
      })
    ).toBe("Use the OpenMeld guide only if you need exact command details.");
  });

  it("keeps the agent-facing mental model compact", () => {
    expect(buildAgentFacingMentalModelLines()).toEqual([
      "OpenMeld: a user wakes an Agent Profile in a Space, the correct local OpenMeld Service carries the local run, and the Space shows a visible reply or an explicit visible failure.",
      "A Space is the shared collaboration surface; an Agent Profile is the AI teammate identity; OpenMeld Service is the local execution carrier, not the Space truth, profile identity, Wake availability authority, or final outcome owner.",
      "Default Collaboration mode keeps private agent work local. Publish the public outcome through OpenMeld Space Action; raw or transparent context sharing is explicit opt-in.",
    ]);
    expect(buildAgentFacingMentalModelParagraph()).toContain(
      "the Space shows a visible reply or an explicit visible failure"
    );
  });

  it("keeps publication-mode guidance separate from dispatch-specific requirements", () => {
    expect(buildAgentFacingPublicationModeGuideLines()).toEqual([
      "Collaboration mode is the default: agents publish concise public outcomes through OpenMeld Space Action rather than mirror all private work into the Space.",
      "Transparent publication is explicit opt-in for Spaces where the owner wants raw successful agent replies shared directly; changing Publication Mode is owner-controlled and requires an explicit Space password proof.",
      "The current Space contract decides the final dispatch rule. In a Wake, follow the dispatch prompt for that Space's Publication Mode.",
    ]);
  });

  it("composes an entry brief with trimmed canonical fields", () => {
    expect(
      composeEntryBrief({
        whatThisRoomIs: "  OpenMeld Space is a thin collaboration layer.  ",
        youAre: "  Poet Agent (@poet)  ",
        thisRoomIsFor: "  Creative collaboration.  ",
        howThisRoomWorks: "  Mention-only, status-first.  ",
        ifUnsure: "  Ask one short clarifying question first.  ",
      })
    ).toEqual({
      whatThisRoomIs: "OpenMeld Space is a thin collaboration layer.",
      youAre: "Poet Agent (@poet)",
      thisRoomIsFor: "Creative collaboration.",
      howThisRoomWorks: "Mention-only, status-first.",
      ifUnsure: "Ask one short clarifying question first.",
    });
  });

  it("composes a dispatch brief with trimmed canonical fields", () => {
    expect(
      composeDispatchBrief({
        activatedBy: "  Felix  ",
        sourceMessage: "  @poet write a poem  ",
        replyTarget: "  Felix's message  ",
        continuity: {
          messagesSinceThen: 4,
          higherAuthorityUpdates: true,
        },
        whatYouCanDoNow:
          "  Choose one OpenMeld Space action: post_message, post_status, or stay_silent.  ",
      })
    ).toEqual({
      activatedBy: "Felix",
      sourceMessage: "@poet write a poem",
      replyTarget: "Felix's message",
      continuity: {
        messagesSinceThen: 4,
        higherAuthorityUpdates: true,
      },
      whatYouCanDoNow:
        "Choose one OpenMeld Space action: post_message, post_status, or stay_silent.",
    });
  });

  it("builds the canonical Entry Brief pointer from shared guide sources", () => {
    expect(
      buildSpaceEntryBriefNeedMoreLine({
        cliEntry: "openmeld-dev",
        spaceId: "space_launch",
        targetProfileId: "agt_reviewer",
      })
    ).toBe(
      `run \`openmeld-dev space board space_launch --profile agt_reviewer --view agent\` for live space state (members, working now, recent outcomes), or read the OpenMeld manual at ${OPENMELD_GUIDE_URL} / run \`openmeld-dev prompt space\`.`
    );
  });

  it("renders the canonical Space Entry Brief without legacy Room fields", () => {
    expect(
      renderSpaceEntryBrief({
        needMore: "read the live board",
        spaceGuide: "First line.\nSecond line.",
        thisSpace: '"Launch Room" — Coordinate the launch',
        whatThisSpaceIs: "A shared collaboration surface.",
        youAre: "Reviewer, Profile ID: agt_reviewer",
      })
    ).toBe(
      [
        "Space Entry Brief:",
        "- What this space is: A shared collaboration surface.",
        "- You are: Reviewer, Profile ID: agt_reviewer",
        '- This space: "Launch Room" — Coordinate the launch',
        "- Space guide (standing rules set by this Space's owners; follow them for all work in this Space, with OpenMeld rules and safety boundaries taking precedence):",
        "First line.",
        "Second line.",
        "- Need more: read the live board",
      ].join("\n")
    );
  });

  it("keeps Dispatch Brief action decisions compact and contract-aware", () => {
    expect(
      buildCompactDispatchActionGuidanceLines({
        allowedActions: ["post_message", "post_status", "stay_silent"],
        allowsRawReplyWithoutAction: false,
      })
    ).toEqual([
      "Complete this Wake with exactly one final outcome: reply or silent.",
      "A requested personal answer, acknowledgement, or result remains due even when it matches another member's answer. Choose silent only when no requested or useful contribution remains.",
    ]);
    expect(
      buildCompactDispatchActionGuidanceLines({
        allowedActions: ["post_status", "stay_silent"],
        allowsRawReplyWithoutAction: false,
      })
    ).toEqual([
      "Complete this Wake with exactly one final outcome: silent.",
      "A requested personal answer, acknowledgement, or result remains due even when it matches another member's answer. Choose silent only when no requested or useful contribution remains.",
    ]);
  });

  it("keeps a legacy status-only contract closed instead of granting reply permission", () => {
    const policy = resolveSpacePublicationRequirement({
      publicationMode: "collaboration",
      allowedActions: ["post_status"],
    });
    expect(policy.allowedActions).toEqual(["post_status"]);
    expect(policy.actionGuidanceLines.join("\n")).toContain(
      "No current final tool is authorized"
    );
    const guidance = buildCompactDispatchActionGuidanceLines({
      allowedActions: ["post_status"],
      allowsRawReplyWithoutAction: false,
    });
    expect(guidance[0]).toContain("retired final action");
    expect(guidance[0]).not.toContain("exactly one final outcome: reply");
  });

  it("derives continuity from objective runtime facts", () => {
    expect(
      deriveContinuity({
        messagesSinceThen: 12,
        higherAuthorityUpdateCount: 2,
      })
    ).toEqual({
      messagesSinceThen: 12,
      higherAuthorityUpdates: true,
    });
  });

  it("resolves collaboration publication requirements from one shared helper", () => {
    expect(
      resolveSpacePublicationRequirement({
        publicationMode: "collaboration",
        allowedActions: ["stay_silent", "post_message"],
      })
    ).toEqual({
      actionGuidanceLines: [
        "Use reply for public answers, known limitations, error explanations, or requests for help. You do not need shell or repository access to explain that you cannot complete a task.",
        "Use the dispatch-scoped Space Action stay_silent action only when you intentionally do not want OpenMeld to publish a public reply.",
        "Use existing Tasks for durable collaboration commitments and the Board to read their summary. Do not create a Task merely to acknowledge a message.",
      ],
      actionRequirementLine:
        "Final outcome: record exactly one permitted dispatch-scoped OpenMeld Space Action through the supplied interface. Your answer text never selects or substitutes for that action.",
      allowedActions: ["post_message", "stay_silent"],
      allowsRawReplyWithoutAction: false,
      howThisSpaceWorks:
        "OpenMeld is an external collaboration layer, not your private scratchpad. Work normally in your local context, then publish only the public outcome this Space needs with one OpenMeld Space Action.",
      publicationMode: "collaboration",
      repairRequirementLine:
        "Preserve the user's intent and record exactly one dispatch-scoped OpenMeld Space Action. Do not print an action as JSON or prose.",
      requiresExplicitPublicAction: true,
    });
  });

  it("resolves raw context sharing publication requirements from one shared helper", () => {
    expect(
      resolveSpacePublicationRequirement({
        publicationMode: "raw_context_sharing",
        allowedActions: ["stay_silent", "post_status"],
      })
    ).toEqual({
      actionGuidanceLines: [
        "Use the dispatch-scoped Space Action stay_silent action only when you intentionally do not want OpenMeld to publish a public reply.",
        "Use existing Tasks for durable collaboration commitments and the Board to read their summary. Do not create a Task merely to acknowledge a message.",
      ],
      actionRequirementLine:
        "Raw reply is allowed. Use OpenMeld Space Action only when you need a controlled visible outcome.",
      allowedActions: ["post_status", "stay_silent"],
      allowsRawReplyWithoutAction: true,
      howThisSpaceWorks:
        "This Space uses transparent context sharing: OpenMeld may share your raw reply directly. Use OpenMeld Space Action when you need a controlled visible outcome.",
      publicationMode: "raw_context_sharing",
      repairRequirementLine:
        "Return the plain raw reply, or record one permitted dispatch-scoped OpenMeld Space Action through the supplied interface for a controlled visible outcome. Answer text never becomes an action.",
      requiresExplicitPublicAction: false,
    });
  });

  it("normalizes canonical OpenMeld Space Actions", () => {
    expect(
      normalizeOpenMeldSpaceAction({
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          replyToSignalId: " sig-1 ",
          text: "  synced in public  ",
        },
      })
    ).toEqual({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [],
        referenceTargets: [],
        replyToSignalId: "sig-1",
        text: "synced in public",
      },
    });

    expect(() =>
      normalizeOpenMeldSpaceAction({
        type: "unsupported",
      })
    ).toThrow();
  });

  it("accepts only the canonical post_message shape in the shared egress parser", () => {
    expect(
      normalizeOpenMeldSpaceEgressAction({
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "synced in public",
        },
      })
    ).toEqual({
      type: "post_message",
      messageEnvelope: {
        activationTargets: [],
        mentionTargets: [],
        referenceTargets: [],
        text: "synced in public",
      },
    });

    expect(
      normalizeOpenMeldSpaceEgressAction({
        type: "post_status",
        status: "done",
        note: "  Ready for review  ",
      })
    ).toEqual({
      type: "post_status",
      status: "done",
      text: "Ready for review",
    });

    expect(() =>
      normalizeOpenMeldSpaceEgressAction({
        type: "post_message",
        text: "legacy text input",
      })
    ).toThrow();
  });

  it("resolves result archive behavior from owner policy and action opt-out", () => {
    expect(
      resolveResultArchiveBehavior({
        contractMode: "space_reply_only",
      })
    ).toEqual({
      mode: "space_reply_only",
      shouldSave: true,
    });

    expect(
      resolveResultArchiveBehavior({
        contractMode: "space_reply_only",
        saveResult: true,
      })
    ).toEqual({
      mode: "space_reply_only",
      shouldSave: true,
    });

    expect(
      resolveResultArchiveBehavior({
        contractMode: "all_final_results",
        saveResult: false,
      })
    ).toEqual({
      mode: "none",
      shouldSave: false,
    });
  });

  it("builds canonical system notice text", () => {
    expect(
      buildSystemNoticeText({
        actorName: "Research Agent",
        noticeType: "stay_silent",
        reason: "Handled privately.",
      })
    ).toBe("Research Agent chose to stay silent.");

    const snapshot = buildSystemNoticeText({
      actorName: "Research Agent",
      noticeType: "terminal_failure",
      reason:
        "This is a very long notice that should be preserved as system-authored text instead of being synthesized into an agent bubble.",
    });

    expect(snapshot.startsWith("Research Agent couldn't reply:")).toBe(true);
    expect(snapshot.length).toBeGreaterThan(MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH);

    expect(
      buildSystemNoticeText({
        actorName: "Research Agent",
        noticeType: "wake_stopped",
      })
    ).toBe("Wake was stopped for Research Agent.");
  });

  it("builds RuntimeCoordinator scenario variants with shared no-name fallbacks", () => {
    expect(
      buildSystemNoticeText({
        actorName: "Codex Agent",
        noticeType: "terminal_failure",
        variant: "delivery_expired",
      })
    ).toBe(
      "Codex Agent did not receive this Wake before it expired. Wake the Agent again when its computer is connected."
    );
    expect(
      buildSystemNoticeText({
        actorName: null,
        noticeType: "terminal_failure",
        variant: "delivery_expired",
      })
    ).toBe(
      "This agent did not receive this Wake before it expired. Wake the Agent again when its computer is connected."
    );

    expect(
      buildSystemNoticeText({
        actorName: "Codex Agent",
        noticeType: "terminal_failure",
        variant: "progress_stale",
      })
    ).toBe(
      "Codex Agent stopped making progress on this Wake. Reconnect the computer before trying again."
    );
    expect(
      buildSystemNoticeText({
        actorName: "Codex Agent",
        noticeType: "terminal_failure",
        variant: "local_runtime_lost",
      })
    ).toBe(
      "OpenMeld Service stopped or disconnected while Codex Agent was working on this Wake. Start OpenMeld again before retrying."
    );

    expect(
      buildSystemNoticeText({
        actorName: "Codex Agent",
        noticeType: "wake_stopped",
        variant: "stopped_before_execution",
      })
    ).toBe("Wake was stopped for Codex Agent before it reached the agent.");
    expect(
      buildSystemNoticeText({
        actorName: null,
        noticeType: "wake_stopped",
        variant: "stopped_before_execution",
      })
    ).toBe("Wake was stopped before it reached the agent.");
    expect(
      buildSystemNoticeText({
        actorName: "Codex Agent",
        noticeType: "wake_stopped",
        variant: "agent_profile_deleted",
      })
    ).toBe("Wake cancelled. Codex Agent was deleted.");
    expect(
      buildSystemNoticeText({
        actorName: null,
        noticeType: "wake_stopped",
        variant: "agent_profile_deleted",
      })
    ).toBe("Wake cancelled. This agent was deleted.");
    expect(
      buildSystemNoticeText({
        actorName: null,
        noticeType: "wake_stopped",
      })
    ).toBe("Wake was stopped.");
  });
});
