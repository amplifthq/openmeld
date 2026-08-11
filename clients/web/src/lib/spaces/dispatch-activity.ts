import {
	AGENT_REPLY_PREVIEW_END_PURPOSE,
	AGENT_REPLY_PREVIEW_PURPOSE,
	AGENT_REPLYING_END_PURPOSE,
	AGENT_REPLYING_PURPOSE,
	CONVERSATION_CONTINUITY_WARNING_PURPOSE,
	DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
	DISPATCH_ACTIVITY_FAILED_PURPOSE,
	DISPATCH_ACTIVITY_RETRYING_PURPOSE,
} from "@openmeld/schemas";
import type { SignalEnvelope, WakeProgressItem } from "@openmeld/schemas/types";
import { applyWakeProgressSignals } from "@openmeld/space";

const TRANSIENT_ACTIVITY_PURPOSES = new Set<string>([
	AGENT_REPLY_PREVIEW_END_PURPOSE,
	AGENT_REPLY_PREVIEW_PURPOSE,
	AGENT_REPLYING_END_PURPOSE,
	AGENT_REPLYING_PURPOSE,
	CONVERSATION_CONTINUITY_WARNING_PURPOSE,
	DISPATCH_ACTIVITY_DISPATCHING_PURPOSE,
	DISPATCH_ACTIVITY_FAILED_PURPOSE,
	DISPATCH_ACTIVITY_RETRYING_PURPOSE,
]);

export type SpaceEphemeralActivityItem = WakeProgressItem;

export function isSpaceTransientActivityEnvelope(
	envelope: SignalEnvelope
): boolean {
	if (envelope.type !== "signal.text") {
		return false;
	}

	const meta = envelope.data.meta;
	return (
		meta?.transient === true &&
		typeof meta.purpose === "string" &&
		TRANSIENT_ACTIVITY_PURPOSES.has(meta.purpose)
	);
}

export function buildSpaceEphemeralActivityItems(input: {
	envelopes: readonly SignalEnvelope[];
	nowMs?: number;
}): readonly SpaceEphemeralActivityItem[] {
	return applyWakeProgressSignals({
		currentItems: [],
		signals: input.envelopes,
		nowMs: input.nowMs,
	});
}
