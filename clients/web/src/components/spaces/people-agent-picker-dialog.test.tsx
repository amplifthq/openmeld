import { DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION } from "@openmeld/schemas";
import type { AgentProfileCreationRequest } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { PeopleAgentPickerCreateAgent } from "../profiles/people-agent-picker-create-agent";
import { PeopleAgentPickerDialog } from "./people-agent-picker-dialog";

const NEW_HELPER = /New helper/;

const creation = vi.hoisted(() => ({
	callbacks: null as ComponentProps<typeof PeopleAgentPickerCreateAgent> | null,
}));
vi.mock("../profiles/people-agent-picker-create-agent", () => ({
	PeopleAgentPickerCreateAgent: (
		props: ComponentProps<typeof PeopleAgentPickerCreateAgent>
	) => {
		creation.callbacks = props;
		return (
			<button
				onClick={() =>
					props.onStarted({
						id: "optimistic:intent",
						profileName: "New helper",
						targetOwnerUserId: "owner",
						configuration: DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
						failureMessage: null,
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
vi.mock("#/lib/profiles/agent-profile-creation-requests", () => ({
	readAgentProfileCreationRequest: async () => null,
}));
afterEach(cleanup);

it.each([
	"selected",
	"deselected",
	"failed",
])("keeps creation in the owner's list through the %s outcome", async (outcome) => {
	const onCreated = vi.fn();
	const onSubmit = vi.fn();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	render(
		<QueryClientProvider client={client}>
			<PeopleAgentPickerDialog
				candidateGroups={{
					alreadyJoinedCount: 0,
					organizationCandidates: [],
					personGroups: [
						{
							id: "owner",
							name: "Mira",
							searchText: "mira",
							lastActiveAt: null,
							humanAlreadyMember: true,
							humanCandidate: null,
							agentCandidates: [
								{
									profileId: "existing",
									profileName: "Existing helper",
									profileKind: "agent",
									searchText: "existing",
								},
							],
						},
					],
				}}
				canSubmit
				description="Choose members"
				emptyMessage="No agents"
				isLoading={false}
				isSubmitting={false}
				onAgentCreated={onCreated}
				onClear={vi.fn()}
				onOpenChange={vi.fn()}
				onQueryChange={vi.fn()}
				onSubmit={onSubmit}
				onToggle={vi.fn()}
				open
				query=""
				selectedProfileIds={new Set(["existing"])}
				submitLabel="Add"
				title="Add people or agents"
			/>
		</QueryClientProvider>
	);
	fireEvent.click(screen.getByRole("button", { name: "New Agent" }));
	fireEvent.click(await screen.findByRole("button", { name: "Create Agent" }));
	const row = await screen.findByRole("checkbox", { name: NEW_HELPER });
	expect(row.getAttribute("aria-checked")).toBe("true");
	expect(screen.getByText("Creating…")).toBeTruthy();
	const owner = document.getElementById(
		"space-add-members-person-owner-agents"
	);
	expect(
		owner?.querySelector("[data-profile-id]")?.getAttribute("data-profile-id")
	).toBe("optimistic:intent");
	fireEvent.click(screen.getByRole("button", { name: "Add" }));
	expect(onSubmit).not.toHaveBeenCalled();
	if (outcome === "failed") {
		act(() => creation.callbacks?.onFailed("Connection unavailable"));
		expect(screen.getByText("Creation failed")).toBeTruthy();
		expect(screen.getByText("Connection unavailable")).toBeTruthy();
		expect(onCreated).not.toHaveBeenCalled();
		fireEvent.click(row);
		fireEvent.click(screen.getByRole("button", { name: "Add" }));
		expect(onSubmit).toHaveBeenCalledOnce();
		client.clear();
		return;
	}
	if (outcome === "deselected") {
		fireEvent.click(row);
	}
	const request: AgentProfileCreationRequest = {
		actorProfileId: "human",
		completedAt: null,
		configuration: DEFAULT_AGENT_PROFILE_CREATION_CONFIGURATION,
		createdAgentProfileId: "confirmed",
		createdAt: "2026-10-15T00:00:00.000Z",
		decidedAt: null,
		failureMessage: null,
		id: "request",
		nativeSessionId: null,
		organizationId: "org",
		profileName: "New helper",
		requestedSpaceId: null,
		requesterUserId: "owner",
		sessionStrategy: "new",
		source: "web",
		status: "approved",
		statusReason: "self_request",
		targetOwnerUserId: "owner",
		updatedAt: "2026-10-15T00:00:00.000Z",
	};
	act(() => creation.callbacks?.onAccepted(request));
	await waitFor(() =>
		expect(onCreated).toHaveBeenCalledWith(
			expect.objectContaining({ profileId: "confirmed", ownerUserId: "owner" }),
			outcome === "selected"
		)
	);
	expect(screen.queryByText("Creating…")).toBeNull();
	client.clear();
});
