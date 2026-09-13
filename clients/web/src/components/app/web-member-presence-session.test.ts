import {
	HUMAN_PRESENCE_HEARTBEAT_MS,
	HUMAN_PRESENCE_IDLE_MS,
} from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startWebMemberPresenceSession } from "./web-member-presence-session";

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe("Web member presence session", () => {
	it("lets the server lease cover brief background periods without renewing it there", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
		const focus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
		const visibility = vi
			.spyOn(document, "visibilityState", "get")
			.mockReturnValue("visible");
		const report = vi.fn();
		const stop = startWebMemberPresenceSession(report);
		try {
			const sessionId = report.mock.calls[0][0].sessionId;
			focus.mockReturnValue(false);
			window.dispatchEvent(new Event("blur"));
			visibility.mockReturnValue("hidden");
			document.dispatchEvent(new Event("visibilitychange"));
			vi.advanceTimersByTime(HUMAN_PRESENCE_HEARTBEAT_MS * 4);
			expect(report.mock.calls.map(([body]) => body.foreground)).toEqual([
				true,
			]);
			focus.mockReturnValue(true);
			visibility.mockReturnValue("visible");
			window.dispatchEvent(new Event("focus"));
			expect(report).toHaveBeenLastCalledWith({
				sessionId,
				sequence: 2,
				foreground: true,
				interaction: true,
			});
			window.dispatchEvent(new Event("pagehide"));
			expect(report).toHaveBeenLastCalledWith({
				sessionId,
				sequence: 3,
				foreground: false,
				interaction: false,
			});
		} finally {
			stop();
		}
	});
	it("ends an idle foreground session and does not treat synthetic input as human activity", () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-09-11T00:00:00Z"));
		vi.spyOn(document, "hasFocus").mockReturnValue(true);
		vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
		const report = vi.fn();
		const stop = startWebMemberPresenceSession(report);
		try {
			vi.advanceTimersByTime(
				HUMAN_PRESENCE_IDLE_MS - HUMAN_PRESENCE_HEARTBEAT_MS
			);
			window.dispatchEvent(new Event("pointermove"));
			vi.advanceTimersByTime(HUMAN_PRESENCE_HEARTBEAT_MS);
			expect(report).toHaveBeenLastCalledWith(
				expect.objectContaining({ foreground: false, interaction: false })
			);
		} finally {
			stop();
		}
	});
});
