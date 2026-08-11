import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SpaceExecutionRecoveryButton,
	type SpaceExecutionRecoveryHandler,
} from "./space-wake-retry";

const recoveryRequest = {
	dispatchId: "dispatch-1",
	resultRef: "dispatch-1::attempt-1",
	targetProfileId: "agent-profile-1",
};

afterEach(() => {
	cleanup();
});

describe("SpaceExecutionRecoveryButton", () => {
	it("names exact-conversation recovery by its user outcome and explains that the task will not rerun", async () => {
		const warning =
			"OpenMeld will ask the same Agent conversation to post the reply it already finished. It will not run the task again.";
		const inspect = vi.fn<SpaceExecutionRecoveryHandler>(async () => ({
			action: "resume_controller_conversation",
			label: "Continue conversation",
			status: "available",
			warning,
		}));

		render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={inspect}
				request={{ ...recoveryRequest, resultRef: null }}
			/>
		);

		const button = await screen.findByRole("button", {
			name: "Recover reply",
		});
		const warningElement = screen.getByText(warning);
		expect(button.getAttribute("aria-describedby")).toBe(warningElement.id);
		expect(warningElement.className).not.toContain("sr-only");
	});

	it("inspects once per execution identity even when the handler reference changes", async () => {
		const inspect = vi.fn<SpaceExecutionRecoveryHandler>(async () => ({
			action: "recover_result",
			label: "Recover result",
			status: "available",
			warning: null,
		}));
		const view = render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={inspect}
				request={recoveryRequest}
			/>
		);

		await screen.findByRole("button", { name: "Recover result" });
		expect(inspect).toHaveBeenCalledOnce();
		expect(inspect).toHaveBeenCalledWith({
			...recoveryRequest,
			action: null,
			operationId: null,
		});

		view.rerender(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={async (attempt) => inspect(attempt)}
				request={recoveryRequest}
			/>
		);
		await Promise.resolve();
		expect(inspect).toHaveBeenCalledOnce();
	});

	it("executes Tier 3 through the Core recovery operation instead of a second Wake path", async () => {
		const warning =
			"This starts a new execution and may run the task and its side effects again.";
		const recover = vi.fn<SpaceExecutionRecoveryHandler>(async (attempt) =>
			attempt.action === null
				? {
						action: "retry_as_new_execution",
						label: "Retry as new execution",
						status: "available",
						warning,
					}
				: {
						action: null,
						label: null,
						status: "in_progress",
						warning: null,
					}
		);
		render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={recover}
				request={recoveryRequest}
			/>
		);

		const button = await screen.findByRole("button", {
			name: "Retry as new execution",
		});
		const warningElement = screen.getByText(warning);
		expect(warningElement).toBeTruthy();
		expect(button.getAttribute("aria-describedby")).toBe(warningElement.id);
		fireEvent.click(button);

		await waitFor(() => expect(recover).toHaveBeenCalledTimes(2));
		expect(recover.mock.calls[1]?.[0]).toEqual({
			...recoveryRequest,
			action: "retry_as_new_execution",
			operationId: expect.any(String),
		});
	});

	it.each([
		{
			activate: (button: HTMLElement) => {
				fireEvent.pointerDown(button, { pointerType: "touch" });
				fireEvent.pointerUp(button, { pointerType: "touch" });
				fireEvent.click(button);
			},
			input: "touch",
		},
		{
			activate: (button: HTMLElement) => {
				button.focus();
				fireEvent.keyDown(button, { key: "Enter" });
				fireEvent.click(button, { detail: 0 });
			},
			input: "keyboard",
		},
	])("keeps the fresh-execution warning visible before $input activation", async ({
		activate,
	}) => {
		const warning =
			"This starts a new execution and may run the task and its side effects again.";
		const recover = vi.fn<SpaceExecutionRecoveryHandler>(async (attempt) =>
			attempt.action === null
				? {
						action: "retry_as_new_execution",
						label: "Retry as new execution",
						status: "available",
						warning,
					}
				: {
						action: null,
						label: null,
						status: "in_progress",
						warning: null,
					}
		);
		render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={recover}
				request={recoveryRequest}
			/>
		);
		const button = await screen.findByRole("button", {
			name: "Retry as new execution",
		});
		const warningElement = screen.getByText(warning);
		expect(warningElement).toBeTruthy();
		expect(button.getAttribute("aria-describedby")).toBe(warningElement.id);

		activate(button);

		await waitFor(() => expect(recover).toHaveBeenCalledTimes(2));
		expect(recover.mock.calls[1]?.[0]).toMatchObject({
			action: "retry_as_new_execution",
			operationId: expect.any(String),
		});
	});
});
