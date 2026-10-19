import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChatHistoryDropdown } from "./chat-history-dropdown";

const PLAN = /Plan/;
const AUDIT = /Audit/;

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
});

it("lists Sessions grouped by Profile, marks the current one and switches in one click", async () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
	);
	const onSelect = vi.fn();
	render(
		<ChatHistoryDropdown
			ariaLabel="Open chats"
			currentSpaceId="a"
			groups={[
				{
					id: "default",
					label: "Codex",
					items: [{ spaceId: "a", title: "Plan" }],
					isLoading: false,
					isError: false,
				},
				{
					id: "review",
					label: "Codex · Review",
					items: [{ spaceId: "b", title: "Audit" }],
					isLoading: false,
					isError: false,
				},
			]}
			onSelect={onSelect}
			title="Plan"
		/>
	);
	fireEvent.click(screen.getByRole("button", { name: "Open chats" }));
	expect(await screen.findByText("Codex · Review")).toBeTruthy();
	expect(
		screen.getByRole("menuitem", { name: PLAN }).getAttribute("aria-current")
	).toBe("page");
	fireEvent.click(screen.getByRole("menuitem", { name: AUDIT }));
	expect(onSelect).toHaveBeenCalledWith("b");
});
