import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationsSidebar } from "./conversations-sidebar";

vi.mock("./use-conversations", async () => ({
	useConversations: (
		await import("#/test-support/conversation-sidebar-fixture")
	).useConversationSidebarFixture,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentUserId: "viewer",
		currentOrganization: { id: "org", slug: "test" },
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({
		to,
		children,
		resetScroll: _resetScroll,
		...props
	}: {
		to: string;
		children: ReactNode;
		resetScroll?: boolean;
	}) => (
		<a href={to} {...props}>
			{children}
		</a>
	),
}));
vi.mock("./new-chat-dialog", () => ({
	NewChatDialog: ({
		initialQuery,
		onOpenChange,
	}: {
		initialQuery: string;
		onOpenChange: (open: boolean) => void;
	}) => (
		<div aria-label="New message" role="dialog">
			<input
				aria-label="Search people and agents"
				defaultValue={initialQuery}
			/>
			<button onClick={() => onOpenChange(false)} type="button">
				Close picker
			</button>
		</div>
	),
}));
vi.mock("../organizations/center-agent-chat-avatar", () => ({
	CenterAgentChatAvatar: () => <span>Agent</span>,
}));
vi.mock("./direct-message-preview", async (importOriginal) => ({
	...(await importOriginal<typeof import("./direct-message-preview")>()),
	useSpaceMessagePreview: () => ({
		data: { timestamp: 200, text: "Latest conversation message" },
		isPending: false,
		isError: false,
	}),
}));

afterEach(() => {
	cleanup();
	localStorage.clear();
});
function mount() {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<TooltipProvider>
				<ConversationsSidebar />
				<textarea aria-label="Message draft" defaultValue="Unsent work" />
			</TooltipProvider>
		</QueryClientProvider>
	);
}
async function selectView(name: "Grouped" | "Recent") {
	fireEvent.click(screen.getByRole("button", { name: "Conversation view" }));
	fireEvent.click(await screen.findByRole("menuitemradio", { name }));
}

it("shows Spaces and Direct messages together and keeps the current draft when switching", async () => {
	mount();
	expect(screen.getByRole("region", { name: "Spaces" })).toBeTruthy();
	expect(screen.getByRole("region", { name: "Direct messages" })).toBeTruthy();
	const pinned = screen.getByRole("region", { name: "Pinned" });
	expect(
		within(pinned)
			.getAllByRole("link")
			.map((link) => link.textContent)
	).toEqual([
		expect.stringContaining("Release planning"),
		expect.stringContaining("Felix"),
	]);
	fireEvent.change(screen.getByRole("textbox", { name: "Message draft" }), {
		target: { value: "Keep this unsent draft" },
	});
	await selectView("Recent");
	expect(
		within(screen.getByRole("region", { name: "Recent" }))
			.getAllByRole("link")
			.map((link) => link.getAttribute("href"))
	).toEqual([
		"/o/test/chats/center-agent?session=agent",
		"/o/test/spaces/design",
	]);
	expect(screen.getByRole("textbox", { name: "Message draft" })).toHaveProperty(
		"value",
		"Keep this unsent draft"
	);
	await selectView("Grouped");
	expect(
		within(screen.getByRole("region", { name: "Pinned" })).getAllByRole("link")
	).toHaveLength(2);
});
it("searches both types and retains canonical session destinations", () => {
	mount();
	const search = screen.getByRole("searchbox", {
		name: "Search conversations",
	});
	fireEvent.change(search, { target: { value: "product" } });
	expect(
		screen.getByRole("link", { name: "Product design" }).getAttribute("href")
	).toBe("/o/test/spaces/design");
	fireEvent.change(search, { target: { value: "checklist" } });
	expect(
		screen.getByRole("link", { name: "Launch checklist" }).getAttribute("href")
	).toBe("/o/test/chats/center-agent?session=agent");
	fireEvent.change(search, { target: { value: "missing" } });
	expect(
		screen.getByText("No conversations match your search or filters.")
	).toBeTruthy();
});
it("keeps discovery visible in both views and carries an unmatched search into the organization picker", async () => {
	mount();
	expect(
		screen.getByRole("link", { name: "Spaces" }).getAttribute("href")
	).toBe("/o/test/chats");
	for (const view of ["Grouped", "Recent"] as const) {
		await selectView(view);
		expect(
			screen.getByRole("link", { name: "Browse spaces" }).getAttribute("href")
		).toBe("/o/test/spaces");
	}
	fireEvent.change(
		screen.getByRole("searchbox", { name: "Search conversations" }),
		{ target: { value: "Unfamiliar teammate" } }
	);
	fireEvent.click(screen.getByRole("button", { name: "Find someone" }));
	expect(
		screen.getByRole("textbox", { name: "Search people and agents" })
	).toHaveProperty("value", "Unfamiliar teammate");
	fireEvent.click(screen.getByRole("button", { name: "Close picker" }));
	fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
	expect(
		(await screen.findByRole("menuitem", { name: "New Space" })).getAttribute(
			"href"
		)
	).toBe("/o/test/new-space");
	fireEvent.click(screen.getByRole("menuitem", { name: "New message" }));
	expect(
		screen.getByRole("textbox", { name: "Search people and agents" })
	).toHaveProperty("value", "");
});
it("pins a Space in Recent and retains its position after switching", async () => {
	mount();
	await selectView("Recent");
	fireEvent.click(screen.getByRole("button", { name: "Pin Product design" }));
	await waitFor(() =>
		expect(
			within(screen.getByRole("region", { name: "Pinned" })).getByRole("link", {
				name: "Product design",
			})
		).toBeTruthy()
	);
	await selectView("Grouped");
	expect(
		within(screen.getByRole("region", { name: "Pinned" })).getAllByRole("link")
	).toHaveLength(3);
});
it("does not offer direct-message rename or archive actions on Spaces", async () => {
	mount();
	fireEvent.click(
		screen.getByRole("button", { name: "Actions for Product design" })
	);
	await screen.findByRole("menu");
	expect(screen.queryByRole("menuitem", { name: "Rename" })).toBeNull();
	expect(screen.queryByRole("menuitem", { name: "Archive" })).toBeNull();
	expect(
		screen.queryByRole("menuitem", { name: "Move to Direct messages" })
	).toBeNull();
});
