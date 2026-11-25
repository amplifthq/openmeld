import type {
	AgentActivitySnapshotResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	type AnyRoute,
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { AppFullWidthLayout } from "#/components/app/app-full-width-layout";
import type { SpaceWindowHeader } from "#/components/spaces/space-header";
import { agentActivityQueryKeys } from "#/query/organizations/agent-activity";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { Route } from "./people";

const organization = vi.hoisted(() => ({
	id: "org-acme",
	slug: "acme",
	name: "Acme",
}));
const currentUserId = "owner-user";
const agentId = "agt_55555555-5555-4555-8555-555555555555";

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: organization,
		currentUserId,
	}),
}));
vi.mock("#/lib/organizations/app-route-prefetch", () => ({
	prefetchPeopleRouteData: async () => undefined,
}));
vi.mock("#/lib/sidebar-width-cookie", () => ({
	getAppSidebarStatesForRoute: async () => undefined,
}));
vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		mainHeader,
	}: ComponentProps<typeof AppFullWidthLayout>) => (
		<main>
			{mainHeader}
			{children}
		</main>
	),
}));
vi.mock("#/components/spaces/space-header", () => ({
	SpaceWindowHeader: ({
		navigation,
		title,
	}: ComponentProps<typeof SpaceWindowHeader>) => (
		<header>
			<h1>{title}</h1>
			{navigation}
		</header>
	),
}));

afterEach(cleanup);

it("opens people and Agents as peers and displays the recorded creator and project summaries", async () => {
	const router = renderTeam();
	const navigation = await screen.findByRole("tablist", { name: "Team view" });
	expect(within(navigation).getAllByRole("tab")).toEqual([
		within(navigation).getByRole("tab", { name: "Members" }),
		within(navigation).getByRole("tab", { name: "Topics" }),
	]);
	const directory = screen.getByRole("complementary", { name: "Team members" });
	const people = within(directory).getByRole("navigation", { name: "People" });
	const agents = within(directory).getByRole("navigation", { name: "Agents" });
	expect(within(people).getByRole("link", { name: "Ari Owner" })).toBeTruthy();
	fireEvent.click(within(people).getByRole("link", { name: "Mira Creator" }));
	await screen.findByRole("heading", { name: "Mira Creator" });
	expect(screen.getByText("Started working")).toBeTruthy();
	expect(screen.queryByText("Private conversation title")).toBeNull();
	fireEvent.change(within(directory).getByRole("searchbox"), {
		target: { value: "issue agent" },
	});
	expect(
		within(directory).queryByRole("navigation", { name: "People" })
	).toBeNull();
	fireEvent.click(within(agents).getByRole("link", { name: "Issue Agent" }));
	await screen.findByRole("heading", { name: "Issue Agent" });
	const creator = screen.getByRole("link", { name: "Mira Creator" });
	expect(creator.getAttribute("href")).toContain("profileId=member");
	expect(creator.parentElement?.textContent).toBe("Created by Mira Creator");
	expect(screen.getByText("Last recorded task activity")).toBeTruthy();
	expect(
		screen.getByRole("link", { name: "Runtime settings" }).getAttribute("href")
	).toContain("#agent-runtime-settings");
	expect(router.state.location.search).toMatchObject({ agentId });
	fireEvent.click(screen.getByRole("tab", { name: "Topics" }));
	expect(
		await screen.findByText("Grouped related reports for the export project.")
	).toBeTruthy();
	expect(
		screen.queryByRole("complementary", { name: "Team members" })
	).toBeNull();
});

function renderTeam() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const now = Date.now();
	const date = new Date(now).toISOString();
	const members: OrganizationProfileDirectoryResponse["members"] = [
		{ id: currentUserId, name: "Ari Owner" },
		{ id: "creator-user", name: "Mira Creator" },
	].map(({ id, name }) => ({
		humanProfile: null,
		joinedAt: date,
		memberId: id,
		organizationId: organization.id,
		role: "member",
		user: { email: `${id}@example.test`, id, image: null, name },
		userId: id,
	}));
	client.setQueryData(organizationQueryKeys.profileDirectory(organization.id), {
		agentProfiles: [
			{
				agentControllerRef: null,
				createdAt: date,
				createdByUserId: "creator-user",
				creatorProfileId: null,
				isDefault: false,
				lastTaskActivityAt: date,
				lastUsedAt: null,
				managedRole: null,
				organizationId: organization.id,
				ownerUserId: currentUserId,
				profileHandle: "issue-agent",
				profileId: agentId,
				profileKind: "agent",
				profileName: "Issue Agent",
				source: "web_create",
				status: "active",
				updatedAt: date,
			},
		],
		generatedAt: date,
		members,
		organizationId: organization.id,
	} satisfies OrganizationProfileDirectoryResponse);
	client.setQueryData(
		organizationQueryKeys.agentRuntimeOverview(organization.id),
		{
			agentProfiles: [],
			generatedAt: date,
			organizationId: organization.id,
		}
	);
	const snapshot = makeSnapshot(now);
	client.setQueryData(
		agentActivityQueryKeys.snapshot(organization.id, {
			memberUserId: currentUserId,
		}),
		{
			...snapshot,
			digests: [],
			recentEvents: [],
		}
	);
	client.setQueryData(
		agentActivityQueryKeys.snapshot(organization.id, {
			memberUserId: "creator-user",
		}),
		{
			...snapshot,
			digests: [],
		}
	);
	client.setQueryData(
		agentActivityQueryKeys.snapshot(organization.id),
		snapshot
	);

	const root = createRootRoute();
	const productionRoute: AnyRoute = Route;
	const team = createRoute({
		...productionRoute.options,
		getParentRoute: () => root,
		path: "/o/$orgSlug/people",
	});
	const router = createRouter({
		history: createMemoryHistory({ initialEntries: ["/o/acme/people"] }),
		routeTree: root.addChildren([team]),
	});
	render(
		<QueryClientProvider client={client}>
			<RouterProvider router={router} />
		</QueryClientProvider>
	);
	return router;
}

function makeSnapshot(now: number): AgentActivitySnapshotResponse {
	return {
		asOfMs: now,
		digests: [
			{
				citations: [{ eventId: "recent-event", observedAtMs: now }],
				createdAtMs: now,
				eventCount: 1,
				failureReason: null,
				id: "recent-digest",
				projectId: "project-active",
				status: "completed",
				summary: "Grouped related reports for the export project.",
				windowEndedAtMs: now,
				windowStartedAtMs: now - 60_000,
			},
		],
		digestsTruncated: false,
		organizationId: organization.id,
		projects: [
			{
				archivedAtMs: null,
				canArchive: false,
				canManage: false,
				createdAtMs: 1,
				createdByUserId: currentUserId,
				id: "project-active",
				name: "Export",
				organizationId: organization.id,
				repositoryFingerprint: null,
				slug: "export",
				updatedAtMs: 1,
			},
		],
		recentEvents: [
			{
				clientKind: "codex-app",
				eventId: "recent-event",
				eventType: "session_active",
				memberName: "Mira Creator",
				memberUserId: "creator-user",
				observedAtMs: now,
				projectId: "project-active",
				provider: "codex",
				status: "active",
				title: "Private conversation title",
			},
		],
		sessions: [],
		sessionsTruncated: false,
		stalenessThresholdMs: 300_000,
	};
}
