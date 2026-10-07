import { projectLocalAgentCatalogFromCapabilities } from "@openmeld/agent-runtime";
import {
	compareAgentControllerRefsForDisplay,
	resolveBuiltinAgentControllerBrand,
} from "@openmeld/schemas";
import type { AiUsageQueryResponse } from "@openmeld/schemas/types";
import {
	type BrandChartColors,
	localAgentChartColors,
} from "@openmeld/ui/lib/brand-chart-colors";

const catalog = projectLocalAgentCatalogFromCapabilities({
	capabilities: [],
}).entries;
export type TokenTimeSeries = NonNullable<AiUsageQueryResponse["timeSeries"]>;
export type LocalAgentTokenSeries = {
	controller: string | null;
	key: string;
	label: string;
	colors: BrandChartColors;
};

export function localAgentTokenSeries(
	buckets: TokenTimeSeries
): LocalAgentTokenSeries[] {
	const controllers = [
		...new Set(
			buckets.flatMap(
				(bucket) => bucket.controllers?.map((row) => row.controller) ?? []
			)
		),
	];
	return controllers
		.sort((a, b) => compareAgentControllerRefsForDisplay(a ?? "", b ?? ""))
		.map((controller, index) => {
			const brand = resolveBuiltinAgentControllerBrand(controller);
			return {
				controller,
				key: `agent_${index}`,
				label:
					catalog.find((entry) => entry.agentId === brand?.controllerId)
						?.displayName ??
					controller ??
					"Unattributed",
				colors: localAgentChartColors(controller),
			};
		});
}

export function recordedTokenValue(
	row:
		| { requests: number; missingTokenRequests: number; totalTokens: number }
		| undefined
) {
	return row && row.requests > 0 && row.missingTokenRequests === row.requests
		? null
		: (row?.totalTokens ?? 0);
}
