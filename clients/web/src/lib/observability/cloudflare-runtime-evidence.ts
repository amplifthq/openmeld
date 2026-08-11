import {
	type ProjectObservabilityCloudflareRuntimeEventInput,
	projectObservabilityCloudflareAnalyticsDataPoint,
	projectObservabilityCloudflareRuntimeConsoleEvent,
	projectObservabilityCloudflareRuntimeEvent,
	shouldLogObservabilityCloudflareRuntimeEvent,
} from "@openmeld/schemas";

type WebAnalyticsDataset = {
	writeDataPoint: (point: {
		blobs: string[];
		doubles: number[];
		indexes: string[];
	}) => void;
};

export type WebCloudflareRuntimeEvidence = {
	analytics?: WebAnalyticsDataset | null;
	workerEnvironment?: string | null;
};

type WebCloudflareRuntimeEvidenceInput = Omit<
	ProjectObservabilityCloudflareRuntimeEventInput,
	"workerEnvironment" | "workerName"
>;

const TRACEPARENT_TRACE_ID_PATTERN = /^[a-f0-9]{32}$/i;

export function emitWebCloudflareRuntimeEvidence(
	cloudflareRuntimeEvidence: WebCloudflareRuntimeEvidence | undefined,
	input: WebCloudflareRuntimeEvidenceInput
): void {
	try {
		const event = projectObservabilityCloudflareRuntimeEvent({
			...input,
			workerEnvironment: cloudflareRuntimeEvidence?.workerEnvironment ?? null,
			workerName: "openmeld-web",
		});
		if (shouldLogObservabilityCloudflareRuntimeEvent(event)) {
			console.info(projectObservabilityCloudflareRuntimeConsoleEvent(event));
		}
		cloudflareRuntimeEvidence?.analytics?.writeDataPoint(
			projectObservabilityCloudflareAnalyticsDataPoint(event)
		);
	} catch (error) {
		console.error({
			event: "web.openmeld.observability.runtime_evidence_projection_failed",
			errorName: error instanceof Error ? error.name : typeof error,
			message: error instanceof Error ? error.message : String(error),
			requestId: normalizeOptionalText(input.requestId),
		});
	}
}

export function readWebCloudflareRequestEvidence(headers: Headers): {
	cfRayId: string | null;
	requestId: string | null;
	traceId: string | null;
} {
	return {
		cfRayId: normalizeOptionalText(headers.get("cf-ray")),
		requestId:
			normalizeOptionalText(headers.get("x-openmeld-request-id")) ??
			normalizeOptionalText(headers.get("x-request-id")),
		traceId: readTraceparentTraceId(headers),
	};
}

function readTraceparentTraceId(headers: Headers): string | null {
	const traceparent = normalizeOptionalText(headers.get("traceparent"));
	if (!traceparent) {
		return null;
	}
	const traceId = traceparent.split("-")[1]?.trim();
	return traceId && TRACEPARENT_TRACE_ID_PATTERN.test(traceId) ? traceId : null;
}

function normalizeOptionalText(value: unknown): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}
