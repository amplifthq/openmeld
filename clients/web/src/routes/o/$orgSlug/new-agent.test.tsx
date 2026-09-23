import { DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION } from "@openmeld/schemas";
import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	readAgentCreationIntent,
	rememberAgentCreationIntent,
} from "#/lib/profiles/agent-creation-intent";
import { agentProfileCreationRequestQueryKeys } from "#/query/profiles/agent-profile-creation-requests";
import { Route } from "./new-agent";

const state = vi.hoisted(() => ({
	onAccepted: null as ((request: AgentProfileCreationRequest) => void) | null,
	navigate: vi.fn(() => Promise.resolve()),
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
});
afterEach(cleanup);

describe("Agent creation response navigation", () => {
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
