import { organizationDirectoryResponseSchema } from "@openmeld/schemas";
import type {
	AuthProfileView,
	MessageChannelConnectionProjection,
	OpenDirectMessageSpaceResponse,
	OrganizationComputerRecord,
} from "@openmeld/schemas/types";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { centerAgentMemberResearchQueryKeys } from "#/query/organizations/center-agent-member-research";
import { messageChannelQueryKeys } from "#/query/organizations/message-channels";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";
import {
	DirectoryMembersOverview,
	InvitationForm,
} from "./directory-members-overview";

const inviteOrganizationMemberMock = vi.hoisted(() => vi.fn());
const getActiveOrganizationMemberRoleMock = vi.hoisted(() => vi.fn());
const getOrganizationJoinLinkMock = vi.hoisted(() => vi.fn());
const listCurrentOrganizationDocumentsMock = vi.hoisted(() => vi.fn());
const readCurrentOrganizationComputersMock = vi.hoisted(() => vi.fn());
const listCurrentOrganizationMessageChannelsMock = vi.hoisted(() => vi.fn());
const disconnectCurrentMessageChannelIdentityLinkMock = vi.hoisted(() =>
	vi.fn()
);
const getCurrentCenterAgentMemberResearchStatusMock = vi.hoisted(() => vi.fn());
const startCurrentCenterAgentMemberResearchMock = vi.hoisted(() => vi.fn());
const openCurrentDirectMessageSpaceMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const updateUserNameMock = vi.hoisted(() => vi.fn());
const onCreateProfileMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastWarningMock = vi.hoisted(() => vi.fn());
const CURRENT_HUMAN_PROFILE_ID = "22222222-2222-4222-8222-222222222222";
const INVITE_BUTTON_LABEL = "Send invitation";
const HANDLE_PATTERN = /Handle/u;
const PROFILE_REPORT_PATTERN = /Profile Report/u;
const RECENT_ACTIVITY_PATTERN = /recent activity/u;
const REPORT_UNAVAILABLE_PATTERN = /Report unavailable/u;

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		className,
		to,
		...props
	}: {
		children: ReactNode;
		className?: string;
		to: string;
		[key: string]: unknown;
	}) => (
		<a {...props} className={className} href={to}>
			{children}
		</a>
	),
	useNavigate: () => navigateMock,
}));

vi.mock("sonner", () => ({
	toast: {
		error: toastErrorMock,
		success: toastSuccessMock,
		warning: toastWarningMock,
	},
}));

vi.mock("#/lib/spaces/direct-message", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("#/lib/spaces/direct-message")>();
	return {
		...original,
		openCurrentDirectMessageSpace: openCurrentDirectMessageSpaceMock,
	};
});

vi.mock("#/query/auth-query", async (importOriginal) => {
	const original = await importOriginal<typeof import("#/query/auth-query")>();
	return {
		...original,
		updateUserName: updateUserNameMock,
	};
});

vi.mock("#/lib/organizations/auth-organizations", () => ({
	getActiveOrganizationMemberRole: getActiveOrganizationMemberRoleMock,
	getOrganizationJoinLink: getOrganizationJoinLinkMock,
	inviteOrganizationMember: inviteOrganizationMemberMock,
	resetOrganizationJoinLink: vi.fn(),
	revokeOrganizationJoinLink: vi.fn(),
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
			queryFn: () =>
				readCurrentOrganizationComputersMock({
					organizationId: input.organizationId,
				}),
			queryKey: actual.organizationQueryKeys.computers(input.organizationId),
			retry: false,
			staleTime: 10_000,
		}),
		organizationMemberRoleQueryOptions: (input: {
			enabled: boolean;
			organizationId: string;
			userId: string;
		}) => ({
			enabled: input.enabled,
			queryFn: () => getActiveOrganizationMemberRoleMock(),
			queryKey: actual.organizationQueryKeys.role(
				input.organizationId,
				input.userId
			),
			retry: false,
			staleTime: 60_000,
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
			queryFn: () =>
				listCurrentOrganizationMessageChannelsMock({
					organizationId: input.organizationId,
				}),
			queryKey: actual.messageChannelQueryKeys.list(input.organizationId),
			retry: false,
			staleTime: 10_000,
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
		disconnectCurrentMessageChannelIdentityLink:
			disconnectCurrentMessageChannelIdentityLinkMock,
		listCurrentOrganizationMessageChannels:
			listCurrentOrganizationMessageChannelsMock,
	};
});

describe("DirectoryMembersOverview", () => {
	beforeEach(() => {
		getActiveOrganizationMemberRoleMock.mockReset().mockResolvedValue("member");
		getOrganizationJoinLinkMock.mockReset().mockResolvedValue(null);
		listCurrentOrganizationDocumentsMock.mockReset().mockResolvedValue({
			canManage: false,
			currentUserId: "user-current",
			documents: [],
			organizationId: "org-acme",
		});
		getCurrentCenterAgentMemberResearchStatusMock
			.mockReset()
			.mockResolvedValue({
				latestBatch: null,
				organizationId: "org-acme",
			});
		readCurrentOrganizationComputersMock.mockReset().mockResolvedValue({
			computers: [
				buildComputer({
					computerId: "computer-ada",
					ownerUserId: "user-ada",
					serviceState: "connected",
				}),
				buildComputer({
					computerId: "computer-grace",
					ownerUserId: "user-grace",
					serviceState: "needs_attention",
				}),
				buildComputer({
					computerId: "computer-felix",
					ownerUserId: "user-current",
					serviceState: "connected",
				}),
			],
			generatedAt: "2026-07-16T00:00:00.000Z",
			organizationId: "org-acme",
		});
		listCurrentOrganizationMessageChannelsMock.mockReset().mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [],
			identityLinks: [],
			organizationId: "org-acme",
		});
		disconnectCurrentMessageChannelIdentityLinkMock.mockReset();
		startCurrentCenterAgentMemberResearchMock.mockReset();
		openCurrentDirectMessageSpaceMock.mockReset().mockResolvedValue({
			memberProfileId: CURRENT_HUMAN_PROFILE_ID,
			organizationId: "org-acme",
			spaceId: "space-grace-dm",
			targetProfileId: "11111111-1111-4111-8111-111111111111",
		});
		navigateMock.mockReset().mockResolvedValue(undefined);
		updateUserNameMock.mockReset().mockResolvedValue({
			defaultHumanProfileId: CURRENT_HUMAN_PROFILE_ID,
			displayName: "Katherine Johnson",
			ok: true,
		});
		onCreateProfileMock.mockReset();
		toastErrorMock.mockReset();
		toastSuccessMock.mockReset();
		toastWarningMock.mockReset();
	});

	afterEach(cleanup);

	it("shows the current member without inventing a Profile Report and links collaboration guidance to organization creation", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue({
			canManage: true,
			currentUserId: "user-felix",
			documents: [],
			organizationId: "org-felix",
		});
		renderOverview({ isPersonal: true });

		expect(await screen.findByText("Felix")).toBeTruthy();
		expect(screen.getByText("felix@example.com")).toBeTruthy();
		expect(screen.getByText("Owner")).toBeTruthy();
		expect(screen.getByText("Invite members")).toBeTruthy();
		expect(
			screen.getByText(
				"Personal workspaces are just for you. Create or switch to an organization when you want to invite teammates and work together."
			)
		).toBeTruthy();
		expect(
			screen
				.getByRole("link", { name: "Create organization" })
				.getAttribute("href")
		).toBe("/o/felix/new-organization");
		expect(
			screen.queryByRole("link", { name: PROFILE_REPORT_PATTERN })
		).toBeNull();
		expect(
			await screen.findByRole("button", { name: "Learn about Felix" })
		).toBeTruthy();
		expect(
			(
				await screen.findByRole("link", {
					name: "Felix: 1 computer connected",
				})
			).getAttribute("href")
		).toBe("/o/felix/computers/computer-felix");
		expect(getActiveOrganizationMemberRoleMock).not.toHaveBeenCalled();
		expect(getOrganizationJoinLinkMock).not.toHaveBeenCalled();
		expect(inviteOrganizationMemberMock).not.toHaveBeenCalled();
		expect(listCurrentOrganizationMessageChannelsMock).not.toHaveBeenCalled();
	});

	it("explains how to create the first Human Profile in a personal workspace", async () => {
		renderOverview({ isPersonal: true, personalProfiles: [] });

		expect(
			await screen.findByText(
				"You don't have a Human Profile in this workspace yet. Create one to choose the name and identity you use in Spaces."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Create Human Profile" })
		).toBeTruthy();
	});

	it("does not point to Human Profile creation when that capability is unavailable", async () => {
		renderOverview({
			additionalHumanProfileCreationEnabled: false,
			isPersonal: true,
			personalProfiles: [],
		});

		expect(
			await screen.findByText(
				"You don't have a Human Profile in this workspace yet."
			)
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Create Human Profile" })
		).toBeNull();
	});

	it("keeps the member directory primary and explains invitation permissions", async () => {
		renderOverview({ isPersonal: false });

		expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("ada@example.com")).toBeTruthy();
		expect(
			await screen.findByText(
				"Only organization owners and admins can invite teammates. Ask one of them if you need to add someone."
			)
		).toBeTruthy();
		expect(screen.queryByText("Invite link")).toBeNull();
		expect(getOrganizationJoinLinkMock).not.toHaveBeenCalled();
	});

	it("does not guess between Learn and Report when Documents fail to load", async () => {
		listCurrentOrganizationDocumentsMock.mockRejectedValue(
			new Error("Documents unavailable")
		);
		renderOverview({ isPersonal: false });

		expect(
			await screen.findByText(
				"Report links are unavailable because Documents could not be loaded."
			)
		).toBeTruthy();
		const [adaCard] = await screen.findAllByTestId(
			"organization-human-profile-row"
		);
		if (!adaCard) {
			throw new Error("Expected Ada's Human Profile card.");
		}
		expect(within(adaCard).queryByText(REPORT_UNAVAILABLE_PATTERN)).toBeNull();
		expect(
			within(adaCard).queryByRole("button", {
				name: "Learn about Ada Lovelace",
			})
		).toBeNull();
	});

	it("consolidates member actions and roles into Human Profile cards", async () => {
		renderOverview({ isPersonal: false });

		const profileCards = await screen.findAllByTestId(
			"organization-human-profile-row"
		);
		expect(profileCards).toHaveLength(2);
		expect(
			screen.getByRole("heading", { level: 2, name: "Human Profiles" })
		).toBeTruthy();
		expect(
			screen.getByText(
				"A Human Profile is the name and identity each member uses in Spaces. The Center Agent can learn about members and keep their Profile Reports up to date."
			)
		).toBeTruthy();
		expect(screen.queryByRole("heading", { name: "Members" })).toBeNull();
		expect(screen.queryByText("1 Human Profile")).toBeNull();

		const adaCard = profileCards[0];
		if (!adaCard) {
			throw new Error("Expected Ada's Human Profile card.");
		}
		expect(within(adaCard).getByText("Ada Lovelace")).toBeTruthy();
		expect(within(adaCard).getByText("ada@example.com")).toBeTruthy();
		expect(
			await within(adaCard).findByText("1 computer connected")
		).toBeTruthy();
		expect(within(adaCard).queryByText(HANDLE_PATTERN)).toBeNull();
		expect(within(adaCard).queryByText(RECENT_ACTIVITY_PATTERN)).toBeNull();
		expect(within(adaCard).queryByText("Active")).toBeNull();
		expect(
			within(adaCard).queryByRole("link", { name: PROFILE_REPORT_PATTERN })
		).toBeNull();
		const learnAction = within(adaCard).getByRole("button", {
			name: "Learn about Ada Lovelace",
		});
		expect(learnAction.querySelector("svg")).toBeTruthy();
		expect(learnAction.className).toContain("border-transparent");
		expect(learnAction.className).toContain("hover:bg-muted");
		expect(learnAction.getAttribute("aria-description")).toBe(
			"Learn about Ada Lovelace and update their Profile Report."
		);
		expect(adaCard.firstElementChild?.contains(learnAction)).toBe(true);
		expect(within(adaCard).getByText("Owner")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Learn about all members" })
		).toBeTruthy();

		const graceCard = profileCards[1];
		if (!graceCard) {
			throw new Error("Expected Grace's Human Profile card.");
		}
		expect(
			await within(graceCard).findByText("1 computer needs attention")
		).toBeTruthy();
		expect(within(graceCard).queryByText(HANDLE_PATTERN)).toBeNull();
		expect(within(graceCard).queryByText("Active")).toBeNull();
		expect(within(graceCard).getByText("Admin")).toBeTruthy();
		expect(
			within(graceCard)
				.getByTestId(
					"human-profile-avatar-11111111-1111-4111-8111-111111111111"
				)
				.querySelector("canvas")
				?.getAttribute("data-profile-avatar-seed")
		).toBe(
			"openmeld-dither-profile-avatar:v1:human:11111111-1111-4111-8111-111111111111"
		);
		expect(
			within(graceCard).getByRole("button", { name: "Direct Message" })
				.textContent
		).toBe("");
		expect(
			within(graceCard).getByRole("button", {
				name: "Profile options for Grace Hopper",
			}).textContent
		).toBe("");

		fireEvent.click(
			screen.getByRole("button", { name: "Create Human Profile" })
		);
		expect(onCreateProfileMock).toHaveBeenCalledOnce();
	});

	it("sorts the current member first, then orders everyone else by role", async () => {
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const [currentCard, adminCard] = await screen.findAllByTestId(
			"organization-human-profile-row"
		);
		if (!(currentCard && adminCard)) {
			throw new Error("Expected both Organization Human Profile cards.");
		}
		expect(within(currentCard).getByText("Felix")).toBeTruthy();
		expect(within(currentCard).getByText("(you)")).toBeTruthy();
		expect(within(currentCard).getByText("Member")).toBeTruthy();
		expect(within(adminCard).getByText("Grace Hopper")).toBeTruthy();
		expect(within(adminCard).getByText("Admin")).toBeTruthy();
	});

	it("opens a Human conversation in the dedicated Direct Messages route", async () => {
		renderOverview({ isPersonal: false });

		const graceCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		).find((card) => within(card).queryByText("Grace Hopper"));
		if (!graceCard) {
			throw new Error("Expected Grace's Human Profile card.");
		}

		fireEvent.click(
			within(graceCard).getByRole("button", { name: "Direct Message" })
		);

		await waitFor(() => {
			expect(openCurrentDirectMessageSpaceMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				targetProfileId: "11111111-1111-4111-8111-111111111111",
			});
			expect(navigateMock).toHaveBeenCalledWith({
				to: `/o/acme/direct-messages/space-grace-dm?profileId=${CURRENT_HUMAN_PROFILE_ID}`,
			});
		});
	});

	it("serializes repeated Human Direct Message opens", async () => {
		let resolveOpen:
			| ((value: OpenDirectMessageSpaceResponse) => void)
			| undefined;
		openCurrentDirectMessageSpaceMock.mockImplementationOnce(
			async () =>
				await new Promise<OpenDirectMessageSpaceResponse>((resolve) => {
					resolveOpen = resolve;
				})
		);
		renderOverview({ isPersonal: false });

		const graceCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		).find((card) => within(card).queryByText("Grace Hopper"));
		if (!graceCard) {
			throw new Error("Expected Grace's Human Profile card.");
		}
		const directMessageButton = within(graceCard).getByRole("button", {
			name: "Direct Message",
		});

		fireEvent.click(directMessageButton);
		await waitFor(() => {
			expect(openCurrentDirectMessageSpaceMock).toHaveBeenCalledTimes(1);
		});
		fireEvent.click(directMessageButton);
		expect(openCurrentDirectMessageSpaceMock).toHaveBeenCalledTimes(1);

		act(() => {
			resolveOpen?.({
				created: false,
				memberProfileId: CURRENT_HUMAN_PROFILE_ID,
				organizationId: "org-acme",
				spaceId: "space-grace-dm",
				targetProfileId: "11111111-1111-4111-8111-111111111111",
			});
		});
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledTimes(1);
		});
	});

	it("opens a complete Human Profile drawer from the member card", async () => {
		renderOverview({ isPersonal: false });

		const graceCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		).find((card) => within(card).queryByText("Grace Hopper"));
		if (!graceCard) {
			throw new Error("Expected Grace's Human Profile card.");
		}

		fireEvent.click(
			within(graceCard).getByRole("button", {
				name: "Open Grace Hopper's profile",
			})
		);

		const detailsDialog = await screen.findByRole("dialog", {
			name: "Profile",
		});
		expect(within(detailsDialog).getByText("Member account")).toBeTruthy();
		expect(within(detailsDialog).getByText("Work access")).toBeTruthy();
		expect(
			within(detailsDialog).getByText("Connected identities")
		).toBeTruthy();
		expect(within(detailsDialog).getByText("Jul 2, 2026")).toBeTruthy();
		expect(
			within(detailsDialog).getAllByText("Human Profile").length
		).toBeGreaterThan(0);
		expect(
			screen.getByText("11111111-1111-4111-8111-111111111111")
		).toBeTruthy();
	});

	it("keeps a disabled organization Human Profile inspectable without Direct Message", async () => {
		renderOverview({ graceProfileStatus: "disabled", isPersonal: false });

		const graceCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		).find((card) => within(card).queryByText("Grace Hopper"));
		if (!graceCard) {
			throw new Error("Expected Grace's Human Profile card.");
		}

		expect(
			within(graceCard).queryByRole("button", {
				name: "Direct Message",
			})
		).toBeNull();
		expect(
			within(graceCard).getByRole("button", {
				name: "Open Grace Hopper's profile",
			})
		).toBeTruthy();
	});

	it("keeps a disabled personal Human Profile inspectable without edit actions", async () => {
		renderOverview({
			isPersonal: true,
			personalProfiles: [{ ...buildHumanProfile(), status: "disabled" }],
		});

		const profileCard = await screen.findByTestId("human-profile-row");
		expect(
			within(profileCard).queryByRole("button", {
				name: "Edit Human Profile",
			})
		).toBeNull();
		expect(
			within(profileCard).getByRole("button", {
				name: "Open Felix's profile",
			})
		).toBeTruthy();
	});

	it("lets the current member edit their default Human Profile name", async () => {
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const currentMemberCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		).find((card) => within(card).queryByText("Felix"));
		if (!currentMemberCard) {
			throw new Error("Expected the current member's Human Profile card.");
		}

		expect(
			within(currentMemberCard).queryByRole("button", {
				name: "Direct Message",
			})
		).toBeNull();
		fireEvent.click(
			within(currentMemberCard).getByRole("button", {
				name: "Open Felix's profile",
			})
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Edit profile" })
		);
		const profileDrawer = screen.getByRole("dialog", { name: "Profile" });
		const nameInput = await within(profileDrawer).findByRole("textbox", {
			name: "Name",
		});
		expect(
			screen.queryByRole("dialog", { name: "Edit Human Profile" })
		).toBeNull();
		fireEvent.change(nameInput, { target: { value: "Katherine Johnson" } });
		fireEvent.click(
			within(profileDrawer).getByRole("button", { name: "Save changes" })
		);

		await waitFor(() => {
			expect(updateUserNameMock).toHaveBeenCalled();
			expect(updateUserNameMock.mock.calls[0]?.[0]).toBe("Katherine Johnson");
		});
		expect(screen.getByRole("dialog", { name: "Profile" })).toBeTruthy();
		expect(
			within(screen.getByRole("dialog", { name: "Profile" })).queryByRole(
				"textbox",
				{ name: "Name" }
			)
		).toBeNull();
	});

	it("opens card editing inside the padded Profile action menu and Drawer", async () => {
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const currentMemberCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		).find((card) => within(card).queryByText("Felix"));
		if (!currentMemberCard) {
			throw new Error("Expected the current member's Human Profile card.");
		}

		fireEvent.click(
			within(currentMemberCard).getByRole("button", {
				name: "Profile options for Felix",
			})
		);
		const profileMenu = await screen.findByRole("menu");
		expect(profileMenu.classList.contains("p-1")).toBe(true);
		fireEvent.click(
			within(profileMenu).getByRole("menuitem", { name: "Edit profile" })
		);

		const profileDrawer = await screen.findByRole("dialog", {
			name: "Profile",
		});
		expect(
			within(profileDrawer).getByRole("textbox", { name: "Name" })
		).toBeTruthy();
		expect(
			screen.queryByRole("dialog", { name: "Edit Human Profile" })
		).toBeNull();
	});

	it("keeps a Human Profile name update failure visible in the Drawer", async () => {
		updateUserNameMock.mockRejectedValueOnce(
			new Error("The display name could not be saved.")
		);
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const currentMemberCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		).find((card) => within(card).queryByText("Felix"));
		if (!currentMemberCard) {
			throw new Error("Expected the current member's Human Profile card.");
		}

		fireEvent.click(
			within(currentMemberCard).getByRole("button", {
				name: "Open Felix's profile",
			})
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Edit profile" })
		);
		const profileDrawer = screen.getByRole("dialog", { name: "Profile" });
		fireEvent.change(
			within(profileDrawer).getByRole("textbox", { name: "Name" }),
			{
				target: { value: "Katherine Johnson" },
			}
		);
		fireEvent.click(
			within(profileDrawer).getByRole("button", { name: "Save changes" })
		);

		expect(
			(await within(profileDrawer).findByRole("alert")).textContent
		).toContain("The display name could not be saved.");
		expect(
			screen.queryByRole("dialog", { name: "Edit Human Profile" })
		).toBeNull();
		expect(screen.getByRole("dialog", { name: "Profile" })).toBeTruthy();
	});

	it("shows each member's Computer state with a matching icon and destination", async () => {
		renderOverview({ isPersonal: false });

		const [adaCard, graceCard] = await screen.findAllByTestId(
			"organization-human-profile-row"
		);
		if (!(adaCard && graceCard)) {
			throw new Error("Expected both Organization Human Profile cards.");
		}
		const connectedStatus = await within(adaCard).findByText(
			"1 computer connected"
		);
		const needsAttentionStatus = await within(graceCard).findByText(
			"1 computer needs attention"
		);
		expect(connectedStatus).toBeTruthy();
		expect(needsAttentionStatus).toBeTruthy();
		const computerLink = within(adaCard).getByRole("link", {
			name: "Ada Lovelace: 1 computer connected",
		});
		expect(computerLink.getAttribute("href")).toBe(
			"/o/acme/computers/computer%3Acomputer-ada"
		);
		expect(computerLink.querySelector("svg")?.className.baseVal).toContain(
			"text-emerald"
		);
		expect(readCurrentOrganizationComputersMock).toHaveBeenCalledWith(
			expect.objectContaining({ organizationId: "org-acme" })
		);
	});

	it("keeps Human Profile cards visible when Computer status is unavailable", async () => {
		readCurrentOrganizationComputersMock.mockRejectedValue(
			new Error("Runtime Transport lookup failed")
		);
		renderOverview({ isPersonal: false });

		const profileCards = await screen.findAllByTestId(
			"organization-human-profile-row"
		);
		expect(profileCards).toHaveLength(2);
		expect(screen.getByText("Ada Lovelace")).toBeTruthy();
		expect(screen.getByText("Grace Hopper")).toBeTruthy();
		expect(
			await screen.findAllByText("Computer status unavailable")
		).toHaveLength(2);
	});

	it("stops showing cached Computer status after a refresh fails", async () => {
		const queryClient = createTestQueryClient();
		renderOverview({ isPersonal: false }, queryClient);

		expect(await screen.findByText("1 computer connected")).toBeTruthy();
		readCurrentOrganizationComputersMock.mockRejectedValue(
			new Error("Runtime Transport refresh failed")
		);

		await act(async () => {
			await queryClient.refetchQueries({
				queryKey: organizationQueryKeys.computers("org-acme"),
			});
		});

		await waitFor(() => {
			expect(screen.queryByText("1 computer connected")).toBeNull();
		});
		expect(
			await screen.findAllByText("Computer status unavailable")
		).toHaveLength(2);
	});

	it("keeps not-connected and unknown Computer states distinct", async () => {
		readCurrentOrganizationComputersMock.mockResolvedValue({
			computers: [
				buildComputer({
					computerId: "computer-ada",
					ownerUserId: "user-ada",
					serviceState: "not_connected",
				}),
				buildComputer({
					computerId: "computer-grace",
					ownerUserId: "user-grace",
					serviceState: "unknown",
				}),
			],
			generatedAt: "2026-07-16T00:00:00.000Z",
			organizationId: "org-acme",
		});
		renderOverview({ isPersonal: false });

		expect(await screen.findAllByText("No computer connected")).toHaveLength(2);
		const profileCards = await screen.findAllByTestId(
			"organization-human-profile-row"
		);
		const graceCard = profileCards[1];
		if (!graceCard) {
			throw new Error("Expected Grace's Human Profile card.");
		}
		expect(
			within(graceCard).getByRole("link", {
				name: "Grace Hopper: No computer connected",
			})
		).toBeTruthy();
	});

	it("gives the current member a direct path to connect their first Computer", async () => {
		readCurrentOrganizationComputersMock.mockResolvedValue({
			computers: [],
			generatedAt: "2026-07-16T00:00:00.000Z",
			organizationId: "org-acme",
		});
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const currentCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		)[0];
		if (!currentCard) {
			throw new Error("Expected the current member's Human Profile card.");
		}
		expect(
			(
				await within(currentCard).findByRole("link", {
					name: "Felix: Connect a computer",
				})
			).getAttribute("href")
		).toBe("/o/acme/connect?session=fresh");
		expect(
			within(currentCard).getAllByRole("link", {
				name: "Felix: Connect a computer",
			})
		).toHaveLength(1);
	});

	it("shows provider identity states and lets a member manage their own account", async () => {
		const identityLinkId = `channel_identity_${"a".repeat(64)}`;
		listCurrentOrganizationMessageChannelsMock.mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [
				buildChannelConnection({ id: "slack:T123", provider: "slack" }),
				buildChannelConnection({ id: "lark-connection", provider: "lark" }),
			],
			identityLinks: [
				{
					connectedAt: "2026-07-16T00:00:00.000Z",
					id: identityLinkId,
					openMeldUserId: "user-current",
					provider: "slack",
					providerAccountName: "@felix",
				},
			],
			organizationId: "org-acme",
		});
		disconnectCurrentMessageChannelIdentityLinkMock.mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [
				buildChannelConnection({ id: "slack:T123", provider: "slack" }),
				buildChannelConnection({ id: "lark-connection", provider: "lark" }),
			],
			identityLinks: [],
			organizationId: "org-acme",
		});
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const currentCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		)[0];
		if (!currentCard) {
			throw new Error("Expected the current member's Human Profile card.");
		}
		expect(
			await within(currentCard).findByRole("button", {
				name: "Slack account: Account email unavailable",
			})
		).toBeTruthy();
		expect(
			within(currentCard).getByRole("button", {
				name: "Lark account: No account connected",
			})
		).toBeTruthy();
		expect(
			within(currentCard)
				.getByTestId("app-logo-slack")
				.classList.contains("grayscale")
		).toBe(false);
		expect(
			within(currentCard)
				.getByTestId("app-logo-lark")
				.classList.contains("grayscale")
		).toBe(true);
		expect(
			within(currentCard).getByText("Account email unavailable")
		).toBeTruthy();
		expect(within(currentCard).queryByText("Linked")).toBeNull();
		fireEvent.click(
			within(currentCard).getByRole("button", {
				name: "Slack account: Account email unavailable",
			})
		);
		const identityDrawer = await screen.findByRole("dialog", {
			name: "Profile",
		});
		expect(
			within(identityDrawer).getByText("Account email unavailable")
		).toBeTruthy();
		expect(within(identityDrawer).queryByText("Linked")).toBeNull();
		fireEvent.click(
			within(identityDrawer).getByRole("button", { name: "Manage" })
		);
		fireEvent.click(
			await screen.findByRole("button", { name: "Disconnect account" })
		);

		await waitFor(() => {
			expect(
				disconnectCurrentMessageChannelIdentityLinkMock
			).toHaveBeenCalledWith({
				identityLinkId,
				organizationId: "org-acme",
			});
		});
		expect(toastSuccessMock).toHaveBeenCalledWith(
			"Connected account disconnected."
		);
	});

	it("shows a provider account email consistently in the card and profile details", async () => {
		listCurrentOrganizationMessageChannelsMock.mockResolvedValue({
			availableLarkPlatformProviders: [],
			connections: [
				buildChannelConnection({ id: "slack:T123", provider: "slack" }),
			],
			identityLinks: [
				{
					connectedAt: "2026-07-16T00:00:00.000Z",
					id: `channel_identity_${"d".repeat(64)}`,
					openMeldUserId: "user-current",
					provider: "slack",
					providerAccountName: "felix@amplift.ai",
				},
			],
			organizationId: "org-acme",
		});
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const currentCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		)[0];
		if (!currentCard) {
			throw new Error("Expected the current member's Human Profile card.");
		}
		const identityButton = await within(currentCard).findByRole("button", {
			name: "Slack account: felix@amplift.ai",
		});
		expect(within(currentCard).getByText("felix@amplift.ai")).toBeTruthy();

		fireEvent.click(identityButton);
		expect(
			within(await screen.findByRole("dialog", { name: "Profile" })).getByText(
				"felix@amplift.ai"
			)
		).toBeTruthy();
	});

	it("offers the current member a connection when another member owns that provider account", async () => {
		listCurrentOrganizationMessageChannelsMock.mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [
				buildChannelConnection({ id: "slack:T123", provider: "slack" }),
			],
			identityLinks: [
				{
					connectedAt: "2026-07-16T00:00:00.000Z",
					id: `channel_identity_${"b".repeat(64)}`,
					openMeldUserId: "user-grace",
					provider: "slack",
					providerAccountName: "@grace",
				},
			],
			organizationId: "org-acme",
		});
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const currentCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		)[0];
		if (!currentCard) {
			throw new Error("Expected the current member's Human Profile card.");
		}
		expect(
			await within(currentCard).findByRole("button", {
				name: "Slack account: No account connected",
			})
		).toBeTruthy();
		expect(
			within(currentCard)
				.getByTestId("app-logo-slack")
				.classList.contains("grayscale")
		).toBe(true);
		expect(within(currentCard).queryByText("No account connected")).toBeNull();
		expect(within(currentCard).queryByText("@grace")).toBeNull();
		fireEvent.click(
			within(currentCard).getByRole("button", {
				name: "Slack account: No account connected",
			})
		);
		expect(
			within(await screen.findByRole("dialog", { name: "Profile" })).getByRole(
				"button",
				{ name: "Connect" }
			)
		).toBeTruthy();
	});

	it("stops offering a cached Channel connection after its refresh fails", async () => {
		const queryClient = createTestQueryClient();
		listCurrentOrganizationMessageChannelsMock.mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [
				buildChannelConnection({ id: "slack:T123", provider: "slack" }),
			],
			identityLinks: [],
			organizationId: "org-acme",
		});
		renderOverview(
			{ currentUserProfile: true, isPersonal: false },
			queryClient
		);

		const currentCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		)[0];
		if (!currentCard) {
			throw new Error("Expected the current member's Human Profile card.");
		}
		fireEvent.click(
			await within(currentCard).findByRole("button", {
				name: "Slack account: No account connected",
			})
		);
		const identityDrawer = await screen.findByRole("dialog", {
			name: "Profile",
		});
		expect(
			within(identityDrawer).getByRole("button", { name: "Connect" })
		).toBeTruthy();
		listCurrentOrganizationMessageChannelsMock.mockRejectedValue(
			new Error("Message Channels refresh failed")
		);

		await act(async () => {
			await queryClient.refetchQueries({
				queryKey: messageChannelQueryKeys.list("org-acme"),
			});
		});

		await waitFor(() => {
			expect(
				within(currentCard).queryByRole("button", {
					name: "Slack account: No account connected",
				})
			).toBeNull();
		});
	});

	it("lets an Organization owner manage another member's connected account", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("owner");
		listCurrentOrganizationMessageChannelsMock.mockResolvedValue({
			availableLarkPlatformProviders: ["lark"],
			connections: [
				buildChannelConnection({ id: "slack:T123", provider: "slack" }),
			],
			identityLinks: [
				{
					connectedAt: "2026-07-16T00:00:00.000Z",
					id: `channel_identity_${"c".repeat(64)}`,
					openMeldUserId: "user-grace",
					provider: "slack",
					providerAccountName: "@grace",
				},
			],
			organizationId: "org-acme",
		});
		renderOverview({ currentUserProfile: true, isPersonal: false });

		const graceCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		)[1];
		if (!graceCard) {
			throw new Error("Expected Grace's Human Profile card.");
		}
		expect(
			await within(graceCard).findByRole("button", {
				name: "Slack account: Account email unavailable",
			})
		).toBeTruthy();
		fireEvent.click(
			within(graceCard).getByRole("button", {
				name: "Slack account: Account email unavailable",
			})
		);
		expect(
			within(await screen.findByRole("dialog", { name: "Profile" })).getByRole(
				"button",
				{ name: "Manage" }
			)
		).toBeTruthy();
	});

	it("does not show Connected accounts when the Organization has no connected provider", async () => {
		renderOverview({ currentUserProfile: true, isPersonal: false });

		expect(await screen.findByText("Felix")).toBeTruthy();
		expect(screen.queryByText("Connected accounts")).toBeNull();
		expect(screen.queryByRole("button", { name: "Connect" })).toBeNull();
	});

	it("hides Human Profile creation when Auth disables the capability", async () => {
		renderOverview({
			additionalHumanProfileCreationEnabled: false,
			isPersonal: false,
		});

		expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Learn about all members" })
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Create Human Profile" })
		).toBeNull();
	});

	it("shows the invitation form to owners", async () => {
		getActiveOrganizationMemberRoleMock.mockResolvedValue("owner");
		renderOverview({ isPersonal: false });

		expect(await screen.findByLabelText("Email")).toBeTruthy();
		expect(
			screen.getByText(
				"Invite a teammate to join this organization and work together in Spaces."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: INVITE_BUTTON_LABEL })
		).toBeTruthy();
		expect(await screen.findByText("Invite link")).toBeTruthy();
		expect(getOrganizationJoinLinkMock).toHaveBeenCalledWith({
			organizationId: "org-acme",
		});
	});

	it("shows only Profile Reports that already exist", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue({
			canManage: true,
			currentUserId: "user-owner",
			documents: [
				{
					canEditContent: true,
					canManage: true,
					createdAt: "2026-08-14T00:00:00.000Z",
					folderId: "folder-ada",
					hasDraft: false,
					id: "document-ada-latest",
					kind: "member_profile",
					organizationId: "org-acme",
					profileReportDate: "2026-08-14",
					profileReportType: "work_profile",
					subjectUserId: "user-ada",
					title: "2026-08-14 — Work Profile",
					updatedAt: "2026-08-14T00:00:00.000Z",
				},
				{
					canEditContent: true,
					canManage: true,
					createdAt: "2026-07-15T00:00:00.000Z",
					folderId: "folder-ada",
					hasDraft: false,
					id: "document-ada-older",
					kind: "member_profile",
					organizationId: "org-acme",
					profileReportDate: "2026-07-15",
					profileReportType: "work_profile",
					subjectUserId: "user-ada",
					title: "2026-07-15 — Work Profile",
					updatedAt: "2026-07-15T00:00:00.000Z",
				},
			],
			organizationId: "org-acme",
		});
		renderOverview({ isPersonal: false });

		expect(
			(
				await screen.findByRole("link", {
					name: "Open Ada Lovelace's Profile Report",
				})
			).getAttribute("href")
		).toBe("/o/acme/documents/document-ada-latest");
		expect(
			screen.queryByRole("link", {
				name: "Open Grace Hopper's Profile Report",
			})
		).toBeNull();
		expect(
			screen.getByRole("button", { name: "Learn about Grace Hopper" })
		).toBeTruthy();
	});

	it("keeps the newest same-day Profile Report selected after an older report is edited", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue({
			canManage: true,
			currentUserId: "user-owner",
			documents: [
				{
					canEditContent: true,
					canManage: true,
					createdAt: "2026-08-15T10:00:00.000Z",
					folderId: "folder-ada",
					hasDraft: false,
					id: "document-ada-newer",
					kind: "member_profile",
					organizationId: "org-acme",
					profileReportDate: "2026-08-15",
					profileReportType: "work_profile",
					subjectUserId: "user-ada",
					title: "2026-08-15 — Work Profile (2)",
					updatedAt: "2026-08-15T10:00:00.000Z",
				},
				{
					canEditContent: true,
					canManage: true,
					createdAt: "2026-08-15T09:00:00.000Z",
					folderId: "folder-ada",
					hasDraft: false,
					id: "document-ada-older",
					kind: "member_profile",
					organizationId: "org-acme",
					profileReportDate: "2026-08-15",
					profileReportType: "work_profile",
					subjectUserId: "user-ada",
					title: "2026-08-15 — Work Profile",
					updatedAt: "2026-08-15T11:00:00.000Z",
				},
			],
			organizationId: "org-acme",
		});
		renderOverview({ isPersonal: false });

		expect(
			(
				await screen.findAllByRole("link", {
					name: "Open Ada Lovelace's Profile Report",
				})
			)[0]?.getAttribute("href")
		).toBe("/o/acme/documents/document-ada-newer");
	});

	it("lets members open an existing profile without offering an unauthorized create path", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue({
			canManage: false,
			currentUserId: "user-ada",
			documents: [
				{
					canEditContent: true,
					canManage: false,
					createdAt: "2026-07-15T00:00:00.000Z",
					hasDraft: false,
					id: "document-ada",
					kind: "member_profile",
					organizationId: "org-acme",
					subjectUserId: "user-ada",
					title: "Ada Lovelace Profile Report",
					updatedAt: "2026-07-15T00:00:00.000Z",
				},
			],
			organizationId: "org-acme",
		});
		renderOverview({ isPersonal: false });

		expect(
			(
				await screen.findByRole("link", {
					name: "Open Ada Lovelace's Profile Report",
				})
			).getAttribute("href")
		).toBe("/o/acme/documents/document-ada");
		expect(
			screen.getAllByRole("link", {
				name: "Open Ada Lovelace's Profile Report",
			})
		).toHaveLength(1);
		const graceCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		)[1];
		if (!graceCard) {
			throw new Error("Expected Grace's Human Profile card.");
		}
		expect(
			within(graceCard).getByRole("button", {
				name: "Learn about Grace Hopper",
			})
		).toBeTruthy();
	});

	it("starts one member research task from that member's row", async () => {
		startCurrentCenterAgentMemberResearchMock.mockImplementation(
			() => new Promise(() => undefined)
		);
		renderOverview({ isPersonal: false });

		const researchButton = await screen.findByRole("button", {
			name: "Learn about Ada Lovelace",
		});
		fireEvent.click(researchButton);

		await waitFor(() => {
			expect(startCurrentCenterAgentMemberResearchMock).toHaveBeenCalledWith({
				expectedOrganizationId: "org-acme",
				scope: "member",
				subjectUserId: "user-ada",
			});
		});
		expect(screen.getByRole("button", { name: "Starting…" })).toBeTruthy();
	});

	it("keeps a member research start failure on that member's card", async () => {
		startCurrentCenterAgentMemberResearchMock.mockRejectedValue({
			code: "center_agent.designation_required",
			message: "designation required",
		});
		renderOverview({ isPersonal: false });

		const [adaCard] = await screen.findAllByTestId(
			"organization-human-profile-row"
		);
		if (!adaCard) {
			throw new Error("Expected Ada's Human Profile card.");
		}
		fireEvent.click(
			await within(adaCard).findByRole("button", {
				name: "Learn about Ada Lovelace",
			})
		);

		expect(
			await within(adaCard).findByText(
				"Connect this Organization's Center Agent before learning about members."
			)
		).toBeTruthy();
		expect(
			within(adaCard).getByRole("button", { name: "Try again" })
		).toBeTruthy();
		expect(
			screen.getAllByText(
				"Connect this Organization's Center Agent before learning about members."
			)
		).toHaveLength(1);
	});

	it("shows one personal member card when more than one Human Profile exists", async () => {
		listCurrentOrganizationDocumentsMock.mockResolvedValue({
			canManage: true,
			currentUserId: "user-felix",
			documents: [],
			organizationId: "org-felix",
		});
		renderOverview({
			isPersonal: true,
			personalProfiles: [
				{ ...buildHumanProfile(), isDefault: false, profileName: "Old Felix" },
				buildHumanProfile(),
			],
		});

		expect(await screen.findAllByTestId("human-profile-row")).toHaveLength(1);
		expect(screen.getByText("Felix")).toBeTruthy();
		expect(screen.queryByText("Old Felix")).toBeNull();
	});

	it("shows one draft review action without a duplicate Draft badge", async () => {
		getCurrentCenterAgentMemberResearchStatusMock.mockResolvedValue({
			latestBatch: {
				completedCount: 2,
				createdAt: "2026-07-16T00:00:00.000Z",
				failedCount: 1,
				id: "research-batch-1",
				organizationId: "org-acme",
				scope: "all",
				status: "running",
				tasks: [
					{
						failureCode: null,
						finishedAt: "2026-07-16T00:00:01.000Z",
						id: "research-task-grace",
						position: 1,
						startedAt: "2026-07-16T00:00:00.000Z",
						status: "completed",
						subjectDisplayName: "Grace Hopper",
						subjectUserId: "user-grace",
					},
					{
						failureCode: null,
						finishedAt: "2026-07-16T00:00:02.000Z",
						id: "research-task-katherine",
						position: 2,
						startedAt: "2026-07-16T00:00:01.000Z",
						status: "completed",
						subjectDisplayName: "Katherine Johnson",
						subjectUserId: "user-katherine",
					},
					{
						failureCode: "remote_agent.worker_unavailable",
						finishedAt: "2026-07-16T00:00:03.000Z",
						id: "research-task-dorothy",
						position: 3,
						startedAt: "2026-07-16T00:00:02.000Z",
						status: "failed",
						subjectDisplayName: "Dorothy Vaughan",
						subjectUserId: "user-dorothy",
					},
					{
						failureCode: null,
						finishedAt: null,
						id: "research-task-ada",
						position: 4,
						startedAt: "2026-07-16T00:00:01.000Z",
						status: "running",
						subjectDisplayName: "Ada Lovelace",
						subjectUserId: "user-ada",
					},
				],
				totalCount: 4,
				updatedAt: "2026-07-16T00:00:01.000Z",
			},
			organizationId: "org-acme",
		});
		listCurrentOrganizationDocumentsMock.mockResolvedValue({
			canManage: true,
			currentUserId: "user-owner",
			documents: [
				{
					canEditContent: true,
					canManage: true,
					createdAt: "2026-07-15T00:00:00.000Z",
					hasDraft: true,
					id: "document-ada",
					kind: "member_profile",
					organizationId: "org-acme",
					subjectUserId: "user-ada",
					title: "Ada Lovelace Profile Report",
					updatedAt: "2026-07-16T00:00:00.000Z",
				},
			],
			organizationId: "org-acme",
		});

		renderOverview({ isPersonal: false });

		expect(
			await screen.findByRole("button", { name: "Learning 3/4" })
		).toBeTruthy();
		const adaCard = (
			await screen.findAllByTestId("organization-human-profile-row")
		).find((card) => within(card).queryByText("Ada Lovelace"));
		if (!adaCard) {
			throw new Error("Expected Ada's Human Profile card.");
		}
		const profileReportAction = within(adaCard).getByRole("link", {
			name: "Open Ada Lovelace's Profile Report — updates to review and save",
		});
		expect(profileReportAction.className).toContain("border-transparent");
		expect(profileReportAction.className).toContain("hover:bg-muted");
		expect(profileReportAction.className).not.toContain("border-amber-");
		expect(profileReportAction.className).toContain("text-amber-");
		expect(profileReportAction.querySelector("svg")).toBeTruthy();
		expect(adaCard.firstElementChild?.contains(profileReportAction)).toBe(true);
		expect(within(adaCard).queryByText("Draft available")).toBeNull();
		expect(within(adaCard).queryByText("Draft ready")).toBeNull();
		expect(
			within(adaCard).queryByRole("button", { name: "Finishing…" })
		).toBeNull();
	});

	it("toasts once when research observed on this page reaches a terminal result", async () => {
		const queryClient = createTestQueryClient();
		const runningBatch = {
			completedCount: 0,
			createdAt: "2026-07-16T00:00:00.000Z",
			failedCount: 0,
			id: "research-batch-toast",
			organizationId: "org-acme",
			scope: "member" as const,
			status: "running" as const,
			tasks: [
				{
					failureCode: null,
					finishedAt: null,
					id: "research-task-ada-toast",
					position: 1,
					startedAt: "2026-07-16T00:00:00.000Z",
					status: "running" as const,
					subjectDisplayName: "Ada Lovelace",
					subjectUserId: "user-ada",
				},
			],
			totalCount: 1,
			updatedAt: "2026-07-16T00:00:00.000Z",
		};
		getCurrentCenterAgentMemberResearchStatusMock.mockResolvedValue({
			latestBatch: runningBatch,
			organizationId: "org-acme",
		});
		renderOverview({ isPersonal: false }, queryClient);

		expect(
			await screen.findByRole("button", { name: "Learning 0/1" })
		).toBeTruthy();
		expect(toastSuccessMock).not.toHaveBeenCalled();

		act(() => {
			queryClient.setQueryData(
				centerAgentMemberResearchQueryKeys.status("org-acme"),
				{
					latestBatch: {
						...runningBatch,
						completedCount: 1,
						status: "completed",
						tasks: [
							{
								...runningBatch.tasks[0],
								finishedAt: "2026-07-16T00:00:03.000Z",
								status: "completed",
							},
						],
						updatedAt: "2026-07-16T00:00:03.000Z",
					},
					organizationId: "org-acme",
				}
			);
		});

		await waitFor(() => {
			expect(toastSuccessMock).toHaveBeenCalledWith(
				"Learning complete. Ada Lovelace's Profile Report is ready."
			);
		});
		expect(toastSuccessMock).toHaveBeenCalledTimes(1);
		expect(toastWarningMock).not.toHaveBeenCalled();
	});
});

describe("InvitationForm", () => {
	beforeEach(() => {
		inviteOrganizationMemberMock.mockReset().mockResolvedValue(undefined);
	});

	afterEach(cleanup);

	it("sends an organization invitation with a trimmed email and default member role", async () => {
		render(
			<TestQueryClientProvider>
				<InvitationForm organizationId="org-123" />
			</TestQueryClientProvider>
		);

		const inviteButton = screen.getByRole("button", {
			name: INVITE_BUTTON_LABEL,
		});
		expect((inviteButton as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(screen.getByLabelText("Email"), {
			target: { value: "  teammate@example.com  " },
		});
		fireEvent.click(inviteButton);

		await waitFor(() => {
			expect(inviteOrganizationMemberMock).toHaveBeenCalledWith({
				email: "teammate@example.com",
				organizationId: "org-123",
				role: "member",
			});
		});
		expect(
			await screen.findByText("Invitation sent to teammate@example.com.")
		).toBeTruthy();
		expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("");
	});
});

function renderOverview(
	input: {
		additionalHumanProfileCreationEnabled?: boolean;
		currentUserProfile?: boolean;
		graceProfileStatus?: "active" | "disabled";
		isPersonal: boolean;
		personalProfiles?: readonly AuthProfileView[];
	},
	queryClient = createTestQueryClient()
) {
	queryClient.setQueryData(
		startQueryKeys.profilesForStorageScope("user-current"),
		input.personalProfiles ?? [buildHumanProfile()]
	);
	queryClient.setQueryData(startQueryKeys.profileCapabilities, {
		additionalHumanProfileCreationEnabled:
			input.additionalHumanProfileCreationEnabled ?? true,
		ok: true,
	});
	const directory = organizationDirectoryResponseSchema.parse({
		agentProfiles: [],
		generatedAt: "2026-07-16T00:00:00.000Z",
		members: [
			{
				humanProfile: input.currentUserProfile
					? {
							lastUsedAt: "2026-07-15T20:30:00.000Z",
							profileHandle: "felix",
							profileId: CURRENT_HUMAN_PROFILE_ID,
							profileName: "Felix",
							status: "active",
						}
					: null,
				joinedAt: "2026-07-01T00:00:00.000Z",
				memberId: "member-ada",
				organizationId: "org-acme",
				role: input.currentUserProfile ? "member" : "owner",
				user: {
					email: input.currentUserProfile
						? "felix@example.com"
						: "ada@example.com",
					id: input.currentUserProfile ? "user-current" : "user-ada",
					image: null,
					name: input.currentUserProfile ? "Felix" : "Ada Lovelace",
				},
				userId: input.currentUserProfile ? "user-current" : "user-ada",
			},
			{
				humanProfile: {
					lastUsedAt: "2026-07-15T20:30:00.000Z",
					profileHandle: "grace",
					profileId: "11111111-1111-4111-8111-111111111111",
					profileName: "Grace Hopper",
					status: input.graceProfileStatus ?? "active",
				},
				joinedAt: "2026-07-02T00:00:00.000Z",
				memberId: "member-grace",
				organizationId: "org-acme",
				role: "admin",
				user: {
					email: "grace@example.com",
					id: "user-grace",
					image: null,
					name: "Grace Hopper",
				},
				userId: "user-grace",
			},
		],
		organizationId: "org-acme",
	});
	if (input.currentUserProfile) {
		directory.members.reverse();
	}

	return render(
		<TestQueryClientProvider queryClient={queryClient}>
			<DirectoryMembersOverview
				account={{ email: "felix@example.com", name: "Felix" }}
				currentOrganization={{
					id: input.isPersonal ? "org-felix" : "org-acme",
					isPersonal: input.isPersonal,
					name: input.isPersonal ? "Felix" : "Acme",
					slug: input.isPersonal ? "felix" : "acme",
				}}
				currentUserId="user-current"
				directoryQuery={{
					data: input.isPersonal ? undefined : directory,
					error: null,
					isError: false,
					isPending: false,
				}}
				focusProfileId={null}
				onCreateProfile={onCreateProfileMock}
				storageScope="user-current"
			/>
		</TestQueryClientProvider>
	);
}

function buildHumanProfile(): AuthProfileView {
	return {
		createdAt: "2026-07-01T00:00:00.000Z",
		createdByUserId: "user-current",
		creatorProfileId: null,
		isDefault: true,
		lastUsedAt: "2026-07-15T00:00:00.000Z",
		managedRole: null,
		ownerName: "Felix",
		ownerUserId: "user-current",
		profileHandle: "felix",
		profileKind: "human",
		profileName: "Felix",
		source: "auth_bootstrap",
		status: "active",
		updatedAt: "2026-07-15T00:00:00.000Z",
		openMeldProfileId: "human-felix",
	};
}

function buildComputer(
	input: Pick<
		OrganizationComputerRecord,
		"computerId" | "ownerUserId" | "serviceState"
	>
): OrganizationComputerRecord {
	return {
		...input,
		deviceDisplayName: input.computerId,
		deviceType: "laptop",
		lastSeenAtMs: 1_755_000_000_000,
		localAgents: [],
		openMeldTools: null,
		osVersion: "26.0",
		platformFamily: "macOS",
	};
}

function buildChannelConnection(input: {
	id: string;
	provider: MessageChannelConnectionProjection["provider"];
}): MessageChannelConnectionProjection {
	return {
		externalAccountId: input.id,
		externalAccountName: null,
		grantedCapabilityGroups: [],
		id: input.id,
		lastVerifiedAt: "2026-07-16T00:00:00.000Z",
		permissionBundleVersion: null,
		provider: input.provider,
		reasonCode: null,
		status: "connected",
		transport: "webhook",
	};
}
