/**
 * Cadence policy for the Inbox notification observation cursor.
 *
 * The account invalidation stream is the primary change signal. Polling is
 * only recovery: a bounded drain while Core reports more pages, a slow repair
 * poll while the stream is connected, and an exponential backoff while it is
 * disconnected so a broken stream cannot turn every visible tab into a
 * one-request-per-second loop.
 */

export const INBOX_OBSERVATION_DRAIN_INTERVAL_MS = 1000;
export const INBOX_OBSERVATION_BACKOFF_BASE_MS = 1000;
export const INBOX_OBSERVATION_BACKOFF_MAX_MS = 30_000;
export const CONNECTED_INBOX_RECOVERY_POLL_INTERVAL_MS = 30_000;
/** Hidden browser tabs still deliver browser notifications on this cadence. */
export const HIDDEN_INBOX_NOTIFICATION_POLL_INTERVAL_MS = 10_000;

/**
 * Delay for one disconnected attempt. The first attempt is exact so a fresh
 * disconnect repairs quickly; later attempts keep 75-100% of the step so many
 * tabs that lost the same stream do not poll in lockstep.
 */
export function inboxObservationBackoffDelayMs(
	attempt: number,
	random: () => number = Math.random
): number {
	const step = Math.min(
		INBOX_OBSERVATION_BACKOFF_MAX_MS,
		INBOX_OBSERVATION_BACKOFF_BASE_MS * 2 ** Math.max(0, attempt)
	);
	if (attempt <= 0) {
		return step;
	}
	return Math.round(step * (0.75 + 0.25 * random()));
}

export type InboxObservationBackoff = {
	/**
	 * Returns the delay after the fetch identified by `fetchKey`. Repeated calls
	 * for the same fetch return the same delay: TanStack Query re-evaluates a
	 * refetchInterval function on renders, and a changing value would restart
	 * its timer.
	 */
	delayAfter(fetchKey: string): number;
	/** Restart from the shortest delay (reconnect, visibility, focus, activity). */
	reset(): void;
};

export function createInboxObservationBackoff(
	random: () => number = Math.random
): InboxObservationBackoff {
	let lastFetchKey: string | null = null;
	let attempt = -1;
	let delay = INBOX_OBSERVATION_BACKOFF_BASE_MS;
	return {
		delayAfter(fetchKey) {
			if (fetchKey !== lastFetchKey) {
				lastFetchKey = fetchKey;
				attempt = Math.min(attempt + 1, 16);
				delay = inboxObservationBackoffDelayMs(attempt, random);
			}
			return delay;
		},
		reset() {
			lastFetchKey = null;
			attempt = -1;
			delay = INBOX_OBSERVATION_BACKOFF_BASE_MS;
		},
	};
}

export function resolveInboxObservationPollInterval(input: {
	/** Core reported another page behind the cursor. */
	hasMore: boolean;
	/** The latest page carried at least one observation. */
	sawItems: boolean;
	visible: boolean;
	streamConnected: boolean;
	notificationsEnabled: boolean;
	desktop: boolean;
	fetchKey: string;
	backoff: InboxObservationBackoff;
}): number | false {
	if (input.hasMore) {
		return INBOX_OBSERVATION_DRAIN_INTERVAL_MS;
	}
	if (input.streamConnected) {
		// Push delivers changes; this only repairs a missed frame.
		return input.visible || (input.notificationsEnabled && !input.desktop)
			? CONNECTED_INBOX_RECOVERY_POLL_INTERVAL_MS
			: false;
	}
	if (!input.visible) {
		// Desktop's native cadence owns hidden-window refreshes. A hidden browser
		// tab polls only when it must deliver browser notifications.
		return input.notificationsEnabled && !input.desktop
			? HIDDEN_INBOX_NOTIFICATION_POLL_INTERVAL_MS
			: false;
	}
	if (input.sawItems) {
		// Fresh activity means another change is likely soon.
		input.backoff.reset();
	}
	return input.backoff.delayAfter(input.fetchKey);
}
