import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";

/** Configuration can survive disconnects; only the matching live projection proves a connection. */
export function resolveLocalAgentCreationGuidance(input: {
	queryFailed: boolean;
	readiness:
		| (Pick<
				CurrentLocalRuntimeReplyReadinessResponse,
				"currentTarget" | "status" | "nextAction"
		  > & {
				service: Pick<
					CurrentLocalRuntimeReplyReadinessResponse["service"],
					"connected" | "matchingCurrentRuntime"
				>;
		  })
		| null
		| undefined;
	target: Pick<LocalRuntimeExecutionTarget, "deviceId" | "runtimeLane"> | null;
}): "check_failed" | "connect_computer" | "set_up_local_agents" {
	if (input.queryFailed) {
		return "check_failed";
	}
	const readiness = input.readiness;
	if (input.target && !readiness) {
		return "check_failed";
	}
	if (
		!(readiness?.service.connected && readiness.service.matchingCurrentRuntime)
	) {
		return "connect_computer";
	}
	if (
		input.target &&
		(readiness.currentTarget.availability !== "resolved" ||
			readiness.currentTarget.deviceId !== input.target.deviceId ||
			readiness.currentTarget.runtimeLane !== input.target.runtimeLane)
	) {
		return "check_failed";
	}
	if (
		readiness.status === "checking" ||
		readiness.nextAction === "check_status"
	) {
		return "check_failed";
	}
	return "set_up_local_agents";
}
