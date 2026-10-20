import type { OrganizationProfileDirectoryResponse } from "@openmeld/schemas/types";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentProfilesWorkspace } from "#/components/agents/agent-profiles-workspace";
import { memberAgentQueryKeys } from "#/query/organizations/member-agents";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	agentProfile,
	MIGRATED_LISTING,
	MIGRATED_PROFILES,
	OWNER_USER_ID,
} from "#/test-support/member-agent-fixtures";
import { buildMemberAgentDirectory } from "./member-agent-directory-model";
import {
	MemberAgentHarnessLock,
	useMemberAgentHarnessLocked,
	useMemberAgentProfileNameLocked,
} from "./member-agent-harness-lock";
import { buildMemberAgentIndex } from "./member-agent-index";

vi.mock("#/lib/member-agents/member-agents-feature", () => ({
	isMemberAgentsEnabled: () => true,
}));

const organization = { id: "org-test", slug: "test", name: "Test" };
vi.mock("#/lib/organizations/organization-context", () => {
	const value = {
		account: { name: "Felix Lu" },
		currentUserId: "user-felix",
		currentOrganization: { id: "org-test", slug: "test", name: "Test" },
	};
	return {
		useAppOrganization: () => value,
		useOptionalAppOrganization: () => value,
	};
});
vi.mock("#/lib/profiles/use-default-human-profile", () => ({
	useDefaultHumanProfile: () => ({
		defaultHumanProfile: { openMeldProfileId: "human-felix" },
	}),
}));
vi.mock("#/components/directory/center-agent-item", () => ({
	CenterAgentItem: () => <div>Center Agent</div>,
}));
vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: null,
		disabled: true,
		save: vi.fn(),
	}),
}));
vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));
vi.mock("#/components/app/app-full-width-layout", () => ({
	AppFullWidthLayout: ({
		children,
		mainSidebar,
	}: {
		children: ReactNode;
		mainSidebar?: { content: ReactNode };
	}) => (
		<div>
			<aside data-testid="sidebar">{mainSidebar?.content}</aside>
			<main>{children}</main>
		</div>
	),
}));
vi.mock("#/components/app/app-navigation-presentation", () => ({
	useAppNavigationPresentation: () => ({ dismiss: vi.fn() }),
}));

afterEach(() => {
	cleanup();
	window.localStorage.clear();
});

const TWO_PROFILES_PATTERN = /^2 Profiles/;

const COLLEAGUE_PROFILE = agentProfile("agt-tali", "Tali Codex", {
	ownerName: "Tali",
	ownerUserId: "user-tali",
});

function seededClient() {
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, staleTime: Number.POSITIVE_INFINITY },
		},
	});
	client.setQueryData(
		memberAgentQueryKeys.all(organization.id),
		MIGRATED_LISTING
	);
	client.setQueryData(
		organizationQueryKeys.profileIdentityDirectory(organization.id),
		{
			organizationId: organization.id,
			generatedAt: "2026-10-18T00:00:00.000Z",
			members: [
				{
					memberId: "member-felix",
					organizationId: organization.id,
					userId: OWNER_USER_ID,
					role: "owner",
					joinedAt: "2026-08-01T00:00:00.000Z",
					user: {
						id: OWNER_USER_ID,
						name: "Felix",
						email: "felix@example.com",
						image: null,
					},
					humanProfile: {
						profileId: "human-felix",
						profileName: "Felix Lu",
						profileHandle: "felix",
						status: "active",
					},
				},
			],
			agentProfiles: [],
		} satisfies OrganizationProfileDirectoryResponse
	);
	client.setQueryData(accountSpaceQueryKeys.items("human-felix", "account"), {
		pinnedItems: [],
		spaceItems: [],
	});
	return client;
}

function renderWorkspace(
	overrides: Partial<Parameters<typeof AgentProfilesWorkspace>[0]> = {}
) {
	const client = seededClient();
	return render(
		<QueryClientProvider client={client}>
			<AgentProfilesWorkspace
				activeView="agents"
				creationAttentionCount={0}
				currentUserId={OWNER_USER_ID}
				members={[OWNER_USER_ID, "user-tali"].map((userId) => ({
					humanProfile: null,
					joinedAt: "2026-08-01T00:00:00.000Z",
					memberId: userId,
					organizationId: organization.id,
					role: "member",
					userId,
					user: {
						id: userId,
						name: userId === OWNER_USER_ID ? "Felix Lu" : "Tali",
						image: null,
						email: `${userId}@example.com`,
					},
				}))}
				modelCatalog={null}
				onCreateAgent={vi.fn()}
				onOpenMemberAgent={vi.fn()}
				onSelectProfile={vi.fn()}
				onViewChange={vi.fn()}
				profiles={[...MIGRATED_PROFILES, COLLEAGUE_PROFILE]}
				profilesStatus="ready"
				readinessByProfileId={new Map()}
				renderProfileDetail={() => null}
				renderProfilesController={() => null}
				requestPanel={null}
				selectedProfileId={null}
				{...overrides}
			/>
		</QueryClientProvider>
	);
}

describe("Agents list for a migrated member", () => {
	it("keeps every existing Profile reachable from the Agents list", () => {
		renderWorkspace();
		const own = screen.getByRole("region", { name: "Felix Lu’s Agents" });
		// Assigned Profiles appear through their MemberAgent rows.
		expect(within(own).getByText("Felix Lu’s Claude Code")).toBeTruthy();
		expect(within(own).getByText("Felix Lu’s Codex")).toBeTruthy();
		expect(within(own).getByText(TWO_PROFILES_PATTERN)).toBeTruthy();
		// Unassigned Profiles keep their own cards at the bottom.
		const unassigned = within(own).getByRole("region", {
			name: "Unassigned Profiles",
		});
		expect(within(unassigned).getByText("Custom script")).toBeTruthy();
		expect(within(unassigned).getByText("Brand new")).toBeTruthy();
		// A colleague's Agents keep the per-Profile list.
		fireEvent.click(
			screen.getByRole("button", { name: "Agent view settings" })
		);
		fireEvent.click(screen.getByRole("menuitemradio", { name: "None" }));
		expect(screen.getByText("Tali Codex")).toBeTruthy();
	});

	it("shows a MemberAgent's page as its default Profile's page", () => {
		const directory = buildMemberAgentDirectory({
			index: buildMemberAgentIndex({
				listing: MIGRATED_LISTING,
				ownerName: "Felix Lu",
			}),
			ownedProfiles: MIGRATED_PROFILES,
			runtimeByProfileId: new Map(),
		});
		renderWorkspace({
			selectedMemberAgentId: "ma-claude",
			memberAgentSidebar: <nav aria-label="Claude Code chats" />,
			renderProfileDetail: (profile) => <h1>{profile.profileName}</h1>,
			renderMemberAgentDetail: (memberAgentId, renderProfile) => {
				const row = directory.rows.find(
					(candidate) => candidate.memberAgentId === memberAgentId
				);
				const profile = row?.profiles[0];
				return profile ? renderProfile(profile) : null;
			},
		});
		expect(
			screen.getByRole("heading", { level: 1, name: "Claude Code" })
		).toBeTruthy();
		expect(
			within(screen.getByTestId("sidebar")).getByRole("navigation", {
				name: "Claude Code chats",
			})
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Back to Agents" })).toBeTruthy();
	});

	it("locks the default Profile's name and every assigned Profile's harness", async () => {
		function Probe() {
			return (
				<output>
					{`harness:${useMemberAgentHarnessLocked()} name:${useMemberAgentProfileNameLocked()}`}
				</output>
			);
		}
		const client = seededClient();
		render(
			<QueryClientProvider client={client}>
				<MemberAgentHarnessLock profileId="agt-claude-default">
					<Probe />
				</MemberAgentHarnessLock>
				<MemberAgentHarnessLock profileId="agt-claude-reviewer">
					<Probe />
				</MemberAgentHarnessLock>
				<MemberAgentHarnessLock profileId="agt-custom">
					<Probe />
				</MemberAgentHarnessLock>
			</QueryClientProvider>
		);
		expect(
			(await screen.findAllByRole("status")).map((node) => node.textContent)
		).toEqual([
			"harness:true name:true",
			"harness:true name:false",
			"harness:false name:false",
		]);
	});
});
