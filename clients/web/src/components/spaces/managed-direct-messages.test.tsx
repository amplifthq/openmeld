import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountSpaceItem } from "#/lib/spaces/account-spaces";
import { ManagedDirectMessages } from "./managed-direct-messages";

const state = vi.hoisted(() => ({
	load: vi.fn<() => Promise<{ timestamp: number; text: string } | null>>(),
	preferencesPending: false,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({ currentOrganization: { id: "org" } }),
}));
vi.mock("../app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: {
			messages: {
				pinned: { sort: "recent", spaceIds: [] },
				spaces: { sort: "recent", spaceIds: [] },
				groups: [],
			},
		},
		isPending: state.preferencesPending,
		isError: false,
		disabled: false,
	}),
}));
vi.mock("./use-account-space-indicators", () => ({
	useAccountSpaceIndicators: () => ({
		activeWakeSpaceIds: new Set(),
		unreadBySpaceId: new Map(),
	}),
}));
vi.mock("./use-account-space-pin-mutation", () => ({
	useAccountSpacePinMutation: () => ({ arePinActionsPending: false }),
}));
vi.mock("./direct-message-preview", () => ({
	spaceMessagePreviewQueryOptions: ({ spaceId }: { spaceId: string }) => ({
		queryKey: ["preview", spaceId],
		queryFn: state.load,
	}),
}));
vi.mock("../app/sidebar-drag", () => ({
	SidebarDrag: ({ children }: { children: ReactNode }) => children,
	SidebarDropSection: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("../app/app-sidebar-group", () => ({
	AppSidebarGroup: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./new-direct-message-dialog", () => ({
	NewDirectMessageDialog: () => null,
}));

const items: AccountSpaceItem[] = ["older", "newer"].map((spaceId, index) => ({
	spaceId,
	spaceName: spaceId,
	organizationId: "org",
	openProfileId: "viewer",
	openProfileName: "Viewer",
	joinedProfiles: [],
	lastJoinedAt: "2026-09-01",
	pinnedAt: null,
	pinnedProfileIds: [],
	visibility: "private",
	spacePurpose: "direct_message",
	activeAgentCount: null,
	activeHumanCount: null,
	activeMemberCount: null,
	spaceCreatedAt: `2026-09-0${index + 1}`,
}));
const clients: QueryClient[] = [];
function setup() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	const onFirstChatChange = vi.fn();
	render(
		<QueryClientProvider client={client}>
			<ManagedDirectMessages
				currentProfileId="viewer"
				currentSpaceId=""
				embedded
				items={items}
				onFirstChatChange={onFirstChatChange}
				renderRow={({ item }) => (
					<a href={`/chats/${item.spaceId}`} key={item.spaceId}>
						{item.spaceName}
					</a>
				)}
			/>
		</QueryClientProvider>
	);
	return { client, onFirstChatChange };
}
afterEach(() => {
	cleanup();
	for (const client of clients.splice(0)) {
		client.clear();
	}
	state.load.mockReset();
	state.preferencesPending = false;
});

describe("conversation list readiness", () => {
	it("shows navigable rows while activity is pending, then applies the resolved order", async () => {
		let finish!: (value: { timestamp: number; text: string }) => void;
		state.load.mockImplementation(
			() =>
				new Promise((resolve) => {
					finish = resolve;
				})
		);
		const { client, onFirstChatChange } = setup();
		expect(
			screen.getByRole("link", { name: "older" }).getAttribute("href")
		).toBe("/chats/older");
		expect(screen.getByRole("link", { name: "newer" })).toBeTruthy();
		expect(screen.queryByText("Loading chats")).toBeNull();
		expect(onFirstChatChange).toHaveBeenLastCalledWith(undefined);
		act(() => {
			finish({ timestamp: 1, text: "Message" });
			client.setQueryData(["preview", "older"], {
				timestamp: 2,
				text: "More recent",
			});
		});
		await waitFor(() =>
			expect(onFirstChatChange).toHaveBeenLastCalledWith(items[0])
		);
		expect(screen.getAllByRole("link").map((row) => row.textContent)).toEqual([
			"older",
			"newer",
		]);
	});
	it("keeps known chats available when activity requests fail", async () => {
		state.load.mockRejectedValue(new Error("Preview unavailable"));
		const { client } = setup();
		await waitFor(() =>
			expect(client.getQueryState(["preview", "older"])?.status).toBe("error")
		);
		expect(screen.getAllByRole("link")).toHaveLength(2);
		expect(screen.queryByText("Retry loading sidebar")).toBeNull();
	});
	it("keeps rows visible during a background refresh with cached activity", async () => {
		state.load.mockResolvedValue({ timestamp: 1, text: "Cached message" });
		const { client } = setup();
		await waitFor(() => expect(client.isFetching()).toBe(0));
		state.load.mockImplementation(
			() =>
				new Promise(() => {
					/* Deliberately pending. */
				})
		);
		act(() => {
			client.invalidateQueries({ queryKey: ["preview"] });
		});
		expect(client.isFetching()).toBe(2);
		expect(screen.getAllByRole("link")).toHaveLength(2);
	});
	it("still waits for sidebar preferences before exposing its groups", () => {
		state.preferencesPending = true;
		state.load.mockImplementation(
			() =>
				new Promise(() => {
					/* Deliberately pending. */
				})
		);
		setup();
		expect(screen.getByText("Loading chats")).toBeTruthy();
		expect(screen.queryAllByRole("link")).toHaveLength(0);
	});
});
