import type { SignalEnvelope } from "@openmeld/protocol";

/** Last explicit human Wake wins. Automated replies and continuation do not retarget. */
export function resolveThreadWakeContinuation(input: {
  root: SignalEnvelope | null;
  latestExplicitWake: SignalEnvelope | null;
}): string | null {
  const signal = input.latestExplicitWake;
  if (signal?.type === "signal.text" && signal.profile.kind === "human") {
    const targets = signal.data.messageEnvelope?.activationTargets ?? [];
    return targets.length === 1 ? (targets[0] ?? null) : null;
  }
  return input.root?.profile.kind === "agent"
    ? (input.root.profile.profileId ?? null)
    : null;
}
