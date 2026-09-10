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

afterEach(cleanup);

it.each([
	"sidebar",
	"card",
] as const)("renders the %s entry from cached identity without starting a runtime directory read", (presentation) => {
	const queryClient = createTestQueryClient();
	const directory: OrganizationProfileDirectoryResponse = {
		organizationId: "org-acme",
		generatedAt: "2026-09-10T00:00:00.000Z",
		members: [],
		agentProfiles: [
			{
				agentControllerRef: null,
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

	expect(screen.getByLabelText("Open Workspace assistant")).toBeTruthy();
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
