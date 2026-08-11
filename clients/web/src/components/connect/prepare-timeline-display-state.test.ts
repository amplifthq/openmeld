import type {
	PrepareSessionSnapshot,
	PrepareStep,
	PrepareStepId,
	PrepareStepState,
} from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolvePrepareTimelineStepDisplayState } from "./prepare-timeline-display-state";

const NOW = "2026-05-08T00:00:00.000Z";

describe("resolvePrepareTimelineStepDisplayState", () => {
	it("shows downstream waiting steps as pending when an earlier step is active", () => {
		const snapshot = createPrepareSnapshot({
			phase: "terminal_disconnected",
			steps: [
				createStep("computer", "complete"),
				createStep("connect_terminal", "terminal_disconnected"),
				createStep("choose_local_agents", "waiting_for_user"),
			],
		});

		expect(
			resolvePrepareTimelineStepDisplayState({
				activeStepId: "connect_terminal",
				snapshot,
				step: snapshot.steps[2],
			})
		).toBe("pending");
	});

	it("keeps the active disconnected Terminal step visible as disconnected", () => {
		const snapshot = createPrepareSnapshot({
			phase: "terminal_disconnected",
			steps: [
				createStep("computer", "complete"),
				createStep("connect_terminal", "terminal_disconnected"),
				createStep("choose_local_agents", "waiting_for_user"),
			],
		});

		expect(
			resolvePrepareTimelineStepDisplayState({
				activeStepId: "connect_terminal",
				snapshot,
				step: snapshot.steps[1],
			})
		).toBe("terminal_disconnected");
	});
});

function createPrepareSnapshot(input: {
	phase: PrepareSessionSnapshot["phase"];
	steps: PrepareStep[];
}): PrepareSessionSnapshot {
	return {
		blockers: [],
		completedAt: null,
		createdAt: NOW,
		deviceId: "device-current",
		diagnosticCorrelationId: "prepare-diagnostic-1",
		expiresAt: "2026-05-08T00:30:00.000Z",
		humanProfileId: "11111111-1111-4111-8111-111111111111",
		lifecycleStatus: "active",
		localAgentCatalog: null,
		localReadinessSnapshot: null,
		ownerUserId: "owner-1",
		phase: input.phase,
		prepareSessionId: "prepare-1",
		runtimeLane: "dev-local",
		selectedLocalAgentIds: [],
		sessionRevision: 1,
		steps: input.steps,
		targetSpaceId: null,
		terminalConnection: {
			connectedAt: NOW,
			connectionEpoch: 1,
			connectionId: "terminal-1",
			disconnectedAt: NOW,
			disconnectReason: "socket_closed",
			lastSeenAt: NOW,
			status: "disconnected",
		},
		updatedAt: NOW,
	};
}

function createStep(id: PrepareStepId, state: PrepareStepState): PrepareStep {
	return {
		blockerReasonCode: null,
		completedAt: state === "complete" ? NOW : null,
		id,
		startedAt: null,
		state,
		summary: `${id} summary`,
		title: id,
		updatedAt: NOW,
	};
}
