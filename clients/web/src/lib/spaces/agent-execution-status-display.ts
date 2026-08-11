import type {
	AgentExecutionStatusDisplayRow,
	AgentExecutionStatusProjection,
} from "@openmeld/agent-runtime";
import { createAgentExecutionStatusDisplayRows } from "@openmeld/agent-runtime";
import { AVAILABILITY_DISPLAY_LABELS } from "#/lib/availability-display";

export type WebAgentExecutionStatusDisplay = {
	rows: readonly AgentExecutionStatusDisplayRow[];
	state: AgentExecutionStatusProjection["displayState"];
	summary: string;
	truthBoundary: {
		grantsBindingTruth: false;
		grantsClaimSuccess: false;
		grantsDispatchRouting: false;
		grantsRuntimeTruth: false;
		startsRuntimeExecution: false;
	};
};

export function createAgentExecutionStatusDisplay({
	projection,
}: {
	projection: AgentExecutionStatusProjection;
}): WebAgentExecutionStatusDisplay {
	const rows = createAgentExecutionStatusDisplayRows(projection);
	const statusSummary = rows[0]?.value ?? "Unknown";

	return {
		rows,
		state: projection.displayState,
		summary: formatAgentExecutionStatusSummary({
			state: projection.displayState,
			statusSummary,
		}),
		truthBoundary: {
			grantsBindingTruth: false,
			grantsClaimSuccess: false,
			grantsDispatchRouting: false,
			grantsRuntimeTruth: false,
			startsRuntimeExecution: false,
		},
	};
}

function formatAgentExecutionStatusSummary(input: {
	state: AgentExecutionStatusProjection["displayState"];
	statusSummary: string;
}): string {
	const statusPrefix = `${formatAgentExecutionDisplayState(input.state)} · `;
	return input.statusSummary.startsWith(statusPrefix)
		? input.statusSummary.slice(statusPrefix.length)
		: input.statusSummary;
}

function formatAgentExecutionDisplayState(
	state: AgentExecutionStatusProjection["displayState"]
): string {
	switch (state) {
		case "ready":
			return AVAILABILITY_DISPLAY_LABELS.availableForWake;
		case "blocked":
			return AVAILABILITY_DISPLAY_LABELS.blocked;
		case "not_ready":
			return AVAILABILITY_DISPLAY_LABELS.unavailable;
		case "unknown":
			return AVAILABILITY_DISPLAY_LABELS.unknown;
		default:
			return AVAILABILITY_DISPLAY_LABELS.unknown;
	}
}
