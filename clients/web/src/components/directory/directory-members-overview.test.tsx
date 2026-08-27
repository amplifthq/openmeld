import type {
	AuthProfileView,
	OrganizationDirectoryResponse,
} from "@openmeld/schemas/types";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startQueryKeys } from "#/query/query-keys";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import { DirectoryMembersOverview } from "./directory-members-overview";

const inviteOrganizationMemberMock = vi.hoisted(() => vi.fn());
const getActiveOrganizationMemberRoleMock = vi.hoisted(() => vi.fn());
const listCurrentOrganizationDocumentsMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationComputersMock = vi.hoisted(() => vi.fn());
const listCurrentOrganizationMessageChannelsMock = vi.hoisted(() => vi.fn());
const getCurrentCenterAgentMemberResearchStatusMock = vi.hoisted(() => vi.fn());
const startCurrentCenterAgentMemberResearchMock = vi.hoisted(() => vi.fn());
const openCurrentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const workspacePropsMock = vi.hoisted(() => vi.fn());

const CURRENT_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const GRACE_PROFILE_ID = "11111111-1111-4111-8111-111111111111";

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("#/components/directory/directory-human-profiles-workspace", () => ({
	DirectoryHumanProfilesWorkspace: (props: {
		members: readonly { id: string; name: string }[];
		onOpenDirectMessage: (profileId: string) => Promise<void>;
		onResearch: (userId: string) => void;
		onSelectProfile: (profileId: string) => void;
		selectedProfileId: string | null;
		sidebarLeadingContent?: ReactNode;
	}) => {
		workspacePropsMock(props);
		return (
			<div data-testid="people-workspace">
				{props.sidebarLeadingContent}
				<p data-testid="selected-profile">{props.selectedProfileId}</p>
				{props.members.map((member) => (
					<button
						key={member.id}
						onClick={() => props.onSelectProfile(member.id)}
						type="button"
					>
						{member.name}
					</button>
				))}
				<button onClick={() => props.onResearch("user-grace")} type="button">
					Research Grace
				</button>
				<button
					onClick={() => props.onOpenDirectMessage(GRACE_PROFILE_ID)}
					type="button"
				>
					Message Grace
				</button>
			</div>
		);
	},
}));

vi.mock("#/components/organizations/organization-invite-link", () => ({
	OrganizationInviteLink: () => (
		<section aria-label="Invite link controls">Invite link controls</section>
	),
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	getActiveOrganizationMemberRole: getActiveOrganizationMemberRoleMock,
	inviteOrganizationMember: inviteOrganizationMemberMock,
}));

vi.mock("#/query/organizations/organization-directory", async () => {
	const actual = await vi.importActual<
		typeof import("#/query/organizations/organization-directory")
	>("#/query/organizations/organization-directory");
	return {
		...actual,
		organizationComputersQueryOptions: (input: {
			enabled: boolean;
			organizationId: string;
		}) => ({
			enabled: input.enabled,
			queryFn: readCurrentOrganizationComputersMock,
			queryKey: actual.organizationQueryKeys.computers(input.organizationId),
			retry: false,
		}),
		organizationMemberRoleQueryOptions: (input: {
			enabled: boolean;
			organizationId: string;
			userId: string;
		}) => ({
			enabled: input.enabled,
			queryFn: getActiveOrganizationMemberRoleMock,
			queryKey: actual.organizationQueryKeys.role(
				input.organizationId,
				input.userId
			),
			retry: false,
		}),
	};
});

vi.mock("#/query/organizations/message-channels", async () => {
	const actual = await vi.importActual<
		typeof import("#/query/organizations/message-channels")
	>("#/query/organizations/message-channels");
	return {
		...actual,
		messageChannelListQueryOptions: (input: { organizationId: string }) => ({
			queryFn: listCurrentOrganizationMessageChannelsMock,
			queryKey: actual.messageChannelQueryKeys.list(input.organizationId),
			retry: false,
		}),
	};
});

vi.mock(
	"#/lib/organizations/organization-documents",
	async (importOriginal) => {
		const original =
			await importOriginal<
				typeof import("#/lib/organizations/organization-documents")
			>();
		return {
			...original,
			getCurrentCenterAgentMemberResearchStatus:
				getCurrentCenterAgentMemberResearchStatusMock,
			listCurrentOrganizationDocuments: listCurrentOrganizationDocumentsMock,
			startCurrentCenterAgentMemberResearch:
				startCurrentCenterAgentMemberResearchMock,
		};
	}
);

vi.mock("#/lib/organizations/organization-computers", () => ({
	readCurrentOrganizationComputers: readCurrentOrganizationComputersMock,
}));

vi.mock("#/lib/organizations/message-channels", async (importOriginal) => {
	const original =
		await importOriginal<
			typeof import("#/lib/organizations/message-channels")
		>();
	return {
		...original,
		listCurrentOrganizationMessageChannels:
			listCurrentOrganizationMessageChannelsMock,
	};
});

vi.mock("#/lib/spaces/direct-message", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/lib/spaces/direct-message")>();
	return {
		...original,
		openCurrentDirectMessageSpace: openCurrentDirectMessageSpaceMock,
	};
});

describe("DirectoryMembersOverview", () => {
	beforeEach(() => {
		workspacePropsMock.mockReset();
		navigateMock.mockReset().mockResolvedValue(undefined);
		getActiveOrganizationMemberRoleMock.mockReset().mockResolvedValue("owner");
		inviteOrganizationMemberMock.mockReset().mockResolvedValue({});
		listCurrentOrganizationDocumentsMock.mockReset().mockResolvedValue({
			canManage: true,
			currentUserId: "user-current",
			documents: [],
			organizationId: "org-acme",
		});
		readCurrentOrganizationComputersMock.mockReset().mockResolvedValue({
			computers: [],
			generatedAt: "2026-08-27T00:00:00.000Z",
			organizationId: "org-acme",
		});
		listCurrentOrganizationMessageChannelsMock.mockReset().mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [],
			identityLinks: [],
			organizationId: "org-acme",
		});
		getCurrentCenterAgentMemberResearchStatusMock
			.mockReset()
			.mockResolvedValue({ latestBatch: null, organizationId: "org-acme" });
		startCurrentCenterAgentMemberResearchMock.mockReset().mockResolvedValue({
			batch: {
				completedCount: 0,
				failedCount: 0,
				id: "batch-1",
				status: "queued",
				tasks: [],
				totalCount: 1,
			},
		});
		openCurrentDirectMessageSpaceMock.mockReset().mockResolvedValue({
			memberProfileId: CURRENT_PROFILE_ID,
			organizationId: "org-acme",
			spaceId: "space-grace-dm",
			targetProfileId: GRACE_PROFILE_ID,
		});
	});

	afterEach(cleanup);

	it("selects the current Human Profile by default and writes explicit selections to the URL", async () => {
		renderOverview();

		expect((await screen.findByTestId("selected-profile")).textContent).toBe(
			CURRENT_PROFILE_ID
		);
		expect(navigateMock).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole("button", { name: "Grace Hopper" }));
		expect(navigateMock).toHaveBeenCalledWith({
			search: { profileId: GRACE_PROFILE_ID },
			to: "/o/acme/people",
		});
	});

	it("combines invite-by-email and invite-link controls in one dialog", async () => {
		renderOverview();

		fireEvent.click(
			await screen.findByRole("button", { name: "Invite Members" })
		);
		expect(screen.getByRole("dialog")).toBeTruthy();
		expect(
			screen.getByRole("heading", { name: "Invite Members" })
		).toBeTruthy();
		expect(screen.getByLabelText("Invite link controls")).toBeTruthy();

		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "  teammate@example.com  " },
		});
		fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
		await waitFor(() => {
			expect(inviteOrganizationMemberMock).toHaveBeenCalledWith({
				email: "teammate@example.com",
				organizationId: "org-acme",
				role: "member",
			});
		});
	});

	it("keeps the Invite Members entry visible while explaining member permissions", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("member");
		renderOverview();

		fireEvent.click(
			await screen.findByRole("button", { name: "Invite Members" })
		);
		expect(
			screen.getByText(
				"Only organization owners and admins can invite teammates. Ask one of them if you need to add someone."
			)
		).toBeTruthy();
		expect(screen.queryByLabelText("Email")).toBeNull();
	});

	it("preserves member research and Direct Message behavior behind the new workspace", async () => {
		renderOverview();
		await screen.findByTestId("people-workspace");

		fireEvent.click(screen.getByRole("button", { name: "Research Grace" }));
		await waitFor(() => {
			expect(startCurrentCenterAgentMemberResearchMock).toHaveBeenCalledWith({
				expectedOrganizationId: "org-acme",
				scope: "member",
				subjectUserId: "user-grace",
			});
		});

		fireEvent.click(screen.getByRole("button", { name: "Message Grace" }));
		await waitFor(() => {
			expect(openCurrentDirectMessageSpaceMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				targetProfileId: GRACE_PROFILE_ID,
			});
		});
		expect(navigateMock).toHaveBeenCalledWith({
			to: "/o/acme/direct-messages/space-grace-dm?profileId=22222222-2222-4222-8222-222222222222",
		});
	});

	it("turns Invite Members into organization guidance in a personal workspace", async () => {
		renderOverview({ isPersonal: true });

		fireEvent.click(
			await screen.findByRole("button", { name: "Invite Members" })
		);
		expect(
			screen.getByText("Create an organization to invite members")
		).toBeTruthy();
	});
});

function renderOverview(input: { isPersonal?: boolean } = {}) {
	const queryClient = createTestQueryClient();
	queryClient.setQueryData(startQueryKeys.profileCapabilities, {
		additionalHumanProfileCreationEnabled: true,
		ok: true,
	});
	queryClient.setQueryData(
		startQueryKeys.profilesForStorageScope("user-current"),
		[buildHumanProfile()]
	);
	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<DirectoryMembersOverview
				account={{ email: "felix@example.com", name: "Felix" }}
				currentOrganization={{
					id: input.isPersonal ? "org-felix" : "org-acme",
					isPersonal: input.isPersonal ?? false,
					name: input.isPersonal ? "Felix" : "Acme",
					slug: input.isPersonal ? "felix" : "acme",
				}}
				currentUserId="user-current"
				directoryQuery={{
					data: input.isPersonal ? undefined : buildDirectory(),
					error: null,
					isError: false,
					isPending: false,
				}}
				focusProfileId={null}
				onCreateProfile={vi.fn()}
				recovery={buildRecovery()}
				storageScope="user-current"
			/>
		</TestQueryClientProvider>
	);
}

function buildDirectory(): OrganizationDirectoryResponse {
	return {
		agentProfiles: [],
		generatedAt: "2026-08-27T00:00:00.000Z",
		members: [
			buildDirectoryMember({
				memberId: "member-grace",
				name: "Grace Hopper",
				profileId: GRACE_PROFILE_ID,
				role: "admin",
				userId: "user-grace",
			}),
			buildDirectoryMember({
				memberId: "member-current",
				name: "Felix",
				profileId: CURRENT_PROFILE_ID,
				role: "owner",
				userId: "user-current",
			}),
		],
		organizationId: "org-acme",
	};
}

function buildDirectoryMember(input: {
	memberId: string;
	name: string;
	profileId: string;
	role: "admin" | "owner";
	userId: string;
}): OrganizationDirectoryResponse["members"][number] {
	return {
		humanProfile: {
			lastUsedAt: "2026-08-27T00:00:00.000Z",
			profileHandle: input.name.toLowerCase().replaceAll(" ", "-"),
			profileId: input.profileId,
			profileName: input.name,
			status: "active",
		},
		joinedAt: "2026-08-01T00:00:00.000Z",
		memberId: input.memberId,
		organizationId: "org-acme",
		role: input.role,
		user: {
			email: `${input.userId}@example.com`,
			id: input.userId,
			image: null,
			name: input.name,
		},
		userId: input.userId,
	};
}

function buildHumanProfile(): AuthProfileView {
	return {
		createdAt: "2026-08-01T00:00:00.000Z",
		createdByUserId: "user-current",
		creatorProfileId: null,
		isDefault: true,
		lastUsedAt: "2026-08-27T00:00:00.000Z",
		managedRole: null,
		ownerName: "Felix",
		ownerUserId: "user-current",
		profileHandle: "felix",
		profileKind: "human",
		profileName: "Felix",
		source: "auth_bootstrap",
		status: "active",
		updatedAt: "2026-08-27T00:00:00.000Z",
		openMeldProfileId: CURRENT_PROFILE_ID,
	};
}

function buildRecovery(): Parameters<
	typeof DirectoryMembersOverview
>[0]["recovery"] {
	return {
		currentLocalRuntimeReplyReadinessQuery: {
			data: null,
			isFetchedAfterMount: true,
			isFetching: false,
		},
		localRuntimesQuery: {
			data: { currentDeviceId: null, localRuntimes: [] },
			isPending: false,
		},
	} as unknown as Parameters<typeof DirectoryMembersOverview>[0]["recovery"];
}
