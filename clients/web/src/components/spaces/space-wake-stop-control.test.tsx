import { postSpaceWakeStopResponseSchema } from "@openmeld/schemas";
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

afterEach(cleanup);
const response = postSpaceWakeStopResponseSchema.parse({
	ok: true,
	status: "cancellation_requested",
	stopMode: "controller_control",
	runtimeCoordinatorExecutionId: "rce_123",
	targetProfileId: "agt_runner",
	cancellationState: { status: "requested", observedAtMs: 1, reasonCode: null },
});
function target(
	name = "Runner",
	overrides: Partial<SpaceWakeStopTargetResolution> = {}
): SpaceWakeStopTargetResolution {
	return {
		canStop: true,
		clientMessageId: "message-1",
		selector: {
			by: "client_message",
			clientMessageId: "message-1",
			targetProfileId: name,
		},
		selectorKey: `client_message:message-1:${name}`,
		sourceSignalId: null,
		status: "active",
		targetLabel: name,
		targetProfileId: name,
		...overrides,
	};
}

describe("immediate Stop", () => {
	it.each([
		false,
		true,
	])("stops a single target on the first click (waiting=%s)", async (isWaitingToStart) => {
		const selected = target("Runner", { isWaitingToStart });
		let finish!: (value: PostSpaceWakeStopResponse) => void;
		const onStopWake = vi.fn(
			() =>
				new Promise<PostSpaceWakeStopResponse>((resolve) => {
					finish = resolve;
				})
		);
		render(<SpaceWakeStopControl onStopWake={onStopWake} target={selected} />);
		const button = screen.getByRole("button", {
			name: isWaitingToStart ? "Cancel waiting for Runner" : "Stop Runner",
		});
		fireEvent.click(button);
		expect(onStopWake).toHaveBeenCalledExactlyOnceWith(selected);
		expect(screen.queryByRole("dialog")).toBeNull();
		expect(button.textContent).toBe("Stopping…");
		expect(button.hasAttribute("disabled")).toBe(true);
		fireEvent.click(button);
		expect(onStopWake).toHaveBeenCalledTimes(1);
		await act(async () => finish(response));
	});
	it("retains confirmed versus requested state from the controller", () => {
		const view = render(
			<SpaceWakeStopControl
				onStopWake={vi.fn()}
				target={target("Runner", { status: "stopping", canStop: false })}
			/>
		);
		expect(screen.getByRole("button").textContent).toBe("Stopping…");
		expect(screen.queryByText("Stopped.")).toBeNull();
		view.rerender(
			<SpaceWakeStopControl
				onStopWake={vi.fn()}
				target={target("Runner", { status: "stopped", canStop: false })}
				variant="details"
			/>
		);
		expect(screen.getByText("Stopped.")).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
	});
	it("shows failure next to the request and permits retry", async () => {
		const onStopWake = vi
			.fn()
			.mockRejectedValueOnce(new Error("Connection lost"))
			.mockResolvedValue(response);
		render(<SpaceWakeStopControl onStopWake={onStopWake} target={target()} />);
		fireEvent.click(screen.getByRole("button", { name: "Stop Runner" }));
		await waitFor(() =>
			expect(screen.getByRole("alert").textContent).toContain("Connection lost")
		);
		fireEvent.click(screen.getByRole("button", { name: "Stop Runner" }));
		await waitFor(() => expect(onStopWake).toHaveBeenCalledTimes(2));
	});
	it("never exposes unsupported runtime control as Stop", () => {
		const onStopWake = vi.fn();
		render(
			<SpaceWakeStopControl
				onStopWake={onStopWake}
				target={target("Runner", { canStop: false, status: "unsupported" })}
				variant="details"
			/>
		);
		expect(
			screen.getByText("Stop is not supported for this local agent.")
		).toBeTruthy();
		expect(screen.queryByRole("button")).toBeNull();
		expect(onStopWake).not.toHaveBeenCalled();
	});
	it("selects one target and keeps the others running", async () => {
		const first = target("Codex"),
			second = target("Claude");
		const onStopWake = vi.fn().mockResolvedValue(response);
		render(
			<SpaceWakeStopControl onStopWake={onStopWake} targets={[first, second]} />
		);
		fireEvent.click(screen.getByRole("button", { name: "Stop 2 agents" }));
		expect(onStopWake).not.toHaveBeenCalled();
		fireEvent.click(
			within(screen.getByRole("dialog", { name: "Stop agents" })).getByRole(
				"button",
				{ name: "Stop Codex" }
			)
		);
		await waitFor(() =>
			expect(onStopWake).toHaveBeenCalledExactlyOnceWith(first)
		);
		expect(
			screen
				.getByRole("button", { name: "Stop Claude" })
				.hasAttribute("disabled")
		).toBe(false);
	});
	it("stops all targets concurrently even if one request is slow or fails", async () => {
		let rejectFirst!: (error: Error) => void;
		const first = target("Codex"),
			second = target("Claude");
		const onStopWake = vi.fn((selected: SpaceWakeStopTargetResolution) =>
			selected === first
				? new Promise<PostSpaceWakeStopResponse>((_, reject) => {
						rejectFirst = reject;
					})
				: Promise.resolve(response)
		);
		render(
			<SpaceWakeStopControl onStopWake={onStopWake} targets={[first, second]} />
		);
		fireEvent.click(screen.getByRole("button", { name: "Stop 2 agents" }));
		fireEvent.click(screen.getByRole("button", { name: "Stop all" }));
		expect(onStopWake).toHaveBeenCalledTimes(2);
		await act(async () => rejectFirst(new Error("Connection lost")));
		expect(
			screen.getByText(
				"Stop is not confirmed. Check your connection and try again."
			)
		).toBeTruthy();
	});
	it("keeps target selection when a streaming reply replaces the source row", () => {
		const targets = [target("Codex"), target("Claude")];
		const onStopWake = vi.fn().mockResolvedValue(response);
		const view = render(
			<SpaceWakeStopScope>
				<SpaceWakeStopControl onStopWake={onStopWake} targets={targets} />
			</SpaceWakeStopScope>
		);
		fireEvent.click(screen.getByRole("button", { name: "Stop 2 agents" }));
		view.rerender(
			<SpaceWakeStopScope>
				<p>Streaming reply</p>
			</SpaceWakeStopScope>
		);
		expect(screen.getByRole("dialog", { name: "Stop agents" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Stop Claude" }));
		expect(onStopWake).toHaveBeenCalledExactlyOnceWith(targets[1]);
	});
});
