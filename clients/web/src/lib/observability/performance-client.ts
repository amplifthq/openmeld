import {
	WEB_PERFORMANCE_PATH,
	type WebPerformancePolicy,
	type WebPerformanceReport,
	webPerformancePolicySchema,
} from "@openmeld/schemas";
import type { AnyRouter } from "@tanstack/react-router";
import { WEB_ERROR_BUILD } from "./application-error";
import { WEB_PERFORMANCE_POLICY } from "./performance-policy";
import {
	beginSpaceOpen,
	browserDiagnosticContext,
	installSpaceOpenReporting,
} from "./space-open";

type Navigation = {
	href: string;
	routeId: string | null;
	start: number;
	loadMs: number | null;
	longTaskCount: number;
	longTaskTotalMs: number;
	longestTaskMs: number;
	hidden: boolean;
	requests: Map<
		WebPerformanceReport["requestGroups"][number]["group"],
		{ count: number; maxMs: number }
	>;
	timer: ReturnType<typeof setTimeout>;
};

const REQUEST_GROUPS = [
	["/_serverFn/", "server_function"],
	["/v1/spaces/", "space"],
	["/v1/organizations/", "organization"],
	["/v1/account/", "account"],
	["/v1/inbox", "inbox"],
	["/assets/", "asset"],
] as const;
function requestGroup(
	path: string
): WebPerformanceReport["requestGroups"][number]["group"] {
	return (
		REQUEST_GROUPS.find(([prefix]) => path.startsWith(prefix))?.[1] ?? "other"
	);
}

export function summarizePerformanceRequests(
	entries: readonly PerformanceResourceTiming[],
	start: number
): Pick<
	WebPerformanceReport,
	"requestCount" | "longestRequestMs" | "requestGroups"
> {
	const groups = new Map<
		WebPerformanceReport["requestGroups"][number]["group"],
		{ count: number; maxMs: number }
	>();
	for (const entry of entries) {
		if (entry.startTime < start || entry.name.includes("/v1/observability/")) {
			continue;
		}
		let path: string;
		try {
			path = new URL(entry.name).pathname;
		} catch {
			continue;
		}
		const group = requestGroup(path);
		const current = groups.get(group) ?? { count: 0, maxMs: 0 };
		current.count++;
		current.maxMs = Math.max(current.maxMs, entry.duration);
		groups.set(group, current);
	}
	const requestGroups = [...groups].map(([group, value]) => ({
		group,
		...value,
	}));
	return {
		requestGroups,
		requestCount: requestGroups.reduce((sum, g) => sum + g.count, 0),
		longestRequestMs: Math.max(0, ...requestGroups.map((g) => g.maxMs)),
	};
}

function recordNavigationRequest(
	nav: Navigation | null,
	entry: PerformanceResourceTiming
) {
	if (!nav) {
		return;
	}
	for (const group of summarizePerformanceRequests([entry], nav.start)
		.requestGroups) {
		const previous = nav.requests.get(group.group);
		nav.requests.set(group.group, {
			count: (previous?.count ?? 0) + group.count,
			maxMs: Math.max(previous?.maxMs ?? 0, group.maxMs),
		});
	}
}

/** Router lifecycle timing, not a claim that every independently fetched pane is ready. */
export function installPerformanceReporting(router: AnyRouter): () => void {
	let policy: WebPerformancePolicy = WEB_PERFORMANCE_POLICY;
	let policyReadAt = Number.NEGATIVE_INFINITY;
	let active: Navigation | null = null;
	let windowStart = performance.now();
	let sent = 0;
	const interactionIds = new Set<number>();
	const pageSessionId = browserDiagnosticContext().pageSessionId;
	const spaceSent = { normal: 0, slow: 0, failure: 0, user: 0 };
	const routeId = () => router.state.matches.at(-1)?.routeId ?? null;
	const refreshPolicy = () => {
		if (performance.now() - policyReadAt < 300_000) {
			return;
		}
		policyReadAt = performance.now();
		fetch(WEB_PERFORMANCE_PATH, {
			credentials: "omit",
			signal: AbortSignal.timeout(5000),
		})
			.then((r) => (r.ok ? r.json() : null))
			.then((data) => {
				const parsed = webPerformancePolicySchema.safeParse(data);
				if (parsed.success) {
					policy = parsed.data;
				}
			})
			.catch(() => undefined);
	};
	const send = (
		report: Omit<
			WebPerformanceReport,
			| "version"
			| "id"
			| "pageSessionId"
			| "buildId"
			| "sourceSha"
			| "policyVersion"
			| "routeId"
		>,
		targetRouteId: string | null = routeId()
	) => {
		if (
			!policy.enabled ||
			(report.kind !== "space_open" && document.visibilityState !== "visible")
		) {
			return;
		}
		if (performance.now() - windowStart >= 3_600_000) {
			windowStart = performance.now();
			sent = 0;
			for (const key of Object.keys(spaceSent) as (keyof typeof spaceSent)[]) {
				spaceSent[key] = 0;
			}
			interactionIds.clear();
		}
		const bucket = report.spaceOpen?.sampling;
		if ((bucket ? spaceSent[bucket] : sent) >= policy.maxReportsPerHour) {
			return;
		}
		if (bucket) {
			spaceSent[bucket]++;
		} else {
			sent++;
		}
		fetch(WEB_PERFORMANCE_PATH, {
			method: "POST",
			credentials: "omit",
			keepalive: true,
			signal: AbortSignal.timeout(5000),
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				version: 1,
				id: crypto.randomUUID(),
				pageSessionId,
				buildId: WEB_ERROR_BUILD.id,
				sourceSha: WEB_ERROR_BUILD.sha,
				policyVersion: policy.version,
				routeId: targetRouteId,
				...report,
			}),
		}).catch(() => undefined);
	};
	const reportNavigation = (
		nav: Navigation,
		outcome: WebPerformanceReport["outcome"]
	) => {
		const durationMs = performance.now() - nav.start;
		if (
			nav.hidden ||
			durationMs < policy.navigationThresholdMs ||
			durationMs > 3_600_000
		) {
			return;
		}
		send(
			{
				kind: "navigation",
				outcome,
				durationMs,
				thresholdMs: policy.navigationThresholdMs,
				loadMs: nav.loadMs,
				longTaskCount: nav.longTaskCount,
				longTaskTotalMs: nav.longTaskTotalMs,
				longestTaskMs: nav.longestTaskMs,
				requestGroups: [...nav.requests].map(([group, values]) => ({
					group,
					...values,
				})),
				requestCount: [...nav.requests.values()].reduce(
					(count, entry) => count + entry.count,
					0
				),
				longestRequestMs: Math.max(
					0,
					...[...nav.requests.values()].map((entry) => entry.maxMs)
				),
			},
			nav.routeId
		);
	};
	const disposeSpaceOpen = installSpaceOpenReporting(({ routeId, ...report }) =>
		send(
			{
				...report,
				kind: "space_open",
				thresholdMs: policy.navigationThresholdMs,
				loadMs: null,
				longTaskCount: null,
				longTaskTotalMs: null,
				longestTaskMs: null,
				requestCount: null,
				longestRequestMs: null,
				requestGroups: [],
			},
			routeId
		)
	);
	const disposers = [
		router.subscribe("onBeforeNavigate", (event) => {
			beginSpaceOpen(event.toLocation.pathname, "navigation");
			if (active) {
				clearTimeout(active.timer);
				reportNavigation(active, "superseded");
			}
			refreshPolicy();
			const nav: Navigation = {
				href: event.toLocation.href,
				routeId:
					router.matchRoutes(event.toLocation.pathname).at(-1)?.routeId ?? null,
				start: performance.now(),
				loadMs: null,
				requests: new Map(),
				longTaskCount: 0,
				longTaskTotalMs: 0,
				longestTaskMs: 0,
				hidden: document.visibilityState !== "visible",
				timer: setTimeout(
					() => {
						if (active === nav) {
							reportNavigation(nav, "still_pending");
						}
					},
					Math.max(5000, policy.navigationThresholdMs)
				),
			};
			active = nav;
		}),
		router.subscribe("onLoad", (event) => {
			if (active?.href === event.toLocation.href) {
				active.loadMs = performance.now() - active.start;
			}
		}),
		router.subscribe("onResolved", (event) => {
			if (active?.href === event.toLocation.href) {
				clearTimeout(active.timer);
				reportNavigation(active, "resolved");
				active = null;
			}
		}),
	];
	const visibility = () => {
		if (active && document.visibilityState !== "visible") {
			active.hidden = true;
		}
	};
	document.addEventListener("visibilitychange", visibility);
	const recordEntry = (entry: PerformanceEntry) => {
		if (entry.entryType === "resource") {
			recordNavigationRequest(active, entry as PerformanceResourceTiming);
			return;
		}
		if (entry.entryType === "longtask") {
			if (active && entry.startTime >= active.start) {
				active.longTaskCount++;
				active.longTaskTotalMs += entry.duration;
				active.longestTaskMs = Math.max(active.longestTaskMs, entry.duration);
			}
			return;
		}
		const event = entry as PerformanceEventTiming & { interactionId?: number };
		if (
			!event.interactionId ||
			entry.duration < policy.interactionThresholdMs ||
			interactionIds.has(event.interactionId)
		) {
			return;
		}
		if (interactionIds.size >= 100) {
			interactionIds.clear();
		}
		interactionIds.add(event.interactionId);
		send({
			kind: "interaction",
			outcome: "interaction",
			durationMs: entry.duration,
			thresholdMs: policy.interactionThresholdMs,
			loadMs: null,
			longTaskCount: null,
			longTaskTotalMs: null,
			longestTaskMs: null,
			requestCount: null,
			longestRequestMs: null,
			requestGroups: [],
		});
	};
	const observers: PerformanceObserver[] = [];
	if (typeof PerformanceObserver !== "undefined") {
		for (const type of ["longtask", "event", "resource"]) {
			if (!PerformanceObserver.supportedEntryTypes.includes(type)) {
				continue;
			}
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) {
					recordEntry(entry);
				}
			});
			try {
				observer.observe({
					type,
					...(type === "event" ? { durationThreshold: 16 } : {}),
				});
				observers.push(observer);
			} catch {
				observer.disconnect();
			}
		}
	}
	refreshPolicy();
	return () => {
		disposeSpaceOpen();
		for (const dispose of disposers) {
			dispose();
		}
		for (const observer of observers) {
			observer.disconnect();
		}
		document.removeEventListener("visibilitychange", visibility);
		if (active) {
			clearTimeout(active.timer);
		}
	};
}
