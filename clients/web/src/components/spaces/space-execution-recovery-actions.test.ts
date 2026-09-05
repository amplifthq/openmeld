import { describe, expect, it } from "vitest";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	resolveAnchoredSpaceExecutionRecoveryRequest,
	resolveAnchoredSpaceExecutionRecoveryState,
} from "./space-execution-recovery-actions";

function terminalFailure(
	targetProfileId = "agent-profile-1",
	dispatchId = "dispatch-1"
): SpaceTimelineItem {
	return {
		id: `failure-${targetProfileId}`,
		systemNoticeDispatchId: dispatchId,
		systemNoticeFailureStage: "execution",
		systemNoticeReasonCode: "runtime.progress_stale",
		systemNoticeTargetProfileId: targetProfileId,
		systemNoticeType: "terminal_failure",
	} as SpaceTimelineItem;
}

function recoveryAvailable(): SpaceTimelineItem {
	return {
		systemNoticeDispatchId: "dispatch-1",
		systemNoticeReasonCode: "runtime_coordinator.late_result_available",
		systemNoticeResultRef: "dispatch-1::attempt-1",
		systemNoticeTargetProfileId: "agent-profile-1",
		systemNoticeType: "execution_recovery_available",
	} as SpaceTimelineItem;
}

function recoveryCompleted(): SpaceTimelineItem {
	return {
		...recoveryAvailable(),
		systemNoticeType: "execution_recovery_completed",
	} as SpaceTimelineItem;
}

describe("anchored execution recovery actions", () => {
	it("correlates a separate recovery notice to the original terminal failure and suppresses fresh retry", () => {
		expect(
			resolveAnchoredSpaceExecutionRecoveryRequest({
				notices: [terminalFailure(), recoveryAvailable()],
				outcomeNotice: terminalFailure(),
			})
		).toEqual({
			dispatchId: "dispatch-1",
			resultRef: "dispatch-1::attempt-1",
			targetProfileId: "agent-profile-1",
		});
	});

	it("inspects recovery for a terminal failure with no known result", () => {
		expect(
			resolveAnchoredSpaceExecutionRecoveryRequest({
				notices: [terminalFailure()],
				outcomeNotice: terminalFailure(),
			})
		).toEqual({
			dispatchId: "dispatch-1",
			resultRef: null,
			targetProfileId: "agent-profile-1",
		});
	});

	it("shows neither recovery nor fresh retry after the exact result was recovered", () => {
		const notices = [
			terminalFailure(),
			recoveryAvailable(),
			recoveryCompleted(),
		];
		expect(
			resolveAnchoredSpaceExecutionRecoveryRequest({
				notices,
				outcomeNotice: terminalFailure(),
			})
		).toBeNull();
		expect(
			resolveAnchoredSpaceExecutionRecoveryState({
				notices,
				outcomeNotice: terminalFailure(),
			})
		).toEqual({ request: null, status: "closed" });
	});

	it("correlates one recoverable target independently in a multi-target Wake", () => {
		const firstFailure = terminalFailure("agent-profile-1", "dispatch-1");
		const secondFailure = terminalFailure("agent-profile-2", "dispatch-2");
		const notices = [firstFailure, secondFailure, recoveryAvailable()];

		expect(
			resolveAnchoredSpaceExecutionRecoveryRequest({
				notices,
				outcomeNotice: firstFailure,
			})
		).toEqual({
			dispatchId: "dispatch-1",
			resultRef: "dispatch-1::attempt-1",
			targetProfileId: "agent-profile-1",
		});
		expect(
			resolveAnchoredSpaceExecutionRecoveryRequest({
				notices,
				outcomeNotice: secondFailure,
			})
		).toEqual({
			dispatchId: "dispatch-2",
			resultRef: null,
			targetProfileId: "agent-profile-2",
		});
	});

	it("dedupes exact replay evidence and rejects conflicting result identities", () => {
		const failure = terminalFailure();
		const exactReplay = { ...recoveryAvailable(), id: "recovery-replay" };
		expect(
			resolveAnchoredSpaceExecutionRecoveryRequest({
				notices: [failure, recoveryAvailable(), exactReplay],
				outcomeNotice: failure,
			})
		).toEqual({
			dispatchId: "dispatch-1",
			resultRef: "dispatch-1::attempt-1",
			targetProfileId: "agent-profile-1",
		});
		expect(
			resolveAnchoredSpaceExecutionRecoveryRequest({
				notices: [
					failure,
					recoveryAvailable(),
					{
						...recoveryAvailable(),
						systemNoticeResultRef: "dispatch-1::attempt-conflict",
					},
				],
				outcomeNotice: failure,
			})
		).toBeNull();
		expect(
			resolveAnchoredSpaceExecutionRecoveryState({
				notices: [
					failure,
					recoveryAvailable(),
					{
						...recoveryAvailable(),
						systemNoticeResultRef: "dispatch-1::attempt-conflict",
					},
				],
				outcomeNotice: failure,
			})
		).toEqual({ request: null, status: "invalid" });
	});
});
