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
			...props
		}: {
			children: ReactNode;
			to: string;
		} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
		Navigate: (props: { replace?: boolean; to: string }) => {
			navigateComponentMock(props);
			return <div data-testid="route-redirect" data-to={props.to} />;
		},
		useNavigate: () => navigateMock,
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

import { AppSpacesIndexContent } from "./index";

describe("app spaces index route", () => {
	beforeEach(() => {
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
		joinOrganizationSpaceMock.mockReset().mockResolvedValue({});
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
			spaceItems: [],
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
		window.sessionStorage.setItem(
			resolveStartFlowStorageKey("user-123"),
			serializeStartFlowState({
				...createInitialStartFlowState(),
				selectedHumanProfileId: "selected-human",
			})
		);

		renderSpacesIndex();

		expect(await screen.findByRole("heading", { name: "Spaces" })).toBeTruthy();
		expect(
			screen.getByText(
				"Browse Spaces in this organization. Public Spaces are open to every member; private Spaces require an invitation."
			)
		).toBeTruthy();
		expect(screen.getByText("Planning")).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Your Spaces" })).toBeTruthy();
		expect(screen.getByRole("heading", { name: "Discover" })).toBeTruthy();
		expect(
			screen.getByRole("searchbox", { name: "Search Spaces" })
		).toBeTruthy();
		expect(screen.getAllByText("Public")).toHaveLength(2);
		expect(screen.getByText("Private")).toBeTruthy();
		expect(screen.getByText("8 members")).toBeTruthy();
		expect(screen.getByText("3 members")).toBeTruthy();
		const planningCard = screen.getByTestId(
			"organization-space-card-space-planning"
		);
		expect(planningCard.getAttribute("data-slot")).toBe("card");
		expect(
			within(planningCard).getByRole("heading", {
				level: 3,
				name: "Planning",
			})
		).toBeTruthy();
		expect(
			within(planningCard).getByText(
				"Open this Space to continue where you left off."
			)
		).toBeTruthy();
		expect(
			planningCard.querySelector('[data-slot="card-content"]')
		).toBeTruthy();
		const supportCard = screen.getByTestId(
			"organization-space-card-space-support"
		);
		expect(
			within(supportCard).getByText(
				"Join this public Space to see its conversation and collaborate."
			)
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Open Planning" }).getAttribute("href")
		).toBe("/o/acme/spaces/space-planning?profileId=selected-human");
		expect(screen.getByRole("button", { name: "Join Support" })).toBeTruthy();
		const privateCard = screen.getByTestId(
			"organization-space-card-space-private"
		);
		expect(
			within(privateCard).getByRole("link", { name: "Open Finance" })
		).toBeTruthy();
		expect(screen.queryByRole("tablist")).toBeNull();
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

	it("shows joined Space status facts in Account Space Index order without leaking them into Discover", async () => {
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
				createAccountSpaceItem({
					pinnedAt: "2026-08-24T00:30:00.000Z",
					pinnedProfileIds: ["selected-human"],
					spaceId: "space-support",
					spaceName: "Support",
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
				{ activeWakeCount: 1, spaceId: "space-support" },
			],
		});
		setAccountSpaceItemPinnedMock.mockReturnValue(new Promise(() => undefined));

		renderSpacesIndex();

		const workingCard = await screen.findByTestId(
			"organization-space-card-space-working"
		);
		const unreadCard = screen.getByTestId(
			"organization-space-card-space-unread"
		);
		const idleCard = screen.getByTestId("organization-space-card-space-idle");
		const supportCard = screen.getByTestId(
			"organization-space-card-space-support"
		);

		const workingUnreadIndicator = within(workingCard).getByTestId(
			"space-directory-unread-indicator"
		);
		expect(workingUnreadIndicator).toBeTruthy();
		const workingUnreadDot = workingUnreadIndicator.querySelector(
			'[aria-hidden="true"]'
		);
		expect(workingUnreadDot).toBeTruthy();
		expect(workingUnreadDot?.className).not.toContain("animate");
		expect(within(workingCard).getByText("2 unread")).toBeTruthy();
		const workingIndicator = within(workingCard).getByTestId(
			"space-directory-working-indicator"
		);
		expect(workingIndicator).toBeTruthy();
		expect(
			workingIndicator.querySelector('[data-slot="space-agent-orb"]')
		).toBeTruthy();
		expect(within(workingCard).getByText("Pinned")).toBeTruthy();
		const unpinButton = within(workingCard).getByRole("button", {
			name: "Unpin Working",
		});
		expect(unpinButton.getAttribute("aria-pressed")).toBe("true");
		expect(unpinButton.querySelector("svg")).toBeTruthy();

		expect(workingCard.compareDocumentPosition(unreadCard)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(unreadCard.compareDocumentPosition(idleCard)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(within(unreadCard).getByText("1 unread")).toBeTruthy();

		expect(
			within(supportCard).getByRole("button", { name: "Join Support" })
		).toBeTruthy();
		expect(
			within(supportCard).queryByTestId("space-directory-unread-indicator")
		).toBeNull();
		expect(
			within(supportCard).queryByTestId("space-directory-working-indicator")
		).toBeNull();
		expect(
			within(supportCard).queryByRole("button", { name: "Pin Support" })
		).toBeNull();

		fireEvent.click(unpinButton);

		await waitFor(() => {
			expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledWith({
				pinnedAt: null,
				profileIds: ["selected-human", "other-human"],
				spaceId: "space-working",
			});
		});
		expect(
			within(workingCard).getByRole("button", { name: "Pin Working" })
		).toBeTruthy();
		expect(within(workingCard).queryByText("Pinned")).toBeNull();
	});

	it("pins a joined Space directly from its directory card", async () => {
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

		const planningCard = await screen.findByTestId(
			"organization-space-card-space-planning"
		);
		const financeCard = screen.getByTestId(
			"organization-space-card-space-private"
		);
		expect(financeCard.compareDocumentPosition(planningCard)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		const pinButton = within(planningCard).getByRole("button", {
			name: "Pin Planning",
		});
		expect(pinButton.getAttribute("aria-pressed")).toBe("false");

		pinButton.focus();
		fireEvent.click(pinButton);

		await waitFor(() => {
			expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledWith({
				pinnedAt: expect.any(String),
				profileIds: ["selected-human"],
				spaceId: "space-planning",
			});
		});
		const unpinButton = within(planningCard).getByRole("button", {
			name: "Unpin Planning",
		});
		expect(planningCard.compareDocumentPosition(financeCard)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(document.activeElement).toBe(unpinButton);
		expect(within(planningCard).getByText("Pinned")).toBeTruthy();
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
					activeMemberCount: 2,
					spaceId: "space-direct-message",
					spaceName: "Selected Human and Helper",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					activeMemberCount: 3,
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
				"Couldn't refresh Spaces. Showing the last saved view from this browser."
			)
		).toBeTruthy();
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

		expect(await screen.findByText("Planning")).toBeTruthy();
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
		expect(await screen.findByRole("heading", { name: "Spaces" })).toBeTruthy();
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

		expect(await screen.findByText("No public Spaces to join")).toBeTruthy();
		expect(
			screen.getByText("Private Spaces appear here after someone invites you.")
		).toBeTruthy();
		expect(
			screen.getByRole("region", { name: "No public Spaces to join" })
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Create Space" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "New Space" })).toBeNull();
		expect(screen.queryByRole("tablist")).toBeNull();
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

		expect(await screen.findByText("Member count unavailable")).toBeTruthy();
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

		expect(await screen.findByText("No Spaces yet")).toBeTruthy();
		expect(
			screen.getByText("Create your first Space to get started.")
		).toBeTruthy();
		expect(screen.getByRole("link", { name: "Create Space" })).toBeTruthy();
		expect(screen.queryByRole("link", { name: "New Space" })).toBeNull();
		expect(screen.queryByTestId("new-space-view")).toBeNull();
		expect(screen.queryByTestId("route-redirect")).toBeNull();
		expect(navigateComponentMock).not.toHaveBeenCalled();
	});

	it("joins a public organization Space and opens it as the selected profile", async () => {
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

		renderSpacesIndex();

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

		fireEvent.click(
			await screen.findByRole("button", { name: "Join Support" })
		);

		const alert = await screen.findByRole("alert");
		expect(alert.textContent).toBe("This Space is no longer public.");
	});

	it("searches joined and discoverable Spaces from one input", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({ isDefault: true, openMeldProfileId: "selected-human" }),
		]);

		renderSpacesIndex();

		fireEvent.change(
			await screen.findByRole("searchbox", { name: "Search Spaces" }),
			{ target: { value: "support" } }
		);

		await waitFor(() => {
			expect(screen.queryByText("Planning")).toBeNull();
			expect(screen.queryByText("Finance")).toBeNull();
			expect(screen.getByText("Support")).toBeTruthy();
		});
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

		expect(await screen.findByRole("heading", { name: "Spaces" })).toBeTruthy();
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

		expect(await screen.findByRole("heading", { name: "Spaces" })).toBeTruthy();
		expect(screen.getByText("Planning")).toBeTruthy();
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
		orgSlug?: string;
		queryClient?: ReturnType<typeof createTestQueryClient>;
	} = {}
) {
	return render(
		<TestQueryClientProvider queryClient={input.queryClient}>
			<StartFlowStateProvider storageScope="user-123">
				<AppSpacesIndexContent orgSlug={input.orgSlug ?? "acme"} />
			</StartFlowStateProvider>
		</TestQueryClientProvider>
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
	pinnedAt?: string | null;
	pinnedProfileIds?: readonly string[];
	spaceId: string;
	spaceName: string;
	spacePurpose?: string | null;
}) {
	const pinnedAt = input.pinnedAt ?? null;
	return {
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
