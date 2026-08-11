import type {
	PrepareSessionSnapshot,
	PrepareStep,
	PrepareStepId,
	PrepareStepState,
} from "@openmeld/schemas/types";

export function resolvePrepareTimelineStepDisplayState(input: {
	activeStepId: PrepareStepId | null;
	snapshot: PrepareSessionSnapshot;
	step: PrepareStep;
}): PrepareStepState {
	if (input.step.state === "complete") {
		return "complete";
	}

	if (input.step.id !== input.activeStepId) {
		return "pending";
	}

	if (
		input.step.id === "connect_terminal" &&
		input.snapshot.lifecycleStatus === "active" &&
		input.snapshot.phase === "terminal_disconnected"
	) {
		return "terminal_disconnected";
	}

	return input.step.state;
}
