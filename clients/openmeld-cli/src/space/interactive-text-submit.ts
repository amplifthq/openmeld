import type { MessageEnvelope } from "@openmeld/schemas/types";
import type {
  SpaceAuthoredMentionInTextOrder,
  SpaceResolvedStructuredTargetSet,
} from "@openmeld/space";
import type { SpaceSessionSendReceipt } from "./runtime/space-session-runtime";

export type PreparedInteractiveOutboundText = {
  text: string;
  messageEnvelope: MessageEnvelope | null;
  mentionsInTextOrder: readonly SpaceAuthoredMentionInTextOrder[];
  resolvedStructuredTargets: SpaceResolvedStructuredTargetSet;
};

export type InteractiveTextSubmitResult =
  | {
      status: "not_queued";
      text: string;
      mentionsInTextOrder: readonly SpaceAuthoredMentionInTextOrder[];
      resolvedStructuredTargets: SpaceResolvedStructuredTargetSet;
    }
  | {
      status: "queued";
      text: string;
      clientMessageId: string;
      mentionsInTextOrder: readonly SpaceAuthoredMentionInTextOrder[];
      resolvedStructuredTargets: SpaceResolvedStructuredTargetSet;
    };

export async function performInteractiveTextSubmit(input: {
  nextBufferText: string;
  submittedText: string;
  text: string;
  prepareOutboundText: (
    text: string
  ) => Promise<PreparedInteractiveOutboundText>;
  queueText: (input: {
    text: string;
    messageEnvelope?: MessageEnvelope;
  }) => SpaceSessionSendReceipt;
  applyComposerBuffer: (bufferText: string) => void;
  clearSubmittedInputLine: (text: string) => void;
}): Promise<InteractiveTextSubmitResult> {
  const preparedSubmission = await input
    .prepareOutboundText(input.text)
    .catch((error) => {
      input.applyComposerBuffer(input.submittedText);
      throw error;
    });
  const outboundText = preparedSubmission.text;
  const sendReceipt = input.queueText({
    text: outboundText,
    ...(preparedSubmission.messageEnvelope
      ? { messageEnvelope: preparedSubmission.messageEnvelope }
      : {}),
  });
  if (!sendReceipt.queued) {
    input.applyComposerBuffer(input.submittedText);
    return {
      status: "not_queued",
      text: outboundText,
      mentionsInTextOrder: preparedSubmission.mentionsInTextOrder,
      resolvedStructuredTargets: preparedSubmission.resolvedStructuredTargets,
    };
  }

  input.applyComposerBuffer(input.nextBufferText);
  input.clearSubmittedInputLine(input.submittedText);
  return {
    status: "queued",
    text: outboundText,
    clientMessageId: sendReceipt.clientMessageId,
    mentionsInTextOrder: preparedSubmission.mentionsInTextOrder,
    resolvedStructuredTargets: preparedSubmission.resolvedStructuredTargets,
  };
}
