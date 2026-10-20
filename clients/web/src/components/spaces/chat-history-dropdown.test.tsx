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

it("shows chat status on the title and on every chat, with full-width rows", async () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
	);
	render(
		<ChatHistoryDropdown
			ariaLabel="Open chats"
			currentSpaceId="a"
			groups={[
				{
					id: "default",
					label: "Codex",
					items: [
						{ spaceId: "a", title: "Plan" },
						{
							spaceId: "b",
							title: "Audit",
							status: <span data-testid="audit-status" />,
							statusLabel: "Codex needs your input",
						},
					],
					isLoading: false,
					isError: false,
				},
			]}
			onNewChat={vi.fn()}
			onSelect={vi.fn()}
			title="Plan"
			titleStatus={<span data-testid="title-status" />}
		/>
	);
	const trigger = screen.getByRole("button", { name: "Open chats" });
	// The title's status is part of the trigger, so it opens the chat list.
	expect(trigger.contains(screen.getByTestId("title-status"))).toBe(true);
	fireEvent.click(trigger);
	const audit = await screen.findByRole("menuitem", {
		name: "Audit, Codex needs your input",
	});
	expect(audit.contains(screen.getByTestId("audit-status"))).toBe(true);
	// Chats sit inside group wrappers; they must still fill the row like New chat.
	for (const item of screen.getAllByRole("menuitem")) {
		expect(item.className).toContain("w-full");
	}
});

it("lists chats flat without a header, each naming its Profile", async () => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
	);
	render(
		<ChatHistoryDropdown
			ariaLabel="Open chats"
			currentSpaceId="a"
			groups={[
				{
					id: "chats",
					items: [
						{ spaceId: "b", title: "Audit", detail: "Review" },
						{ spaceId: "a", title: "Plan", detail: "Codex" },
					],
					isLoading: false,
					isError: false,
				},
			]}
			onSelect={vi.fn()}
			title="Plan"
		/>
	);
	fireEvent.click(screen.getByRole("button", { name: "Open chats" }));
	const items = await screen.findAllByRole("menuitem");
	expect(items.map((item) => item.textContent)).toEqual([
		"AuditReview",
		"PlanCodexCurrent",
	]);
	expect(screen.queryByText("Chat history")).toBeNull();
});
