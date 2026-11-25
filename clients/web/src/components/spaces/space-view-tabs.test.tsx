import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpaceViewTabs } from "./space-view-tabs";

describe("SpaceViewTabs", () => {
	afterEach(cleanup);
	it("shows Messages, Tasks, and Files while hiding the Graph entry", () => {
		const onViewChange = vi.fn();

		render(
			<SpaceViewTabs
				activeView="messages"
				idPrefix="space-view-test"
				onViewChange={onViewChange}
			/>
		);

		const messagesTab = screen.getByRole("tab", { name: "Messages" });
		const tasksTab = screen.getByRole("tab", { name: "Tasks" });
		expect(screen.queryByRole("tab", { name: "Graph" })).toBeNull();
		const filesTab = screen.getByRole("tab", { name: "Files" });
		const tabList = screen.getByRole("tablist", { name: "Space view" });

		expect(messagesTab.getAttribute("aria-selected")).toBe("true");
		expect(tabList.getAttribute("data-variant")).toBe("underline");
		expect(tabList.className).toContain("h-full");
		expect(tabList.className).toContain("gap-5");
		expect(messagesTab.className).toContain("px-0");
		expect(screen.queryByRole("tab", { name: "Conversation" })).toBeNull();

		fireEvent.click(filesTab);

		expect(onViewChange).toHaveBeenLastCalledWith("files");
		fireEvent.click(tasksTab);
		expect(onViewChange).toHaveBeenLastCalledWith("tasks");
	});

	it("hides Tasks where the shared Space workflow is unavailable", () => {
		render(
			<SpaceViewTabs
				activeView="messages"
				idPrefix="direct-message-view"
				onViewChange={vi.fn()}
				tasksEnabled={false}
			/>
		);

		expect(screen.queryByRole("tab", { name: "Tasks" })).toBeNull();
		expect(screen.getByRole("tab", { name: "Files" })).toBeDefined();
	});

	it("shows Guide after Files only where it is enabled", () => {
		const onViewChange = vi.fn();
		const { rerender } = render(
			<SpaceViewTabs
				activeView="messages"
				idPrefix="space-view-test"
				onViewChange={onViewChange}
			/>
		);
		expect(screen.queryByRole("tab", { name: "Guide" })).toBeNull();

		rerender(
			<SpaceViewTabs
				activeView="guide"
				guideEnabled
				idPrefix="space-view-test"
				onViewChange={onViewChange}
			/>
		);

		const tabs = screen.getAllByRole("tab");
		const guideTab = screen.getByRole("tab", { name: "Guide" });
		expect(tabs.at(-1)).toBe(guideTab);
		expect(tabs.indexOf(guideTab)).toBe(
			tabs.indexOf(screen.getByRole("tab", { name: "Files" })) + 1
		);
		expect(guideTab.getAttribute("aria-selected")).toBe("true");
		fireEvent.click(screen.getByRole("tab", { name: "Files" }));
		expect(onViewChange).toHaveBeenLastCalledWith("files");
		fireEvent.click(guideTab);
		expect(onViewChange).toHaveBeenLastCalledWith("guide");
	});
});
