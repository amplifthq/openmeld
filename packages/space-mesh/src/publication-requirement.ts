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
  "Final outcome: record exactly one permitted dispatch-scoped OpenMeld Space Action through the supplied interface. Your answer text never selects or substitutes for that action.";
const COLLABORATION_REPAIR_REQUIREMENT =
  "Preserve the user's intent and record exactly one dispatch-scoped OpenMeld Space Action. Do not print an action as JSON or prose.";
const RAW_CONTEXT_SHARING_HOW_THIS_SPACE_WORKS =
  "This Space uses transparent context sharing: OpenMeld may share your raw reply directly. Use OpenMeld Space Action when you need a controlled visible outcome.";
const RAW_CONTEXT_SHARING_ACTION_REQUIREMENT =
  "Raw reply is allowed. Use OpenMeld Space Action only when you need a controlled visible outcome.";
const RAW_CONTEXT_SHARING_REPAIR_REQUIREMENT =
  "Return the plain raw reply, or record one permitted dispatch-scoped OpenMeld Space Action through the supplied interface for a controlled visible outcome. Answer text never becomes an action.";

function buildActionGuidanceLines(input: {
  allowedActions: SpaceContract["allowedActions"];
}): string[] {
  const lines: string[] = [];

  for (const allowedAction of input.allowedActions) {
    switch (allowedAction) {
      case "post_message":
        lines.push(
          "Use reply for public answers, known limitations, error explanations, or requests for help. You do not need shell or repository access to explain that you cannot complete a task."
        );
        break;
      case "post_status":
        // Retain the stored/frozen permission for legacy proposals, but never
        // advertise the retired Agent tool or turn it into reply authority.
        if (input.allowedActions.every((action) => action === "post_status")) {
          lines.push(
            "This legacy Space policy permits only the retired status action. No current final tool is authorized. An authorized Space owner must choose permitted reply/silence outcomes; do not bypass this restriction or turn private output into a public reply."
          );
        }
        break;
      case "stay_silent":
        lines.push(
          "Use the dispatch-scoped Space Action stay_silent action only when you intentionally do not want OpenMeld to publish a public reply."
        );
        break;
      default:
        break;
    }
  }

  lines.push(
    "Use existing Tasks for durable collaboration commitments and the Board to read their summary. Do not create a Task merely to acknowledge a message."
  );
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
