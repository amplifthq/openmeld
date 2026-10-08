import { DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION } from "@openmeld/schemas";
import type {
	AgentProfileCreationRequest,
	OpenDirectMessageSpaceResponse,
	OrganizationProfileDirectoryResponse,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	readAgentCreationIntent,
	rememberAgentCreationIntent,
} from "#/lib/profiles/agent-creation-intent";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { agentProfileCreationRequestQueryKeys } from "#/query/profiles/agent-profile-creation-requests";
import { Route } from "./new-agent";

const state = vi.hoisted(() => ({
	onAccepted: null as ((request: AgentProfileCreationRequest) => void) | null,
	navigate: vi.fn(
		(_options: { to: string; search?: object; replace?: boolean }) =>
			Promise.resolve()
	),
	readDirectory: vi.fn(),
	readRequest: vi.fn(),
	openDirectMessage: vi.fn(),
}));

vi.mock("#/lib/organizations/organization-directory", async (original) => ({
	...(await original<object>()),
	readCurrentOrganizationProfileDirectory: state.readDirectory,
}));
vi.mock("#/lib/profiles/agent-profile-creation-requests", async (original) => ({
	...(await original<object>()),
	readAgentProfileCreationRequest: state.readRequest,
}));
vi.mock("#/lib/spaces/direct-message", () => ({
	openCurrentDirectMessageSpace: state.openDirectMessage,
}));

vi.mock("@tanstack/react-router", () => ({
	createFileRoute: () => (options: object) => ({
		options,
		useLoaderData: () => ({ sidebarStates: {} }),
		useSearch: () => ({}),
	}),
	useNavigate: () => state.navigate,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		account: { name: "Felix" },
		currentOrganization: { id: "org-a", slug: "acme", isPersonal: true },
		currentUserId: "user-a",
		storageScope: "test-scope",
	}),
}));
vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({ children }: { children: ReactNode }) => (
		<main>{children}</main>
	),
}));
vi.mock("#/components/app/shell-layout", () => ({
	appShellStaticData: { newAgent: {} },
}));
vi.mock("#/components/agents/agent-creation-progress", () => ({
	AgentCreationProgress: () => <p>Creating Agent</p>,
}));
vi.mock("#/components/profiles/new-agent-creation-form", () => ({
	NewAgentCreationForm: ({
		onAccepted,
		onStarted,
	}: {
		onAccepted: (request: AgentProfileCreationRequest) => void;
		onStarted: (creation: {
			id: string;
			profileName: string;
			status: string;
		}) => void;
	}) => {
		state.onAccepted = onAccepted;
		return (
			<button
				onClick={() =>
					onStarted({
						id: "optimistic:creation-key",
						profileName: "Research Agent",
						status: "creating",
					})
				}
				type="button"
			>
				Create Agent
			</button>
		);
	},
}));

const acceptedRequest: AgentProfileCreationRequest = {
	actorProfileId: "human-a",
	completedAt: null,
	configuration: DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
	createdAgentProfileId: null,
	createdAt: "2026-09-23T00:00:00.000Z",
	decidedAt: "2026-09-23T00:00:00.000Z",
	failureMessage: null,
	id: "request-a",
	nativeSessionId: null,
	organizationId: "org-a",
	profileName: "Research Agent",
	requestedSpaceId: null,
	requesterUserId: "user-a",
	sessionStrategy: "new",
	source: "web",
	status: "approved",
	statusReason: "self_request",
	targetOwnerUserId: "user-a",
	updatedAt: "2026-09-23T00:00:00.000Z",
};

beforeEach(() => {
	window.history.replaceState({}, "", "/o/acme/new-agent");
	window.sessionStorage.clear();
	state.onAccepted = null;
	state.navigate.mockClear();
	state.readDirectory.mockReset();
	state.readRequest.mockReset();
	state.openDirectMessage.mockReset();
});
afterEach(cleanup);

describe("Agent creation response navigation", () => {
	it.each([
		{ leave: false, pendingRead: false },
		{ leave: true, pendingRead: false },
		{ leave: false, pendingRead: true },
	])("refreshes saved avatar identity before opening the new DM, leave=$leave, pendingRead=$pendingRead", async ({
		leave,
		pendingRead,
	}) => {
		const profileId = "agt_11111111-1111-4111-8111-111111111111";
		const completedRequest: AgentProfileCreationRequest = {
			...acceptedRequest,
			configuration: {
				...acceptedRequest.configuration,
				agentControllerRef: "hosted:remote-agent",
				modelId: "anthropic/claude-haiku-5-5",
			},
			completedAt: acceptedRequest.updatedAt,
			createdAgentProfileId: profileId,
			status: "completed",
			statusReason: "profile_created",
		};
		const directory: OrganizationProfileDirectoryResponse = {
			organizationId: "org-a",
			generatedAt: acceptedRequest.updatedAt,
			members: [],
			agentProfiles: [
				{
					organizationId: "org-a",
					profileId,
					profileName: "Research Agent",
					profileHandle: "research-agent",
					profileKind: "agent",
					isDefault: false,
					status: "active",
					ownerUserId: "user-a",
					source: "auth",
					managedRole: null,
					createdByUserId: "user-a",
					creatorProfileId: "human-a",
					lastUsedAt: null,
					createdAt: acceptedRequest.createdAt,
					updatedAt: acceptedRequest.updatedAt,
					agentControllerRef: "hosted:remote-agent",
					avatarStyle: "automatic",
					avatarModelId: "anthropic/claude-haiku-5-5",
				},
			],
		};
		let finishDirectory!: (value: OrganizationProfileDirectoryResponse) => void;
		state.readDirectory.mockReturnValue(
			new Promise<OrganizationProfileDirectoryResponse>((resolve) => {
				finishDirectory = resolve;
			})
		);
		state.readRequest.mockResolvedValue(completedRequest);
		const dm: OpenDirectMessageSpaceResponse = {
			organizationId: "org-a",
			memberProfileId: "human-a",
			targetProfileId: profileId,
			spaceId: "new-dm",
			created: true,
		};
		state.openDirectMessage.mockResolvedValue(dm);
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const staleDirectory = {
			...directory,
			agentProfiles: directory.agentProfiles.map((profile) => ({
				...profile,
				avatarModelId: null,
			})),
		};
		let finishPendingRead:
			| ((value: OrganizationProfileDirectoryResponse) => void)
			| undefined;
		for (const queryKey of [
			organizationQueryKeys.profileDirectory("org-a"),
			organizationQueryKeys.profileIdentityDirectory("org-a"),
		]) {
			if (pendingRead && queryKey.length === 3) {
				queryClient
					.fetchQuery({
						queryKey,
						queryFn: () =>
							new Promise<OrganizationProfileDirectoryResponse>((resolve) => {
								finishPendingRead = resolve;
							}),
					})
					.catch(() => undefined);
			} else {
				queryClient.setQueryData(queryKey, staleDirectory);
			}
		}
		const Component = Route.options.component as () => ReactNode;
		render(
			<QueryClientProvider client={queryClient}>
				<Component />
			</QueryClientProvider>
		);
		act(() => state.onAccepted?.(completedRequest));
		await waitFor(() => expect(state.readDirectory).toHaveBeenCalled());
		expect(state.navigate.mock.calls).not.toContainEqual([
			{ to: "/o/acme/chats/new-dm?profileId=human-a" },
		]);
		if (leave) {
			window.history.replaceState({}, "", "/o/acme/spaces/space-other");
		}
		await act(async () => finishDirectory(directory));
		await waitFor(() =>
			expect(
				queryClient.getQueryData<OrganizationProfileDirectoryResponse>(
					organizationQueryKeys.profileDirectory("org-a")
				)?.agentProfiles[0]?.avatarModelId
			).toBe("anthropic/claude-haiku-5-5")
		);
		expect(
			queryClient.getQueryData<OrganizationProfileDirectoryResponse>(
				organizationQueryKeys.profileIdentityDirectory("org-a")
			)?.agentProfiles[0]?.avatarModelId
		).toBe("anthropic/claude-haiku-5-5");
		expect(
			state.navigate.mock.calls.filter(([destination]) =>
				destination.to?.includes("/chats/")
			)
		).toHaveLength(leave ? 0 : 1);
		await act(async () => finishPendingRead?.(staleDirectory));
		expect(
			queryClient.getQueryData<OrganizationProfileDirectoryResponse>(
				organizationQueryKeys.profileDirectory("org-a")
			)?.agentProfiles[0]?.avatarModelId
		).toBe("anthropic/claude-haiku-5-5");
		queryClient.clear();
	});
	it.each([
		{ leave: false, unmount: false, expectedNavigation: 1 },
		{ leave: true, unmount: false, expectedNavigation: 0 },
		{ leave: true, unmount: true, expectedNavigation: 0 },
	])("respects a later navigation choice: leave=$leave, unmount=$unmount", ({
		leave,
		unmount,
		expectedNavigation,
	}) => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const Component = Route.options.component as () => ReactNode;
		const view = render(
			<QueryClientProvider client={queryClient}>
				<Component />
			</QueryClientProvider>
		);
		fireEvent.click(screen.getByRole("button", { name: "Create Agent" }));
		rememberAgentCreationIntent({
			fingerprint: "creation-fingerprint",
			idempotencyKey: "creation-key",
			organizationId: "org-a",
			profileName: "Research Agent",
			scope: "test-scope",
		});
		if (leave) {
			window.history.replaceState({}, "", "/o/acme/spaces/space-other");
		}
		if (unmount) {
			view.unmount();
		}
		act(() => state.onAccepted?.(acceptedRequest));
		expect(state.navigate).toHaveBeenCalledTimes(expectedNavigation);
		expect(
			queryClient.getQueryData(
				agentProfileCreationRequestQueryKeys.request("org-a", "request-a")
			)
		).toEqual(acceptedRequest);
		expect(readAgentCreationIntent("test-scope", "org-a") !== null).toBe(leave);
		queryClient.clear();
	});
});
