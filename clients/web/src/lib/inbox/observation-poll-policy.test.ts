import { describe, expect, it } from "vitest";
import {
	createInboxObservationBackoff,
	inboxObservationBackoffDelayMs,
	resolveInboxObservationPollInterval,
} from "./observation-poll-policy";

function resolve(
	overrides: Partial<Parameters<typeof resolveInboxObservationPollInterval>[0]>
) {
	return resolveInboxObservationPollInterval({
		hasMore: false,
		sawItems: false,
		visible: true,
		streamConnected: false,
		notificationsEnabled: false,
		desktop: false,
		fetchKey: "0:0",
		backoff: createInboxObservationBackoff(() => 1),
		...overrides,
	});
}

describe("inbox observation poll policy", () => {
	it("backs off disconnected visible polling exponentially up to 30 seconds", () => {
		const backoff = createInboxObservationBackoff(() => 1);
		const delays = Array.from({ length: 8 }, (_, fetch) =>
			resolve({ backoff, fetchKey: `${fetch}:0` })
		);
		expect(delays).toEqual([
			1000, 2000, 4000, 8000, 16_000, 30_000, 30_000, 30_000,
		]);
	});

	it("keeps one delay per completed fetch so re-renders do not restart the timer", () => {
		const backoff = createInboxObservationBackoff(() => 1);
		expect(resolve({ backoff, fetchKey: "1:0" })).toBe(1000);
		expect(resolve({ backoff, fetchKey: "2:0" })).toBe(2000);
		expect(resolve({ backoff, fetchKey: "2:0" })).toBe(2000);
		expect(resolve({ backoff, fetchKey: "2:0" })).toBe(2000);
		// A failed fetch advances the backoff like an empty one.
		expect(resolve({ backoff, fetchKey: "2:5" })).toBe(4000);
	});

	it("jitters later attempts within 75-100% of the step", () => {
		expect(inboxObservationBackoffDelayMs(0, () => 0)).toBe(1000);
		expect(inboxObservationBackoffDelayMs(3, () => 0)).toBe(6000);
		expect(inboxObservationBackoffDelayMs(3, () => 1)).toBe(8000);
		expect(inboxObservationBackoffDelayMs(20, () => 0)).toBe(22_500);
	});

	it("restarts from one second after a reset or a page with new observations", () => {
		const backoff = createInboxObservationBackoff(() => 1);
		for (const fetch of [1, 2, 3, 4]) {
			resolve({ backoff, fetchKey: `${fetch}:0` });
		}
		expect(resolve({ backoff, fetchKey: "5:0" })).toBe(16_000);
		backoff.reset();
		expect(resolve({ backoff, fetchKey: "5:0" })).toBe(1000);
		expect(resolve({ backoff, fetchKey: "6:0" })).toBe(2000);
		expect(resolve({ backoff, fetchKey: "7:0", sawItems: true })).toBe(1000);
	});

	it("drains remaining pages quickly regardless of connection or visibility", () => {
		expect(resolve({ hasMore: true, streamConnected: true })).toBe(1000);
		expect(resolve({ hasMore: true, visible: false })).toBe(1000);
	});

	it("only runs the slow recovery poll while push is connected", () => {
		expect(resolve({ streamConnected: true })).toBe(30_000);
		expect(
			resolve({
				streamConnected: true,
				visible: false,
				notificationsEnabled: true,
			})
		).toBe(30_000);
		expect(resolve({ streamConnected: true, visible: false })).toBe(false);
	});

	it("stops hidden polling unless a browser tab must deliver notifications", () => {
		expect(resolve({ visible: false })).toBe(false);
		expect(
			resolve({ visible: false, notificationsEnabled: true, desktop: true })
		).toBe(false);
		expect(resolve({ visible: false, notificationsEnabled: true })).toBe(
			10_000
		);
	});
});
