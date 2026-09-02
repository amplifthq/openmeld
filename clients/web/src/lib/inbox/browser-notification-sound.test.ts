import type { InboxItem } from "@openmeld/schemas/types";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const playMock = vi.hoisted(() => vi.fn());

vi.mock("cuelume", () => ({ play: playMock }));

import {
	cancelPendingInboxBrowserNotificationSound,
	queueInboxBrowserNotificationSound,
	readInboxBrowserNotificationSoundEnabled,
	resolveInboxBrowserNotificationSoundCue,
	writeInboxBrowserNotificationSoundEnabled,
} from "./browser-notification-sound";

const USER_ID = "11111111-1111-1111-1111-111111111111";
const SOUND_PREFERENCE_KEY = `openmeld.inbox.browser-notification-sounds.enabled:${USER_ID}`;

describe("Inbox browser notification sounds", () => {
	beforeEach(() => {
		vi.useFakeTimers();
		window.localStorage.clear();
		playMock.mockReset();
		cancelPendingInboxBrowserNotificationSound();
	});

	afterEach(() => {
		cancelPendingInboxBrowserNotificationSound();
		window.localStorage.clear();
		vi.useRealTimers();
		vi.restoreAllMocks();
	});

	it("defaults sounds on and remembers a browser-local opt-out", () => {
		expect(readInboxBrowserNotificationSoundEnabled({ userId: USER_ID })).toBe(
			true
		);

		writeInboxBrowserNotificationSoundEnabled({
			enabled: false,
			userId: USER_ID,
		});

		expect(window.localStorage.getItem(SOUND_PREFERENCE_KEY)).toBe("disabled");
		expect(readInboxBrowserNotificationSoundEnabled({ userId: USER_ID })).toBe(
			false
		);
	});

	it("maps ordinary updates to ready and attention items to chime", () => {
		expect(
			resolveInboxBrowserNotificationSoundCue(
				createInboxItem({
					attention: "update",
					importance: "normal",
					kind: "agent_reply",
					resolutionStatus: "not_applicable",
				})
			)
		).toBe("update");
		expect(
			resolveInboxBrowserNotificationSoundCue(
				createInboxItem({
					attention: "action_required",
					importance: "normal",
					resolutionStatus: "open",
				})
			)
		).toBe("attention");
		expect(
			resolveInboxBrowserNotificationSoundCue(
				createInboxItem({ importance: "urgent" })
			)
		).toBe("attention");
	});

	it("plays one ready sound for a burst of ordinary updates at full volume", () => {
		const item = createInboxItem({
			attention: "update",
			importance: "normal",
			kind: "agent_reply",
			resolutionStatus: "not_applicable",
		});

		queueInboxBrowserNotificationSound({ item, userId: USER_ID });
		queueInboxBrowserNotificationSound({ item, userId: USER_ID });
		vi.runAllTimers();

		expect(playMock).toHaveBeenCalledOnce();
		expect(playMock).toHaveBeenCalledWith("ready", { volume: 1 });
	});

	it("lets an attention item win a mixed notification burst", () => {
		queueInboxBrowserNotificationSound({
			item: createInboxItem({
				attention: "update",
				importance: "normal",
				kind: "agent_reply",
				resolutionStatus: "not_applicable",
			}),
			userId: USER_ID,
		});
		queueInboxBrowserNotificationSound({
			item: createInboxItem({ importance: "urgent" }),
			userId: USER_ID,
		});
		vi.runAllTimers();

		expect(playMock).toHaveBeenCalledOnce();
		expect(playMock).toHaveBeenCalledWith("chime", { volume: 1 });
	});

	it("does not play a queued sound after the user turns sounds off", () => {
		queueInboxBrowserNotificationSound({
			item: createInboxItem(),
			userId: USER_ID,
		});

		writeInboxBrowserNotificationSoundEnabled({
			enabled: false,
			userId: USER_ID,
		});
		vi.runAllTimers();

		expect(playMock).not.toHaveBeenCalled();
	});

	it("keeps audio failures from escaping into notification delivery", () => {
		playMock.mockImplementationOnce(() => {
			throw new Error("Audio unavailable");
		});
		const warning = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		queueInboxBrowserNotificationSound({
			item: createInboxItem(),
			userId: USER_ID,
		});

		expect(() => vi.runAllTimers()).not.toThrow();
		expect(warning).toHaveBeenCalledWith(
			"[openmeld.web.inbox.browser_notification_sound_failed]",
			{ error: "Audio unavailable" }
		);
	});
});

function createInboxItem(overrides: Partial<InboxItem> = {}): InboxItem {
	return {
		attention: "action_required",
		contextLabel: "Design Room",
		createdAt: "2026-08-04T01:00:00.000Z",
		id: "22222222-2222-2222-2222-222222222222",
		importance: "urgent",
		kind: "agent_interaction",
		occurredAt: "2026-08-04T01:00:00.000Z",
		organizationId: "33333333-3333-3333-3333-333333333333",
		preview: "Review the proposed database migration.",
		readAt: null,
		recipientUserId: USER_ID,
		resolutionStatus: "open",
		sourceTarget: {
			interactionId: "44444444-4444-4444-4444-444444444444",
			kind: "agent_interaction",
			runtimeCoordinatorExecutionId: "55555555-5555-5555-5555-555555555555",
			spaceId: "66666666-6666-6666-6666-666666666666",
		},
		title: "Agent approval required",
		updatedAt: "2026-08-04T01:00:00.000Z",
		...overrides,
	};
}
