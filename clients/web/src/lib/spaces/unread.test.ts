import type { SignalEnvelope } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import {
	countUnreadSignals,
	isCountableUnreadSignal,
	resolveLatestVisibleTs,
	resolveUnreadSignalState,
} from "./unread";

const SELF = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function textSignal(input: {
	id: string;
	ts: number;
	text?: string;
	profileId?: string;
}): SignalEnvelope {
	return {
		v: 1,
		id: input.id,
		spaceId: "space-123",
		ts: input.ts,
		profile: {
			kind: "human",
			profileId: input.profileId ?? OTHER,
			profileName: "Someone",
		},
		type: "signal.text",
		data: {
			text: input.text ?? "hello",
		},
	} as SignalEnvelope;
}

describe("isCountableUnreadSignal", () => {
	it("counts a text message authored by someone else", () => {
		expect(isCountableUnreadSignal(textSignal({ id: "a", ts: 1 }), SELF)).toBe(
			true
		);
	});

	it("excludes the current profile's own messages", () => {
		expect(
			isCountableUnreadSignal(
				textSignal({ id: "a", ts: 1, profileId: SELF }),
				SELF
			)
		).toBe(false);
	});

	it("excludes empty / whitespace-only messages", () => {
		expect(
			isCountableUnreadSignal(textSignal({ id: "a", ts: 1, text: "   " }), SELF)
		).toBe(false);
	});
});

describe("countUnreadSignals", () => {
	const envelopes = [
		textSignal({ id: "seen", ts: 10 }),
		textSignal({ id: "own", ts: 20, profileId: SELF }),
		textSignal({ id: "new-1", ts: 30 }),
		textSignal({ id: "new-2", ts: 40 }),
	];

	it("counts only others' visible messages newer than the watermark", () => {
		expect(
			countUnreadSignals({ envelopes, selfProfileId: SELF, lastSeenTs: 20 })
		).toBe(2);
	});

	it("treats the watermark boundary as already read (strict greater-than)", () => {
		expect(
			countUnreadSignals({ envelopes, selfProfileId: SELF, lastSeenTs: 30 })
		).toBe(1);
	});

	it("returns zero once the watermark reaches the latest message", () => {
		expect(
			countUnreadSignals({ envelopes, selfProfileId: SELF, lastSeenTs: 40 })
		).toBe(0);
	});
});

describe("resolveUnreadSignalState", () => {
	it("returns the first visible unread message and the total unread count", () => {
		const envelopes = [
			textSignal({ id: "seen", profileId: OTHER, ts: 20 }),
			textSignal({ id: "self", profileId: SELF, ts: 30 }),
			textSignal({ id: "first-unread", profileId: OTHER, ts: 40 }),
			textSignal({ id: "second-unread", profileId: OTHER, ts: 50 }),
		];

		expect(
			resolveUnreadSignalState({
				envelopes,
				lastSeenTs: 20,
				selfProfileId: SELF,
			})
		).toEqual({ count: 2, firstSignalId: "first-unread" });
	});
});

describe("resolveLatestVisibleTs", () => {
	it("returns the newest visible ts", () => {
		expect(
			resolveLatestVisibleTs([
				textSignal({ id: "a", ts: 10 }),
				textSignal({ id: "b", ts: 40 }),
				textSignal({ id: "c", ts: 25 }),
			])
		).toBe(40);
	});

	it("returns 0 for an empty timeline", () => {
		expect(resolveLatestVisibleTs([])).toBe(0);
	});
});
