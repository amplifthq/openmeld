import type { SignalEnvelope } from "@openmeld/protocol";
import { parseEnvelope } from "@openmeld/protocol";
import {
  AGENT_REPLY_FINAL_PURPOSE,
  spaceMentionLabelSchema,
} from "@openmeld/schemas";

export function parseStoredSignal(raw: string): SignalEnvelope | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    const signal = parseEnvelope(parsed);
    if (signal) {
      return signal;
    }
    return recoverFinalReplyDisplayNameInMentionLabel(parsed);
  } catch {
    return null;
  }
}

// Older finalization substituted a display name for this optional syntax label.
// Repair only that known invalid projection; author, target, content and reply
// linkage still have to pass the complete protocol schema. Stored bytes stay intact.
function recoverFinalReplyDisplayNameInMentionLabel(
  value: unknown
): SignalEnvelope | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const candidate = value as SignalEnvelope;
  if (candidate.type !== "signal.text") {
    return null;
  }
  const meta = candidate.data?.meta;
  if (
    meta?.purpose !== AGENT_REPLY_FINAL_PURPOSE ||
    typeof meta.targetMentionLabel !== "string" ||
    meta.targetMentionLabel !== meta.targetProfileName ||
    candidate.profile?.profileId !== meta.targetProfileId ||
    spaceMentionLabelSchema.safeParse(meta.targetMentionLabel).success
  ) {
    return null;
  }
  const { targetMentionLabel: _invalidLabel, ...recoveredMeta } = meta;
  const recovered = parseEnvelope({
    ...candidate,
    data: { ...candidate.data, meta: recoveredMeta },
  });
  if (recovered) {
    console.warn("[core.space.stored_final_reply_label_recovered]", {
      signalId: recovered.id,
      spaceId: recovered.spaceId,
      dispatchId: meta.dispatchId,
    });
  }
  return recovered;
}
