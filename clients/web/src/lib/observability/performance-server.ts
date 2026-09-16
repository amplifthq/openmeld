import { env } from "cloudflare:workers";
import { webPerformanceReportSchema } from "@openmeld/schemas";
import { WEB_ERROR_BUILD } from "./application-error";
import { WEB_PERFORMANCE_POLICY } from "./performance-policy";

const response = (status: number) =>
	new Response(null, { status, headers: { "Cache-Control": "no-store" } });
let windowStart = 0;
let count = 0;
export async function receivePerformanceReport(
	request: Request
): Promise<Response> {
	if (request.headers.get("origin") !== new URL(request.url).origin) {
		return response(403);
	}
	if (
		request.headers.get("content-type")?.split(";")[0].trim() !==
		"application/json"
	) {
		return response(415);
	}
	if (!WEB_PERFORMANCE_POLICY.enabled) {
		return response(204);
	}
	if (Date.now() - windowStart >= 60_000) {
		windowStart = Date.now();
		count = 0;
	}
	// Best-effort per-isolate volume cap, not a distributed security rate limit.
	if (++count > 120) {
		return response(429);
	}
	const reader = request.body?.getReader();
	if (!reader) {
		return response(400);
	}
	try {
		const chunks: Uint8Array[] = [];
		let bytes = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}
			bytes += value.byteLength;
			if (bytes > 4096) {
				await reader.cancel();
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
		const parsed = webPerformanceReportSchema.safeParse(
			JSON.parse(new TextDecoder().decode(body))
		);
		if (!parsed.success) {
			return response(400);
		}
		const threshold =
			parsed.data.kind === "interaction"
				? WEB_PERFORMANCE_POLICY.interactionThresholdMs
				: WEB_PERFORMANCE_POLICY.navigationThresholdMs;
		if (parsed.data.kind === "space_open" && !parsed.data.spaceOpen) {
			return response(400);
		}
		if (
			parsed.data.kind !== "space_open" &&
			parsed.data.durationMs < threshold
		) {
			return response(204);
		}
		console.warn({
			event:
				parsed.data.kind === "space_open"
					? "web.openmeld.space_open"
					: "web.openmeld.slow_experience",
			workerName: "openmeld-web",
			environment: env.OPENMELD_WORKER_ENVIRONMENT,
			serverBuildId: WEB_ERROR_BUILD.id,
			serverSourceSha: WEB_ERROR_BUILD.sha,
			policyVersion: WEB_PERFORMANCE_POLICY.version,
			thresholdMs: threshold,
			report: parsed.data,
		});
		return response(204);
	} catch {
		return response(400);
	}
}
