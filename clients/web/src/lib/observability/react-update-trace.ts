import {
	WEB_APPLICATION_REACT_UPDATE_TRACE_MAX_EVENTS,
	type WebApplicationReactUpdateEvent,
} from "@openmeld/schemas";

const TRACE_WINDOW_MS = 5000;
const events: { event: WebApplicationReactUpdateEvent; at: number }[] = [];
const capturedErrors = new WeakMap<
	object,
	{ event: WebApplicationReactUpdateEvent; ageMs: number }[]
>();

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

export function readRecentReactUpdates(error?: unknown): {
	event: WebApplicationReactUpdateEvent;
	ageMs: number;
}[] {
	if (typeof window === "undefined") {
		return [];
	}
	if (error !== null && typeof error === "object") {
		const captured = capturedErrors.get(error);
		if (captured) {
			return captured;
		}
	}
	const now = performance.now();
	const recent = events.flatMap(({ event, at }) => {
		const ageMs = Math.floor(now - at);
		return ageMs >= 0 && ageMs <= TRACE_WINDOW_MS ? [{ event, ageMs }] : [];
	});
	// The manual report may arrive after the five-second window has passed.
	// Bind its fixed-label snapshot to this exact Error, without retaining the Error.
	if (error !== null && typeof error === "object") {
		capturedErrors.set(error, recent);
	}
	return recent;
}
