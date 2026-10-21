import {
	WEB_APPLICATION_ERROR_PATH,
	type WebApplicationErrorBoundary,
	type WebApplicationErrorQueryCategory,
	type WebApplicationErrorQueryDiagnostic,
	type WebApplicationErrorReport,
	type WebApplicationErrorSource,
	webApplicationErrorReportSchema,
	webApplicationErrorRouteIdSchema,
} from "@openmeld/schemas";
import {
	readApplicationErrorRequestFailure,
	summarizeApplicationError,
	WEB_ERROR_BUILD,
} from "./application-error";
import { readRecentReactUpdates } from "./react-update-trace";
import { browserDiagnosticContext } from "./space-open";

let readRouteId: () => string | null = () => null;
let lastNavigation: { fromRouteId: string; startedAt: number } | null = null;
export function setApplicationErrorRouteReader(
	reader: () => string | null
): void {
	readRouteId = reader;
}

/** Retain only the route template that led into this page, never a URL or search params. */
export function recordApplicationErrorNavigation(fromRouteId: string): void {
	const parsed = webApplicationErrorRouteIdSchema.safeParse(fromRouteId);
	lastNavigation = parsed.success
		? { fromRouteId: parsed.data, startedAt: performance.now() }
		: null;
}

// Bounded, in-memory deduplication: no account data or browser persistence.
const reported = new Set<string>();
const reportedWakeProgress = new Set<string>();
export function reportClientApplicationError(
	error: unknown,
	source: WebApplicationErrorSource,
	resource?: string,
	query?: WebApplicationErrorQueryDiagnostic,
	reactBoundary?: WebApplicationErrorBoundary
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		const report = createApplicationErrorReport(
			error,
			source,
			resource,
			query,
			reactBoundary
		);
		const key = JSON.stringify([
			report.routeId,
			report.navigation?.fromRouteId,
			report.reactBoundary,
			report.error,
			report.query,
		]);
		if (reported.has(key) || reported.size >= 20) {
			return;
		}
		reported.add(key);
		// keepalive allows a small report to outlive the automatic page refresh.
		// Never retry a failed diagnostic request or report its own failure.
		sendApplicationErrorReport(report).catch(() => undefined);
	} catch {
		// Telemetry must not replace the original application outcome.
	}
}

export function reportCaughtComponentError(
	error: unknown,
	boundary: WebApplicationErrorBoundary
): void {
	reportClientApplicationError(
		error,
		"react_caught",
		undefined,
		undefined,
		boundary
	);
}

export function reportClientQueryError(
	error: unknown,
	category: WebApplicationErrorQueryCategory,
	stage?: WebApplicationErrorQueryDiagnostic["stage"]
): void {
	reportClientApplicationError(error, "query", undefined, {
		category,
		...(stage ? { stage } : {}),
		failure: readApplicationErrorRequestFailure(error),
	});
}

/** Report visible Wake work without current confirmation or arbitrary browser state. */
export function reportUnconfirmedWakeProgressPresentation(
	wakeProgress: NonNullable<WebApplicationErrorReport["wakeProgress"]>
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		const report = webApplicationErrorReportSchema.safeParse({
			...createApplicationErrorReport(
				new Error("unconfirmed wake progress displayed"),
				"wake_progress_presentation"
			),
			wakeProgress,
			error: {
				name: "Error",
				code: "unconfirmed_wake_progress_displayed",
				frames: [],
			},
		});
		if (!report.success) {
			return;
		}
		const key = JSON.stringify([
			wakeProgress.spaceId,
			wakeProgress.dispatchId,
			wakeProgress.clientMessageId,
			wakeProgress.streamId,
			wakeProgress.phase,
			wakeProgress.fromRestoredPresentation,
			wakeProgress.fromCachedSpaceSummary,
			wakeProgress.fromCachedOwnSummary,
			wakeProgress.fromBootstrapStream,
			wakeProgress.fromHistoricalSignal,
			wakeProgress.spaceSummaryFetchedAfterMount,
			wakeProgress.ownSummaryFetchedAfterMount,
			wakeProgress.bootstrapFetchedAfterMount,
		]);
		if (reportedWakeProgress.has(key) || reportedWakeProgress.size >= 10) {
			return;
		}
		reportedWakeProgress.add(key);
		sendApplicationErrorReport(report.data).catch(() => undefined);
	} catch {
		// Diagnostic delivery must never change the Space view.
	}
}

function createApplicationErrorReport(
	error: unknown,
	source: WebApplicationErrorSource,
	resource?: string,
	query?: WebApplicationErrorQueryDiagnostic,
	reactBoundary?: WebApplicationErrorBoundary
): WebApplicationErrorReport {
	const elapsedMs = lastNavigation
		? Math.floor(performance.now() - lastNavigation.startedAt)
		: -1;
	const summary = summarizeApplicationError(error, resource);
	const queryDiagnostic =
		query ??
		(error instanceof Error &&
		"operation" in error &&
		error.operation === "account.organizationContext.read"
			? {
					category: "account_organization_context" as const,
					failure: readApplicationErrorRequestFailure(error),
				}
			: undefined);
	const reactUpdateTrace =
		summary.code === "react_update_depth" ? readRecentReactUpdates(error) : [];
	return {
		version: 1,
		id: crypto.randomUUID(),
		...browserDiagnosticContext(),
		source,
		buildId: WEB_ERROR_BUILD.id,
		sourceSha: WEB_ERROR_BUILD.sha,
		routeId: readRouteId(),
		...(lastNavigation && elapsedMs >= 0 && elapsedMs <= 600_000
			? {
					navigation: {
						fromRouteId: lastNavigation.fromRouteId,
						elapsedMs,
					},
				}
			: {}),
		...(reactBoundary ? { reactBoundary } : {}),
		...(reactUpdateTrace.length > 0 ? { reactUpdateTrace } : {}),
		...(queryDiagnostic ? { query: queryDiagnostic } : {}),
		error: summary,
	};
}

function sendApplicationErrorReport(report: WebApplicationErrorReport) {
	return fetch(WEB_APPLICATION_ERROR_PATH, {
		method: "POST",
		credentials: "omit",
		keepalive: true,
		signal: AbortSignal.timeout(10_000),
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(report),
	});
}

/** Explicit submissions bypass automatic deduplication and confirm intake. */
export async function submitApplicationErrorReport(
	error: unknown
): Promise<string> {
	const report = createApplicationErrorReport(error, "route");
	report.submission = "user";
	const response = await sendApplicationErrorReport(report);
	if (response.status !== 204) {
		throw new Error("The error report was not accepted.");
	}
	return report.id;
}

export function installApplicationErrorReporting(): () => void {
	const onError = (event: Event) => {
		if (event instanceof ErrorEvent) {
			reportClientApplicationError(
				event.error ?? event.message,
				"window",
				event.filename
			);
		} else if (
			event.target instanceof HTMLScriptElement ||
			event.target instanceof HTMLLinkElement
		) {
			const resource =
				event.target instanceof HTMLScriptElement
					? event.target.src
					: event.target.href;
			reportClientApplicationError(null, "resource", resource);
		}
	};
	const onRejection = (event: PromiseRejectionEvent) =>
		reportClientApplicationError(event.reason, "unhandled_rejection");
	const onPreload = (event: Event) =>
		reportClientApplicationError(
			(event as Event & { payload?: unknown }).payload,
			"preload"
		);
	window.addEventListener("error", onError, true);
	window.addEventListener("unhandledrejection", onRejection);
	window.addEventListener("vite:preloadError", onPreload);
	return () => {
		window.removeEventListener("error", onError, true);
		window.removeEventListener("unhandledrejection", onRejection);
		window.removeEventListener("vite:preloadError", onPreload);
	};
}
