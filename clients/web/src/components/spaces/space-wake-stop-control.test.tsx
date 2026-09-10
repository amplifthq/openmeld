import type { PostSpaceWakeStopResponse } from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpaceWakeStopTargetResolution } from "#/lib/spaces/wake-stop-target";
import {
	SpaceWakeStopControl,
	SpaceWakeStopScope,
} from "./space-wake-stop-control";

describe("SpaceWakeStopControl", () => {
	afterEach(() => {
		cleanup();
	});

	it.each([
		"Close",
		"Close icon",
		"Escape",
	])("dismisses a pending Stop with %s without closing a later confirmation", async (dismissAction) => {
		let finishStop!: (response: PostSpaceWakeStopResponse) => void;
		const onStopWake = vi.fn(
			() =>
				new Promise<PostSpaceWakeStopResponse>((resolve) => {
					finishStop = resolve;
				})
		);
		render(
			<SpaceWakeStopControl
				onStopWake={onStopWake}
				target={createWakeStopTarget({})}
			/>
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Stop Wake for Runner Agent" })
		);
		fireEvent.click(screen.getByRole("button", { name: "Stop Wake" }));
		expect(
			screen
				.getByRole("button", { name: "Requesting Stop..." })
				.hasAttribute("disabled")
		).toBe(true);
		if (dismissAction === "Escape") {
			fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
		} else {
			const closeButtons = screen.getAllByRole("button", {
				name: "Close",
			});
			expect(closeButtons).toHaveLength(2);
			const button = closeButtons[dismissAction === "Close icon" ? 1 : 0];
			if (!button) {
				throw new Error("Missing dialog close action");
			}
			fireEvent.click(button);
		}
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(onStopWake).toHaveBeenCalledTimes(1);
		fireEvent.click(
			screen.getByRole("button", { name: "Stop Wake for Runner Agent" })
		);
		await act(async () => finishStop(createWakeStopResponse()));
		expect(
			screen.getByRole("dialog", { name: "Stop this Wake?" })
		).toBeTruthy();
		expect(onStopWake).toHaveBeenCalledTimes(1);
	});

	it("keeps confirmation and its exact target when an active reply replaces the trigger row", async () => {
		const target = createWakeStopTarget({ targetLabel: "Review Agent" });
		const onStopWake = vi.fn().mockResolvedValue(createWakeStopResponse());
		const view = render(
			<SpaceWakeStopScope>
				<SpaceWakeStopControl onStopWake={onStopWake} target={target} />
			</SpaceWakeStopScope>
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Stop Wake for Review Agent" })
		);
		view.rerender(
			<SpaceWakeStopScope>
				<p>The public reply is streaming.</p>
			</SpaceWakeStopScope>
		);
		const dialog = within(
			screen.getByRole("dialog", { name: "Stop this Wake?" })
		);
		fireEvent.click(dialog.getByRole("button", { name: "Stop Wake" }));
		await waitFor(() => expect(onStopWake).toHaveBeenCalledWith(target));
	});

	it("shows a visible Stop label for the details trigger", () => {
		const onStopWake = vi.fn().mockResolvedValue(createWakeStopResponse());

		render(
			<SpaceWakeStopControl
				onStopWake={onStopWake}
				target={createWakeStopTarget({ targetLabel: "@runner" })}
				variant="details"
			/>
		);

		const button = screen.getByRole("button", {
			name: "Stop Wake for @runner",
		});
		expect(button.textContent).toContain("Stop");
	});

	it("labels the disabled details trigger while Stop is pending", () => {
		const onStopWake = vi.fn().mockResolvedValue(createWakeStopResponse());

		render(
			<SpaceWakeStopControl
				onStopWake={onStopWake}
				target={createWakeStopTarget({
					canStop: false,
					status: "stopping",
					targetLabel: "@runner",
				})}
				variant="details"
			/>
		);

		const button = screen.getByRole("button", {
			name: "Stop request pending for @runner",
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		expect(button.textContent).toContain("Stopping...");
		expect(
			screen.getByText(
				"Stop requested. Waiting for OpenMeld to confirm this Wake was stopped."
			)
		).toBeTruthy();
	});

	it("lets the user stop one target from a multi-target Wake", async () => {
		const claudeTarget = createWakeStopTarget({
			targetLabel: "Claude Agent",
			targetProfileId: "agt_claude",
		});
		const codexTarget = createWakeStopTarget({
			targetLabel: "Codex Agent",
			targetProfileId: "agt_codex",
		});
		const onStopWake = vi.fn().mockResolvedValue(
			createWakeStopResponse({
				cancellationStateStatus: "cancelled",
				runtimeCoordinatorExecutionId: null,
				status: "cancelled",
				stopMode: "openmeld_owned_pre_agent",
			})
		);

		render(
			<SpaceWakeStopControl
				onStopWake={onStopWake}
				targets={[claudeTarget, codexTarget]}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Stop Wake for 2 agents" })
		);
		const dialog = within(
			screen.getByRole("dialog", { name: "Stop agents in this Wake" })
		);
		fireEvent.click(dialog.getByRole("button", { name: "Stop Codex Agent" }));

		await waitFor(() => {
			expect(onStopWake).toHaveBeenCalledTimes(1);
		});
		expect(onStopWake).toHaveBeenCalledWith(codexTarget);
		expect(onStopWake).not.toHaveBeenCalledWith(claudeTarget);
	});

	it("continues an explicit Stop All after the pending dialog is dismissed", async () => {
		const claudeTarget = createWakeStopTarget({
			targetLabel: "Claude Agent",
			targetProfileId: "agt_claude",
		});
		const codexTarget = createWakeStopTarget({
			targetLabel: "Codex Agent",
			targetProfileId: "agt_codex",
		});
		let finishFirstStop!: (response: PostSpaceWakeStopResponse) => void;
		const firstStop = new Promise<PostSpaceWakeStopResponse>((resolve) => {
			finishFirstStop = resolve;
		});
		const onStopWake = vi.fn().mockResolvedValue(
			createWakeStopResponse({
				cancellationStateStatus: "cancelled",
				runtimeCoordinatorExecutionId: null,
				status: "cancelled",
				stopMode: "openmeld_owned_pre_agent",
			})
		);

		render(
			<SpaceWakeStopControl
				onStopWake={onStopWake}
				targets={[claudeTarget, codexTarget]}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Stop Wake for 2 agents" })
		);
		const dialog = within(
			screen.getByRole("dialog", { name: "Stop agents in this Wake" })
		);
		onStopWake.mockImplementationOnce(() => firstStop);
		fireEvent.click(dialog.getByRole("button", { name: "Stop All" }));
		const closeButton = dialog.getAllByRole("button", { name: "Close" })[0];
		if (!closeButton) {
			throw new Error("Missing dialog close action");
		}
		fireEvent.click(closeButton);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(onStopWake).toHaveBeenCalledTimes(1);
		await act(async () => finishFirstStop(createWakeStopResponse()));

		await waitFor(() => {
			expect(onStopWake).toHaveBeenCalledTimes(2);
		});
		expect(onStopWake).toHaveBeenNthCalledWith(1, claudeTarget);
		expect(onStopWake).toHaveBeenNthCalledWith(2, codexTarget);
	});

	it("excludes unauthorized targets from the multi-target stop selection", async () => {
		const allowed = createWakeStopTarget({
			targetProfileId: "agt_owned",
			targetLabel: "Owned agent",
		});
		const denied = createWakeStopTarget({
			targetProfileId: "agt_other",
			targetLabel: "Other agent",
			canStop: false,
			status: "not_stoppable",
		});
		const onStopWake = vi.fn().mockResolvedValue(createWakeStopResponse());
		render(
			<SpaceWakeStopControl
				onStopWake={onStopWake}
				targets={[allowed, denied]}
			/>
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Stop Wake for Owned agent" })
		);
		const dialog = within(screen.getByRole("dialog"));
		expect(dialog.queryByRole("button", { name: "Stop All" })).toBeNull();
		fireEvent.click(dialog.getByRole("button", { name: "Stop Wake" }));
		await waitFor(() => expect(onStopWake).toHaveBeenCalledWith(allowed));
		expect(onStopWake).not.toHaveBeenCalledWith(denied);
	});

	it("keeps an open multi-target picker stable after one target stops", async () => {
		const claudeTarget = createWakeStopTarget({
			targetLabel: "Claude Agent",
			targetProfileId: "agt_claude",
		});
		const codexTarget = createWakeStopTarget({
			targetLabel: "Codex Agent",
			targetProfileId: "agt_codex",
		});
		const onStopWake = vi.fn().mockResolvedValue(
			createWakeStopResponse({
				cancellationStateStatus: "cancelled",
				runtimeCoordinatorExecutionId: null,
				status: "cancelled",
				stopMode: "openmeld_owned_pre_agent",
			})
		);
		const view = render(
			<SpaceWakeStopControl
				onStopWake={onStopWake}
				targets={[claudeTarget, codexTarget]}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Stop Wake for 2 agents" })
		);
		fireEvent.click(
			within(
				screen.getByRole("dialog", { name: "Stop agents in this Wake" })
			).getByRole("button", { name: "Stop Codex Agent" })
		);

		await waitFor(() => {
			expect(onStopWake).toHaveBeenCalledTimes(1);
		});
		view.rerender(
			<SpaceWakeStopControl onStopWake={onStopWake} targets={[claudeTarget]} />
		);

		const dialog = screen.getByRole("dialog", {
			name: "Stop agents in this Wake",
		});
		expect(dialog.textContent).toContain("Claude Agent");
		expect(dialog.textContent).toContain("Codex Agent");
		expect(dialog.textContent).toContain("Stopped.");
		expect(
			within(dialog).getByRole("button", { name: "Codex Agent stopped" })
				.textContent
		).toContain("Stopped");
		expect(
			screen.queryByRole("dialog", { name: "Stop this Wake?" })
		).toBeNull();
	});
});

function createWakeStopTarget(
	overrides: Partial<SpaceWakeStopTargetResolution>
): SpaceWakeStopTargetResolution {
	const targetProfileId = overrides.targetProfileId ?? "agt_runner";
	const selector = {
		by: "source_signal" as const,
		sourceSignalId: "sig-source",
		targetProfileId,
	};
	return {
		canStop: true,
		clientMessageId: "client-message-1",
		selector,
		selectorKey: `source_signal:sig-source:${targetProfileId}`,
		sourceSignalId: "sig-source",
		status: "active",
		targetLabel: "Runner Agent",
		targetProfileId,
		...overrides,
	};
}

function createWakeStopResponse(
	overrides: {
		cancellationStateStatus?: "cancelled" | "requested";
		runtimeCoordinatorExecutionId?: string | null;
		status?: PostSpaceWakeStopResponse["status"];
		stopMode?: "openmeld_owned_pre_agent" | "controller_control";
	} = {}
): PostSpaceWakeStopResponse {
	return {
		cancellationState: {
			observedAtMs: Date.UTC(2026, 5, 3, 22, 8),
			reasonCode: null,
			status: overrides.cancellationStateStatus ?? "requested",
		},
		ok: true,
		runtimeCoordinatorExecutionId:
			overrides.runtimeCoordinatorExecutionId ?? "rce_123",
		status: overrides.status ?? "cancellation_requested",
		stopMode: overrides.stopMode ?? "controller_control",
		targetProfileId: "agt_runner",
	} as PostSpaceWakeStopResponse;
}
