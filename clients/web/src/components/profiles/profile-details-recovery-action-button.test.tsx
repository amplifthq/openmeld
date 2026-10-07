import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProfileDetailsRecoveryActionButton } from "./profile-details-recovery-action-button";

afterEach(cleanup);

describe("recovery confirmation intent", () => {
	it.each([
		["skip_interrupted_work", "Skip interrupted work"],
		["fork_interrupted_work", "Choose how to continue"],
	] as const)("closes %s confirmation only when its target changes", async (kind, label) => {
		const onRecoveryAction = vi.fn();
		const button = (target: string) => (
			<ProfileDetailsRecoveryActionButton
				isPending={false}
				onRecoveryAction={onRecoveryAction}
				recoveryAction={{
					kind,
					expectedInterruptedTargetWakeLifecycleId: target,
					visibility: "owner_self",
				}}
			/>
		);
		const { rerender } = render(button("twl_first"));
		fireEvent.click(screen.getByRole("button", { name: label }));
		expect(await screen.findByRole("alertdialog")).toBeTruthy();
		// A fresh projection of the same task (including queue changes) must not
		// invalidate the choice. Replacing the interrupted task must close it.
		rerender(button("twl_first"));
		expect(screen.getByRole("alertdialog")).toBeTruthy();
		rerender(button("twl_second"));
		await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
		expect(onRecoveryAction).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: label }));
		expect(await screen.findByRole("alertdialog")).toBeTruthy();
	});
});
