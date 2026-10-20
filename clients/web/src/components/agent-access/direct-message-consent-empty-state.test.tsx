import type {
	OrganizationProfileDirectoryResponse,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	directMessageConsentEmptyState,
	resolveAgentOwnerName,
	resolveColleagueDirectMessageAgent,
	useDirectMessageConsentEmptyState,
} from "./direct-message-consent-empty-state";

const mocks = vi.hoisted(() => ({
	grants: [] as string[],
	readDirectory: vi.fn(),
}));
vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => true,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useOptionalAppOrganization: () => ({
		currentUserId: "felix",
		currentOrganization: { id: "org" },
	}),
}));
vi.mock("#/query/agent-access", () => ({
	useViewerAgentAccessGrants: () => ({ data: mocks.grants }),
}));
vi.mock("#/query/organizations/organization-directory", () => ({
	organizationProfileIdentityDirectoryQueryOptions: (input: {
		enabled: boolean;
	}) => ({
		enabled: input.enabled,
		queryFn: mocks.readDirectory,
		queryKey: ["profile-identity-directory"],
	}),
}));

const agent = (
	profileId: string,
	ownerUserId: string | null,
	status = "active"
) =>
	({
		profileId,
		profileName: "Codex",
		ownerUserId,
		status,
	}) as SpaceMembersSnapshot["agents"][number];
const snapshot = (agents: SpaceMembersSnapshot["agents"]) =>
	({ humans: [], agents }) as unknown as SpaceMembersSnapshot;
const directory = {
	members: [
		{
			userId: "tali",
			user: { name: "tali@example.test" },
			humanProfile: { profileName: "Tali Smoke" },
		},
	],
	agentProfiles: [{ profileId: "agt_codex", ownerName: "Tali" }],
} as unknown as OrganizationProfileDirectoryResponse;

describe("Direct Message empty state that asks the owner first", () => {
	it("explains that the first message goes to the owner for approval", () => {
		expect(
			directMessageConsentEmptyState({
				agentName: "Codex",
				ownerName: "Tali Smoke",
			})
		).toEqual({
			title: "Ask Tali Smoke to use Codex",
			description:
				"Your first message goes to Tali Smoke for approval. Codex starts once Tali Smoke allows it.",
		});
	});

	it("finds only an active Agent another member owns", () => {
		expect(
			resolveColleagueDirectMessageAgent({
				snapshot: snapshot([
					agent("agt_mine", "felix"),
					agent("agt_org", null),
					agent("agt_left", "tali", "removed"),
					agent("agt_codex", "tali"),
				]),
				viewerUserId: "felix",
			})?.profileId
		).toBe("agt_codex");
		expect(
			resolveColleagueDirectMessageAgent({
				snapshot: snapshot([agent("agt_mine", "felix")]),
				viewerUserId: "felix",
			})
		).toBeNull();
	});

	it("names the owner by their Human Profile, then their account", () => {
		expect(
			resolveAgentOwnerName({
				directory,
				agentProfileId: "agt_codex",
				ownerUserId: "tali",
			})
		).toBe("Tali Smoke");
		expect(
			resolveAgentOwnerName({
				directory: {
					...directory,
					members: [{ userId: "tali", user: { name: "Tali" } }],
				} as unknown as OrganizationProfileDirectoryResponse,
				agentProfileId: "agt_codex",
				ownerUserId: "tali",
			})
		).toBe("Tali");
	});
});

describe("useDirectMessageConsentEmptyState", () => {
	beforeEach(() => {
		mocks.grants = [];
		mocks.readDirectory.mockReset().mockResolvedValue(directory);
	});
	afterEach(cleanup);

	function renderState(input: {
		isDirectMessage?: boolean;
		agents?: SpaceMembersSnapshot["agents"];
	}) {
		const client = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		const wrapper = ({ children }: { children: ReactNode }) => (
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		);
		return renderHook(
			() =>
				useDirectMessageConsentEmptyState({
					isCenterAgentDirectMessage: false,
					isDirectMessage: input.isDirectMessage ?? true,
					snapshot: snapshot(input.agents ?? [agent("agt_codex", "tali")]),
				}),
			{ wrapper }
		);
	}

	it("asks the owner first when the viewer has no grant", async () => {
		const { result } = renderState({});
		await waitFor(() =>
			expect(result.current?.title).toBe("Ask Tali Smoke to use Codex")
		);
	});

	it("keeps the ordinary empty state once the owner allowed the viewer", async () => {
		mocks.grants = ["agt_codex"];
		const { result } = renderState({});
		await waitFor(() => expect(mocks.readDirectory).toHaveBeenCalled());
		expect(result.current).toBeNull();
	});

	it("keeps the ordinary empty state for the viewer's own Agent and a Space", () => {
		expect(
			renderState({ agents: [agent("agt_mine", "felix")] }).result.current
		).toBeNull();
		expect(renderState({ isDirectMessage: false }).result.current).toBeNull();
		expect(mocks.readDirectory).not.toHaveBeenCalled();
	});
});
