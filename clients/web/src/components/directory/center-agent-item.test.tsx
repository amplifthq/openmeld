import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { cleanup, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { centerAgentQueryKeys } from "#/query/organizations/center-agent";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { CenterAgentItem } from "./center-agent-item";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, ...props }: ComponentProps<"a">) => (
		<a {...props}>{children}</a>
	),
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org-acme", name: "Acme", slug: "acme" },
	}),
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
});

it.each([
	{ presentation: "sidebar", avatarStyle: "star", interactive: false },
	{ presentation: "card", avatarStyle: "star", interactive: true },
	{ presentation: "card", avatarStyle: "fluid", interactive: false },
	{ presentation: "card", avatarStyle: "automatic", interactive: false },
] as const)("renders $presentation/$avatarStyle from cached identity with an independent avatar action only for a Bot card", ({
	presentation,
	avatarStyle,
	interactive,
}) => {
	vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
	const queryClient = createTestQueryClient();
	const directory: OrganizationProfileDirectoryResponse = {
		organizationId: "org-acme",
		generatedAt: "2026-09-10T00:00:00.000Z",
		members: [],
		agentProfiles: [
			{
				agentControllerRef: null,
				avatarStyle,
				createdAt: "2026-09-10T00:00:00.000Z",
				createdByUserId: "user-owner",
				creatorProfileId: null,
				isDefault: false,
				isCenterAgent: true,
				lastUsedAt: null,
				managedRole: "center_agent",
				organizationId: "org-acme",
				ownerUserId: null,
				profileHandle: "workspace-assistant",
				profileId: "agt_11111111-1111-4111-8111-111111111111",
				profileKind: "agent",
				profileName: "Workspace assistant",
				source: "cli_create",
				status: "active",
				updatedAt: "2026-09-10T00:00:00.000Z",
			},
		],
	};
	queryClient.setQueryData(
		organizationQueryKeys.profileDirectory("org-acme"),
		directory
	);
	queryClient.setQueryData(centerAgentQueryKeys.designation("org-acme"), {
		designation: {
			agentProfileId: directory.agentProfiles[0]?.profileId,
			createdAt: directory.generatedAt,
			designatedBy: "user-owner",
			duty: null,
			organizationId: "org-acme",
		},
		organizationId: "org-acme",
		remoteRuntimeAvailability: { selectable: true },
	});

	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<CenterAgentItem presentation={presentation} />
		</TestQueryClientProvider>
	);

	const navigation = screen.getByLabelText("Open Workspace assistant");
	const animation = screen.queryByLabelText(
		"Animate Workspace assistant's avatar"
	);
	expect(navigation).toBeTruthy();
	if (interactive) {
		expect(animation?.tagName).toBe("BUTTON");
		expect(navigation.contains(animation)).toBe(false);
	} else {
		expect(animation).toBeNull();
		expect(navigation.querySelector("[data-avatar-style]")).toBeTruthy();
	}
	expect(
		queryClient.getQueryState(organizationQueryKeys.directory("org-acme"))
	).toBeUndefined();
	expect(
		queryClient.getQueryState(
			organizationQueryKeys.agentRuntimeOverview("org-acme")
		)
	).toBeUndefined();
	queryClient.clear();
});

it("shows a refreshing Center Agent read as loading, never as unavailable", () => {
	// The cached designation predates the Center Agent; the refresh is pending.
	vi.spyOn(globalThis, "fetch").mockImplementation(
		() => new Promise<Response>(() => undefined)
	);
	const queryClient = createTestQueryClient();
	queryClient.setQueryData(organizationQueryKeys.profileDirectory("org-acme"), {
		organizationId: "org-acme",
		generatedAt: "2026-09-10T00:00:00.000Z",
		members: [],
		agentProfiles: [],
	} satisfies OrganizationProfileDirectoryResponse);
	queryClient.setQueryData(centerAgentQueryKeys.designation("org-acme"), {
		designation: null,
		organizationId: "org-acme",
		remoteRuntimeAvailability: { selectable: true },
	});
	queryClient.invalidateQueries();

	render(
		<TestQueryClientProvider queryClient={queryClient}>
			<CenterAgentItem presentation="card" />
		</TestQueryClientProvider>
	);

	expect(screen.queryByText("Center Agent unavailable")).toBeNull();
	expect(screen.getByLabelText("Loading Center Agent")).toBeTruthy();
	queryClient.clear();
});
