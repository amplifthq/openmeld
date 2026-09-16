import type { WebPerformanceReport } from "@openmeld/schemas";
import { WEB_PERFORMANCE_POLICY } from "./performance-policy";

const SPACE_ROUTE = /^(\/o\/[^/]+)?\/spaces\/([^/]+)\/?$/;
const SPACE_REQUEST =
	/^\/v1\/spaces\/([^/]+)\/(entry-resolution|bootstrap|signals|status|members)$/;
const REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

type Snapshot = NonNullable<WebPerformanceReport["spaceOpen"]>;
type RequestObservation = Snapshot["requests"][number] & { start: number };
type Attempt = {
	spaceId: string;
	pathname: string;
	routeId: string;
	start: number;
	normalSample: boolean;
	done: boolean;
	outcome: WebPerformanceReport["outcome"];
	snapshot: Snapshot;
	requests: RequestObservation[];
	timer: ReturnType<typeof setTimeout>;
};
type Reporter = (attempt: {
	routeId: string;
	durationMs: number;
	spaceOpen: Snapshot;
	outcome: WebPerformanceReport["outcome"];
}) => void;
let report: Reporter | undefined;
let active: Attempt | undefined;
let pageSessionId: string | undefined;
export function browserDiagnosticContext() {
	if (typeof window === "undefined") {
		return {};
	}
	pageSessionId ??= crypto.randomUUID();
	return { pageSessionId, spaceOpenAttemptId: active?.snapshot.attemptId };
}

function emit(
	attempt: Attempt,
	outcome: WebPerformanceReport["outcome"],
	user = false
) {
	const durationMs = Math.min(
		3_600_000,
		Math.max(0, performance.now() - attempt.start)
	);
	const failure =
		outcome === "failed" || outcome === "denied" || outcome === "still_pending";
	const normal = !failure && attempt.normalSample;
	// Draw independently of latency. Separate report quotas are enforced by the receiver client.
	if (
		!(user || failure || normal) &&
		durationMs < WEB_PERFORMANCE_POLICY.navigationThresholdMs
	) {
		return;
	}
	let sampling: Snapshot["sampling"] = "slow";
	if (normal) {
		sampling = "normal";
	}
	if (failure) {
		sampling = "failure";
	}
	if (user) {
		sampling = "user";
	}
	try {
		report?.({
			routeId: attempt.routeId,
			durationMs,
			outcome,
			spaceOpen: {
				...attempt.snapshot,
				sampling,
				sampleRate: sampling === "normal" ? 0.1 : 1,
				visibility:
					document.visibilityState === "visible" ? "visible" : "hidden",
				online: navigator.onLine,
				requests: attempt.requests.map(({ start, ...request }) => ({
					...request,
					elapsedMs:
						request.phase === "complete" || request.phase === "failed"
							? request.elapsedMs
							: Math.min(3_600_000, performance.now() - start),
				})),
			},
		});
	} catch {
		/* Diagnostics never change the application outcome. */
	}
}

export function beginSpaceOpen(pathname: string, trigger: Snapshot["trigger"]) {
	if (!report) {
		return;
	}
	if (active?.pathname === pathname) {
		return;
	}
	const match = pathname.match(SPACE_ROUTE);
	// Public links canonicalize to the organization route within the same opening.
	if (active && !active.done && match?.[2] === active.spaceId) {
		active.pathname = pathname;
		active.routeId = match[1]
			? "/o/$orgSlug/spaces/$spaceId"
			: "/spaces/$spaceId";
		return;
	}
	if (active) {
		clearTimeout(active.timer);
		if (!active.done) {
			emit(active, "superseded");
		}
		active = undefined;
	}
	if (!match?.[2]) {
		return;
	}
	const attempt: Attempt = {
		spaceId: match[2],
		pathname,
		routeId: match[1] ? "/o/$orgSlug/spaces/$spaceId" : "/spaces/$spaceId",
		start: performance.now(),
		normalSample: Math.random() < 0.1,
		done: false,
		outcome: "still_pending",
		requests: [],
		snapshot: {
			attemptId: crypto.randomUUID(),
			trigger,
			sampling: "normal",
			sampleRate: 0.1,
			stage: "route",
			accessMs: null,
			contentMs: null,
			composerMs: null,
			content: "unknown",
			composer: "unknown",
			cache: "unknown",
			prefetch: "unknown",
			visibility: document.visibilityState === "visible" ? "visible" : "hidden",
			wasHidden: document.visibilityState !== "visible",
			online: navigator.onLine,
			queryStatus: "unknown",
			fetchStatus: "unknown",
			failureCount: 0,
			requests: [],
		},
		timer: setTimeout(() => {
			if (active === attempt && !attempt.done) {
				emit(attempt, "still_pending");
			}
		}, 5000),
	};
	active = attempt;
}

export function installSpaceOpenReporting(reporter: Reporter) {
	report = reporter;
	beginSpaceOpen(window.location.pathname, "initial");
	const visibility = () => {
		if (active && document.visibilityState !== "visible") {
			active.snapshot.wasHidden = true;
		}
	};
	const pagehide = () => {
		if (active && !active.done) {
			emit(active, "superseded");
			active.done = true;
			clearTimeout(active.timer);
		}
	};
	document.addEventListener("visibilitychange", visibility);
	window.addEventListener("pagehide", pagehide);
	return () => {
		if (active) {
			clearTimeout(active.timer);
		}
		active = undefined;
		report = undefined;
		document.removeEventListener("visibilitychange", visibility);
		window.removeEventListener("pagehide", pagehide);
	};
}

export function observeSpaceOpen(
	spaceId: string,
	fields: Partial<
		Pick<
			Snapshot,
			"cache" | "prefetch" | "queryStatus" | "fetchStatus" | "failureCount"
		>
	>
) {
	if (active?.spaceId === spaceId && !active.done) {
		const { cache, ...other } = fields;
		Object.assign(active.snapshot, other);
		if (
			cache &&
			(active.snapshot.cache === "unknown" ||
				(active.snapshot.cache === "cold" && cache === "restored"))
		) {
			active.snapshot.cache = cache;
		}
		if (fields.queryStatus && active.snapshot.accessMs === null) {
			active.snapshot.stage = "access";
		}
	}
}

export function markSpaceOpen(
	spaceId: string,
	milestone:
		| "access"
		| "messages"
		| "empty"
		| "editable"
		| "read_only"
		| "failed"
		| "denied"
) {
	const attempt = active;
	if (!attempt || attempt.done || attempt.spaceId !== spaceId) {
		return;
	}
	const snapshot = attempt.snapshot;
	const elapsed = Math.min(3_600_000, performance.now() - attempt.start);
	if (milestone === "failed" || milestone === "denied") {
		attempt.done = true;
		attempt.outcome = milestone;
		clearTimeout(attempt.timer);
		emit(attempt, milestone);
		return;
	}
	if (milestone === "access") {
		snapshot.accessMs ??= elapsed;
	} else if (milestone === "messages" || milestone === "empty") {
		snapshot.contentMs ??= elapsed;
		snapshot.content = milestone;
	} else {
		snapshot.composerMs ??= elapsed;
		snapshot.composer = milestone;
	}
	snapshot.stage = "ready";
	if (snapshot.composerMs === null) {
		snapshot.stage = "composer";
	}
	if (snapshot.contentMs === null) {
		snapshot.stage = "content";
	}
	if (snapshot.accessMs === null) {
		snapshot.stage = "access";
	}
	if (snapshot.stage === "ready") {
		attempt.done = true;
		attempt.outcome = "resolved";
		clearTimeout(attempt.timer);
		emit(attempt, "resolved");
	}
}

/** Copies an ephemeral lookup key, never a URL, account, or message. */
export async function copySpaceOpenDiagnosticId(spaceId: string) {
	if (!active || active.spaceId !== spaceId) {
		throw new Error("No Space diagnostic is available.");
	}
	emit(active, active.outcome, true);
	await navigator.clipboard.writeText(active.snapshot.attemptId);
}

// Bounded intent-prefetch provenance only. Never used to authorize or populate a cache.
const prefetches = new Map<
	string,
	{ phase: "in_flight" | "complete"; at: number }
>();
export function recordSpacePrefetch(
	key: string,
	phase: "in_flight" | "complete"
) {
	if (typeof window === "undefined") {
		return;
	}
	if (prefetches.size >= 20) {
		const oldest = prefetches.keys().next().value;
		if (oldest) {
			prefetches.delete(oldest);
		}
	}
	prefetches.set(key, { phase, at: performance.now() });
}
export function readSpacePrefetch(key: string): Snapshot["prefetch"] {
	const value = prefetches.get(key);
	return value && performance.now() - value.at < 300_000
		? value.phase
		: "unknown";
}

export function observeSpaceRequest(url: string) {
	const attempt = active;
	if (!attempt || attempt.done) {
		return undefined;
	}
	let path: string;
	try {
		path = new URL(url, window.location.origin).pathname;
	} catch {
		return undefined;
	}
	const match = path.match(SPACE_REQUEST);
	if (!match || match[1] !== attempt.spaceId || attempt.requests.length >= 8) {
		return undefined;
	}
	const operations = {
		"entry-resolution": "entry",
		bootstrap: "bootstrap",
		signals: "history",
		status: "status",
		members: "members",
	} as const;
	const operation = operations[match[2] as keyof typeof operations];
	const observation: RequestObservation = {
		operation,
		phase: "preparing",
		start: performance.now(),
		elapsedMs: 0,
		sentMs: null,
		headersMs: null,
		validatedMs: null,
		failedAt: null,
		requestId: null,
		status: null,
	};
	attempt.requests.push(observation);
	return (phase: RequestObservation["phase"], response?: Response) => {
		if (
			phase === "failed" &&
			observation.phase !== "complete" &&
			observation.phase !== "failed"
		) {
			observation.failedAt = observation.phase;
		}
		observation.phase = phase;
		observation.elapsedMs = Math.min(
			3_600_000,
			performance.now() - observation.start
		);
		if (phase === "sent") {
			observation.sentMs = observation.elapsedMs;
		}
		if (phase === "headers") {
			observation.headersMs = observation.elapsedMs;
		}
		if (phase === "complete") {
			observation.validatedMs = observation.elapsedMs;
		}
		if (response) {
			observation.status = response.status;
			const id = response.headers.get("x-openmeld-request-id");
			observation.requestId = id && REQUEST_ID.test(id) ? id : null;
		}
	};
}
