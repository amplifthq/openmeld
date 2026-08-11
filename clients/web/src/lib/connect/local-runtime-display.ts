const localRuntimeLastObservedFormatter = new Intl.DateTimeFormat("en-US", {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

export function buildLocalRuntimeSummary(input: {
	executionTargets?: readonly {
		runtimeLane: string;
		status: "ready" | "partial" | "not_ready" | "stale" | "unknown";
		userFacingCommand: string;
		capabilities: readonly {
			agentControllerRef: string;
			status: "ready" | "not_ready" | "stale" | "unknown";
		}[];
	}[];
	platformFamily: string;
	lastObservedAtMs: number | null;
}) {
	const executionSummary = buildExecutionTargetSummary(input.executionTargets);
	if (input.lastObservedAtMs === null) {
		const base =
			input.platformFamily === "Unknown"
				? "No recent check-in yet."
				: `${input.platformFamily} · No recent check-in yet.`;
		return executionSummary ? `${base} · ${executionSummary}` : base;
	}

	const formatted = localRuntimeLastObservedFormatter.format(
		input.lastObservedAtMs
	);

	const base =
		input.platformFamily === "Unknown"
			? `Last seen ${formatted}.`
			: `${input.platformFamily} · Last seen ${formatted}.`;
	return executionSummary ? `${base} · ${executionSummary}` : base;
}

export function buildExecutionTargetLabel(input: {
	runtimeLane: string;
	status: "ready" | "partial" | "not_ready" | "stale" | "unknown";
	userFacingCommand: string;
	capabilities: readonly {
		agentControllerRef: string;
		status: "ready" | "not_ready" | "stale" | "unknown";
	}[];
}): string {
	return formatExecutionTargetStatus(input);
}

function buildExecutionTargetSummary(
	targets:
		| readonly {
				runtimeLane: string;
				status: "ready" | "partial" | "not_ready" | "stale" | "unknown";
				userFacingCommand: string;
				capabilities: readonly {
					agentControllerRef: string;
					status: "ready" | "not_ready" | "stale" | "unknown";
				}[];
		  }[]
		| undefined
): string | null {
	if (!(targets && targets.length > 0)) {
		return null;
	}
	return targets.map(buildExecutionTargetLabel).join("; ");
}

function formatExecutionTargetStatus(input: {
	status: "ready" | "partial" | "not_ready" | "stale" | "unknown";
	capabilities: readonly {
		agentControllerRef: string;
		status: "ready" | "not_ready" | "stale" | "unknown";
	}[];
}): string {
	if (input.status === "stale") {
		return "Needs a fresh check from OpenMeld Service";
	}
	if (input.status === "unknown") {
		return "Checking local agents";
	}
	if (input.status === "not_ready") {
		return "No available local agents yet";
	}

	const readyCapabilityCount = input.capabilities.filter(
		(capability) => capability.status === "ready"
	).length;
	if (readyCapabilityCount > 0) {
		return `${readyCapabilityCount} ${readyCapabilityCount === 1 ? "local agent" : "local agents"} available`;
	}
	return "no available local agents";
}
