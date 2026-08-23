import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SpaceViewTabs } from "./space-view-tabs";

describe("SpaceViewTabs", () => {
	it("shows Messages, Graph, and Files as one view control", () => {
		const onViewChange = vi.fn();

		render(
			<SpaceViewTabs
				activeView="messages"
				idPrefix="space-view-test"
				onViewChange={onViewChange}
			/>
		);

		const messagesTab = screen.getByRole("tab", { name: "Messages" });
		const graphTab = screen.getByRole("tab", { name: "Graph" });
		const filesTab = screen.getByRole("tab", { name: "Files" });
		const tabList = screen.getByRole("tablist", { name: "Space view" });

		expect(messagesTab.getAttribute("aria-selected")).toBe("true");
		expect(tabList.getAttribute("data-variant")).toBe("underline");
		expect(tabList.className).toContain("h-full");
		expect(tabList.className).toContain("gap-5");
		expect(messagesTab.className).toContain("px-0");
		expect(screen.queryByRole("tab", { name: "Conversation" })).toBeNull();

		fireEvent.click(graphTab);

		expect(onViewChange).toHaveBeenCalledWith("graph");

		fireEvent.click(filesTab);

		expect(onViewChange).toHaveBeenLastCalledWith("files");
	});
});
