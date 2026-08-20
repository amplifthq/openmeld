import type { OrganizationDirectoryResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { AgentProfileCreationRequestsPanel } from "./agent-profile-creation-requests-panel";

const listRequestsMock = vi.hoisted(() => vi.fn());
const decideRequestMock = vi.hoisted(() => vi.fn());
const cancelRequestMock = vi.hoisted(() => vi.fn());
const INCOMING_REQUEST_SUMMARY =
	/Alex requested this for You via the Center Agent/;
const OUTGOING_REQUEST_SUMMARY = /You requested this for Alex via Web/;

vi.mock("#/lib/profiles/agent-profile-creation-requests", () => ({
	cancelAgentProfileCreationRequest: cancelRequestMock,
	createAgentProfileCreationRequest: vi.fn(),
	decideAgentProfileCreationRequest: decideRequestMock,
	listAgentProfileCreationRequests: listRequestsMock,
	retryAgentProfileCreationRequest: vi.fn(),
}));

const BASE_REQUEST = {
	actorProfileId: "profile-alex",
	completedAt: null,
	createdAgentProfileId: null,
	createdAt: "2026-08-20T00:00:00.000Z",
	decidedAt: null,
	id: "request-incoming",
	nativeSessionId: null,
	organizationId: "org-1",
	profileName: "Release Reviewer",
	requestedSpaceId: null,
	requesterUserId: "user-alex",
	sessionStrategy: "new" as const,
	source: "center_agent" as const,
	status: "pending" as const,
	statusReason: "approval_required" as const,
	targetOwnerUserId: "user-felix",
	updatedAt: "2026-08-20T00:00:00.000Z",
};

describe("AgentProfileCreationRequestsPanel", () => {
	beforeEach(() => {
		listRequestsMock.mockReset().mockResolvedValue({
			organizationId: "org-1",
			requests: [
				BASE_REQUEST,
				{
					...BASE_REQUEST,
					actorProfileId: "profile-felix",
					id: "request-outgoing",
					profileName: "Docs Editor",
					requesterUserId: "user-felix",
					source: "web",
					targetOwnerUserId: "user-alex",
				},
			],
		});
		decideRequestMock.mockReset().mockResolvedValue({
			request: { ...BASE_REQUEST, status: "completed" },
		});
		cancelRequestMock.mockReset().mockResolvedValue({
			request: { ...BASE_REQUEST, status: "cancelled" },
		});
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("shows request origin and exposes only the participant's valid actions", async () => {
		renderPanel();

		expect(await screen.findByText("Release Reviewer")).toBeTruthy();
		expect(screen.getByText(INCOMING_REQUEST_SUMMARY)).toBeTruthy();
		expect(screen.getByText(OUTGOING_REQUEST_SUMMARY)).toBeTruthy();

		fireEvent.click(screen.getByRole("button", { name: "Approve" }));
		await waitFor(() => {
			expect(decideRequestMock).toHaveBeenCalledWith({
				decision: "approve",
				organizationId: "org-1",
				requestId: "request-incoming",
			});
		});

		fireEvent.click(screen.getByRole("button", { name: "Cancel request" }));
		await waitFor(() => {
			expect(cancelRequestMock).toHaveBeenCalledWith({
				organizationId: "org-1",
				requestId: "request-outgoing",
			});
		});
	});

	it("refreshes Agents when setup fails after creating the Profile", async () => {
		decideRequestMock.mockResolvedValueOnce({
			request: {
				...BASE_REQUEST,
				createdAgentProfileId: "agent-created-before-setup-failed",
				failureMessage: "The selected Computer is no longer reachable.",
				status: "failed",
				statusReason: "profile_creation_failed",
			},
		});
		const { queryClient } = renderPanel();
		const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");

		fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

		await waitFor(() => {
			expect(invalidateQueries).toHaveBeenCalledWith({
				queryKey: organizationQueryKeys.directory("org-1"),
			});
		});
	});
});

function renderPanel() {
	const queryClient = new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
	const rendered = render(
		<QueryClientProvider client={queryClient}>
			<AgentProfileCreationRequestsPanel
				currentUserId="user-felix"
				directory={DIRECTORY}
				focusRequestId={null}
				onCreateAgent={vi.fn()}
				onOpenAgent={vi.fn()}
				organizationId="org-1"
			/>
		</QueryClientProvider>
	);
	return { ...rendered, queryClient };
}

const DIRECTORY: OrganizationDirectoryResponse = {
	agentProfiles: [],
	generatedAt: "2026-08-20T00:00:00.000Z",
	members: [
		{
			humanProfile: {
				profileHandle: "felix",
				profileId: "11111111-1111-4111-8111-111111111111",
				profileName: "Felix",
				status: "active",
			},
			joinedAt: "2026-08-20T00:00:00.000Z",
			memberId: "member-felix",
			organizationId: "org-1",
			role: "owner",
			user: {
				email: "felix@example.com",
				id: "user-felix",
				image: null,
				name: "Felix",
			},
			userId: "user-felix",
		},
		{
			humanProfile: {
				profileHandle: "alex",
				profileId: "22222222-2222-4222-8222-222222222222",
				profileName: "Alex",
				status: "active",
			},
			joinedAt: "2026-08-20T00:00:00.000Z",
			memberId: "member-alex",
			organizationId: "org-1",
			role: "member",
			user: {
				email: "alex@example.com",
				id: "user-alex",
				image: null,
				name: "Alex",
			},
			userId: "user-alex",
		},
	],
	organizationId: "org-1",
};
