import {
	HUMAN_PRESENCE_HEARTBEAT_MS,
	HUMAN_PRESENCE_IDLE_MS,
} from "@openmeld/schemas";
import type { OrganizationMemberPresenceBody } from "@openmeld/schemas/types";

// One page owns one sequence. Device/tab departure cannot overwrite another page.
export function startWebMemberPresenceSession(
	report: (body: OrganizationMemberPresenceBody) => void
) {
	const sessionId = crypto.randomUUID();
	let sequence = 0;
	let lastInteractionAt = 0;
	let lastReportAt = 0;
	let interactionPending = false;
	let foregroundReported = false;
	const isForeground = () =>
		document.visibilityState === "visible" && document.hasFocus();
	const send = () => {
		// Losing focus is not a departure. Stop renewing and let Core's existing
		// lease cover a brief tab/window switch; hidden pages never extend it.
		if (!isForeground()) {
			return;
		}
		const now = Date.now();
		const foreground = now - lastInteractionAt < HUMAN_PRESENCE_IDLE_MS;
		if (!(foreground || foregroundReported)) {
			return;
		}
		report({
			sessionId,
			sequence: ++sequence,
			foreground,
			interaction: foreground && interactionPending,
		});
		foregroundReported = foreground;
		interactionPending = false;
		lastReportAt = now;
	};
	const interact = () => {
		if (!isForeground()) {
			return;
		}
		lastInteractionAt = Date.now();
		interactionPending = true;
		if (
			!foregroundReported ||
			Date.now() - lastReportAt >= HUMAN_PRESENCE_HEARTBEAT_MS
		) {
			send();
		}
	};
	const input = (event: Event) => {
		if (event.isTrusted) {
			interact();
		}
	};
	const visibility = () => {
		if (isForeground()) {
			interact();
		}
	};
	const leave = () => {
		if (!foregroundReported) {
			return;
		}
		foregroundReported = false;
		interactionPending = false;
		report({
			sessionId,
			sequence: ++sequence,
			foreground: false,
			interaction: false,
		});
	};
	const events = [
		"pointerdown",
		"pointermove",
		"keydown",
		"wheel",
		"touchmove",
	] as const;
	for (const event of events) {
		window.addEventListener(event, input, { passive: true });
	}
	window.addEventListener("focus", visibility);
	document.addEventListener("visibilitychange", visibility);
	window.addEventListener("pagehide", leave);
	const timer = window.setInterval(send, HUMAN_PRESENCE_HEARTBEAT_MS);
	interact();
	return () => {
		window.clearInterval(timer);
		for (const event of events) {
			window.removeEventListener(event, input);
		}
		window.removeEventListener("focus", visibility);
		document.removeEventListener("visibilitychange", visibility);
		window.removeEventListener("pagehide", leave);
		leave();
	};
}
