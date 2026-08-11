// Compatibility seam only. Canonical reply foundation lives in
// dispatch-reply-foundation.ts.
import {
  buildCanonicalDispatchReplyMessageEnvelope as buildCanonicalDispatchReplyMessageEnvelopeImpl,
  buildDispatchPublishedAgentProfile as buildDispatchPublishedAgentProfileImpl,
  buildDispatchReplyContext as buildDispatchReplyContextImpl,
  buildDispatchReplyTargetProfile as buildDispatchReplyTargetProfileImpl,
  emitDispatchTextReplySignal as emitDispatchTextReplySignalImpl,
  DISPATCH_REPLY_SIGNAL_ID_MISMATCH_ERROR as FOUNDATION_REPLY_SIGNAL_ID_MISMATCH_ERROR,
} from "./dispatch-reply-foundation";

export const DISPATCH_REPLY_SIGNAL_ID_MISMATCH_ERROR =
  FOUNDATION_REPLY_SIGNAL_ID_MISMATCH_ERROR;

export function buildCanonicalDispatchReplyMessageEnvelope(
  input: Parameters<typeof buildCanonicalDispatchReplyMessageEnvelopeImpl>[0]
) {
  return buildCanonicalDispatchReplyMessageEnvelopeImpl(input);
}

export function buildDispatchPublishedAgentProfile(
  input: Parameters<typeof buildDispatchPublishedAgentProfileImpl>[0]
) {
  return buildDispatchPublishedAgentProfileImpl(input);
}

export function buildDispatchReplyContext(
  input: Parameters<typeof buildDispatchReplyContextImpl>[0]
) {
  return buildDispatchReplyContextImpl(input);
}

export function buildDispatchReplyTargetProfile(
  input: Parameters<typeof buildDispatchReplyTargetProfileImpl>[0]
) {
  return buildDispatchReplyTargetProfileImpl(input);
}

export function emitDispatchTextReplySignal(
  input: Parameters<typeof emitDispatchTextReplySignalImpl>[0]
) {
  return emitDispatchTextReplySignalImpl(input);
}
