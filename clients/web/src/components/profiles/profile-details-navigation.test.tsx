import type { ProfileDetailsSnapshot } from "@openmeld/schemas/types";
import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
	AgentProfileDetailsContent,
	AgentProfileDetailsPopover,
} from "./profile-details-dialog";

describe("profile details navigation", () => {
	it("uses the real Router and preserves the selected profile id", async () => {
		const root = createRootRoute({ component: Outlet });
		const source = createRoute({
			getParentRoute: () => root,
			path: "/o/$orgSlug/spaces/$spaceId",
			component: () => (
				<QueryClientProvider client={new QueryClient()}>
					<AgentProfileDetailsContent
						details={details}
						entry={entry}
						moreDetailsHref="/o/北极/agents?profileId=agent-%E4%B8%AD"
					/>
				</QueryClientProvider>
			),
		});
		const target = createRoute({
			getParentRoute: () => root,
			path: "/o/$orgSlug/agents",
			validateSearch: (search: Record<string, unknown>) => ({
				profileId: String(search.profileId ?? ""),
			}),
			component() {
				const search = target.useSearch();
				return <h1>Agent {search.profileId}</h1>;
			},
		});
		const history = createMemoryHistory({
			initialEntries: ["/o/acme/spaces/space-1"],
		});
		const router = createRouter({
			history,
			routeTree: root.addChildren([source, target]),
		});

		render(<RouterProvider router={router} />);
		fireEvent.click(
			await screen.findByRole("link", { name: "Edit 中文 Agent" })
		);

		await screen.findByRole("heading", { name: "Agent agent-中" });
		expect(router.state.location.pathname).toBe("/o/北极/agents");
		expect(router.state.location.search).toEqual({ profileId: "agent-中" });
		history.back();
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/o/acme/spaces/space-1")
		);
	});

	it("opens Center Agent App settings without losing the Thread or leaving its Organization", async () => {
		const queryClient = new QueryClient();
		const root = createRootRoute({ component: Outlet });
		const organization = createRoute({
			getParentRoute: () => root,
			path: "/o/$orgSlug",
			component: Outlet,
			validateSearch: (search: Record<string, unknown>) => search,
		});
		const source = createRoute({
			getParentRoute: () => organization,
			path: "/spaces/$spaceId",
			component: () => (
				<QueryClientProvider client={queryClient}>
					<AgentProfileDetailsPopover
						details={details}
						entry={{
							...entry,
							agentControllerRef: "hosted:center-agent",
							availabilityCategory: "available",
						}}
						isCenterAgent
						trigger={<button type="button">Open Center Agent Profile</button>}
					/>
				</QueryClientProvider>
			),
		});
		const router = createRouter({
			history: createMemoryHistory({
				initialEntries: [
					"/o/acme/spaces/space-1?focusThreadRootSignalId=root-1",
				],
			}),
			routeTree: root.addChildren([organization.addChildren([source])]),
		});
		render(<RouterProvider router={router} />);
		fireEvent.click(
			await screen.findByRole("button", { name: "Open Center Agent Profile" })
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Open Center Agent settings" })
		);
		await waitFor(() =>
			expect(router.state.location.search).toEqual({
				appSettings: "center-agent",
				focusThreadRootSignalId: "root-1",
			})
		);
		expect(router.state.location.pathname).toBe("/o/acme/spaces/space-1");
		await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
	});
});

const details: ProfileDetailsSnapshot = {
	context: "space",
	profileId: "agent-中",
	profileKind: "agent",
	profileName: "中文 Agent",
	sections: [],
	viewerScope: "owner_self",
};

const entry = {
	addedByDisplayName: null,
	addedByProfileId: null,
	avatarUrl: null,
	agentControllerConversationId: null,
	agentControllerPermissionMode: null,
	agentControllerRef: "builtin:codex",
	availabilityAction: null,
	availabilityBadgeLabel: null,
	availabilityCategory: null,
	availabilityIsRefreshing: false,
	availabilityPhase: null,
	availabilityReasonCode: null,
	availabilitySummary: null,
	availabilityTooltip: null,
	controllerDisplayName: "Codex",
	id: "agent-中",
	lastSeenLabel: null,
	liveNow: false,
	manualParticipationOnly: false,
	mentionLabel: "@中文 Agent",
	modelSelection: null,
	ownerDisplay: null,
	ownerName: null,
	ownerUserId: "user-1",
	presenceLabel: "Ready",
	presenceStatus: "wakeable",
	profileId: "agent-中",
	profileKind: "agent",
	profileName: "中文 Agent",
	runtimeDeviceDisplayName: null,
	searchText: "中文 Agent",
	workingDirectory: null,
} satisfies SpaceMemberDirectoryEntry;
