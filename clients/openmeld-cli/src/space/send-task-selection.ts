import { buildTargetWakeLifecycleId } from "@openmeld/schemas";
import type {
  ExecutionContextSelection,
  GetSpaceMessageDetailsResponse,
} from "@openmeld/schemas/types";

// Message details owns the reply-to-Wake linkage. This read selects an identity;
// Core still checks the Context's requester, scope, and execution eligibility.
export async function resolveMessageTaskSelection(input: {
  selection?: ExecutionContextSelection;
  sourceSignalId?: string;
  targetProfileId?: string;
  spaceId: string;
  readDetails: (signalId: string) => Promise<GetSpaceMessageDetailsResponse>;
}): Promise<ExecutionContextSelection | undefined> {
  const selection = input.selection;
  if (
    !selection ||
    (selection.mode !== "resume" && selection.mode !== "fork")
  ) {
    return selection;
  }
  if (!input.sourceSignalId) {
    return selection;
  }
  const details = await input.readDetails(input.sourceSignalId);
  const source = details.wakeContext.sourceSignalId;
  if (
    details.query.spaceId !== input.spaceId ||
    details.message.signalId !== input.sourceSignalId ||
    source.state !== "recorded" ||
    !source.value ||
    !input.targetProfileId ||
    !details.wakeContext.targets.some(
      (target) => target.targetProfileId === input.targetProfileId
    )
  ) {
    throw new Error(
      "This message has no recorded task for the selected Agent. Select its original Wake request or an Agent reply with task details, or use --new-task. No message was sent."
    );
  }
  return {
    ...selection,
    sourceWakeId: buildTargetWakeLifecycleId({
      spaceId: input.spaceId,
      sourceSignalId: source.value,
      targetProfileId: input.targetProfileId,
    }),
  };
}
