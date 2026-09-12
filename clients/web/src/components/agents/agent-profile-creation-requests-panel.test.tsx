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
const launchPolicy = vi.hoisted(() => ({ enabled: false }));
// Retain dormant approval coverage for the future isolated reopening.
vi.mock("@openmeld/schemas", async (importOriginal) => ({
	...(await importOriginal<typeof import("@openmeld/schemas")>()),
	get TEAMMATE_AGENT_REQUESTS_ENABLED() {
		return launchPolicy.enabled;
	},
}));
const decideRequestMock = vi.hoisted(() => vi.fn());
const cancelRequestMock = vi.hoisted(() => vi.fn());
const retryRequestMock = vi.hoisted(() => vi.fn());
const continueLocalSetupMock = vi.hoisted(() => vi.fn());
const readLocalSetupMock = vi.hoisted(() => vi.fn());
const INCOMING_REQUEST_SUMMARY =
	/Alex requested this for You via the Center Agent/;
const OUTGOING_REQUEST_SUMMARY = /You requested this for Alex via Web/;

vi.mock("#/lib/profiles/agent-profile-creation-requests", () => ({
	cancelAgentProfileCreationRequest: cancelRequestMock,
	createAgentProfileCreationRequest: vi.fn(),
	decideAgentProfileCreationRequest: decideRequestMock,
	listAgentProfileCreationRequests: listRequestsMock,
	retryAgentProfileCreationRequest: retryRequestMock,
}));

vi.mock("#/lib/profiles/agent-profile-creation-local-setup", () => ({
	continuePendingAgentProfileCreationLocalSetup: continueLocalSetupMock,
	readPendingAgentProfileCreationLocalSetup: readLocalSetupMock,
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
		launchPolicy.enabled = false;
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
		retryRequestMock.mockReset().mockResolvedValue({
			request: {
				...BASE_REQUEST,
				completedAt: "2026-08-20T00:00:05.000Z",
				createdAgentProfileId: "agent-created-before-setup-failed",
				failureMessage: null,
				status: "completed",
				statusReason: "profile_created",
			},
		});
		continueLocalSetupMock.mockReset().mockResolvedValue({
			failureMessage: null,
			pending: false,
		});
		readLocalSetupMock.mockReset().mockReturnValue(null);
	});

	afterEach(() => {
		cleanup();
		vi.restoreAllMocks();
	});

	it("shows request origin and exposes only the participant's valid actions", async () => {
		launchPolicy.enabled = true;
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
		launchPolicy.enabled = true;
		decideRequestMock.mockResolvedValueOnce({
			request: {
				...BASE_REQUEST,
				createdAgentProfileId: "agent-created-before-setup-failed",
				failureMessage: "The selected Computer is no longer reachable.",
				status: "failed",
				statusReason: "profile_created",
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

	it("continues Core and browser-local setup for the same committed Profile", async () => {
		listRequestsMock.mockResolvedValueOnce({
			organizationId: "org-1",
			requests: [
				{
					...BASE_REQUEST,
					createdAgentProfileId: "agent-created-before-setup-failed",
					// Captured production RPC error from the reported creation failure.
					failureMessage:
						'HTTP 503: {"ok":false,"error":{"code":"agent_profile.workspace_change_eligibility_unavailable","message":"OpenMeld couldn’t confirm whether this Agent is working, so the working folder is temporarily unavailable. Try again."}}',
					requesterUserId: "user-felix",
					status: "failed",
					statusReason: "profile_created",
				},
			],
		});

		renderPanel();

		expect(await screen.findByText("Needs attention")).toBeTruthy();
		expect(
			screen.getByRole("table", { name: "Agent creation history" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"The Agent was created, but its working folder could not be prepared because OpenMeld couldn’t check whether it was busy. Retry setup to finish configuring this Agent."
			)
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "View Agent" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry setup" }));
		await waitFor(() => {
			expect(retryRequestMock).toHaveBeenCalledWith({
				organizationId: "org-1",
				requestId: "request-incoming",
			});
			expect(continueLocalSetupMock).toHaveBeenCalledWith({
				organizationId: "org-1",
				request: expect.objectContaining({
					createdAgentProfileId: "agent-created-before-setup-failed",
					status: "completed",
				}),
				selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
				storageScope: "account-1",
			});
		});
		expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
	});

	it("carries browser-local setup through a retry that commits the Profile", async () => {
		listRequestsMock.mockResolvedValueOnce({
			organizationId: "org-1",
			requests: [
				{
					...BASE_REQUEST,
					failureMessage: "The selected Computer is no longer reachable.",
					requesterUserId: "user-felix",
					status: "failed",
					statusReason: "profile_creation_failed",
				},
			],
		});

		renderPanel();

		fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
		await waitFor(() => {
			expect(retryRequestMock).toHaveBeenCalledWith({
				organizationId: "org-1",
				requestId: "request-incoming",
			});
			expect(continueLocalSetupMock).toHaveBeenCalledWith({
				organizationId: "org-1",
				request: expect.objectContaining({
					createdAgentProfileId: "agent-created-before-setup-failed",
					status: "completed",
				}),
				selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
				storageScope: "account-1",
			});
		});
	});

	it("retries only the browser-local step after Core setup completed", async () => {
		readLocalSetupMock.mockReturnValue({
			agentProfileId: "agent-created-before-setup-failed",
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});
		listRequestsMock.mockResolvedValueOnce({
			organizationId: "org-1",
			requests: [
				{
					...BASE_REQUEST,
					completedAt: "2026-08-20T00:00:05.000Z",
					createdAgentProfileId: "agent-created-before-setup-failed",
					decidedAt: "2026-08-20T00:00:01.000Z",
					requesterUserId: "user-felix",
					status: "completed",
					statusReason: "profile_created",
				},
			],
		});

		renderPanel();

		expect(await screen.findByText("Needs attention")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Retry setup" }));
		await waitFor(() => {
			expect(continueLocalSetupMock).toHaveBeenCalledWith({
				organizationId: "org-1",
				request: expect.objectContaining({
					createdAgentProfileId: "agent-created-before-setup-failed",
					status: "completed",
				}),
				selectedHumanProfileId: "11111111-1111-4111-8111-111111111111",
				storageScope: "account-1",
			});
		});
		expect(retryRequestMock).not.toHaveBeenCalled();
	});

	it("keeps setup incomplete after the private folder draft expires", async () => {
		readLocalSetupMock.mockReturnValue({
			agentProfileId: "agent-created-before-setup-failed",
			workspacePath: null,
		});
		listRequestsMock.mockResolvedValueOnce({
			organizationId: "org-1",
			requests: [
				{
					...BASE_REQUEST,
					completedAt: "2026-08-20T00:00:05.000Z",
					createdAgentProfileId: "agent-created-before-setup-failed",
					decidedAt: "2026-08-20T00:00:01.000Z",
					requesterUserId: "user-felix",
					status: "completed",
					statusReason: "profile_created",
				},
			],
		});

		renderPanel();

		expect(await screen.findByText("Needs attention")).toBeTruthy();
		expect(
			screen.getByText(
				"Choose the custom working folder again in Agent settings on this computer."
			)
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "View Agent" })).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Retry setup" })).toBeNull();
	});

	it("returns to Agent created after settings clears the local setup intent", async () => {
		listRequestsMock.mockResolvedValueOnce({
			organizationId: "org-1",
			requests: [
				{
					...BASE_REQUEST,
					completedAt: "2026-08-20T00:00:05.000Z",
					createdAgentProfileId: "agent-created-before-setup-failed",
					decidedAt: "2026-08-20T00:00:01.000Z",
					requesterUserId: "user-felix",
					status: "completed",
					statusReason: "profile_created",
				},
			],
		});

		renderPanel();

		expect(await screen.findByText("Agent created")).toBeTruthy();
		expect(screen.getByRole("button", { name: "View Agent" })).toBeTruthy();
	});

	it("shows an active creation honestly and removes cancellation", async () => {
		readLocalSetupMock.mockReturnValue({
			agentProfileId: "agent-created-before-setup-failed",
			workspacePath: "/Users/felix/Desktop/work/openmeld",
		});
		listRequestsMock.mockResolvedValueOnce({
			organizationId: "org-1",
			requests: [
				{
					...BASE_REQUEST,
					createdAgentProfileId: "agent-created-before-setup-failed",
					status: "approved",
					requesterUserId: "user-felix",
					statusReason: "profile_created",
				},
			],
		});

		renderPanel();

		expect(await screen.findByText("Finishing setup…")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Cancel request" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry setup" })).toBeNull();
	});
	it("hides cached teammate requests and approval actions during the launch hold", async () => {
		renderPanel();
		expect(
			await screen.findByText("No Agent creation history yet.")
		).toBeTruthy();
		expect(screen.queryByText("Release Reviewer")).toBeNull();
		expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
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
				storageScope="account-1"
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
