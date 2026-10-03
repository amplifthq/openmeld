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
beforeEach(() => queue.mutate.mockReset());
afterEach(cleanup);

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
		<SpaceInputQueue onEdit={oldDraft} profileId="author" spaceId="space" />
	);
	await edit();
	expect(oldDraft).not.toHaveBeenCalled();
	view.rerender(
		<SpaceInputQueue onEdit={latestDraft} profileId="author" spaceId="space" />
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
		<SpaceInputQueue onEdit={onEdit} profileId="author" spaceId="space" />
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
