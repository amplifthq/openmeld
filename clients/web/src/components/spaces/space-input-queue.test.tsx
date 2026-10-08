import type { SpaceInputQueueResponse } from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SpaceInputQueue } from "./space-input-queue";

const queue = vi.hoisted(() => ({ mutate: vi.fn() }));
const item: SpaceInputQueueResponse["items"][number] = {
	inputId: "queued-draft",
	authorProfileId: "author",
	target: { dispatchId: "original-response", targetProfileId: "agt_codex" },
	text: "Keep this draft",
	state: "queued",
	blocked: false,
};
vi.mock("./use-space-input-queue", () => ({
	useSpaceInputQueue: () => ({
		items: [item],
		error: null,
		mutate: queue.mutate,
	}),
}));
vi.mock("./use-space-work-recovery", () => ({
	useSpaceWorkRecovery: () => ({ visible: false, content: null }),
}));
beforeEach(() => {
	queue.mutate.mockReset();
});
afterEach(cleanup);

it.each([
	"running",
	"writing",
	"connecting",
	"queued",
	"occupied",
] as const)("Send now only steers a running response: %s", async (phase) => {
	render(
		<SpaceInputQueue
			onEdit={vi.fn()}
			profileId="author"
			progressItems={[
				{
					dispatchId: "original-response",
					targetProfileId: "agt_codex",
					terminal: false,
					phase: phase === "occupied" ? "connecting" : phase,
					waitReasonCode:
						phase === "occupied"
							? "runtime.agent_controller_conversation.occupied"
							: null,
				},
			]}
			spaceId="space"
		/>
	);
	const send = screen.getByRole("button", { name: "Send now" });
	const canSendNow = phase === "running" || phase === "writing";
	expect((send as HTMLButtonElement).disabled).toBe(!canSendNow);
	fireEvent.click(send);
	if (canSendNow) {
		await waitFor(() =>
			expect(queue.mutate).toHaveBeenCalledExactlyOnceWith({
				action: "steer",
				inputId: item.inputId,
				target: item.target,
			})
		);
	} else {
		expect(queue.mutate).not.toHaveBeenCalled();
	}
});

async function edit() {
	fireEvent.click(
		screen.getByRole("button", { name: "Queued message options" })
	);
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Edit message" })
	);
}

it("waits for removal and uses the latest composer callback when an edit completes", async () => {
	let acknowledge!: () => void;
	queue.mutate.mockReturnValue(
		new Promise<void>((resolve) => {
			acknowledge = resolve;
		})
	);
	const oldDraft = vi.fn();
	const latestDraft = vi.fn();
	const view = render(
		<SpaceInputQueue
			onEdit={oldDraft}
			profileId="author"
			progressItems={[]}
			spaceId="space"
		/>
	);
	await edit();
	expect(oldDraft).not.toHaveBeenCalled();
	view.rerender(
		<SpaceInputQueue
			onEdit={latestDraft}
			profileId="author"
			progressItems={[]}
			spaceId="space"
		/>
	);
	await act(() => {
		acknowledge();
	});
	expect(oldDraft).not.toHaveBeenCalled();
	expect(latestDraft).toHaveBeenCalledExactlyOnceWith("Keep this draft");
	expect(queue.mutate).toHaveBeenCalledExactlyOnceWith({
		action: "delete",
		inputId: "queued-draft",
	});
});

it("keeps a failed edit recoverable without resending the original queue item", async () => {
	queue.mutate
		.mockRejectedValueOnce(new Error("Response lost"))
		.mockResolvedValueOnce(undefined);
	const onEdit = vi.fn();
	render(
		<SpaceInputQueue
			onEdit={onEdit}
			profileId="author"
			progressItems={[]}
			spaceId="space"
		/>
	);
	await edit();
	expect((await screen.findByRole("alert")).textContent).toBe("Response lost");
	expect(onEdit).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Retry edit" }));
	await waitFor(() =>
		expect(onEdit).toHaveBeenCalledExactlyOnceWith("Keep this draft")
	);
	expect(queue.mutate.mock.calls).toEqual([
		[{ action: "delete", inputId: "queued-draft" }],
		[{ action: "delete", inputId: "queued-draft" }],
	]);
});
