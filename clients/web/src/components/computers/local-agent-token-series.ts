import { projectLocalAgentCatalogFromCapabilities } from "@openmeld/agent-runtime";
import {
	compareAgentControllerRefsForDisplay,
	resolveBuiltinAgentControllerBrand,
} from "@openmeld/schemas";
import type { AiUsageQueryResponse } from "@openmeld/schemas/types";

const catalog = projectLocalAgentCatalogFromCapabilities({
	capabilities: [],
}).entries;
export type TokenTimeSeries = NonNullable<AiUsageQueryResponse["timeSeries"]>;
export type LocalAgentTokenSeries = {
	controller: string | null;
	key: string;
	label: string;
	colors: { light: string[]; dark: string[] };
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
			// Monochrome logos have no unique hue: fixed secondary colors keep traces distinct.
			const monochromeAccents: Record<string, string> = {
				cursor: "#c49a47",
				opencode: "#2aafa0",
			};
			const accent =
				monochromeAccents[brand?.controllerId ?? ""] ??
				brand?.accentHex ??
				"#929aa8";
			const light = `#${[1, 3, 5]
				.map((offset) =>
					Math.round(
						Number.parseInt(accent.slice(offset, offset + 2), 16) * 0.72
					)
						.toString(16)
						.padStart(2, "0")
				)
				.join("")}`;
			return {
				controller,
				key: `agent_${index}`,
				label:
					catalog.find((entry) => entry.agentId === brand?.controllerId)
						?.displayName ??
					controller ??
					"Unattributed",
				colors: { light: [light], dark: [accent] },
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
