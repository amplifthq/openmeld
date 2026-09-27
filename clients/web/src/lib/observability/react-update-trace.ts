import {
	WEB_APPLICATION_REACT_UPDATE_TRACE_MAX_EVENTS,
	type WebApplicationReactUpdateEvent,
} from "@openmeld/schemas";

const TRACE_WINDOW_MS = 5000;
const events: { event: WebApplicationReactUpdateEvent; at: number }[] = [];

/** Keep only static code-path labels in page memory for an update-depth error. */
export function recordReactUpdate(event: WebApplicationReactUpdateEvent): void {
	if (typeof window === "undefined") {
		return;
	}
	events.push({ event, at: performance.now() });
	if (events.length > WEB_APPLICATION_REACT_UPDATE_TRACE_MAX_EVENTS) {
		events.shift();
	}
}

export function readRecentReactUpdates(): {
	event: WebApplicationReactUpdateEvent;
	ageMs: number;
}[] {
	if (typeof window === "undefined") {
		return [];
	}
	const now = performance.now();
	return events.flatMap(({ event, at }) => {
		const ageMs = Math.floor(now - at);
		return ageMs >= 0 && ageMs <= TRACE_WINDOW_MS ? [{ event, ageMs }] : [];
	});
}
