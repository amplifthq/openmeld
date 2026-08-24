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
  actionGuidanceLines: string[];
  actionRequirementLine: string;
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
  "Final outcome: call exactly one dispatch-scoped OpenMeld Space Action CLI command. Your answer text never selects or substitutes for that action.";
const COLLABORATION_REPAIR_REQUIREMENT =
  "Preserve the user's intent and call exactly one dispatch-scoped OpenMeld Space Action CLI command. Do not print an action as JSON or prose.";
const RAW_CONTEXT_SHARING_HOW_THIS_SPACE_WORKS =
  "This Space uses transparent context sharing: OpenMeld may share your raw reply directly. Use OpenMeld Space Action when you need a controlled visible outcome.";
const RAW_CONTEXT_SHARING_ACTION_REQUIREMENT =
  "Raw reply is allowed. Use OpenMeld Space Action only when you need a controlled visible outcome.";
const RAW_CONTEXT_SHARING_REPAIR_REQUIREMENT =
  "Return the plain raw reply, or call one dispatch-scoped OpenMeld Space Action CLI command for a controlled visible outcome. Answer text never becomes an action.";

function buildActionGuidanceLines(input: {
  allowedActions: SpaceContract["allowedActions"];
}): string[] {
  const lines: string[] = [];

  for (const allowedAction of input.allowedActions) {
    switch (allowedAction) {
      case "post_message":
        lines.push(
          "Use the dispatch-scoped Space Action reply command for normal public replies, greetings, answers, and discussion."
        );
        break;
      case "post_status":
        lines.push(
          'Use post_status only for final-safe outcomes: done, blocked, needs_input, or handoff. Do not use "working" or "ready" because post_status closes the Wake.'
        );
        lines.push(
          `Keep post_status text at ${MAX_SIGNAL_REPLY_TO_PREVIEW_LENGTH} characters or fewer. Use post_message for answers, discussion, or anything longer.`
        );
        break;
      case "stay_silent":
        lines.push(
          "Use the dispatch-scoped Space Action silent command only when you intentionally do not want OpenMeld to publish a public reply."
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
      actionGuidanceLines: buildActionGuidanceLines({ allowedActions }),
      actionRequirementLine: RAW_CONTEXT_SHARING_ACTION_REQUIREMENT,
      allowedActions,
      allowsRawReplyWithoutAction: true,
      howThisSpaceWorks: RAW_CONTEXT_SHARING_HOW_THIS_SPACE_WORKS,
      publicationMode,
      repairRequirementLine: RAW_CONTEXT_SHARING_REPAIR_REQUIREMENT,
      requiresExplicitPublicAction: false,
    };
  }

  return {
    actionGuidanceLines: buildActionGuidanceLines({ allowedActions }),
    actionRequirementLine: COLLABORATION_ACTION_REQUIREMENT,
    allowedActions,
    allowsRawReplyWithoutAction: false,
    howThisSpaceWorks: COLLABORATION_HOW_THIS_SPACE_WORKS,
    publicationMode,
    repairRequirementLine: COLLABORATION_REPAIR_REQUIREMENT,
    requiresExplicitPublicAction: true,
  };
}
