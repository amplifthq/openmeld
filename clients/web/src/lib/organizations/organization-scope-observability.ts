export type OrganizationScopeTimingMetric = {
	durationMs: number;
	errorName: string | null;
	reasonCode: string;
	status: "failed" | "succeeded";
};

export type OrganizationScopeTimingStage = "account_organization_context";

const MAX_OBSERVABILITY_ROUTE_LENGTH = 512;

export function normalizeOrganizationScopeRouteFamilyForObservability(
	routeFamily: string
): string {
	try {
		const url = new URL(routeFamily.trim(), "https://openmeld.invalid");
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return "unknown_route";
		}
		return url.pathname.startsWith("/")
			? url.pathname.slice(0, MAX_OBSERVABILITY_ROUTE_LENGTH)
			: "unknown_route";
	} catch {
		return "unknown_route";
	}
}

type OrganizationScopeTimingMetricInput = {
	reasonCode: string;
	status: OrganizationScopeTimingMetric["status"];
	error?: unknown;
};

export function createOrganizationScopeTimingCollector(input?: {
	nowMs?: () => number;
}) {
	const nowMs = input?.nowMs ?? defaultNowMs;
	const totalStartedAtMs = nowMs();
	const metrics: OrganizationScopeTimingMetric[] = [];

	const record = (
		metric: OrganizationScopeTimingMetricInput,
		startedAtMs: number
	) => {
		metrics.push({
			durationMs: Math.max(0, nowMs() - startedAtMs),
			errorName: resolveErrorName(metric.error),
			reasonCode: metric.reasonCode,
			status: metric.status,
		});
	};

	return {
		async measure<T>(
			stage: OrganizationScopeTimingStage,
			operation: () => Promise<T> | T
		): Promise<T> {
			const startedAtMs = nowMs();
			try {
				const result = await operation();
				record({ reasonCode: stage, status: "succeeded" }, startedAtMs);
				return result;
			} catch (error) {
				record({ error, reasonCode: stage, status: "failed" }, startedAtMs);
				throw error;
			}
		},
		finish(metric: OrganizationScopeTimingMetricInput) {
			record(metric, totalStartedAtMs);
			return [...metrics];
		},
	};
}

function defaultNowMs(): number {
	return typeof performance === "undefined" ? Date.now() : performance.now();
}

function resolveErrorName(error: unknown): string | null {
	if (error === undefined) {
		return null;
	}
	return error instanceof Error ? error.name : typeof error;
}
