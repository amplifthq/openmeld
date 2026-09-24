import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NewAgentCreationForm } from "./new-agent-creation-form";

vi.mock("#/components/app/start-flow-state", () => ({
	useStartFlowState: () => ({
		state: { selectedHumanProfileId: "human-a" },
		storageScope: "test-scope",
	}),
}));
vi.mock("#/lib/spaces/app-spaces-profile", () => ({
	resolveAppSpacesProfileId: () => "human-a",
}));
vi.mock("#/components/spaces/account-space-sections", () => ({
	selectAccountSpaceSections: () => ({
		pinnedItems: [],
		spaceItems: [{ spaceId: "space-a" }],
	}),
}));
vi.mock("#/query/profiles/profiles", () => ({
	buildStartProfilesQueryOptions: () => ({
		queryKey: ["test-profiles"],
		queryFn: async () => [],
	}),
}));
vi.mock("#/query/spaces/account-spaces", () => ({
	accountSpaceItemsQueryOptions: () => ({
		queryKey: ["test-account-spaces"],
		queryFn: async () => ({}),
	}),
}));
vi.mock("#/query/organizations/organization-directory", () => ({
	organizationSpacesQueryOptions: () => ({
		queryKey: ["test-organization-spaces"],
		queryFn: async () => ({
			spaces: [{ spaceId: "space-a", name: "Space A", joined: true }],
		}),
	}),
}));
vi.mock("#/components/agents/use-local-agent-recovery-controller", () => ({
	useLocalAgentRecoveryController: () => ({}),
}));
vi.mock("./create-profile-dialog", () => ({
	CreateAgentProfilePage: ({
		spaceContext,
	}: {
		spaceContext?: { spaceId: string };
	}) => (
		<output data-testid="creation-destination">
			{spaceContext?.spaceId ?? "chat"}
		</output>
	),
}));
vi.mock("./remote-agent-creation-form", () => ({
	RemoteAgentCreationForm: ({
		requestedSpaceId,
	}: {
		requestedSpaceId: string | null;
	}) => (
		<output data-testid="creation-destination">
			{requestedSpaceId ?? "chat"}
		</output>
	),
}));

afterEach(cleanup);

describe("new Agent destination", () => {
	it.each([
		"Local Agent",
		"Remote Agent",
	])("uses the latest destination for %s creation", async (runtime) => {
		const queryClient = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		render(
			<QueryClientProvider client={queryClient}>
				<NewAgentCreationForm
					accountName="Felix"
					currentUserId="user-a"
					intentStorageScope="test-scope"
					isPersonalOrganization={true}
					onAccepted={vi.fn()}
					onCancel={vi.fn()}
					onFailed={vi.fn()}
					onStarted={vi.fn()}
					organizationId="org-a"
					orgSlug="acme"
				/>
			</QueryClientProvider>
		);
		fireEvent.click(screen.getByRole("button", { name: runtime }));
		fireEvent.click(screen.getByRole("button", { name: "Add to a Space" }));
		fireEvent.click(await screen.findByRole("combobox", { name: "Space" }));
		fireEvent.click(await screen.findByRole("option", { name: "Space A" }));
		expect(screen.getByTestId("creation-destination").textContent).toBe(
			"space-a"
		);
		fireEvent.click(screen.getByRole("button", { name: "Start a chat" }));
		expect(screen.getByTestId("creation-destination").textContent).toBe("chat");
		queryClient.clear();
	});
});
