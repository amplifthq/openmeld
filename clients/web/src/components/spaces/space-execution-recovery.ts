import type { ExecutionRecoveryProjection } from "@openmeld/schemas/types";
import type { SpaceExecutionRecoveryResolution } from "./space-wake-retry";

export function projectSpaceExecutionRecoveryResolution(
	recovery: ExecutionRecoveryProjection
): SpaceExecutionRecoveryResolution {
	if (recovery.status !== "available") {
		return {
			action: null,
			label: null,
			status: recovery.status,
			warning: null,
		};
	}
	const capability = resolveRecommendedExecutionRecoveryCapability(recovery);
	return {
		action: capability?.enabled === true ? recovery.recommendedAction : null,
		label: capability?.enabled === true ? capability.label : null,
		status: recovery.status,
		warning: capability?.warning ?? null,
	};
}

function resolveRecommendedExecutionRecoveryCapability(
	recovery: ExecutionRecoveryProjection
) {
	switch (recovery.recommendedAction) {
		case "recover_result":
			return recovery.actions.recoverResult;
		case "resume_controller_conversation":
			return recovery.actions.resumeControllerConversation;
		case "retry_as_new_execution":
			return recovery.actions.retryAsNewExecution;
		default:
			return null;
	}
}
