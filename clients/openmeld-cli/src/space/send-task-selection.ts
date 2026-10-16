import { buildTargetWakeLifecycleId } from "@openmeld/schemas";
import type {
  ExecutionContextSelection,
  GetSpaceMessageDetailsResponse,
} from "@openmeld/schemas/types";

const UNAVAILABLE_TASK_MESSAGE =
  "This message has no recorded task for the selected Agent. Select its original Wake request or an Agent reply with task details, or use --new-task. No message was sent.";

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
  const sourceSignalId = input.sourceSignalId?.trim();
  if (!sourceSignalId) {
    return selection;
  }
  let details = await input.readDetails(sourceSignalId);
  if (
    details.query.spaceId !== input.spaceId ||
    details.message.signalId !== sourceSignalId
  ) {
    throw new Error(UNAVAILABLE_TASK_MESSAGE);
  }
  const replySource = details.replyContext.replyingToSignalId;
  if (
    details.message.actor.profileKind === "agent" &&
    details.message.actor.profileId === input.targetProfileId &&
    replySource.state === "recorded" &&
    replySource.value
  ) {
    // An Agent reply can also Wake another Agent. Its outgoing Wake describes
    // that other task; the reply link identifies the author's original request.
    details = await input.readDetails(replySource.value);
    if (details.message.signalId !== replySource.value) {
      throw new Error(UNAVAILABLE_TASK_MESSAGE);
    }
  }
  const source = details.wakeContext.sourceSignalId;
  if (
    details.query.spaceId !== input.spaceId ||
    source.state !== "recorded" ||
    !source.value ||
    source.value !== details.message.signalId ||
    !input.targetProfileId ||
    !details.wakeContext.targets.some(
      (target) => target.targetProfileId === input.targetProfileId
    )
  ) {
    throw new Error(UNAVAILABLE_TASK_MESSAGE);
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
