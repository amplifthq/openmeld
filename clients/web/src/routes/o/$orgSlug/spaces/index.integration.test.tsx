import type { AuthProfileView } from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { onlineManager } from "@tanstack/react-query";
import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
	within,
} from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createInitialStartFlowState,
	resolveStartFlowStorageKey,
	StartFlowStateProvider,
	serializeStartFlowState,
} from "#/components/app/start-flow-state";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { resolveAppSpacesProfileId } from "#/lib/spaces/app-spaces-profile";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { startQueryKeys } from "#/query/query-keys";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";

const PLANNING_ROW = /Open Planning/;
const WORKING_ROW = /Open Working.*2 unread/;
const UNREAD_ROW = /Open Unread.*1 unread/;
const IDLE_ROW = /Open Idle/;
const SUPPORT_ROW = /Support.*Join/;
const UNREAD_TEXT = /unread/;

const {
	appOrganizationMock,
	appSpaceShellMock,
	clearOrganizationPersistenceMock,
	getAccountSpaceActiveWakeSummaryMock,
	getCurrentSpaceInboxSummaryMock,
	joinOrganizationSpaceMock,
	listAccountSpaceItemsMock,
	listOrganizationsMock,
	listOrganizationSpacesMock,
	listStartProfilesMock,
	navigateMock,
	navigateComponentMock,
	setAccountSpaceItemPinnedMock,
	spaceWindowShellMock,
} = vi.hoisted(() => ({
	appOrganizationMock: {
		activeOrganization: null as OrganizationSummary | null,
		currentOrganization: {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		} as OrganizationSummary,
		organizations: [] as OrganizationSummary[],
	},
	appSpaceShellMock: vi.fn(
		(input: {
			children: ReactNode;
			currentProfileId: string;
			currentSpaceId: string;
			showSpacesSidebar?: boolean;
		}) => (
			<section
				data-current-profile-id={input.currentProfileId}
				data-current-space-id={input.currentSpaceId}
				data-show-spaces-sidebar={String(input.showSpacesSidebar ?? true)}
				data-testid="app-space-shell"
			>
				{input.children}
			</section>
		)
	),
	clearOrganizationPersistenceMock: vi.fn(),
	getAccountSpaceActiveWakeSummaryMock: vi.fn(),
	getCurrentSpaceInboxSummaryMock: vi.fn(),
	spaceWindowShellMock: vi.fn((input: { children: ReactNode }) => (
		<section data-testid="space-window-shell">{input.children}</section>
	)),
	joinOrganizationSpaceMock: vi.fn(),
	listAccountSpaceItemsMock: vi.fn(),
	listOrganizationsMock: vi.fn(),
	listOrganizationSpacesMock: vi.fn(),
	listStartProfilesMock: vi.fn(),
	navigateMock: vi.fn(),
	navigateComponentMock: vi.fn(),
	setAccountSpaceItemPinnedMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		Link: ({
			children,
			to,
			search,
			...props
		}: {
			children: ReactNode;
			to: string;
			search?: Record<string, string | undefined>;
		} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
			<a
				href={`${to}${search && Object.values(search).some((value) => value !== undefined) ? `?${new URLSearchParams(Object.entries(search).filter((entry): entry is [string, string] => entry[1] !== undefined)).toString()}` : ""}`}
				{...props}
			>
				{children}
			</a>
		),
		Navigate: (props: { replace?: boolean; to: string }) => {
			navigateComponentMock(props);
			return <div data-testid="route-redirect" data-to={props.to} />;
		},
		useNavigate: () => navigateMock,
		useLocation: (input: { select: (location: { href: string }) => string }) =>
			input.select({ href: "/o/acme/spaces" }),
		useRouterState: (input: {
			select: (state: { location: { pathname: string } }) => string;
		}) => input.select({ location: { pathname: "/o/acme/spaces" } }),
	};
});

vi.mock("#/components/spaces/app-space-shell", () => ({
	AppSpaceShell: appSpaceShellMock,
	SpaceWindowShell: spaceWindowShellMock,
}));

vi.mock("#/components/spaces/space-profile-required-state", () => ({
	SpaceProfileRequiredState: () => (
		<div data-testid="space-profile-required-state">
			Choose a human profile first
		</div>
	),
}));

vi.mock("#/components/welcome/welcome-first-run", () => ({
	WelcomeFirstRun: () => <div data-testid="new-space-view" />,
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => appOrganizationMock,
	useOptionalAppOrganization: () => appOrganizationMock,
}));

vi.mock("#/lib/organizations/space-invitations", () => ({
	requestSpaceInvitations: async () => [],
}));

vi.mock("#/lib/organizations/auth-organizations", () => ({
	listOrganizations: () => listOrganizationsMock(),
}));

vi.mock("#/lib/organizations/organization-spaces", () => ({
	joinOrganizationSpace: (input: { spaceId: string }) =>
		joinOrganizationSpaceMock(input),
	listCurrentOrganizationSpaces: () => listOrganizationSpacesMock(),
}));

vi.mock("#/lib/profiles/existing-profiles", () => ({
	listStartProfiles: () => listStartProfilesMock(),
}));

vi.mock("#/lib/spaces/account-spaces", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("#/lib/spaces/account-spaces")>();
	return {
		...actual,
		listAccountSpaceItems: () => listAccountSpaceItemsMock(),
		setAccountSpaceItemPinned: (...args: unknown[]) =>
			setAccountSpaceItemPinnedMock(...args),
	};
});

vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentSpaceInboxSummary: (...args: unknown[]) =>
		getCurrentSpaceInboxSummaryMock(...args),
}));

vi.mock("#/lib/spaces/account-space-active-wake", () => ({
	getAccountSpaceActiveWakeSummary: (...args: unknown[]) =>
		getAccountSpaceActiveWakeSummaryMock(...args),
}));

vi.mock("#/query/persistence/app-query-persistence", () => ({
	resolveAppQueryPersistenceController: () => ({
		clearOrganization: clearOrganizationPersistenceMock,
	}),
}));

vi.mock("#/components/app/use-sidebar-preferences", () => ({
	useSidebarPreferences: () => ({
		preferences: {
			pinned: { sort: "priority", spaceIds: [] },
			spaces: { sort: "priority", spaceIds: [] },
			groups: [],
		},
		isPending: false,
		isError: false,
		disabled: false,
		save: vi.fn(),
		retry: vi.fn(),
	}),
}));
vi.mock(
	"#/components/spaces/direct-message-preview",
	async (importOriginal) => {
		const actual =
			await importOriginal<
				typeof import("#/components/spaces/direct-message-preview")
			>();
		return {
			...actual,
			spaceMessagePreviewQueryOptions: (input: { spaceId: string }) => ({
				queryKey: ["test-preview", input.spaceId],
				queryFn: async () => null,
				initialData: null,
			}),
		};
	}
);
vi.mock("#/lib/organizations/organization-directory", () => ({
	readCurrentOrganizationProfileDirectory: async () => ({
		organizationId: "org-acme",
		generatedAt: "2026-07-05T00:00:00.000Z",
		members: [],
		agentProfiles: [],
	}),
}));

import { AppSpacesIndexContent } from "./index";

vi.mock("#/components/spaces/conversations-home", () => ({
	ConversationsHome: () => <main aria-label="Chats">Conversation home</main>,
}));

describe("app spaces index route", () => {
	beforeEach(() => {
		window.localStorage.clear();
		window.sessionStorage.clear();
		appOrganizationMock.activeOrganization = null;
		appOrganizationMock.currentOrganization = {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		};
		appOrganizationMock.organizations = [];
		appSpaceShellMock.mockClear();
		navigateComponentMock.mockClear();
		navigateMock.mockReset().mockResolvedValue(undefined);
		spaceWindowShellMock.mockClear();
		joinOrganizationSpaceMock.mockReset().mockResolvedValue({
			addedMemberIds: [],
			alreadyMemberIds: [],
			items: [],
		});
		clearOrganizationPersistenceMock.mockReset().mockResolvedValue(undefined);
		getAccountSpaceActiveWakeSummaryMock.mockReset().mockResolvedValue({
			generatedAtMs: 0,
			items: [],
		});
		getCurrentSpaceInboxSummaryMock.mockReset().mockResolvedValue({
			organizationId: "org-acme",
			spaces: [],
		});
		listOrganizationsMock.mockReset().mockResolvedValue([]);
		listOrganizationSpacesMock
			.mockReset()
			.mockResolvedValue(createOrganizationSpacesResponse());
		listAccountSpaceItemsMock.mockReset().mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-planning",
					spaceName: "Planning",
				}),
				createAccountSpaceItem({
					spaceId: "space-private",
					spaceName: "Finance",
					activeMemberCount: 3,
				}),
			],
		});
		listStartProfilesMock.mockReset();
		setAccountSpaceItemPinnedMock.mockReset().mockResolvedValue([]);
	});

	afterEach(() => {
		cleanup();
		onlineManager.setOnline(true);
		window.sessionStorage.clear();
		vi.restoreAllMocks();
	});

	it("opens the combined conversation home by default without waiting for the Space directory", () => {
		listOrganizationSpacesMock.mockRejectedValue(createGenericFailure());
		renderSpacesIndex({ initialView: "conversations" });
		expect(screen.getByRole("main", { name: "Chats" })).toBeTruthy();
		expect(screen.queryByRole("tab", { name: "Your Spaces" })).toBeNull();
		expect(listOrganizationSpacesMock).not.toHaveBeenCalled();
	});

	it("renders the Space sidebar shell with the selected active human profile", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "default-human",
				isDefault: true,
				profileName: "Default Human",
			}),
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: false,
				profileName: "Selected Human",
			}),
		]);
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 3000,
					spaceId: "space-planning",
					unreadCount: 2,
				},
			],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [{ activeWakeCount: 1, spaceId: "space-planning" }],
		});
		window.sessionStorage.setItem(
			resolveStartFlowStorageKey("user-123"),
			serializeStartFlowState({
				...createInitialStartFlowState(),
				selectedHumanProfileId: "selected-human",
			})
		);

		renderSpacesIndex();

		expect(
			await screen.findByRole("heading", { level: 1, name: "Spaces" })
		).toBeTruthy();
		expect(await screen.findByText("Planning")).toBeTruthy();
		expect(
			screen
				.getByRole("tab", { name: "Your Spaces" })
				.getAttribute("aria-selected")
		).toBe("true");
		expect(screen.getByRole("tab", { name: "Discover" })).toBeTruthy();
		expect(screen.getAllByRole("tab")).toEqual(
			["Chats", "Your Spaces", "Direct messages", "Discover"].map((name) =>
				screen.getByRole("tab", { name })
			)
		);
		expect(
			screen.getByRole("link", { name: PLANNING_ROW }).getAttribute("href")
		).toBe("/o/acme/spaces/space-planning?profileId=selected-human");
		expect(screen.getByRole("button", { name: "Pin Planning" })).toBeTruthy();
		const shell = screen.getByTestId("app-space-shell");
		fireEvent.click(screen.getByRole("tab", { name: "Direct messages" }));
		await waitFor(() =>
			expect(
				screen
					.getByRole("tab", { name: "Direct messages" })
					.getAttribute("aria-selected")
			).toBe("true")
		);
		expect(screen.queryByRole("searchbox")).toBeNull();
		expect(screen.queryByRole("link", { name: PLANNING_ROW })).toBeNull();
		expect(screen.getByTestId("app-space-shell")).toBe(shell);
		expect(screen.queryByText("Support")).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
		expect(
			await screen.findByRole("button", { name: "Join Support" })
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Support" })).toBeTruthy();
		expect(screen.queryByText("Finance")).toBeNull();
		expect(joinOrganizationSpaceMock).not.toHaveBeenCalled();

		expect(screen.getByTestId("app-space-shell")).toBeTruthy();
		await waitFor(() => {
			expect(appSpaceShellMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					currentProfileId: "selected-human",
					currentSpaceId: "",
				}),
				undefined
			);
		});
		expect(screen.queryByTestId("space-landing")).toBeNull();
	});

	it("groups joined Spaces with Priority order without leaking status into Discover", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listOrganizationSpacesMock.mockResolvedValue(
			createOrganizationSpacesResponse({
				spaces: [
					createOrganizationSpace({
						joined: true,
						name: "Idle",
						spaceId: "space-idle",
						visibility: "public",
					}),
					createOrganizationSpace({
						joined: true,
						name: "Working",
						spaceId: "space-working",
						visibility: "private",
					}),
					createOrganizationSpace({
						joined: true,
						name: "Unread",
						spaceId: "space-unread",
						visibility: "public",
					}),
					createOrganizationSpace({
						joined: false,
						name: "Support",
						spaceId: "space-support",
						visibility: "public",
					}),
				],
			})
		);
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-08-24T01:00:00.000Z",
					pinnedProfileIds: ["selected-human", "other-human"],
					spaceId: "space-working",
					spaceName: "Working",
					spacePurpose: null,
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-idle",
					spaceName: "Idle",
					spacePurpose: null,
				}),
				createAccountSpaceItem({
					spaceId: "space-unread",
					spaceName: "Unread",
					spacePurpose: null,
				}),
			],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 3000,
					spaceId: "space-working",
					unreadCount: 2,
				},
				{
					latestUnreadOccurredAtMs: 2000,
					spaceId: "space-unread",
					unreadCount: 1,
				},
				{
					latestUnreadOccurredAtMs: 1000,
					spaceId: "space-support",
					unreadCount: 4,
				},
			],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{ activeWakeCount: 1, spaceId: "space-working" },
				{ activeWakeCount: 1, spaceId: "space-idle" },
				{ activeWakeCount: 1, spaceId: "space-support" },
			],
		});
		setAccountSpaceItemPinnedMock.mockReturnValue(new Promise(() => undefined));

		renderSpacesIndex();

		fireEvent.click(await screen.findByRole("button", { name: "Table" }));
		const workingRow = await screen.findByRole("row", {
			name: WORKING_ROW,
		});
		const unreadRow = screen.getByRole("row", { name: UNREAD_ROW });
		const idleRow = screen.getByRole("row", { name: IDLE_ROW });
		expect(workingRow.compareDocumentPosition(unreadRow)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(unreadRow.compareDocumentPosition(idleRow)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(within(workingRow).getAllByText("2 unread").length).toBeGreaterThan(
			0
		);
		const unpin = within(workingRow).getByRole("button", {
			name: "Unpin Working",
		});
		fireEvent.click(unpin);
		await waitFor(() =>
			expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledWith({
				pinnedAt: null,
				profileIds: ["selected-human", "other-human"],
				spaceId: "space-working",
			})
		);
		fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
		const support = await screen.findByRole("row", {
			name: SUPPORT_ROW,
		});
		expect(within(support).queryByText(UNREAD_TEXT)).toBeNull();
		expect(
			within(support).queryByRole("button", { name: "Pin Support" })
		).toBeNull();
	});

	it("pins a joined Space from the default card view and updates the shared index", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-private",
					spaceName: "Finance",
					spacePurpose: null,
				}),
				createAccountSpaceItem({
					spaceId: "space-planning",
					spaceName: "Planning",
					spacePurpose: null,
				}),
			],
		});
		setAccountSpaceItemPinnedMock.mockReturnValue(new Promise(() => undefined));

		renderSpacesIndex();

		expect(
			(await screen.findByRole("button", { name: "Cards" })).getAttribute(
				"aria-pressed"
			)
		).toBe("true");
		fireEvent.click(
			await screen.findByRole("button", { name: "Pin Planning" })
		);
		await waitFor(() =>
			expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledWith({
				pinnedAt: expect.any(String),
				profileIds: ["selected-human"],
				spaceId: "space-planning",
			})
		);
		expect(
			await screen.findByRole("button", { name: "Unpin Planning" })
		).toBeTruthy();
		const pinned = screen.getByRole("heading", { name: "Pinned" });
		expect(pinned).toBeTruthy();
	});

	it("remembers the selected Space layout when returning to the directory", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "selected-human" }),
		]);
		renderSpacesIndex();
		expect(
			(await screen.findByRole("button", { name: "Cards" })).getAttribute(
				"aria-pressed"
			)
		).toBe("true");
		fireEvent.click(screen.getByRole("button", { name: "Table" }));
		cleanup();
		renderSpacesIndex();
		expect(
			(await screen.findByRole("button", { name: "Table" })).getAttribute(
				"aria-pressed"
			)
		).toBe("true");
		expect(await screen.findByRole("row", { name: PLANNING_ROW })).toBeTruthy();
	});

	it("shows a newly joined Space while the discovery snapshot is still older", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "selected-human" }),
		]);
		listOrganizationSpacesMock.mockResolvedValue(
			createOrganizationSpacesResponse({ spaces: [] })
		);
		renderSpacesIndex();
		expect(
			await screen.findByRole("link", { name: PLANNING_ROW })
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Join Planning" })).toBeNull();
	});

	it("keeps joined Spaces openable when account-specific index facts are missing", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "selected-human" }),
		]);
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});
		renderSpacesIndex();
		expect(
			await screen.findByRole("link", { name: "Open Planning" })
		).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Pin Planning" })).toBeNull();
		expect(screen.queryByText("Support")).toBeNull();
	});

	it("keeps current Direct Messages out of the Spaces directory", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listOrganizationSpacesMock.mockResolvedValue(
			createOrganizationSpacesResponse({
				spaces: [
					createOrganizationSpace({
						activeMemberCount: 8,
						joined: true,
						name: "Planning",
						spaceId: "space-planning",
						visibility: "public",
					}),
					createOrganizationSpace({
						activeMemberCount: 2,
						joined: true,
						name: "Selected Human and Helper",
						spaceId: "space-direct-message",
						visibility: "private",
					}),
					createOrganizationSpace({
						activeMemberCount: 3,
						joined: true,
						name: "Expanded conversation",
						spaceId: "space-expanded-conversation",
						visibility: "private",
					}),
				],
			})
		);
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-planning",
					spaceName: "Planning",
				}),
				createAccountSpaceItem({
					activeMemberCount: 2,
					spaceId: "space-direct-message",
					spaceName: "Selected Human and Helper",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					activeMemberCount: 3,
					directMessageConvertedAt: "2026-07-06T00:00:00.000Z",
					spaceId: "space-expanded-conversation",
					spaceName: "Expanded conversation",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
		});

		renderSpacesIndex();

		expect(await screen.findByText("Planning")).toBeTruthy();
		expect(screen.queryByText("Selected Human and Helper")).toBeNull();
		expect(screen.getByText("Expanded conversation")).toBeTruthy();
	});

	it("does not flash the inner Spaces sidebar while the Space directory is loading", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listOrganizationSpacesMock.mockReturnValue(new Promise(() => undefined));

		renderSpacesIndex();

		await waitFor(() => {
			expect(appSpaceShellMock).toHaveBeenLastCalledWith(
				expect.objectContaining({
					currentProfileId: "selected-human",
					currentSpaceId: "",
					showSpacesSidebar: false,
				}),
				undefined
			);
		});
	});

	it("keeps a saved Space list visible when its background refresh fails", async () => {
		const queryClient = createTestQueryClient();
		const profile = createProfile({
			isDefault: true,
			openMeldProfileId: "selected-human",
		});
		const spaces = createOrganizationSpacesResponse();
		queryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("user-123"),
			[profile],
			{ updatedAt: 1 }
		);
		queryClient.setQueryData(organizationQueryKeys.spaces("org-acme"), spaces, {
			updatedAt: 1,
		});
		listStartProfilesMock.mockRejectedValue(createGenericFailure());
		listOrganizationSpacesMock.mockRejectedValue(createGenericFailure());

		renderSpacesIndex({ queryClient });

		expect(await screen.findByText("Planning")).toBeTruthy();
		expect(
			await screen.findByText(
				"Couldn't refresh Spaces. Showing the last saved view."
			)
		).toBeTruthy();
		fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
		expect(
			(
				screen.getByRole("button", {
					name: "Join Support",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(
			screen.queryByText("OpenMeld could not load your Spaces.")
		).toBeNull();
	});

	it("keeps Join disabled while an offline saved Space list is paused", async () => {
		const queryClient = createTestQueryClient();
		listStartProfilesMock.mockReturnValue(new Promise(() => undefined));
		listOrganizationSpacesMock.mockReturnValue(new Promise(() => undefined));
		queryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("user-123"),
			[
				createProfile({
					isDefault: true,
					openMeldProfileId: "selected-human",
				}),
			],
			{ updatedAt: 1 }
		);
		queryClient.setQueryData(
			organizationQueryKeys.spaces("org-acme"),
			createOrganizationSpacesResponse(),
			{ updatedAt: 1 }
		);
		onlineManager.setOnline(false);

		renderSpacesIndex({ queryClient });

		await screen.findByRole("tab", { name: "Discover" });
		fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
		expect(
			(
				screen.getByRole("button", {
					name: "Join Support",
				}) as HTMLButtonElement
			).disabled
		).toBe(true);
		expect(joinOrganizationSpaceMock).not.toHaveBeenCalled();
	});

	it("starts loading the Space directory while profiles are still pending", async () => {
		let resolveProfiles:
			| ((profiles: readonly AuthProfileView[]) => void)
			| undefined;
		listStartProfilesMock.mockReturnValue(
			new Promise<readonly AuthProfileView[]>((resolve) => {
				resolveProfiles = resolve;
			})
		);

		renderSpacesIndex();

		await waitFor(() => {
			expect(listOrganizationSpacesMock).toHaveBeenCalledTimes(1);
		});
		expect(
			screen.getByRole("status", {
				name: "Loading Spaces",
			})
		).toBeTruthy();
		const loadingState = screen.getByLabelText("Loading Spaces", {
			selector: "section",
		});
		expect(
			loadingState.querySelectorAll('[data-slot="skeleton"]').length
		).toBeGreaterThan(0);
		expect(
			screen.queryByText("OpenMeld is loading your Space list.")
		).toBeNull();

		resolveProfiles?.([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		expect(
			await screen.findByRole("heading", { level: 1, name: "Spaces" })
		).toBeTruthy();
	});

	it("keeps organization discovery visible when there are no Spaces", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listOrganizationSpacesMock.mockResolvedValue(
			createOrganizationSpacesResponse({ spaces: [] })
		);

		renderSpacesIndex();

		fireEvent.click(await screen.findByRole("tab", { name: "Discover" }));
		expect(
			await screen.findByText("No public Spaces to discover right now.")
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "New Space" })).toBeTruthy();

		expect(screen.queryByTestId("new-space-view")).toBeNull();
		expect(screen.queryByTestId("route-redirect")).toBeNull();
		expect(navigateComponentMock).not.toHaveBeenCalled();
		expect(appSpaceShellMock).toHaveBeenLastCalledWith(
			expect.objectContaining({ showSpacesSidebar: true }),
			undefined
		);
	});

	it("does not present a missing member count as zero", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listOrganizationSpacesMock.mockResolvedValue(
			createOrganizationSpacesResponse({
				spaces: [
					createOrganizationSpace({
						activeMemberCount: null,
						joined: false,
						name: "Support",
						spaceId: "space-support",
						visibility: "public",
					}),
				],
			})
		);

		renderSpacesIndex();

		fireEvent.click(await screen.findByRole("tab", { name: "Discover" }));
		expect(await screen.findByText("Member count unavailable")).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Cards" }).getAttribute("aria-pressed")
		).toBe("true");
		expect(screen.getByRole("list", { name: "Discover Spaces" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Join Support" })).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Table" }));
		expect(await screen.findByText("—")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Join Support" })).toBeTruthy();
		expect(screen.queryByText("0 members")).toBeNull();
	});

	it("shows a create-first empty state in a solo context", async () => {
		appOrganizationMock.currentOrganization = {
			id: "org-solo",
			isPersonal: true,
			name: "Solo",
			slug: "solo",
		};
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listOrganizationSpacesMock.mockResolvedValue(
			createOrganizationSpacesResponse({ spaces: [] })
		);

		renderSpacesIndex({ orgSlug: "solo" });

		expect(
			await screen.findByText("No Spaces in this group yet.")
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "New Space" })).toBeTruthy();
		expect(screen.queryByRole("tab", { name: "Discover" })).toBeNull();

		expect(screen.queryByTestId("new-space-view")).toBeNull();
		expect(screen.queryByTestId("route-redirect")).toBeNull();
		expect(navigateComponentMock).not.toHaveBeenCalled();
	});

	it.each([
		"Cards",
		"Table",
	])("joins a public organization Space from %s and opens it as the selected profile", async (layout) => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		listOrganizationSpacesMock
			.mockResolvedValueOnce(
				createOrganizationSpacesResponse({
					spaces: [
						createOrganizationSpace({
							joined: false,
							name: "Support",
							spaceId: "space-support",
							visibility: "public",
						}),
					],
				})
			)
			.mockResolvedValue(
				createOrganizationSpacesResponse({
					spaces: [
						createOrganizationSpace({
							joined: true,
							name: "Support",
							spaceId: "space-support",
							visibility: "public",
						}),
					],
				})
			);

		renderSpacesIndex({ initialView: "discover" });
		fireEvent.click(await screen.findByRole("button", { name: layout }));

		fireEvent.click(
			await screen.findByRole("button", { name: "Join Support" })
		);

		await waitFor(() => {
			expect(joinOrganizationSpaceMock).toHaveBeenCalledWith({
				organizationId: "org-acme",
				spaceId: "space-support",
			});
		});
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				to: "/o/acme/spaces/space-support?profileId=selected-human",
			});
		});
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: "Join Support" })).toBeNull();
		});
	});

	it("announces a public Space join failure", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "selected-human",
				isDefault: true,
				profileName: "Selected Human",
			}),
		]);
		joinOrganizationSpaceMock.mockRejectedValue(
			new Error("This Space is no longer public.")
		);

		renderSpacesIndex();

		fireEvent.click(await screen.findByRole("tab", { name: "Discover" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Join Support" })
		);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe("This Space is no longer public.");
	});

	it("expands search on demand and keeps each tab search independent", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "selected-human" }),
		]);

		renderSpacesIndex();

		await screen.findByText("Planning");
		expect(screen.queryByRole("searchbox")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Search Spaces" }));
		fireEvent.change(screen.getByRole("searchbox", { name: "Search Spaces" }), {
			target: { value: "planning" },
		});
		await waitFor(() => expect(screen.queryByText("Finance")).toBeNull());
		fireEvent.click(screen.getByRole("tab", { name: "Discover" }));
		expect(await screen.findByText("Support")).toBeTruthy();
		expect(screen.queryByRole("searchbox")).toBeNull();
		fireEvent.click(screen.getByRole("tab", { name: "Your Spaces" }));
		expect(
			((await screen.findByRole("searchbox")) as HTMLInputElement).value
		).toBe("planning");
		expect(screen.queryByText("Finance")).toBeNull();
	});

	it("falls back to the default human profile when no selected profile is active", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "default-human",
				isDefault: true,
				profileName: "Default Human",
			}),
		]);

		renderSpacesIndex();

		expect(
			await screen.findByRole("heading", { level: 1, name: "Spaces" })
		).toBeTruthy();
		expect(appSpaceShellMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				currentProfileId: "default-human",
				currentSpaceId: "",
			}),
			undefined
		);
	});

	it("renders the required-profile state when no default human profile is available", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "agent-profile",
				isDefault: false,
				profileKind: "agent",
				profileName: "Codex",
			}),
		]);

		renderSpacesIndex();

		expect(
			await screen.findByTestId("space-profile-required-state")
		).toBeTruthy();
		expect(appSpaceShellMock).not.toHaveBeenCalled();
		expect(spaceWindowShellMock).toHaveBeenCalled();
	});

	it("revalidates membership and loads Spaces with the explicit URL organization", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "default-human" }),
		]);
		// The Space directory keeps failing until the one-time membership check
		// confirms the URL organization and triggers a refetch.
		listOrganizationSpacesMock.mockReset().mockImplementation(() => {
			if (listOrganizationsMock.mock.calls.length > 0) {
				return Promise.resolve(createOrganizationSpacesResponse());
			}
			return Promise.reject(createMembershipFailure());
		});
		// The URL organization is still a membership, so the explicit selector is
		// safe to retry without changing the shared Session.
		listOrganizationsMock.mockResolvedValue([
			appOrganizationMock.currentOrganization,
		]);

		renderSpacesIndex();

		expect(
			await screen.findByRole("heading", { level: 1, name: "Spaces" })
		).toBeTruthy();
		expect(await screen.findByText("Planning")).toBeTruthy();
		expect(listOrganizationsMock).toHaveBeenCalledTimes(1);
		expect(
			screen.queryByText("OpenMeld could not load your Spaces.")
		).toBeNull();
	});

	it("shows a retry-only card when the URL org is still a membership but Core still rejects it", async () => {
		appOrganizationMock.activeOrganization =
			appOrganizationMock.currentOrganization;
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "default-human" }),
		]);
		listOrganizationSpacesMock
			.mockReset()
			.mockRejectedValue(createMembershipFailure());
		// Real self-heal input shape: Auth says the URL organization is still in
		// the account's memberships, so this is an Auth/Core dev-state mismatch.
		listOrganizationsMock.mockResolvedValue([
			appOrganizationMock.currentOrganization,
		]);

		renderSpacesIndex();

		expect(
			await screen.findByText("OpenMeld could not load your Spaces.")
		).toBeTruthy();
		expect(
			screen.getByText(
				"OpenMeld could not confirm your access right now. Try again in a moment."
			)
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Go to Acme" })).toBeNull();
		expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
		expect(listOrganizationsMock).toHaveBeenCalledTimes(1);
	});

	it("shows an access-denied card with the valid organization link when the URL org is no longer a membership", async () => {
		appOrganizationMock.activeOrganization = {
			id: "org-home",
			name: "Home",
			slug: "home",
		};
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "default-human" }),
		]);
		listOrganizationSpacesMock
			.mockReset()
			.mockRejectedValue(createMembershipFailure());
		// The URL organization is not among the account's memberships.
		listOrganizationsMock.mockResolvedValue([
			{ id: "org-home", name: "Home", slug: "home" },
		]);

		renderSpacesIndex();

		expect(
			await screen.findByText("Organization access unavailable")
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Go to Home" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "Sign out" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
		expect(clearOrganizationPersistenceMock).toHaveBeenCalledWith(
			"user-123",
			"org-acme"
		);
	});

	it("keeps a Retry for a non-membership Spaces failure and does not self-heal", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "default-human" }),
		]);
		listOrganizationSpacesMock
			.mockReset()
			.mockRejectedValue(createGenericFailure());

		renderSpacesIndex();

		expect(
			await screen.findByText("OpenMeld could not load your Spaces.")
		).toBeTruthy();
		expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
		expect(listOrganizationsMock).not.toHaveBeenCalled();
	});

	it("resolves selected active profile before the default profile", () => {
		expect(
			resolveAppSpacesProfileId({
				profiles: [
					createProfile({
						openMeldProfileId: "default-human",
						isDefault: true,
					}),
					createProfile({
						openMeldProfileId: "selected-human",
						isDefault: false,
					}),
				],
				selectedHumanProfileId: "selected-human",
			})
		).toBe("selected-human");
	});
});

function renderSpacesIndex(
	input: {
		initialView?: "conversations" | "spaces" | "discover";
		orgSlug?: string;
		queryClient?: ReturnType<typeof createTestQueryClient>;
	} = {}
) {
	return render(
		<NuqsTestingAdapter
			hasMemory
			resetUrlUpdateQueueOnMount={false}
			searchParams={
				input.initialView === "conversations"
					? {}
					: { view: input.initialView ?? "spaces" }
			}
		>
			<TestQueryClientProvider queryClient={input.queryClient}>
				<StartFlowStateProvider storageScope="user-123">
					<AppSpacesIndexContent orgSlug={input.orgSlug ?? "acme"} />
				</StartFlowStateProvider>
			</TestQueryClientProvider>
		</NuqsTestingAdapter>
	);
}

function createMembershipFailure() {
	return {
		code: "organization.membership_required",
		message: "You are not a member of the active organization.",
		requestId: "req-membership",
		status: 403,
		upstreamCode: null,
	};
}

function createGenericFailure() {
	return {
		code: "space_index.store_unavailable",
		message: "The Space index is temporarily unavailable.",
		requestId: "req-generic",
		status: 503,
		upstreamCode: null,
	};
}

function createProfile(
	overrides: Partial<AuthProfileView> = {}
): AuthProfileView {
	return {
		openMeldProfileId: overrides.openMeldProfileId ?? "human-profile",
		createdAt: overrides.createdAt ?? "2026-04-19T00:00:00.000Z",
		createdByUserId: overrides.createdByUserId ?? "user-123",
		creatorProfileId: overrides.creatorProfileId ?? null,
		isDefault: overrides.isDefault ?? false,
		lastUsedAt: overrides.lastUsedAt ?? null,
		managedRole: overrides.managedRole ?? null,
		ownerUserId: overrides.ownerUserId ?? "user-123",
		profileHandle: overrides.profileHandle ?? "human",
		profileKind: overrides.profileKind ?? "human",
		profileName: overrides.profileName ?? "Human",
		source: overrides.source ?? "auth_bootstrap",
		status: overrides.status ?? "active",
		updatedAt: overrides.updatedAt ?? "2026-04-19T00:00:00.000Z",
	};
}

function createOrganizationSpacesResponse(input?: {
	spaces?: readonly ReturnType<typeof createOrganizationSpace>[];
}) {
	return {
		generatedAt: "2026-07-05T00:00:00.000Z",
		organizationId: "org-acme",
		spaces: input?.spaces ?? [
			createOrganizationSpace({
				joined: true,
				name: "Planning",
				spaceId: "space-planning",
				visibility: "public",
			}),
			createOrganizationSpace({
				activeMemberCount: 5,
				joined: false,
				name: "Support",
				spaceId: "space-support",
				visibility: "public",
			}),
			createOrganizationSpace({
				activeMemberCount: 3,
				joined: true,
				name: "Finance",
				spaceId: "space-private",
				visibility: "private",
			}),
		],
	};
}

function createOrganizationSpace(input: {
	activeMemberCount?: number | null;
	joined: boolean;
	name: string;
	spaceId: string;
	visibility: "public" | "private";
}) {
	return {
		activeMemberCount:
			input.activeMemberCount === undefined ? 8 : input.activeMemberCount,
		joined: input.joined,
		lastJoinedAt: input.joined ? "2026-07-05T00:00:00.000Z" : null,
		name: input.name,
		organizationId: "org-acme",
		spaceCreatedAt: "2026-07-04T00:00:00.000Z",
		spaceId: input.spaceId,
		spaceUpdatedAt: "2026-07-04T00:00:00.000Z",
		updatedAt: "2026-07-05T00:00:00.000Z",
		visibility: input.visibility,
	};
}

function createAccountSpaceItem(input: {
	activeMemberCount?: number;
	directMessageConvertedAt?: string;
	pinnedAt?: string | null;
	pinnedProfileIds?: readonly string[];
	spaceId: string;
	spaceName: string;
	spacePurpose?: string | null;
}) {
	const pinnedAt = input.pinnedAt ?? null;
	return {
		directMessageConvertedAt: input.directMessageConvertedAt,
		activeAgentCount: null,
		activeHumanCount: null,
		activeMemberCount: input.activeMemberCount ?? 8,
		joinedProfiles: [
			{
				lastJoinedAt: "2026-07-05T00:00:00.000Z",
				pinnedAt,
				profileId: "selected-human",
				profileName: "Selected Human",
			},
		],
		lastJoinedAt: "2026-07-05T00:00:00.000Z",
		openProfileId: "selected-human",
		openProfileName: "Selected Human",
		organizationId: "org-acme",
		pinnedAt,
		pinnedProfileIds: input.pinnedProfileIds ?? [],
		spaceId: input.spaceId,
		spaceName: input.spaceName,
		spacePurpose: input.spacePurpose ?? null,
		visibility: "private" as const,
	};
}
