import type { ListCenterAgentSessionsResponse } from "@openmeld/schemas";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CenterAgentChatHistory } from "./center-agent-chat-history";

const { listSessions, navigate } = vi.hoisted(() => ({
	listSessions: vi.fn(),
	navigate: vi.fn(),
}));
vi.mock("@openmeld/api-client", async (original) => ({
	...(await original<typeof import("@openmeld/api-client")>()),
	createCenterAgentApi: () => ({ listSessions }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("#/lib/openmeld-api/client", () => ({
	createOrganizationScopedWebOpenMeldApiFoundation: () => ({}),
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org-1", slug: "acme" },
	}),
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human-1" },
	}),
}));
vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: {
			chats: { titles: { older: "Saved launch plan" }, archivedIds: ["older"] },
		},
	}),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	vi.unstubAllGlobals();
});

it.each([
	undefined,
	"recent",
])("searches every page and selects an archived personal title from %s", async (spaceId) => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe = vi.fn();
			unobserve = vi.fn();
			disconnect = vi.fn();
		}
	);
	const page = (
		id: string,
		nextCursor: string | null
	): ListCenterAgentSessionsResponse => ({
		generatedAt: "2026-09-22T00:00:00.000Z",
		organizationId: "org-1",
		nextCursor,
		sessions: [
			{
				organizationId: "org-1",
				spaceId: id,
				centerAgentProfileId: "agent-1",
				memberProfileId: "human-1",
				kind: "center_agent_direct_message_space",
				isCenterAgentDirectMessageSpace: true,
				name: "Automatic title",
				createdAt: null,
			},
		],
	});
	listSessions.mockImplementation(({ cursor }) =>
		Promise.resolve(cursor ? page("older", null) : page("recent", "next-page"))
	);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<CenterAgentChatHistory spaceId={spaceId} title="New chat" />
		</QueryClientProvider>
	);
	fireEvent.click(
		screen.getByRole("button", { name: "Open chat history: New chat" }),
		{ detail: 1 }
	);
	await screen.findByRole("menuitem", { name: "Saved launch plan" });
	expect(!!screen.queryByRole("menuitem", { name: "New chat" })).toBe(
		!!spaceId
	);
	const search = screen.getByRole("searchbox", { name: "Search chat history" });
	await waitFor(() => expect(document.activeElement).toBe(search));
	fireEvent.change(search, { target: { value: "saved LAUNCH" } });
	expect(
		screen.queryByRole("menuitem", { name: "Automatic title" })
	).toBeNull();
	fireEvent.keyDown(search, { key: "Enter" });
	await waitFor(() =>
		expect(navigate).toHaveBeenCalledWith({
			to: "/o/acme/chats/center-agent?session=older",
		})
	);
	client.clear();
});
