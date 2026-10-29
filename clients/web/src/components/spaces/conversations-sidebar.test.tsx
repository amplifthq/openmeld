import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { SidebarProvider } from "@openmeld/ui/fluid/sidebar-state";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { ConversationsHome } from "./conversations-home";
import { ConversationsSidebar } from "./conversations-sidebar";

vi.mock("./app-space-shell", () => ({
	SpaceWindowShell: ({ children }: { children: ReactNode }) => (
		<SidebarProvider
			geometry={{ mode: "expanded", width: 352 }}
			onGeometryChange={() => undefined}
			static
			style={{ display: "contents" }}
		>
			{children}
		</SidebarProvider>
	),
}));

const sidebarState = vi.hoisted(() => ({ accountIndexPending: false }));
const navigate = vi.hoisted(() =>
	vi.fn(async (_options: unknown) => undefined)
);
vi.mock("./use-conversations", async () => {
	const { useConversationSidebarFixture } = await import(
		"#/test-support/conversation-sidebar-fixture"
	);
	return {
		useConversations: () => {
			const model = useConversationSidebarFixture();
			return sidebarState.accountIndexPending
				? {
						...model,
						directMessages: {
							...model.directMessages,
							spaces: { ...model.directMessages.spaces, isPending: true },
						},
					}
				: model;
		},
	};
});
vi.mock("#/components/member-agents/member-agent-session-nav", () => ({
	useActiveMemberAgentSessionList: () => null,
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({ defaultHumanProfile: null }),
}));
vi.mock("#/lib/organizations/organization-context", () => {
	const organization = {
		currentUserId: "viewer",
		currentOrganization: { id: "org", slug: "test" },
	};
	return {
		useAppOrganization: () => organization,
		useOptionalAppOrganization: () => organization,
	};
});
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	useLocation: ({
		select,
	}: {
		select: (location: { href: string }) => unknown;
	}) => select({ href: "/o/acme/spaces" }),
	Link: ({
		to,
		search,
		hash,
		children,
		resetScroll: _resetScroll,
		...props
	}: {
		to: string;
		search?: Record<string, string>;
		hash?: string;
		children: ReactNode;
		resetScroll?: boolean;
	}) => {
		const href = new URL(to, "https://openmeld.invalid");
		for (const [key, value] of Object.entries(search ?? {})) {
			href.searchParams.set(key, value);
		}
		if (hash) {
			href.hash = hash;
		}
		return (
			<a href={`${href.pathname}${href.search}${href.hash}`} {...props}>
				{children}
			</a>
		);
	},
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

afterEach(() => {
	cleanup();
	localStorage.clear();
	sidebarState.accountIndexPending = false;
	navigate.mockClear();
	vi.useRealTimers();
});
function mount(home = false) {
	return render(
		<QueryClientProvider client={new QueryClient()}>
			<TooltipProvider>
				{home ? <ConversationsHome /> : <ConversationsSidebar />}
				<textarea aria-label="Message draft" defaultValue="Unsent work" />
			</TooltipProvider>
		</QueryClientProvider>
	);
}

it("opens the home list with Spaces and direct messages together, searchable without opening a menu", () => {
	mount(true);
	expect(
		screen.getByRole("heading", { name: "Pick a conversation" })
	).toBeTruthy();
	const recent = screen.getByRole("region", { name: "Recent" });
	expect(
		within(recent)
			.getByRole("link", { name: "Product design" })
			.getAttribute("href")
	).toBe("/o/test/spaces/design");
	expect(
		within(recent)
			.getByRole("link", { name: "Launch checklist" })
			.getAttribute("href")
	).toBe("/o/test/chats/center-agent?session=agent");
	expect(
		screen.getByRole("link", { name: "Browse Spaces" }).getAttribute("href")
	).toBe("/o/test/spaces?view=spaces");
	const search = screen.getByRole("searchbox", {
		name: "Search conversations",
	});
	expect(document.activeElement).not.toBe(search);
	fireEvent.change(search, { target: { value: "Felix" } });
	expect(screen.queryByRole("link", { name: "Product design" })).toBeNull();
	expect(screen.getByRole("link", { name: "Felix" })).toBeTruthy();
	fireEvent.keyDown(search, { key: "Escape" });
	expect(screen.getByRole("link", { name: "Product design" })).toBeTruthy();
});
async function selectView(name: "Grouped" | "Recent") {
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Conversation view" })
	);
	fireEvent.click(await screen.findByRole("menuitemradio", { name }));
}

it("shows previews by default and remembers an explicit choice after remount", async () => {
	const first = mount();
	const previewName =
		"Open preview message in Product design: The release plan is ready to review.";
	expect(await screen.findByRole("link", { name: previewName })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	const defaultToggle = await screen.findByRole("menuitemcheckbox", {
		name: "Show message previews",
	});
	expect(defaultToggle.getAttribute("aria-checked")).toBe("true");
	fireEvent.click(defaultToggle);
	expect(screen.queryByRole("link", { name: previewName })).toBeNull();
	first.unmount();
	// A saved "hidden" stays hidden.
	const hidden = mount();
	expect(screen.queryByRole("link", { name: previewName })).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	fireEvent.click(
		await screen.findByRole("menuitemcheckbox", {
			name: "Show message previews",
		})
	);
	expect(await screen.findByRole("link", { name: previewName })).toBeTruthy();
	expect(screen.getByRole("link", { name: "Release planning" })).toBeTruthy();
	expect(
		screen.getByRole("link", {
			name: "Open preview message in Release planning: The release plan is ready to review.",
		})
	).toBeTruthy();
	hidden.unmount();
	const remounted = mount();
	expect(await screen.findByRole("link", { name: previewName })).toBeTruthy();
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	const toggle = await screen.findByRole("menuitemcheckbox", {
		name: "Show message previews",
	});
	expect(toggle.getAttribute("aria-checked")).toBe("true");
	fireEvent.click(toggle);
	expect(screen.queryByRole("link", { name: previewName })).toBeNull();
	remounted.unmount();
	mount();
	expect(screen.queryByRole("link", { name: previewName })).toBeNull();
});

it("refreshes row timestamps across midnight and when the window regains focus", () => {
	vi.useFakeTimers();
	const messageDate = new Date(100);
	vi.setSystemTime(
		new Date(
			messageDate.getFullYear(),
			messageDate.getMonth(),
			messageDate.getDate(),
			23,
			59,
			30
		)
	);
	mount();
	const link = screen.getByRole("link", { name: "Product design" });
	const time = link.parentElement?.querySelector("time");
	expect(time?.getAttribute("datetime")).toBe(messageDate.toISOString());
	expect(time?.classList.contains("hidden")).toBe(false);
	act(() => vi.advanceTimersByTime(60_000));
	expect(time?.textContent).toBe("Yesterday");
	expect(time?.classList.contains("hidden")).toBe(true);
	vi.setSystemTime(
		new Date(
			messageDate.getFullYear(),
			messageDate.getMonth(),
			messageDate.getDate() + 2
		)
	);
	fireEvent.focus(window);
	expect(time?.textContent).toBe("2 days ago");
});

it("shows Spaces and Direct messages together and keeps the current draft when switching", async () => {
	mount();
	expect(screen.getByRole("region", { name: "Recent" })).toBeTruthy();
	await selectView("Grouped");
	expect(screen.getByRole("region", { name: "Spaces" })).toBeTruthy();
	expect(screen.getByRole("region", { name: "Direct messages" })).toBeTruthy();
	const pinned = screen.getByRole("region", { name: "Pinned" });
	expect(
		within(pinned)
			.getAllByRole("link")
			.filter((link) => !link.getAttribute("href")?.includes("focusSignalId"))
			.map((link) => link.getAttribute("aria-label"))
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
			.filter((link) => !link.getAttribute("href")?.includes("focusSignalId"))
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
		within(screen.getByRole("region", { name: "Pinned" }))
			.getAllByRole("link")
			.filter((link) => !link.getAttribute("href")?.includes("focusSignalId"))
	).toHaveLength(2);
});

it("does not present session-only discovery as a complete conversation list", () => {
	sidebarState.accountIndexPending = true;
	mount();
	expect(screen.queryByRole("link", { name: "Launch checklist" })).toBeNull();
	expect(screen.queryByRole("link", { name: "Product design" })).toBeNull();
	expect(screen.queryByText("No matching conversations")).toBeNull();
});
it("searches both types and applies the nested conversation filter", async () => {
	mount();
	expect(
		screen.queryByRole("searchbox", { name: "Search conversations" })
	).toBeNull();
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "Search" }));
	let search = screen.getByRole("searchbox", {
		name: "Search conversations",
	});
	await waitFor(() => expect(document.activeElement).toBe(search));
	fireEvent.change(search, { target: { value: "No match" } });
	fireEvent.click(screen.getByRole("button", { name: "Close search" }));
	expect(
		screen.queryByRole("searchbox", { name: "Search conversations" })
	).toBeNull();
	expect(document.activeElement).toBe(
		screen.getByRole("button", { name: "View and filters" })
	);
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "Search" }));
	search = screen.getByRole("searchbox", { name: "Search conversations" });
	expect(search).toHaveProperty("value", "");
	await waitFor(() => expect(document.activeElement).toBe(search));
	expect(search.getAttribute("placeholder")).toBe("Find a space...");
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
	fireEvent.change(search, { target: { value: "" } });
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	fireEvent.click(
		await screen.findByRole("menuitem", { name: "Filter conversations" })
	);
	fireEvent.click(
		await screen.findByRole("menuitemcheckbox", { name: "Spaces" })
	);
	expect(screen.getByRole("link", { name: "Product design" })).toBeTruthy();
	expect(screen.queryByRole("link", { name: "Launch checklist" })).toBeNull();
});
it("keeps the Spaces directory reachable in both views and carries an unmatched search into the organization picker", async () => {
	mount();
	expect(
		screen.getByRole("link", { name: "Spaces" }).getAttribute("href")
	).toBe("/o/test/spaces");
	for (const view of ["Grouped", "Recent"] as const) {
		await selectView(view);
		expect(screen.queryByRole("link", { name: "Browse spaces" })).toBeNull();
	}
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "Search" }));
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
	fireEvent.click(await screen.findByRole("menuitem", { name: "New Space" }));
	expect(navigate).toHaveBeenCalledWith({ to: "/o/test/new-space" });
	fireEvent.click(screen.getByRole("button", { name: "New conversation" }));
	fireEvent.click(screen.getByRole("menuitem", { name: "New message" }));
	expect(
		screen.getByRole("textbox", { name: "Search people and agents" })
	).toHaveProperty("value", "");
});
it("prepends new pins without changing existing order across views", async () => {
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
		within(screen.getByRole("region", { name: "Pinned" }))
			.getAllByRole("link")
			.filter((link) => !link.getAttribute("href")?.includes("focusSignalId"))
			.map((link) => link.getAttribute("aria-label"))
	).toEqual([
		expect.stringContaining("Product design"),
		expect.stringContaining("Release planning"),
		expect.stringContaining("Felix"),
	]);
	fireEvent.click(screen.getByRole("button", { name: "View and filters" }));
	fireEvent.click(await screen.findByRole("menuitem", { name: "Search" }));
	fireEvent.change(
		screen.getByRole("searchbox", { name: "Search conversations" }),
		{
			target: { value: "Launch" },
		}
	);
	fireEvent.click(screen.getByRole("button", { name: "Pin Launch checklist" }));
	fireEvent.click(screen.getByRole("button", { name: "Close search" }));
	await waitFor(() =>
		expect(
			within(screen.getByRole("region", { name: "Pinned" }))
				.getAllByRole("link")
				.filter((link) => !link.getAttribute("href")?.includes("focusSignalId"))
				.map((link) => link.getAttribute("aria-label"))
		).toEqual([
			expect.stringContaining("Launch checklist"),
			expect.stringContaining("Product design"),
			expect.stringContaining("Release planning"),
			expect.stringContaining("Felix"),
		])
	);
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
