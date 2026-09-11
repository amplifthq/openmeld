import type { SignalEnvelope } from "@openmeld/protocol";

export function applyAutomaticThreadWake(
  signal: SignalEnvelope,
  resolveTarget: () => { profileId: string; label: string } | null
): void {
  if (signal.type !== "signal.text" || signal.profile.kind !== "human") {
    return;
  }
  const envelope = signal.data.messageEnvelope;
  if (
    envelope?.activationTargets.length ||
    envelope?.referenceTargets.length ||
    envelope?.mentionTargets?.length
  ) {
    return;
  }
  const target = resolveTarget();
  if (!target) {
    return;
  }
  const label = target.label.startsWith("@")
    ? target.label.slice(1)
    : target.label;
  const text = `${signal.data.text}\n@${label}`;
  signal.data.text = text;
  signal.data.messageEnvelope = {
    ...envelope,
    text,
    activationTargets: [target.profileId],
    referenceTargets: [],
  };
  signal.data.meta = { ...signal.data.meta, threadWakeContinuation: true };
}
