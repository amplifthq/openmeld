import { env } from "cloudflare:workers";
import {
	DESKTOP_APP_ORIGIN,
	DESKTOP_CONTRACT_HEADER,
	DESKTOP_CONTRACT_VERSION,
	WEB_APPLICATION_ERROR_MAX_BYTES,
	type WebApplicationErrorReport,
	webApplicationErrorReportSchema,
} from "@openmeld/schemas";
import {
	summarizeApplicationError,
	WEB_ERROR_BUILD,
} from "./application-error";

const CF_RAY = /^[a-f0-9]{16,32}(?:-[A-Z]{3})?$/;
const reportedRequests = new WeakSet<Request>();

export function logApplicationError(
	report: WebApplicationErrorReport,
	request: Request,
	status?: number
): void {
	const ray = request.headers.get("cf-ray");
	const log =
		report.source === "wake_progress_presentation"
			? console.warn
			: console.error;
	log({
		event:
			report.source === "wake_progress_presentation"
				? "web.openmeld.wake_progress_presentation_unconfirmed"
				: "web.openmeld.application_error",
		workerName: "openmeld-web",
		environment: env.OPENMELD_WORKER_ENVIRONMENT,
		serverBuildId: WEB_ERROR_BUILD.id,
		serverSourceSha: WEB_ERROR_BUILD.sha,
		serverBuildDirty: WEB_ERROR_BUILD.dirty,
		cfRayId: ray && CF_RAY.test(ray) ? ray : null,
		status: status ?? null,
		report,
	});
}

export function reportServerApplicationError(
	error: unknown,
	request: Request,
	source: "server_request" | "server_function",
	status?: number
): void {
	if (request.signal.aborted || reportedRequests.has(request)) {
		return;
	}
	try {
		const summary = summarizeApplicationError(error);
		if (status && status >= 500) {
			summary.code = "http_5xx";
		}
		logApplicationError(
			{
				version: 1,
				id: crypto.randomUUID(),
				source,
				buildId: WEB_ERROR_BUILD.id,
				sourceSha: WEB_ERROR_BUILD.sha,
				routeId: null,
				error: summary,
			},
			request,
			status
		);
		reportedRequests.add(request);
	} catch {
		// A diagnostic failure must not replace the application exception.
	}
}

const response = (status: number) =>
	new Response(null, {
		status,
		headers: { "Cache-Control": "no-store" },
	});

// Best-effort isolate log-volume cap, not a distributed security rate limit.
// Fixed-size state; never retain IPs, sessions, exception text, or request bodies.
let windowStarted = 0;
let accepted = 0;
export async function receiveApplicationError(
	request: Request
): Promise<Response> {
	if (request.method !== "POST") {
		return response(405);
	}
	const origin = request.headers.get("origin");
	const isDesktopReport =
		origin === DESKTOP_APP_ORIGIN &&
		request.headers.get(DESKTOP_CONTRACT_HEADER) === DESKTOP_CONTRACT_VERSION;
	if (origin !== new URL(request.url).origin && !isDesktopReport) {
		return response(403);
	}
	if (
		request.headers.get("content-type")?.split(";")[0].trim() !==
		"application/json"
	) {
		return response(415);
	}
	const now = Date.now();
	if (now - windowStarted >= 60_000) {
		windowStarted = now;
		accepted = 0;
	}
	if (accepted >= 120) {
		return response(429);
	}
	accepted++;
	if (
		Number(request.headers.get("content-length")) >
		WEB_APPLICATION_ERROR_MAX_BYTES
	) {
		return response(413);
	}
	const reader = request.body?.getReader();
	if (!reader) {
		return response(400);
	}
	const chunks: Uint8Array[] = [];
	let bytes = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			bytes += value.byteLength;
			if (bytes > WEB_APPLICATION_ERROR_MAX_BYTES) {
				reader.cancel().catch(() => undefined);
				return response(413);
			}
			chunks.push(value);
		}
		const body = new Uint8Array(bytes);
		let offset = 0;
		for (const chunk of chunks) {
			body.set(chunk, offset);
			offset += chunk.byteLength;
		}
		const parsed = webApplicationErrorReportSchema.safeParse(
			JSON.parse(new TextDecoder().decode(body))
		);
		if (
			!parsed.success ||
			parsed.data.source.startsWith("server_") ||
			(parsed.data.source === "wake_progress_presentation") !==
				(parsed.data.wakeProgress !== undefined) ||
			(parsed.data.source === "wake_progress_presentation" &&
				parsed.data.error.code !== "unconfirmed_wake_progress_displayed")
		) {
			return response(400);
		}
		logApplicationError(parsed.data, request);
		return response(204);
	} catch {
		// Malformed telemetry is not itself an application error.
		return response(400);
	} finally {
		reader.releaseLock();
	}
}
