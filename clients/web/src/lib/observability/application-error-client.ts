import {
	WEB_APPLICATION_ERROR_PATH,
	type WebApplicationErrorReport,
	type WebApplicationErrorSource,
} from "@openmeld/schemas";
import {
	summarizeApplicationError,
	WEB_ERROR_BUILD,
} from "./application-error";
import { browserDiagnosticContext } from "./space-open";

let readRouteId: () => string | null = () => null;
export function setApplicationErrorRouteReader(
	reader: () => string | null
): void {
	readRouteId = reader;
}

// Bounded, in-memory deduplication: no account data or browser persistence.
const reported = new Set<string>();
export function reportClientApplicationError(
	error: unknown,
	source: WebApplicationErrorSource,
	resource?: string
): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		const summary = summarizeApplicationError(error, resource);
		const routeId = readRouteId();
		const key = JSON.stringify([routeId, summary]);
		if (reported.has(key) || reported.size >= 20) {
			return;
		}
		reported.add(key);
		const report = createApplicationErrorReport(error, source, resource);
		// keepalive allows a small report to outlive the automatic page refresh.
		// Never retry a failed diagnostic request or report its own failure.
		sendApplicationErrorReport(report).catch(() => undefined);
	} catch {
		// Telemetry must not replace the original application outcome.
	}
}

function createApplicationErrorReport(
	error: unknown,
	source: WebApplicationErrorSource,
	resource?: string
): WebApplicationErrorReport {
	return {
		version: 1,
		id: crypto.randomUUID(),
		...browserDiagnosticContext(),
		source,
		buildId: WEB_ERROR_BUILD.id,
		sourceSha: WEB_ERROR_BUILD.sha,
		routeId: readRouteId(),
		error: summarizeApplicationError(error, resource),
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
