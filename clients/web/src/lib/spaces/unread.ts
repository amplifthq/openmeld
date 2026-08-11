import type { SignalEnvelope } from "@openmeld/schemas/types";
import { listVisibleTimelineEnvelopes } from "./timeline";

// A signal counts toward the unread badge when it is a visible text message
// authored by someone other than the current profile. We run it through
// listVisibleTimelineEnvelopes first so the count mirrors exactly what the
// conversation renders (transient "is typing" activity and presence are already
// dropped there) — the badge can never disagree with the transcript.
export function isCountableUnreadSignal(
	signal: SignalEnvelope,
	selfProfileId: string
): boolean {
	return (
		signal.type === "signal.text" &&
		signal.profile.profileId !== selfProfileId &&
		typeof signal.data.text === "string" &&
		signal.data.text.trim().length > 0
	);
}

// Unread = visible, countable messages newer than the read watermark. The
// comparison is strict (ts > lastSeenTs) so the boundary signal the user has
// already seen is never recounted.
export function countUnreadSignals(input: {
	envelopes: readonly SignalEnvelope[];
	selfProfileId: string;
	lastSeenTs: number;
}): number {
	return resolveUnreadSignalState(input).count;
}

export type UnreadSignalState = {
	count: number;
	firstSignalId: string | null;
};

export function resolveUnreadSignalState(input: {
	envelopes: readonly SignalEnvelope[];
	selfProfileId: string;
	lastSeenTs: number;
}): UnreadSignalState {
	let count = 0;
	let firstSignalId: string | null = null;
	for (const signal of listVisibleTimelineEnvelopes(input.envelopes)) {
		if (
			signal.ts > input.lastSeenTs &&
			isCountableUnreadSignal(signal, input.selfProfileId)
		) {
			firstSignalId ??= signal.id;
			count += 1;
		}
	}
	return { count, firstSignalId };
}

// Latest ts across the visible transcript — the watermark target when the user
// has the conversation open at the bottom.
export function resolveLatestVisibleTs(
	envelopes: readonly SignalEnvelope[]
): number {
	let latest = 0;
	for (const signal of listVisibleTimelineEnvelopes(envelopes)) {
		if (signal.ts > latest) {
			latest = signal.ts;
		}
	}
	return latest;
}
