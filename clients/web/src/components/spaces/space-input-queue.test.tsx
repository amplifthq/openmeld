import type { SpaceInputQueueResponse } from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
	isPausedBehind,
	queuedMessageStatus,
	reorderVisibleSpaceQueue,
	resolveSendNowState,
	SpaceInputQueue,
} from "./space-input-queue";

const queue = vi.hoisted(() => ({ mutate: vi.fn(), sendNow: vi.fn() }));
const item: SpaceInputQueueResponse["items"][number] = {
	inputId: "queued-draft",
	authorProfileId: "author",
	target: { dispatchId: "original-response", targetProfileId: "agt_codex" },
	text: "Keep this draft",
	state: "queued",
	blocked: false,
};
let items: SpaceInputQueueResponse["items"] = [item];
vi.mock("./use-space-input-queue", () => ({
	useSpaceInputQueue: () => ({
		items,
		error: null,
		mutate: queue.mutate,
		sendNow: queue.sendNow,
	}),
}));
vi.mock("./use-space-work-recovery", () => ({
	useSpaceWorkRecovery: () => ({ visible: false, content: null }),
}));
beforeEach(() => {
	items = [item];
	queue.mutate.mockReset();
	queue.sendNow.mockReset();
});
afterEach(cleanup);

it("shows only the current conversation's queued messages", async () => {
	items = [
		item,
		{
			...item,
			inputId: "thread-draft",
			threadId: "thread-a",
			text: "Thread draft",
		},
		{
			...item,
			inputId: "other-draft",
			threadId: "thread-b",
			text: "Other Thread draft",
		},
	];
	const view = render(
		<SpaceInputQueue
			onEdit={vi.fn()}
			profileId="author"
			progressItems={[]}
			spaceId="space"
			threadId="thread-a"
		/>
	);
	expect(screen.getByText("Thread draft")).toBeTruthy();
	expect(screen.queryByText("Keep this draft")).toBeNull();
	expect(screen.queryByText("Other Thread draft")).toBeNull();
	view.rerender(
		<SpaceInputQueue
			onEdit={vi.fn()}
			profileId="author"
			progressItems={[]}
			spaceId="space"
		/>
	);
	expect(screen.getByText("Keep this draft")).toBeTruthy();
	await waitFor(() => expect(screen.queryByText("Thread draft")).toBeNull());
});

it("reorders visible queued messages while preserving other conversations' positions", () => {
	expect(
		reorderVisibleSpaceQueue(["main", "a", "other", "b"], ["a", "b"], 0, 1)
	).toEqual(["main", "b", "other", "a"]);
});

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
					targetLabel: "Codex",
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
			expect(queue.sendNow).toHaveBeenCalledExactlyOnceWith(item)
		);
	} else {
		expect(queue.sendNow).not.toHaveBeenCalled();
	}
});

it("explains why Send now is off", () => {
	const progress = {
		dispatchId: "original-response",
		targetProfileId: "agt_codex",
		targetLabel: "@Claude Code",
		terminal: false,
		phase: "running" as const,
		waitReasonCode: null,
	};
	expect(resolveSendNowState(item, [progress])).toEqual({
		available: true,
		hint: "Send this message to Claude Code while it works",
	});
	expect(
		resolveSendNowState(item, [
			{
				...progress,
				pendingInteraction: {} as never,
			},
		])
	).toEqual({
		available: false,
		hint: "Claude Code is waiting for your input. Answer it first, then send this message.",
	});
	expect(resolveSendNowState(item, []).available).toBe(false);
	expect(
		resolveSendNowState({ ...item, blocked: true }, [progress]).available
	).toBe(false);
});

it("keeps the reason reachable while Send now is disabled", () => {
	render(
		<SpaceInputQueue
			onEdit={vi.fn()}
			profileId="author"
			progressItems={[]}
			spaceId="space"
		/>
	);
	const wrapper = screen
		.getByRole("button", { name: "Send now" })
		.closest("[data-slot=queued-send-now]");
	expect(wrapper?.getAttribute("tabindex")).toBe("0");
	expect(wrapper?.getAttribute("aria-description")).toContain(
		"This response has ended"
	);
});

it("shows a clear error when Send now fails", async () => {
	queue.sendNow.mockRejectedValue(
		new Error("Couldn't send this message now. It's still queued.")
	);
	render(
		<SpaceInputQueue
			onEdit={vi.fn()}
			profileId="author"
			progressItems={[
				{
					dispatchId: "original-response",
					targetProfileId: "agt_codex",
					targetLabel: "Codex",
					terminal: false,
					phase: "running",
					waitReasonCode: null,
				},
			]}
			spaceId="space"
		/>
	);
	fireEvent.click(screen.getByRole("button", { name: "Send now" }));
	expect((await screen.findByRole("alert")).textContent).toBe(
		"Couldn't send this message now. It's still queued."
	);
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

const claudeProgress = {
	dispatchId: "original-response",
	targetProfileId: "agt_codex",
	targetLabel: "@Claude Code",
	terminal: true,
	phase: "running" as const,
	waitReasonCode: null,
};

it("describes an unconfirmed message by what Core is doing about it", () => {
	const checking = {
		...item,
		state: "unconfirmed" as const,
		delivery: "checking" as const,
	};
	expect(queuedMessageStatus(checking, [claudeProgress])).toBe(
		"Checking whether Claude Code received this…"
	);
	expect(resolveSendNowState(checking, [claudeProgress])).toEqual({
		available: false,
		hint: "Checking whether Claude Code received this…",
	});
	const undecided = { ...checking, delivery: "undecided" as const };
	expect(queuedMessageStatus(undecided, [claudeProgress])).toBe(
		"Couldn't confirm that Claude Code received this. Retry it or remove it; later messages wait until you do."
	);
	expect(resolveSendNowState(undecided, [claudeProgress]).hint).toBe(
		"Retry or remove this message first."
	);
});

it("names the Agent from the Space members once its response has left", () => {
	expect(
		queuedMessageStatus(
			{ ...item, state: "unconfirmed", delivery: "checking" },
			[],
			{ agents: [{ profileId: "agt_codex", profileName: "Claude Code" }] }
		)
	).toBe("Checking whether Claude Code received this…");
});

it("never says a paused message is sent when the next response starts", () => {
	const queue = [
		{ ...item, inputId: "m", state: "unconfirmed" as const },
		{ ...item, inputId: "n" },
		{
			...item,
			inputId: "other",
			target: { dispatchId: "another", targetProfileId: "agt_codex" },
		},
	];
	expect(isPausedBehind(queue, 1)).toBe(true);
	expect(isPausedBehind(queue, 2)).toBe(false);
	const state = resolveSendNowState(queue[1] as typeof item, [claudeProgress], {
		paused: true,
	});
	expect(state.available).toBe(false);
	expect(state.hint).not.toContain("next one starts");
	expect(
		queuedMessageStatus(queue[1] as typeof item, [claudeProgress], {
			paused: true,
		})
	).toBe("Waiting for the message above.");
});

it("retries or removes an undecided message, asking once before removing", async () => {
	items = [
		{ ...item, state: "unconfirmed", delivery: "undecided" },
		{ ...item, inputId: "behind", text: "Behind it" },
	];
	queue.mutate.mockResolvedValue(undefined);
	render(
		<SpaceInputQueue
			onEdit={vi.fn()}
			profileId="author"
			progressItems={[claudeProgress]}
			spaceId="space"
		/>
	);
	expect(screen.getByText("Waiting for the message above.")).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "Retry" }));
	await waitFor(() =>
		expect(queue.mutate).toHaveBeenCalledWith({
			action: "retry",
			inputId: "queued-draft",
		})
	);
	fireEvent.click(screen.getByRole("button", { name: "Remove from queue" }));
	expect(queue.mutate).toHaveBeenCalledTimes(1);
	const dialog = await screen.findByRole("alertdialog");
	expect(within(dialog).getByText("Remove from queue?")).toBeTruthy();
	fireEvent.click(
		within(dialog).getByRole("button", { name: "Remove from queue" })
	);
	await waitFor(() =>
		expect(queue.mutate).toHaveBeenLastCalledWith({
			action: "delete",
			inputId: "queued-draft",
		})
	);
});
