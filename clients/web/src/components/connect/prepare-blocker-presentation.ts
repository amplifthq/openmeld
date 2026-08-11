import { resolveLocalMachineRecoveryPolicy } from "@openmeld/schemas";

export type PrepareBlockerFollowUp = {
	actionLabel: string;
	nextStepText: string | null;
};

export function resolvePrepareBlockerFollowUp(input: {
	hasForgottenComputerBlocker: boolean;
	hasLocalMachineBlocker: boolean;
	hasTerminalAuthBlocker: boolean;
}): PrepareBlockerFollowUp {
	if (input.hasLocalMachineBlocker) {
		return {
			actionLabel: "Try again",
			nextStepText: null,
		};
	}
	if (input.hasTerminalAuthBlocker) {
		return {
			actionLabel: "Start over with a fresh command",
			nextStepText:
				"Sign in to OpenMeld in Terminal with the same account shown in OpenMeld Web, then copy a fresh setup command from OpenMeld Web and run setup again.",
		};
	}
	if (input.hasForgottenComputerBlocker) {
		return {
			actionLabel: "Start over with a fresh command",
			nextStepText:
				"Copy a fresh setup command from OpenMeld Web and run setup again in Terminal. OpenMeld will reconnect this computer during setup.",
		};
	}
	return {
		actionLabel: "Start over with a fresh command",
		nextStepText:
			"After fixing this step, start over to get a fresh setup command.",
	};
}

export function isLocalMachinePrepareBlocker(input: {
	reasonCode: string;
}): boolean {
	return resolveLocalMachineRecoveryPolicy(input.reasonCode) === "user_action";
}
