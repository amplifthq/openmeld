import { env, waitUntil } from "cloudflare:workers";
import {
	emitWebCloudflareRuntimeEvidence,
	readWebCloudflareRequestEvidence,
} from "#/lib/observability/cloudflare-runtime-evidence";
import {
	normalizeOrganizationScopeRouteFamilyForObservability,
	type OrganizationScopeTimingMetric,
} from "./organization-scope-observability";

export function scheduleOrganizationScopeTimingEvidence(input: {
	metrics: readonly OrganizationScopeTimingMetric[];
	requestHeaders: Headers;
	routeFamily: string;
}): void {
	const routeFamily = normalizeOrganizationScopeRouteFamilyForObservability(
		input.routeFamily
	);
	waitUntil(
		Promise.resolve().then(() => {
			try {
				emitOrganizationScopeTimingEvidence({ ...input, routeFamily });
			} catch (error) {
				console.error({
					event: "web.openmeld.organization_scope_timing_emission_failed",
					errorName: error instanceof Error ? error.name : typeof error,
					routeFamily,
				});
			}
		})
	);
}

function emitOrganizationScopeTimingEvidence(input: {
	metrics: readonly OrganizationScopeTimingMetric[];
	requestHeaders: Headers;
	routeFamily: string;
}): void {
	const requestEvidence = readWebCloudflareRequestEvidence(
		input.requestHeaders
	);
	const requestId =
		requestEvidence.requestId ?? createOrganizationScopeRequestId();
	const cloudflareRuntimeEvidence = {
		analytics: env.OPENMELD_OBSERVABILITY,
		workerEnvironment: env.OPENMELD_WORKER_ENVIRONMENT,
	};

	for (const metric of input.metrics) {
		emitWebCloudflareRuntimeEvidence(cloudflareRuntimeEvidence, {
			cfRayId: requestEvidence.cfRayId,
			durationMs: metric.durationMs,
			errorName: metric.errorName,
			event: "web.openmeld.organization_scope_timing",
			method: "GET",
			operation: "resolveOrganizationScope",
			reasonCode: metric.reasonCode,
			requestId,
			route: input.routeFamily,
			runtimeKind: "rpc",
			status: metric.status,
			traceId: requestEvidence.traceId,
		});
	}
}

function createOrganizationScopeRequestId(): string {
	if (typeof crypto.randomUUID === "function") {
		return crypto.randomUUID();
	}
	return `organization-scope-${Date.now().toString(36)}`;
}
