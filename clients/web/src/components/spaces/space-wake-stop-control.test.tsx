import type { PostSpaceWakeStopResponse } from "@openmeld/schemas/types";
import {
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

	it("lets the user explicitly stop all active targets", async () => {
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
		fireEvent.click(dialog.getByRole("button", { name: "Stop All" }));

		await waitFor(() => {
			expect(onStopWake).toHaveBeenCalledTimes(2);
		});
		expect(onStopWake).toHaveBeenNthCalledWith(1, claudeTarget);
		expect(onStopWake).toHaveBeenNthCalledWith(2, codexTarget);
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
