import { dispatchBriefSchema } from "@openmeld/schemas";
import type { DispatchBrief, SpaceContract } from "@openmeld/schemas/types";
import { SPACE_PERSONAL_CONTRIBUTION_RULE } from "./collaboration-context";

const ACTION_LABEL_BY_TYPE = {
  post_message: "reply",
  post_status: "status",
  stay_silent: "silent",
} as const satisfies Record<SpaceContract["allowedActions"][number], string>;

export function composeDispatchBrief(input: unknown): DispatchBrief {
  const parsed = dispatchBriefSchema.safeParse(input);
  if (parsed.success) {
    return parsed.data;
  }
  throw new Error(
    parsed.error.issues[0]?.message ?? "dispatch brief is invalid"
  );
}

export function buildCompactDispatchActionGuidanceLines(input: {
  allowedActions: SpaceContract["allowedActions"];
  allowsRawReplyWithoutAction: boolean;
}): [string, string] {
  const actionLabels = new Set<string>();
  if (input.allowsRawReplyWithoutAction) {
    actionLabels.add("reply");
  }
  for (const action of input.allowedActions) {
    actionLabels.add(ACTION_LABEL_BY_TYPE[action]);
  }
  const choices = [...actionLabels];
  if (choices.length === 0) {
    throw new Error(
      "dispatch action guidance requires at least one final outcome"
    );
  }
  return [
    `Complete this Wake with exactly one final outcome: ${formatChoiceList(choices)}.`,
    SPACE_PERSONAL_CONTRIBUTION_RULE,
  ];
}

function formatChoiceList(choices: string[]): string {
  if (choices.length === 1) {
    return choices[0] ?? "";
  }
  if (choices.length === 2) {
    return `${choices[0]} or ${choices[1]}`;
  }
  return `${choices.slice(0, -1).join(", ")}, or ${choices.at(-1)}`;
}
