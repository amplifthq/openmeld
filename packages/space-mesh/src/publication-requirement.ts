import { MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH } from "@openmeld/schemas";
import type { SpaceContract } from "@openmeld/schemas/types";
import {
  canonicalizeAllowedActions,
  DEFAULT_SPACE_CONTRACT_FIELDS,
} from "./space-contract";

type SpacePublicationRequirementInput =
  | Pick<SpaceContract, "allowedActions" | "publicationMode">
  | null
  | undefined;

export type SpacePublicationRequirement = {
  actionRequirementLine: string;
  actionSchemaGuidanceLines: string[];
  allowedActions: SpaceContract["allowedActions"];
  allowsRawReplyWithoutAction: boolean;
  howThisSpaceWorks: string;
  publicationMode: SpaceContract["publicationMode"];
  repairRequirementLine: string;
  requiresExplicitPublicAction: boolean;
};

const COLLABORATION_HOW_THIS_SPACE_WORKS =
  "OpenMeld is an external collaboration layer, not your private scratchpad. Work normally in your local context, then publish only the public outcome this Space needs with one OpenMeld Space Action.";
const COLLABORATION_ACTION_REQUIREMENT =
  "Final outcome: use exactly one OpenMeld Space Action through the CLI. Only if every Space Action CLI command fails, use one trailing openmeld-space-action block.";
const COLLABORATION_REPAIR_REQUIREMENT =
  "Return the corrected final answer again, preserve the user's intent, and end with exactly one valid trailing ```openmeld-space-action``` JSON block.";
const RAW_CONTEXT_SHARING_HOW_THIS_SPACE_WORKS =
  "This Space uses transparent context sharing: OpenMeld may share your raw reply directly. Use OpenMeld Space Action when you need a controlled visible outcome.";
const RAW_CONTEXT_SHARING_ACTION_REQUIREMENT =
  "Raw reply is allowed. Use OpenMeld Space Action only when you need a controlled visible outcome.";
const RAW_CONTEXT_SHARING_REPAIR_REQUIREMENT =
  "If you keep a trailing ```openmeld-space-action``` block, it must be valid. Otherwise return the plain raw reply with no ```openmeld-space-action``` block.";

function buildActionSchemaGuidanceLines(input: {
  allowedActions: SpaceContract["allowedActions"];
}): string[] {
  const lines = [
    'Inside the block, JSON must use the key "type". Never use "action".',
  ];

  for (const allowedAction of input.allowedActions) {
    switch (allowedAction) {
      case "post_message":
        lines.push(
          "Use post_message for normal public replies, greetings, answers, and discussion."
        );
        lines.push(
          [
            "Canonical post_message block:",
            "```openmeld-space-action",
            '{"type":"post_message","messageEnvelope":{"text":"Hello.","activationTargets":[],"referenceTargets":[]}}',
            "```",
          ].join("\n")
        );
        break;
      case "post_status":
        lines.push(
          'Use post_status only for final-safe outcomes: done, blocked, needs_input, or handoff. Do not use "working" or "ready" because post_status closes the Wake.'
        );
        lines.push(
          `Keep post_status text at ${MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH} characters or fewer. Use post_message for answers, discussion, or anything longer.`
        );
        lines.push(
          [
            "Canonical post_status block (prefer final-safe statuses: done | blocked | needs_input | handoff):",
            "```openmeld-space-action",
            '{"type":"post_status","status":"done","text":"Status update."}',
            "```",
          ].join("\n")
        );
        break;
      case "stay_silent":
        lines.push(
          "Use stay_silent only when you intentionally do not want OpenMeld to publish a public reply."
        );
        lines.push(
          [
            "Canonical stay_silent block:",
            "```openmeld-space-action",
            '{"type":"stay_silent","reason":"No public reply is needed."}',
            "```",
          ].join("\n")
        );
        break;
      default:
        break;
    }
  }

  return lines;
}

export function resolveSpacePublicationRequirement(
  input?: SpacePublicationRequirementInput
): SpacePublicationRequirement {
  const publicationMode =
    input?.publicationMode ?? DEFAULT_SPACE_CONTRACT_FIELDS.publicationMode;
  const allowedActions = canonicalizeAllowedActions(
    input?.allowedActions ?? DEFAULT_SPACE_CONTRACT_FIELDS.allowedActions
  );

  if (publicationMode === "raw_context_sharing") {
    return {
      actionRequirementLine: RAW_CONTEXT_SHARING_ACTION_REQUIREMENT,
      actionSchemaGuidanceLines: buildActionSchemaGuidanceLines({
        allowedActions,
      }),
      allowedActions,
      allowsRawReplyWithoutAction: true,
      howThisSpaceWorks: RAW_CONTEXT_SHARING_HOW_THIS_SPACE_WORKS,
      publicationMode,
      repairRequirementLine: RAW_CONTEXT_SHARING_REPAIR_REQUIREMENT,
      requiresExplicitPublicAction: false,
    };
  }

  return {
    actionRequirementLine: COLLABORATION_ACTION_REQUIREMENT,
    actionSchemaGuidanceLines: buildActionSchemaGuidanceLines({
      allowedActions,
    }),
    allowedActions,
    allowsRawReplyWithoutAction: false,
    howThisSpaceWorks: COLLABORATION_HOW_THIS_SPACE_WORKS,
    publicationMode,
    repairRequirementLine: COLLABORATION_REPAIR_REQUIREMENT,
    requiresExplicitPublicAction: true,
  };
}
