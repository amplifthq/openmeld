import type {
	AuthProfileView,
	CreateSpaceResponse,
	OpenDirectMessageSpaceResponse,
	PostSpaceMembersResponse,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OrganizationSpaceProfileCandidates } from "#/query/organizations/organization-directory";
import { buildRemoteCenterAgentReadiness } from "#/test-support/center-agent-readiness";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { NewChatDialog } from "./new-chat-dialog";

const mocks = vi.hoisted(() => ({
	navigate: vi.fn(),
	create: vi.fn(),
	add: vi.fn(),
	dm: vi.fn(),
}));
const humanId = "11111111-1111-4111-8111-111111111111";
const miraId = "22222222-2222-4222-8222-222222222222";
const agentId = "agt_33333333-3333-4333-8333-333333333333";
const centerId = "agt_44444444-4444-4444-8444-444444444444";
const spaceId = "a".repeat(64);
const profile: AuthProfileView = {
	openMeldProfileId: humanId,
	createdAt: "2026-09-01T00:00:00Z",
	createdByUserId: "viewer",
	creatorProfileId: null,
	isDefault: true,
	lastUsedAt: null,
	managedRole: null,
	ownerName: "Jordan",
	ownerUserId: "viewer",
	profileHandle: "jordan",
	profileKind: "human",
	profileName: "Jordan",
	source: "user",
	status: "active",
	updatedAt: "2026-09-01T00:00:00Z",
};
const directory: OrganizationSpaceProfileCandidates = {
	organizationId: "org",
	members: [
		{
			userId: "mira",
			memberName: "Mira",
			lastActiveAt: null,
			avatarImageUrl: null,
			humanProfile: {
				profileId: miraId,
				profileName: "Mira",
				profileHandle: "mira",
				status: "active",
			},
		},
	],
	agentProfiles: [
		{
			profileId: agentId,
			profileName: "Mira Agent",
			profileHandle: "mira-agent",
			ownerUserId: "mira",
			ownerName: "Mira",
			agentControllerRef: "hosted:remote-agent",
			isCenterAgent: false,
			status: "active",
			createdAt: "2026-09-01T00:00:00Z",
			lastUsedAt: null,
			readiness: buildRemoteCenterAgentReadiness("available", {
				agentProfileId: agentId,
			}),
		},
		{
			profileId: centerId,
			profileName: "Center Agent",
			profileHandle: "center-agent",
			ownerUserId: "viewer",
			ownerName: "Jordan",
			agentControllerRef: "hosted:center-agent",
			isCenterAgent: true,
			status: "active",
			createdAt: "2026-09-01T00:00:00Z",
			lastUsedAt: null,
			readiness: buildRemoteCenterAgentReadiness("available", {
				agentProfileId: centerId,
			}),
		},
	],
};
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => mocks.navigate,
}));
vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		currentOrganization: { id: "org", slug: "acme", name: "Acme" },
		currentUserId: "viewer",
	}),
}));
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({ defaultHumanProfile: profile }),
}));
vi.mock("#/query/organizations/organization-directory", () => ({
	organizationSpaceProfileCandidatesQueryOptions: () => ({
		queryKey: ["picker-test"],
		queryFn: async () => directory,
	}),
}));
vi.mock("#/lib/spaces/create-space-in-organization", () => ({
	createSpaceInOrganization: (...args: unknown[]) => mocks.create(...args),
}));
vi.mock("#/lib/spaces/api", () => ({
	createOrganizationScopedWebSpaceApi: () => ({
		addOrganizationDirectoryProfilesToSpace: (...args: unknown[]) =>
			mocks.add(...args),
	}),
}));
vi.mock("#/lib/spaces/direct-message", () => ({
	openCurrentDirectMessageSpace: (...args: unknown[]) => mocks.dm(...args),
	resolveDirectMessageOpenErrorMessage: () => "Could not open chat.",
}));

beforeEach(() => {
	vi.clearAllMocks();
	mocks.create.mockResolvedValue({ spaceId } satisfies CreateSpaceResponse);
	mocks.add.mockResolvedValue({
		addedMemberIds: [miraId, centerId],
		alreadyMemberIds: [],
		items: [],
	} satisfies PostSpaceMembersResponse);
	mocks.dm.mockResolvedValue({
		spaceId: "direct",
		organizationId: "org",
		memberProfileId: humanId,
		targetProfileId: agentId,
		created: false,
	} satisfies OpenDirectMessageSpaceResponse);
});
afterEach(cleanup);
async function openPicker(initialQuery?: string) {
	const closed = vi.fn();
	render(
		<TestQueryClientProvider queryClient={createTestQueryClient()}>
			<NewChatDialog initialQuery={initialQuery} onOpenChange={closed} open />
		</TestQueryClientProvider>
	);
	await screen.findByRole("checkbox", { name: "Mira Agent" });
	return closed;
}
it("finds a person from the organization directory with a prefilled query, without prior chat history", async () => {
	await openPicker("Mira");
	expect(
		screen.getByRole("searchbox", { name: "Search people and agents" })
	).toHaveProperty("value", "Mira");
	expect(screen.queryByRole("checkbox", { name: "Center Agent" })).toBeNull();
	fireEvent.click(screen.getByRole("checkbox", { name: "Mira" }));
	fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
	await waitFor(() =>
		expect(mocks.dm).toHaveBeenCalledWith({
			organizationId: "org",
			targetProfileId: miraId,
		})
	);
});
it("opens a private chat for one explicit Agent without selecting its owner", async () => {
	await openPicker();
	fireEvent.click(screen.getByRole("checkbox", { name: "Mira Agent" }));
	expect(screen.getByText("1 selected")).toBeTruthy();
	expect(
		screen.getByRole("checkbox", { name: "Mira" }).getAttribute("aria-checked")
	).toBe("false");
	fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
	await waitFor(() =>
		expect(mocks.dm).toHaveBeenCalledWith({
			organizationId: "org",
			targetProfileId: agentId,
		})
	);
	expect(mocks.create).not.toHaveBeenCalled();
});
it("opens Center Agent draft when it is the only selection", async () => {
	await openPicker();
	fireEvent.click(screen.getByRole("checkbox", { name: "Center Agent" }));
	fireEvent.click(screen.getByRole("button", { name: "Start chat" }));
	await waitFor(() =>
		expect(mocks.navigate).toHaveBeenCalledWith({
			to: "/o/acme/chats/center-agent?draft=new",
		})
	);
	expect(mocks.dm).not.toHaveBeenCalled();
	expect(mocks.create).not.toHaveBeenCalled();
});
it("creates a private Space for multiple targets and retries membership on that same Space", async () => {
	mocks.add.mockRejectedValueOnce(new Error("Membership unavailable"));
	const closed = await openPicker();
	fireEvent.click(screen.getByRole("checkbox", { name: "Mira" }));
	fireEvent.click(screen.getByRole("checkbox", { name: "Center Agent" }));
	fireEvent.click(screen.getByRole("button", { name: "Create Space" }));
	await screen.findByText("Membership unavailable");
	expect(mocks.create).toHaveBeenCalledWith(
		expect.objectContaining({
			organizationId: "org",
			space: {
				name: "Center Agent, Mira",
				visibility: "private",
				accessMode: "members_only",
			},
		})
	);
	expect(mocks.navigate).not.toHaveBeenCalled();
	expect(closed).not.toHaveBeenCalled();
	fireEvent.click(screen.getByRole("button", { name: "Retry adding members" }));
	await waitFor(() => expect(closed).toHaveBeenCalledWith(false));
	expect(mocks.create).toHaveBeenCalledTimes(1);
	expect(mocks.add).toHaveBeenCalledTimes(2);
	expect(mocks.add).toHaveBeenLastCalledWith({
		spaceId,
		directoryProfileIds: [centerId, miraId],
		expectedCenterAgentProfileId: centerId,
	});
	expect(mocks.dm).not.toHaveBeenCalled();
});
