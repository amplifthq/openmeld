import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceUnreadControl } from "./space-unread-control";

afterEach(cleanup);
const first = {
	itemId: "first",
	signalId: "first",
	occurredAtMs: 1,
	threadRootSignalId: null,
};
const second = {
	itemId: "second",
	signalId: "second",
	occurredAtMs: 2,
	threadRootSignalId: "root",
};
describe("persistent Space unread control", () => {
	it("keeps navigation available and uses the next remaining target", async () => {
		const navigate = vi.fn().mockResolvedValue(true);
		const ui = (targets: (typeof first)[]) => (
			<TooltipProvider>
				<SpaceUnreadControl
					count={targets.length}
					onNavigate={navigate}
					targets={targets}
				/>
			</TooltipProvider>
		);
		const { rerender } = render(
			ui([first, { ...second, threadRootSignalId: null }])
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "2 unread updates. Jump to first unread",
			})
		);
		await waitFor(() => expect(navigate).toHaveBeenCalledWith(first));
		expect(
			screen.getByRole("button", {
				name: "2 unread updates. Jump to first unread",
			})
		).toBeTruthy();
		rerender(ui([{ ...second, threadRootSignalId: null }]));
		fireEvent.click(
			screen.getByRole("button", {
				name: "1 unread update. Jump to first unread",
			})
		);
		await waitFor(() => expect(navigate).toHaveBeenCalledTimes(2));
		rerender(ui([]));
		expect(screen.queryByRole("button")).toBeNull();
	});
	it("requires confirmation, allows cancel, and retries the frozen selection after failure", async () => {
		const commit = vi
			.fn()
			.mockRejectedValueOnce(new Error("Connection lost. Try again."))
			.mockResolvedValue(undefined);
		const prepare = vi.fn().mockResolvedValue({ unreadCount: 2, commit });
		render(
			<TooltipProvider>
				<SpaceUnreadControl
					count={2}
					onNavigate={vi.fn()}
					onPrepareMarkAllRead={prepare}
					targets={[first, second]}
				/>
			</TooltipProvider>
		);
		fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
		await screen.findByRole("dialog", { name: "Mark all updates as read?" });
		expect(commit).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		fireEvent.click(screen.getByRole("button", { name: "Mark all as read" }));
		const dialog = await screen.findByRole("dialog");
		await waitFor(() =>
			expect(
				screen.getAllByRole("button", { name: "Mark all as read" }).length
			).toBeGreaterThan(0)
		);
		const confirm = () =>
			within(dialog).getByRole("button", { name: "Mark all as read" });
		await waitFor(() => expect(confirm()).toBeDefined());
		fireEvent.click(confirm());
		expect((await screen.findByRole("alert")).textContent).toContain(
			"Connection lost"
		);
		fireEvent.click(confirm());
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
		expect(prepare).toHaveBeenCalledTimes(2);
		expect(commit).toHaveBeenCalledTimes(2);
	});
});
