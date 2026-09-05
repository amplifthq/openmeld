import {
	WEB_APPLICATION_ERROR_PATH,
	type WebApplicationErrorReport,
	type WebApplicationErrorSource,
} from "@openmeld/schemas";
import {
	summarizeApplicationError,
	WEB_ERROR_BUILD,
} from "./application-error";

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
		const report: WebApplicationErrorReport = {
			version: 1,
			id: crypto.randomUUID(),
			source,
			buildId: WEB_ERROR_BUILD.id,
			sourceSha: WEB_ERROR_BUILD.sha,
			routeId,
			error: summary,
		};
		// keepalive allows a small report to outlive the automatic page refresh.
		// Never retry a failed diagnostic request or report its own failure.
		fetch(WEB_APPLICATION_ERROR_PATH, {
			method: "POST",
			credentials: "omit",
			keepalive: true,
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(report),
		}).catch(() => undefined);
	} catch {
		// Telemetry must not replace the original application outcome.
	}
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
