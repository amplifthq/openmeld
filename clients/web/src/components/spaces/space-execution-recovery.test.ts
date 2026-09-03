import { executionRecoveryProjectionSchema } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { projectSpaceExecutionRecoveryResolution } from "./space-execution-recovery";

describe("projectSpaceExecutionRecoveryResolution", () => {
	it.each([
		"in_progress",
		"outcome_unknown",
		"recovered",
		"unavailable",
	] as const)("drops an enabled recovery action when the authoritative status is %s", (status) => {
		const recovery = executionRecoveryProjectionSchema.parse({
			actions: {
				recoverResult: {
					action: "recover_result",
					enabled: false,
					label: "Recover result",
					reasonCode: "execution_recovery.unavailable",
					warning: null,
				},
				resumeControllerConversation: {
					action: "resume_controller_conversation",
					enabled: false,
					label: "Recover reply",
					reasonCode: "execution_recovery.unavailable",
					warning: null,
				},
				retryAsNewExecution: {
					action: "retry_as_new_execution",
					enabled: true,
					label: "Retry as new execution",
					reasonCode: "execution_recovery.available",
					warning:
						"This starts a new execution and may run side effects again.",
				},
			},
			destination: {
				spaceId: "space-1",
				surface: "space",
				threadId: null,
			},
			identity: {
				agentControllerConversationId: null,
				agentControllerRef: null,
				attemptId: null,
				dispatchId: "dispatch-1",
				resultRef: null,
				runtimeCoordinatorExecutionId: null,
				spaceId: "space-1",
				targetProfileId: "agt_1",
				taskId: null,
			},
			recommendedAction: "retry_as_new_execution",
			recoveredPublicationId: null,
			status,
			tier: "fresh_execution",
			updatedAtMs: 1,
		});

		expect(projectSpaceExecutionRecoveryResolution(recovery)).toEqual({
			action: null,
			label: null,
			status,
			warning: null,
		});
	});
});
