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
  hydrateOpenMeldSpaceEgressActionInputFromCleanedOutput,
  normalizeOpenMeldSpaceAction,
  normalizeOpenMeldSpaceEgressAction,
  OPENMELD_GUIDE_URL,
  renderSpaceEntryBrief,
  resolveGuideEntry,
  resolveResultArchiveBehavior,
  resolveSpacePublicationRequirement,
  tryExtractTrailingStructuredSpaceActionBlock,
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
      })
    ).toBe(
      `run \`openmeld-dev space board space_launch\` for live space state (members, working now, recent outcomes), or read the OpenMeld manual at ${OPENMELD_GUIDE_URL} / run \`openmeld-dev prompt space\`.`
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
        "- Space guide (maintained by this space's steward):",
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
      "Complete this Wake with exactly one final outcome: reply, status, or silent.",
      "Choose silent when you have no new contribution instead of repeating another member.",
    ]);
    expect(
      buildCompactDispatchActionGuidanceLines({
        allowedActions: ["post_status", "stay_silent"],
        allowsRawReplyWithoutAction: false,
      })
    ).toEqual([
      "Complete this Wake with exactly one final outcome: status or silent.",
      "Choose silent when you have no new contribution instead of repeating another member.",
    ]);
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
      actionRequirementLine:
        "Final outcome: use exactly one OpenMeld Space Action through the CLI. Only if every Space Action CLI command fails, use one trailing openmeld-space-action block.",
      actionSchemaGuidanceLines: [
        'Inside the block, JSON must use the key "type". Never use "action".',
        "Use post_message for normal public replies, greetings, answers, and discussion.",
        [
          "Canonical post_message block:",
          "```openmeld-space-action",
          '{"type":"post_message","messageEnvelope":{"text":"Hello.","activationTargets":[],"referenceTargets":[]}}',
          "```",
        ].join("\n"),
        "Use stay_silent only when you intentionally do not want OpenMeld to publish a public reply.",
        [
          "Canonical stay_silent block:",
          "```openmeld-space-action",
          '{"type":"stay_silent","reason":"No public reply is needed."}',
          "```",
        ].join("\n"),
      ],
      allowedActions: ["post_message", "stay_silent"],
      allowsRawReplyWithoutAction: false,
      howThisSpaceWorks:
        "OpenMeld is an external collaboration layer, not your private scratchpad. Work normally in your local context, then publish only the public outcome this Space needs with one OpenMeld Space Action.",
      publicationMode: "collaboration",
      repairRequirementLine:
        "Return the corrected final answer again, preserve the user's intent, and end with exactly one valid trailing ```openmeld-space-action``` JSON block.",
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
      actionRequirementLine:
        "Raw reply is allowed. Use OpenMeld Space Action only when you need a controlled visible outcome.",
      actionSchemaGuidanceLines: [
        'Inside the block, JSON must use the key "type". Never use "action".',
        'Use post_status only for final-safe outcomes: done, blocked, needs_input, or handoff. Do not use "working" or "ready" because post_status closes the Wake.',
        "Keep post_status text at 120 characters or fewer. Use post_message for answers, discussion, or anything longer.",
        [
          "Canonical post_status block (prefer final-safe statuses: done | blocked | needs_input | handoff):",
          "```openmeld-space-action",
          '{"type":"post_status","status":"done","text":"Status update."}',
          "```",
        ].join("\n"),
        "Use stay_silent only when you intentionally do not want OpenMeld to publish a public reply.",
        [
          "Canonical stay_silent block:",
          "```openmeld-space-action",
          '{"type":"stay_silent","reason":"No public reply is needed."}',
          "```",
        ].join("\n"),
      ],
      allowedActions: ["post_status", "stay_silent"],
      allowsRawReplyWithoutAction: true,
      howThisSpaceWorks:
        "This Space uses transparent context sharing: OpenMeld may share your raw reply directly. Use OpenMeld Space Action when you need a controlled visible outcome.",
      publicationMode: "raw_context_sharing",
      repairRequirementLine:
        "If you keep a trailing ```openmeld-space-action``` block, it must be valid. Otherwise return the plain raw reply with no ```openmeld-space-action``` block.",
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

  it("repairs malformed trailing structured action blocks when the JSON is trivially recoverable", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "I already drafted the reply.",
          "```openmeld-space-action",
          '{"type":"post_message","text":"hello"',
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "I already drafted the reply.",
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "hello",
        },
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("extracts trailing structured action blocks that use common post_message aliases", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "I already drafted the reply.",
          "```openmeld-space-action",
          '{"type":"post_message","message":"hello"}',
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "I already drafted the reply.",
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "hello",
        },
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("extracts simple post_message action blocks without requiring JSON", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "OPENCLAW-PHASE2-FINAL-A1-0323",
          "```openmeld-space-action",
          "post_message",
          "OPENCLAW-PHASE2-FINAL-A1-0323",
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "OPENCLAW-PHASE2-FINAL-A1-0323",
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "OPENCLAW-PHASE2-FINAL-A1-0323",
        },
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("preserves indentation and blank lines in simple post_message blocks", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "Prelude",
          "```openmeld-space-action",
          "post_message",
          "",
          "  line one",
          "",
          "    line two",
          "",
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "Prelude",
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "line one\n\n    line two",
        },
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("fills post_message text from cleaned prose when the action only declares type", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "CLAUDE-ROUNDTRIP-0322",
          "```openmeld-space-action",
          '{"type":"post_message"}',
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "CLAUDE-ROUNDTRIP-0322",
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "CLAUDE-ROUNDTRIP-0322",
        },
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("parses post_status header notes into text", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "Prelude",
          "```openmeld-space-action",
          "post_status done Ready for review",
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "Prelude",
      action: {
        type: "post_status",
        status: "done",
        text: "Ready for review",
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("preserves multiline post_status bodies when the header also includes a note", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "Prelude",
          "```openmeld-space-action",
          "post_status done Ready for review",
          "",
          "  line two",
          "",
          "    line three",
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "Prelude",
      action: {
        type: "post_status",
        status: "done",
        text: "Ready for review\n\n  line two\n\n    line three",
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("accepts a single spacer line before a body-derived post_status", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "Prelude",
          "```openmeld-space-action",
          "post_status",
          "",
          "done",
          "",
          "Ready for review",
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "Prelude",
      action: {
        type: "post_status",
        status: "done",
        text: "Ready for review",
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("hydrates post_status text from cleaned prose when the action omits text", () => {
    expect(
      hydrateOpenMeldSpaceEgressActionInputFromCleanedOutput({
        action: {
          type: "post_status",
          status: "done",
        },
        cleanedOutput: "Ready for review",
      })
    ).toEqual({
      type: "post_status",
      status: "done",
      text: "Ready for review",
    });
  });

  it("keeps extracting repaired actions even when malformed output has no safe prose", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "```openmeld-space-action",
          '{"type":"post_message","text":"hello"',
          "```",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "fenced_block",
      cleanedOutput: "",
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "hello",
        },
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("treats whitespace-only output as no structured action without throwing", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: "   \n",
      })
    ).toEqual({
      carrierKind: "none",
      cleanedOutput: "",
      action: null,
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("extracts a trailing standalone JSON action object as a compatible explicit carrier", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: ["Hi there.", '{"type":"post_message","text":"hello"}'].join(
          "\n\n"
        ),
      })
    ).toEqual({
      carrierKind: "trailing_json",
      cleanedOutput: "Hi there.",
      action: {
        type: "post_message",
        messageEnvelope: {
          activationTargets: [],
          referenceTargets: [],
          text: "hello",
        },
      },
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("does not treat inline JSON inside prose as a valid explicit action carrier", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: 'Hi there {"type":"post_message","text":"hello"}',
      })
    ).toEqual({
      carrierKind: "none",
      cleanedOutput: 'Hi there {"type":"post_message","text":"hello"}',
      action: null,
      infoString: "openmeld-space-action",
      parseError: null,
    });
  });

  it("rejects trailing standalone JSON actions that include unsupported extra fields", () => {
    expect(
      tryExtractTrailingStructuredSpaceActionBlock({
        output: [
          "Hi there.",
          "{",
          '  "type": "post_message",',
          '  "text": "hello",',
          '  "meta": {',
          '    "source": "test"',
          "  }",
          "}",
        ].join("\n"),
      })
    ).toEqual({
      carrierKind: "invalid_json",
      cleanedOutput: [
        "Hi there.",
        "{",
        '  "type": "post_message",',
        '  "text": "hello",',
        '  "meta": {',
        '    "source": "test"',
        "  }",
        "}",
      ].join("\n"),
      action: null,
      infoString: "openmeld-space-action",
      parseError: "Invalid input",
    });
  });

  it("preserves the nearest trailing JSON validation error when multiple candidates fail", () => {
    const result = tryExtractTrailingStructuredSpaceActionBlock({
      output: [
        "Hi there.",
        '{"type":"post_message","text":"older","meta":{"source":"test"}}',
        '{"type":"stay_silent"}',
      ].join("\n"),
    });

    expect(result.carrierKind).toBe("invalid_json");
    expect(result.action).toBeNull();
    expect(result.parseError).toBe(
      "Too small: expected string to have >=1 characters"
    );
    expect(result.parseError).not.toBe("Invalid input");
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
      "Codex Agent did not receive this Wake before it expired. Wake the agent again when the local OpenMeld Service is online."
    );
    expect(
      buildSystemNoticeText({
        actorName: null,
        noticeType: "terminal_failure",
        variant: "delivery_expired",
      })
    ).toBe(
      "This agent did not receive this Wake before it expired. Wake the agent again when the local OpenMeld Service is online."
    );

    expect(
      buildSystemNoticeText({
        actorName: "Codex Agent",
        noticeType: "terminal_failure",
        variant: "progress_stale",
      })
    ).toBe(
      "Codex Agent stopped making progress on this Wake. Reconnect OpenMeld Service before trying again."
    );
    expect(
      buildSystemNoticeText({
        actorName: "Codex Agent",
        noticeType: "terminal_failure",
        variant: "local_runtime_lost",
      })
    ).toBe("Codex Agent was interrupted when OpenMeld Service restarted.");

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
        actorName: null,
        noticeType: "wake_stopped",
      })
    ).toBe("Wake was stopped.");
  });
});
