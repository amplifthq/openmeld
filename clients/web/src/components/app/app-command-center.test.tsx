import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AppCommandCenter } from "./app-command-center";

const navigate = vi.fn();
vi.mock("#/components/spaces/use-conversations", async () => ({
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
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human" },
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => navigate,
	useMatches: ({ select }: { select: (matches: []) => unknown }) => select([]),
}));
vi.mock("next-themes", () => ({
	useTheme: () => ({ resolvedTheme: "light", setTheme: vi.fn() }),
}));
vi.mock("#/components/spaces/new-chat-dialog", () => ({
	NewChatDialog: () => null,
}));
vi.mock("../organizations/center-agent-chat-avatar", () => ({
	CenterAgentChatAvatar: () => <span>Agent</span>,
}));

afterEach(() => {
	cleanup();
	localStorage.clear();
	vi.clearAllMocks();
});
it("finds Spaces and direct-message sessions by their sidebar titles and opens the exact conversation", async () => {
	navigate.mockResolvedValue(undefined);
	render(
		<QueryClientProvider client={new QueryClient()}>
			<TooltipProvider>
				<AppCommandCenter />
			</TooltipProvider>
		</QueryClientProvider>
	);
	fireEvent.keyDown(window, { key: "k", metaKey: true });
	const search = await screen.findByRole("combobox", {
		name: "Search or run a command",
	});
	fireEvent.change(search, { target: { value: "product design" } });
	expect(
		await screen.findByRole("option", { name: "Product design" })
	).toBeTruthy();
	fireEvent.change(search, { target: { value: "launch checklist" } });
	fireEvent.click(
		await screen.findByRole("option", { name: "Launch checklist" })
	);
	expect(navigate).toHaveBeenCalledWith({
		to: "/o/test/chats/center-agent?session=agent",
	});
});
