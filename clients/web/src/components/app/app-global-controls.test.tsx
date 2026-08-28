import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppGlobalControls } from "./app-global-controls";

vi.mock("./current-computer-toolbar-launcher", () => ({
	CurrentComputerToolbarLauncher: () => <a href="/computer">Computer</a>,
}));

vi.mock("#/components/inbox/global-inbox-launcher", () => ({
	GlobalInboxLauncher: (input: {
		onOpenChange: (open: boolean) => void;
		open: boolean;
	}) => (
		<button onClick={() => input.onOpenChange(!input.open)} type="button">
			{input.open ? "Close Inbox panel" : "Open Inbox panel"}
		</button>
	),
}));

vi.mock("#/components/organizations/global-center-agent-launcher", () => ({
	GlobalCenterAgentLauncher: (input: {
		onOpenChange: (open: boolean) => void;
		open: boolean;
	}) => (
		<button onClick={() => input.onOpenChange(!input.open)} type="button">
			{input.open ? "Close Center Agent panel" : "Open Center Agent panel"}
		</button>
	),
	GlobalCenterAgentTaskLaunchers: (input: {
		onOpenTaskChange: (taskId: string, open: boolean) => void;
		openTaskId: string | null;
	}) => (
		<button
			onClick={() =>
				input.onOpenTaskChange("task-1", input.openTaskId !== "task-1")
			}
			type="button"
		>
			{input.openTaskId === "task-1" ? "Close Task panel" : "Open Task panel"}
		</button>
	),
}));

describe("AppGlobalControls", () => {
	afterEach(cleanup);

	it("keeps the Inbox and Center Agent panels mutually exclusive", () => {
		render(<AppGlobalControls />);

		fireEvent.click(
			screen.getByRole("button", { name: "Open Center Agent panel" })
		);
		expect(
			screen.getByRole("button", { name: "Close Center Agent panel" })
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Open Inbox panel" }));
		expect(
			screen.getByRole("button", { name: "Close Inbox panel" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Open Center Agent panel" })
		).toBeTruthy();
	});

	it("places Computer at the far left while Center Agent and Inbox stay together at the far right", () => {
		render(<AppGlobalControls />);

		const toolbar = screen.getByRole("toolbar", { name: "Global controls" });
		const start = toolbar.querySelector(
			'[data-slot="app-global-controls-start"]'
		);
		const end = toolbar.querySelector('[data-slot="app-global-controls-end"]');
		expect(start).toBeInstanceOf(HTMLElement);
		expect(end).toBeInstanceOf(HTMLElement);
		if (!(start instanceof HTMLElement && end instanceof HTMLElement)) {
			return;
		}

		expect(within(start).getByRole("link", { name: "Computer" })).toBeTruthy();
		expect(within(end).queryByRole("link", { name: "Computer" })).toBeNull();
		expect(
			within(end)
				.getAllByRole("button")
				.map((button) => button.textContent)
		).toEqual([
			"Open Task panel",
			"Open Center Agent panel",
			"Open Inbox panel",
		]);
		expect(toolbar.classList.contains("lg:ps-0")).toBe(true);
		expect(toolbar.classList.contains("lg:pe-2")).toBe(true);
	});

	it("keeps Task, Inbox, and Center Agent panels mutually exclusive", () => {
		render(<AppGlobalControls />);

		fireEvent.click(screen.getByRole("button", { name: "Open Task panel" }));
		expect(
			screen.getByRole("button", { name: "Close Task panel" })
		).toBeTruthy();

		fireEvent.click(
			screen.getByRole("button", { name: "Open Center Agent panel" })
		);
		expect(
			screen.getByRole("button", { name: "Close Center Agent panel" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Open Task panel" })
		).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Open Task panel" }));
		fireEvent.click(screen.getByRole("button", { name: "Open Inbox panel" }));
		expect(
			screen.getByRole("button", { name: "Close Inbox panel" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Open Task panel" })
		).toBeTruthy();
	});

	it("allows Home to open the canonical Center Agent panel", () => {
		const onOpenPanelChange = vi.fn();
		const { rerender } = render(
			<AppGlobalControls
				onOpenPanelChange={onOpenPanelChange}
				openPanel={null}
			/>
		);

		fireEvent.click(
			screen.getByRole("button", { name: "Open Center Agent panel" })
		);
		expect(onOpenPanelChange).toHaveBeenCalledWith("center_agent");

		rerender(
			<AppGlobalControls
				onOpenPanelChange={onOpenPanelChange}
				openPanel="center_agent"
			/>
		);
		expect(
			screen.getByRole("button", { name: "Close Center Agent panel" })
		).toBeTruthy();
	});
});
