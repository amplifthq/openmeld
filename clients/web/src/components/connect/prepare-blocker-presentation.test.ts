import { describe, expect, it } from "vitest";
import {
	isLocalMachinePrepareBlocker,
	resolvePrepareBlockerFollowUp,
} from "./prepare-blocker-presentation";

describe("prepare blocker presentation", () => {
	it("lets the structured local computer message own the guidance", () => {
		expect(
			resolvePrepareBlockerFollowUp({
				hasForgottenComputerBlocker: false,
				hasLocalMachineBlocker: true,
				hasTerminalAuthBlocker: false,
			})
		).toEqual({
			actionLabel: "Try again",
			nextStepText: null,
		});
	});

	it("uses the shared recovery policy instead of rebuilding local error rules", () => {
		expect(
			isLocalMachinePrepareBlocker({
				reasonCode: "local_machine.storage.exhausted",
			})
		).toBe(true);
		expect(
			isLocalMachinePrepareBlocker({
				reasonCode: "local_machine.failure.unknown",
			})
		).toBe(false);
		expect(
			isLocalMachinePrepareBlocker({
				reasonCode: "prepare.refresh_service.failed",
			})
		).toBe(false);
	});
});
