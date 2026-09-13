import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	SpaceExecutionRecoveryButton,
	type SpaceExecutionRecoveryHandler,
} from "./space-execution-recovery-actions";

const recoveryRequest = {
	dispatchId: "dispatch-1",
	resultRef: "dispatch-1::attempt-1",
	targetProfileId: "agent-profile-1",
};

afterEach(() => {
	cleanup();
	vi.useRealTimers();
});

describe("SpaceExecutionRecoveryButton", () => {
	it.each([
		{ name: "message details", presentation: undefined },
		{ name: "message row", presentation: "compact" as const },
	])("keeps recovery inspection out of $name until a real action is available", async ({
		presentation,
	}) => {
		let resolveInspection:
			| ((value: Awaited<ReturnType<SpaceExecutionRecoveryHandler>>) => void)
			| undefined;
		const inspect = vi.fn<SpaceExecutionRecoveryHandler>(
			async () =>
				await new Promise((resolve) => {
					resolveInspection = resolve;
				})
		);

		render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={inspect}
				presentation={presentation}
				request={recoveryRequest}
			/>
		);

		expect(screen.queryByRole("button")).toBeNull();

		act(() => {
			resolveInspection?.({
				action: "recover_result",
				label: "Recover result",
				status: "available",
				warning: null,
			});
		});

		await screen.findByRole("button", { name: "Recover result" });
	});

	it("keeps an automatic inspection failure out of the user's way", async () => {
		const error = new Error("recovery inspection failed");
		const inspect = vi
			.fn<SpaceExecutionRecoveryHandler>()
			.mockRejectedValue(error);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={inspect}
				request={recoveryRequest}
				unavailableFallback={<a href="/computers">Reconnect Computer</a>}
			/>
		);

		await waitFor(() => expect(inspect).toHaveBeenCalledOnce());
		await waitFor(() => {
			expect(screen.queryByRole("button")).toBeNull();
		});
		expect(
			screen.queryByRole("link", { name: "Reconnect Computer" })
		).toBeNull();
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to inspect execution recovery.",
			error
		);
	});

	it("shows a separately confirmed current action only after execution recovery is unavailable", async () => {
		let resolveInspection:
			| ((value: Awaited<ReturnType<SpaceExecutionRecoveryHandler>>) => void)
			| undefined;
		const inspect = vi.fn<SpaceExecutionRecoveryHandler>(
			async () =>
				await new Promise((resolve) => {
					resolveInspection = resolve;
				})
		);

		render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={inspect}
				request={recoveryRequest}
				unavailableFallback={<a href="/computers">Reconnect Computer</a>}
			/>
		);

		expect(
			screen.queryByRole("link", { name: "Reconnect Computer" })
		).toBeNull();

		act(() => {
			resolveInspection?.({
				action: null,
				label: null,
				status: "unavailable",
				warning: null,
			});
		});

		await screen.findByRole("link", { name: "Reconnect Computer" });
	});

	it.each([
		"in_progress",
		"outcome_unknown",
		"recovered",
	] as const)("does not replace a %s execution outcome with a generic current action", async (status) => {
		const inspect = vi.fn<SpaceExecutionRecoveryHandler>(async () => ({
			action: null,
			label: null,
			status,
			warning: null,
		}));

		render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={inspect}
				request={recoveryRequest}
				unavailableFallback={<a href="/computers">Reconnect Computer</a>}
			/>
		);

		await waitFor(() => expect(inspect).toHaveBeenCalledOnce());
		expect(
			screen.queryByRole("link", { name: "Reconnect Computer" })
		).toBeNull();
	});

	it.each([
		"in_progress",
		"outcome_unknown",
		"recovered",
		"unavailable",
	] as const)("fails closed for a schema-valid %s projection that still carries an enabled action", async (status) => {
		const inspect = vi.fn<SpaceExecutionRecoveryHandler>(async () => ({
			action: "retry_as_new_execution",
			label: "Retry as new execution",
			status,
			warning:
				"This starts a new execution and may run the task and its side effects again.",
		}));

		render(
			<SpaceExecutionRecoveryButton
				onRecoverExecution={inspect}
				request={recoveryRequest}
				unavailableFallback={<a href="/computers">Reconnect Computer</a>}
			/>
		);

		await waitFor(() => expect(inspect).toHaveBeenCalledOnce());
		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
		expect(inspect).toHaveBeenCalledTimes(1);
	});

	it("names exact-conversation recovery by its user outcome and explains that the task will not rerun", async () => {
		const warning =
			"Continue from the saved conversation. This only prepares a reply; it cannot repeat tools or other actions.";
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
			name: "Continue conversation",
		});
		const warningElement = screen.getByText(warning);
		expect(button.getAttribute("aria-describedby")).toBe(warningElement.id);
		expect(warningElement.className).not.toContain("sr-only");
	});

	it("checks a pending reply after a connection failure without executing recovery again", async () => {
		vi.useFakeTimers();
		const warning =
			"The reply still couldn't be completed. Your message is saved.";
		const recover = vi
			.fn<SpaceExecutionRecoveryHandler>()
			.mockResolvedValueOnce({
				action: "resume_controller_conversation",
				label: "Continue conversation",
				status: "available",
				warning: null,
			})
			.mockResolvedValueOnce({
				action: null,
				label: null,
				status: "in_progress",
				warning: null,
			})
			.mockRejectedValueOnce(new Error("connection lost"))
			.mockResolvedValueOnce({
				action: null,
				label: null,
				status: "unavailable",
				warning,
			});
		await act(async () => {
			render(
				<SpaceExecutionRecoveryButton
					onRecoverExecution={recover}
					request={recoveryRequest}
				/>
			);
			await Promise.resolve();
		});
		await act(async () =>
			screen.getByRole("button", { name: "Continue conversation" }).click()
		);
		expect(screen.getByText("Preparing your reply…")).toBeTruthy();
		await act(async () => vi.advanceTimersByTimeAsync(2000));
		expect(
			screen.getByText(
				"Couldn't confirm whether your reply is ready. Your message is saved."
			)
		).toBeTruthy();
		await act(async () =>
			screen.getByRole("button", { name: "Check status" }).click()
		);
		expect(screen.getByText(warning)).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
		expect(
			recover.mock.calls.filter(([attempt]) => attempt.action !== null)
		).toHaveLength(1);
		expect(recover).toHaveBeenLastCalledWith({
			...recoveryRequest,
			action: null,
			operationId: null,
		});
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

	it("does not expose or execute an older Core fresh-Wake recovery action", async () => {
		const recover = vi.fn<SpaceExecutionRecoveryHandler>(async (attempt) =>
			attempt.action === null
				? {
						action: "retry_as_new_execution",
						label: "Retry as new execution",
						status: "available",
						warning:
							"This starts a new execution and may run the task and its side effects again.",
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

		await waitFor(() => expect(recover).toHaveBeenCalledOnce());
		expect(
			screen.queryByRole("button", { name: "Retry as new execution" })
		).toBeNull();
		expect(recover).toHaveBeenCalledWith({
			...recoveryRequest,
			action: null,
			operationId: null,
		});
	});
});
