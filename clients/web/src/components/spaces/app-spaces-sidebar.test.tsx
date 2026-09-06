import type { WakeProgressItem } from "@openmeld/schemas/types";
import {
	createWakeProgressItem,
	OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
} from "@openmeld/space";
import { TooltipProvider } from "@openmeld/ui/components/tooltip";
import {
	focusManager,
	QueryClient,
	QueryClientProvider,
} from "@tanstack/react-query";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { OPENMELD_WELCOMING_SPACE_PURPOSE } from "#/lib/spaces/welcoming-space";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import {
	setSpaceWakeProgressPresentationItems,
	spaceActiveWakeProgressSummaryQueryOptions,
} from "#/query/spaces/active-wake-progress";
import { AppSpacesSidebar } from "./app-spaces-sidebar";
import {
	SpaceWakeProgressVisibleProjectionProvider,
	usePublishSpaceWakeProgressVisibleProjection,
} from "./space-wake-progress-visible-projection";

const OTHER_JOINED_PROFILE_TEXT = /Other joined profile/;
const BROWSE_SPACES_TEXT = /Browse Spaces/;

function WakeProgressProjectionPublisher(input: {
	items: readonly WakeProgressItem[];
}) {
	usePublishSpaceWakeProgressVisibleProjection(input.items);
	return null;
}

type AppOrganizationMock = {
	activeOrganization: OrganizationSummary | null;
	currentOrganization: OrganizationSummary;
	organizations: OrganizationSummary[];
};

function getSidebarGroupLabel(name: string): HTMLElement {
	const matches = Array.from(
		new Set(
			screen
				.getAllByRole("heading", { level: 2, name })
				.map((element) =>
					element.closest<HTMLElement>('[data-slot="sidebar-group-label"]')
				)
				.filter((element): element is HTMLElement => element !== null)
		)
	);
	if (matches.length !== 1) {
		throw new Error(`Expected exactly one sidebar group label named ${name}.`);
	}
	return matches[0] as HTMLElement;
}

const {
	appOrganizationMock,
	getAccountSpaceActiveWakeSummaryMock,
	getCurrentSpaceInboxSummaryMock,
	getActiveWakeProgressMock,
	listAccountSpaceItemsMock,
	navigateMock,
	setAccountSpaceItemPinnedMock,
} = vi.hoisted(() => ({
	appOrganizationMock: {
		activeOrganization: null,
		currentOrganization: {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		},
		organizations: [
			{
				id: "org-personal",
				isPersonal: true,
				name: "Mira",
				slug: "mira",
			},
			{
				id: "org-acme",
				isPersonal: false,
				name: "Acme",
				slug: "acme",
			},
		],
	} as AppOrganizationMock,
	getAccountSpaceActiveWakeSummaryMock: vi.fn(),
	getCurrentSpaceInboxSummaryMock: vi.fn(),
	getActiveWakeProgressMock: vi.fn(),
	listAccountSpaceItemsMock: vi.fn(),
	navigateMock: vi.fn(),
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
			resetScroll: _resetScroll,
			...props
		}: {
			children: ReactNode;
			to: string;
			resetScroll?: boolean;
		} & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
			<a href={to} {...props}>
				{children}
			</a>
		),
		useNavigate: () => navigateMock,
	};
});

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => appOrganizationMock,
	useCurrentOrganizationSlug: () =>
		appOrganizationMock.currentOrganization.slug,
}));

vi.mock("#/lib/spaces/account-spaces", () => ({
	listAccountSpaceItems: (
		...args: Parameters<typeof listAccountSpaceItemsMock>
	) => listAccountSpaceItemsMock(...args),
	setAccountSpaceItemPinned: (
		...args: Parameters<typeof setAccountSpaceItemPinnedMock>
	) => setAccountSpaceItemPinnedMock(...args),
}));

vi.mock("#/lib/organizations/inbox", () => ({
	getCurrentSpaceInboxSummary: (
		...args: Parameters<typeof getCurrentSpaceInboxSummaryMock>
	) => getCurrentSpaceInboxSummaryMock(...args),
}));

vi.mock("#/lib/spaces/account-space-active-wake", () => ({
	getAccountSpaceActiveWakeSummary: (
		...args: Parameters<typeof getAccountSpaceActiveWakeSummaryMock>
	) => getAccountSpaceActiveWakeSummaryMock(...args),
}));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => ({
		getActiveWakeProgress: (...args: unknown[]) =>
			getActiveWakeProgressMock(...args),
	}),
}));

describe("AppSpacesSidebar", () => {
	it("uses the unopened Space snapshot and removes its marker when its tasks finish", async () => {
		const queryClient = createSidebarQueryClient();
		seedCurrentSpaceWakeRace(queryClient);
		const working = createWakeProgressItem({
			clientMessageId: "client-beta",
			dispatchId: "dispatch-beta",
			phase: "running",
			sourceSignalId: "signal-beta",
			targetLabel: "Reviewer",
			targetProfileId: "agent-beta",
			updatedAtMs: Date.now(),
		});
		const response = {
			items: [
				working,
				{
					...working,
					dispatchId: "dispatch-question",
					targetLabel: "Planner",
					pendingInteraction: {
						canRespond: true,
						expiresAtMs: null,
						interactionId: "question-beta",
						kind: "question" as const,
						request: null,
						requestedAtMs: Date.now(),
					},
				},
			],
			pageInfo: { hasMore: false, limit: 50 },
			query: { spaceId: "space-beta", targetProfileId: null },
		};
		getActiveWakeProgressMock.mockResolvedValue(response);
		renderSidebar(
			<AppSpacesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);
		expect(
			await screen.findByRole("button", {
				name: "Planner needs your input; Reviewer is working. Open Beta",
			})
		).toBeTruthy();
		expect(getActiveWakeProgressMock).toHaveBeenCalledWith(
			expect.objectContaining({ spaceId: "space-beta" })
		);
		getActiveWakeProgressMock.mockResolvedValue({ ...response, items: [] });
		await act(async () => {
			await queryClient.invalidateQueries({
				queryKey: spaceActiveWakeProgressSummaryQueryOptions({
					enabled: true,
					openMeldProfileId: "human-1",
					spaceId: "space-beta",
				}).queryKey,
			});
		});
		expect(await screen.findByRole("link", { name: "Beta" })).toBeTruthy();
		expect(
			screen.queryByRole("link", { name: "Beta, active Wake" })
		).toBeNull();
	});

	beforeEach(() => {
		appOrganizationMock.activeOrganization = {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		};
		appOrganizationMock.currentOrganization = {
			id: "org-acme",
			isPersonal: false,
			name: "Acme",
			slug: "acme",
		};
		listAccountSpaceItemsMock.mockReset();
		getActiveWakeProgressMock
			.mockReset()
			.mockRejectedValue(new Error("Snapshot unavailable"));
		getAccountSpaceActiveWakeSummaryMock.mockReset().mockResolvedValue({
			generatedAtMs: 0,
			items: [],
		});
		getCurrentSpaceInboxSummaryMock.mockReset().mockResolvedValue({
			organizationId: "org-acme",
			spaces: [],
		});
		navigateMock.mockReset();
		navigateMock.mockResolvedValue(undefined);
		setAccountSpaceItemPinnedMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		focusManager.setFocused(undefined);
	});

	it("moves unpinned Spaces with unread messages first and shows a static accessible indicator", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 2000,
					spaceId: "space-beta",
					unreadCount: 2,
				},
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const beta = await screen.findByRole("link", {
			name: "Beta, unread messages",
		});
		const alpha = screen.getByRole("link", { name: "Alpha" });

		expect(beta.compareDocumentPosition(alpha)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(beta.querySelector("[data-space-unread-indicator]")).toBeTruthy();
		expect(beta.className).not.toContain("animate-");
	});

	it("prioritizes unread pinned Spaces when Priority is selected by default", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T02:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
			spaceItems: [],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 3000,
					spaceId: "space-beta",
					unreadCount: 1,
				},
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const alpha = await screen.findByRole("link", { name: "Alpha" });
		const beta = screen.getByRole("link", {
			name: "Beta, unread messages",
		});
		expect(alpha.compareDocumentPosition(beta)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);
	});

	it("keeps unread recency ahead of newly joined Spaces", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-28T00:00:00.000Z",
					lastSeenTs: Date.parse("2026-04-30T00:00:00.000Z"),
					spaceId: "space-existing",
					spaceName: "Existing",
				}),
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					spaceId: "space-new",
					spaceName: "Launch Room",
				}),
			],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 5000,
					spaceId: "space-existing",
					unreadCount: 2,
				},
				{
					latestUnreadOccurredAtMs: 1000,
					spaceId: "space-new",
					unreadCount: 1,
				},
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const newSpace = await screen.findByRole("link", {
			name: "Launch Room, unread messages",
		});
		const existingSpace = screen.getByRole("link", {
			name: "Existing, unread messages",
		});
		expect(newSpace.compareDocumentPosition(existingSpace)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);
		expect(newSpace.classList.contains("font-semibold")).toBe(true);
		expect(newSpace.classList.contains("text-primary")).toBe(false);
		expect(
			newSpace.querySelector('[data-space-unread-indicator="true"]')
		).toBeTruthy();
	});

	it("keeps pin order when a Space has never been opened", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-20T00:00:00.000Z",
					lastSeenTs: Date.parse("2026-04-30T00:00:00.000Z"),
					pinnedAt: "2026-04-29T03:00:00.000Z",
					spaceId: "space-pinned-first",
					spaceName: "Pinned First",
				}),
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-pinned-new",
					spaceName: "Pinned New",
				}),
			],
			spaceItems: [],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const pinnedNew = await screen.findByRole("link", {
			name: "Pinned New",
		});
		const pinnedFirst = screen.getByRole("link", { name: "Pinned First" });
		expect(pinnedNew.compareDocumentPosition(pinnedFirst)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);
	});

	it("preserves pin and unread ordering when the open owner records lastSeenTs", async () => {
		const initialSections = {
			pinnedItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-20T00:00:00.000Z",
					pinnedAt: "2026-04-29T03:00:00.000Z",
					spaceId: "space-pinned-first",
					spaceName: "Pinned First",
				}),
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-pinned-new",
					spaceName: "Pinned New",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					spaceId: "space-regular-new",
					spaceName: "Regular New",
				}),
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-20T00:00:00.000Z",
					spaceId: "space-regular-unread",
					spaceName: "Regular Unread",
				}),
			],
		};
		listAccountSpaceItemsMock.mockResolvedValue(initialSections);
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 5000,
					spaceId: "space-regular-unread",
					unreadCount: 1,
				},
			],
		});
		const queryClient = createSidebarQueryClient();

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />,
			queryClient
		);
		const pinnedNew = await screen.findByRole("link", {
			name: "Pinned New",
		});
		const pinnedFirst = screen.getByRole("link", { name: "Pinned First" });
		const regularNew = screen.getByRole("link", {
			name: "Regular New",
		});
		const regularUnread = screen.getByRole("link", {
			name: "Regular Unread, unread messages",
		});
		expect(pinnedNew.compareDocumentPosition(pinnedFirst)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);
		expect(regularNew.compareDocumentPosition(regularUnread)).toBe(
			Node.DOCUMENT_POSITION_PRECEDING
		);

		const seenAt = Date.parse("2026-04-30T00:00:00.000Z");
		act(() => {
			queryClient.setQueryData(
				accountSpaceQueryKeys.items("human-1", "account"),
				{
					pinnedItems: initialSections.pinnedItems.map((item) => ({
						...item,
						lastSeenTs: seenAt,
					})),
					spaceItems: initialSections.spaceItems.map((item) => ({
						...item,
						lastSeenTs: seenAt,
					})),
				}
			);
		});

		await waitFor(() => {
			expect(
				screen
					.getByRole("link", { name: "Pinned First" })
					.compareDocumentPosition(
						screen.getByRole("link", { name: "Pinned New" })
					)
			).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
			expect(
				screen
					.getByRole("link", {
						name: "Regular Unread, unread messages",
					})
					.compareDocumentPosition(
						screen.getByRole("link", { name: "Regular New" })
					)
			).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		});
	});

	it("does not mark a previously seen Space as new when its join timestamp advances", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: Date.parse("2026-04-20T00:00:00.000Z"),
					spaceId: "space-seen-before",
					spaceName: "Previously Seen",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(
			await screen.findByRole("link", { name: "Previously Seen" })
		).toBeTruthy();
		expect(
			screen.queryByRole("button", {
				name: "Previously Seen",
			})
		).toBeNull();
	});

	it("keeps an unseen Space available through render, hover, and focus", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					lastJoinedAt: "2026-04-29T00:00:00.000Z",
					lastSeenTs: null,
					spaceId: "space-first-unseen",
					spaceName: "First Unseen",
				}),
			],
		});
		const view = renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const firstUnseen = await screen.findByRole("link", {
			name: "First Unseen",
		});
		fireEvent.pointerEnter(firstUnseen);
		fireEvent.focus(firstUnseen);
		view.rerender(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(screen.getByRole("link", { name: "First Unseen" })).toBeTruthy();
	});

	it("shows a newly joined Space as soon as the window regains focus", async () => {
		focusManager.setFocused(false);
		listAccountSpaceItemsMock
			.mockResolvedValueOnce({
				pinnedItems: [],
				spaceItems: [
					createAccountSpaceItem({
						spaceId: "space-existing",
						spaceName: "Existing",
					}),
				],
			})
			.mockResolvedValue({
				pinnedItems: [],
				spaceItems: [
					createAccountSpaceItem({
						spaceId: "space-existing",
						spaceName: "Existing",
					}),
					createAccountSpaceItem({
						lastJoinedAt: "2026-04-29T00:00:00.000Z",
						lastSeenTs: null,
						spaceId: "space-new-on-focus",
						spaceName: "Focus Room",
					}),
				],
			});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);
		await screen.findByRole("link", { name: "Existing" });
		expect(screen.queryByText("Focus Room")).toBeNull();

		act(() => focusManager.setFocused(true));

		expect(
			await screen.findByRole("link", {
				name: "Focus Room",
			})
		).toBeTruthy();
	});

	it("keeps cached Spaces visible when a foreground refresh fails", async () => {
		focusManager.setFocused(false);
		listAccountSpaceItemsMock
			.mockResolvedValueOnce({
				pinnedItems: [],
				spaceItems: [
					createAccountSpaceItem({
						spaceId: "space-existing",
						spaceName: "Existing",
					}),
				],
			})
			.mockRejectedValueOnce(
				Object.assign(new Error("temporary refresh failure"), {
					code: "gateway.invalid_response",
				})
			);
		const queryClient = createSidebarQueryClient();

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />,
			queryClient
		);
		await screen.findByRole("link", { name: "Existing" });

		act(() => focusManager.setFocused(true));
		await waitFor(() => {
			expect(
				queryClient.getQueryState(
					accountSpaceQueryKeys.items("human-1", "account")
				)?.status
			).toBe("error");
		});

		expect(screen.getByRole("link", { name: "Existing" })).toBeTruthy();
		expect(
			screen.queryByText("OpenMeld could not load your spaces.")
		).toBeNull();
	});

	it("keeps an empty pinned section available as a drag destination", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(await screen.findByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			screen.queryByRole("heading", { level: 2, name: "Pinned" })
		).toBeTruthy();
	});

	it("hides legacy welcoming spaces from the sidebar", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-welcome-pinned",
					spaceName: "Welcome Pinned",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T00:00:00.000Z",
					spaceId: "space-pinned",
					spaceName: "Pinned Alpha",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-welcome-regular",
					spaceName: "Welcome Regular",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					spaceId: "space-regular",
					spaceName: "Regular Beta",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const pinnedSpace = await screen.findByRole("link", {
			name: "Pinned Alpha",
		});
		expect(screen.queryByText("Welcome Pinned")).toBeNull();
		expect(screen.queryByText("Welcome Regular")).toBeNull();
		expect(screen.queryByText("Welcoming")).toBeNull();
		const pinnedHeading = getSidebarGroupLabel("Pinned");
		const spacesHeading = getSidebarGroupLabel("Spaces");

		expect(pinnedHeading.compareDocumentPosition(spacesHeading)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(pinnedHeading.compareDocumentPosition(pinnedSpace)).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		expect(
			spacesHeading.compareDocumentPosition(
				screen.getByRole("link", { name: "Regular Beta" })
			)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("keeps current Direct Messages out of the Spaces sidebar", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-dm-pinned",
					spaceName: "Felix and Center Agent",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 3,
					spaceId: "space-dm-degraded",
					spaceName: "Felix and Center Agent plus Ada",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					activeMemberCount: 2,
					spaceId: "space-ordinary-two-person",
					spaceName: "Ordinary Pair",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		await screen.findByRole("link", {
			name: "Felix and Center Agent plus Ada",
		});
		expect(
			screen.queryByRole("heading", { level: 2, name: "Direct Messages" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Felix and Center Agent" })
		).toBeNull();
		const spacesHeading = getSidebarGroupLabel("Spaces");
		expect(
			spacesHeading.compareDocumentPosition(
				screen.getByRole("link", {
					name: "Felix and Center Agent plus Ada",
				})
			)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
		expect(
			spacesHeading.compareDocumentPosition(
				screen.getByRole("link", { name: "Ordinary Pair" })
			)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("keeps a channel icon when member previews are not available", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-pinned",
					spaceName: "Pinned Alpha",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-regular",
					spaceName: "Regular Beta",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		for (const spaceName of ["Pinned Alpha", "Regular Beta"]) {
			const row = await screen.findByRole("link", { name: spaceName });
			expect(row?.querySelector('[data-space-icon="channel"]')).toBeTruthy();
		}
	});

	it("filters account-scoped spaces to the current organization before grouping", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					organizationId: "org-personal",
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-personal-pinned",
					spaceName: "Personal Pinned",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					organizationId: "org-personal",
					spaceId: "space-personal-welcome",
					spaceName: "Personal Welcome",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					organizationId: "org-beta",
					spaceId: "space-beta",
					spaceName: "Beta Project",
				}),
				createAccountSpaceItem({
					organizationId: "org-acme",
					spaceId: "space-acme",
					spaceName: "Acme Project",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(
			await screen.findByRole("link", { name: "Acme Project" })
		).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Personal Pinned" })
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: "Personal Welcome" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Beta Project" })).toBeNull();
		expect(
			screen.queryByRole("heading", { level: 2, name: "Pinned" })
		).toBeTruthy();
		expect(screen.queryByText("Welcoming")).toBeNull();
	});

	it("hides personal legacy welcoming spaces in the personal context", async () => {
		appOrganizationMock.activeOrganization = null;
		appOrganizationMock.currentOrganization = {
			id: "org-personal",
			isPersonal: true,
			name: "Mira",
			slug: "mira",
		};
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					organizationId: "org-personal",
					spaceId: "space-personal-welcome",
					spaceName: "Mira Welcome",
					spacePurpose: OPENMELD_WELCOMING_SPACE_PURPOSE,
				}),
				createAccountSpaceItem({
					organizationId: "org-acme",
					spaceId: "space-acme",
					spaceName: "Acme Project",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		await waitFor(() => {
			expect(listAccountSpaceItemsMock).toHaveBeenCalled();
		});
		expect(screen.queryByRole("button", { name: "Mira Welcome" })).toBeNull();
		expect(screen.queryByText("Welcoming")).toBeNull();
		expect(screen.queryByRole("button", { name: "Acme Project" })).toBeNull();
	});

	it("renders the Spaces title without repeating the OpenMeld brand", () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		const { container } = renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);
		const sidebarHeader = container.querySelector(
			'[data-slot="sidebar-header"]'
		);

		expect(sidebarHeader).toBeNull();
		expect(screen.queryByText("Chatroom for agents & humans")).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "OpenMeld Spaces" })
		).toBeNull();
		expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
	});

	it("keeps the Web profile out of Space navigation metadata", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-29T00:00:00.000Z",
							pinnedAt: null,
							profileId: "agent-1",
							profileName: "Codex",
						},
						{
							lastJoinedAt: "2026-04-28T00:00:00.000Z",
							pinnedAt: null,
							profileId: "human-1",
							profileName: "Mira",
						},
					],
					openProfileId: "agent-1",
					openProfileName: "Codex",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(await screen.findByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(screen.queryByText("Joined as Mira")).toBeNull();
		expect(screen.queryByText("Joined as Codex")).toBeNull();
		expect(screen.queryByText("1 other profile also joined")).toBeNull();
	});

	it("reclaims the timestamp area when a space item is narrow", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const openSpaceButton = await screen.findByRole("link", {
			name: "Alpha",
		});
		const spaceName = openSpaceButton.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text"]'
		);
		const nameAndDate = openSpaceButton.querySelector<HTMLElement>(
			'[data-slot="space-sidebar-name-and-date"]'
		);
		const spaceRow = openSpaceButton?.parentElement;
		const timestamp = openSpaceButton.querySelector<HTMLElement>(
			'[data-slot="space-sidebar-date"]'
		);
		const pinButton = screen.getByRole("button", { name: "Pin Alpha" });

		expect(spaceRow?.classList.contains("@container/space-item")).toBe(true);
		expect(openSpaceButton?.classList.contains("pr-10")).toBe(false);
		expect(spaceName?.classList.contains("pr-10")).toBe(false);
		expect(spaceName?.classList.contains("@[13rem]/space-item:pr-10")).toBe(
			false
		);
		expect(nameAndDate?.classList.contains("flex")).toBe(true);
		expect(nameAndDate?.classList.contains("min-w-0")).toBe(true);
		expect(nameAndDate?.classList.contains("flex-1")).toBe(true);
		expect(nameAndDate?.classList.contains("items-center")).toBe(true);
		expect(nameAndDate?.classList.contains("gap-px")).toBe(true);
		expect(openSpaceButton.classList.contains("items-center")).toBe(true);
		expect(timestamp?.classList.contains("absolute")).toBe(false);
		expect(timestamp?.classList.contains("shrink-0")).toBe(true);
		expect(timestamp?.classList.contains("hidden")).toBe(true);
		expect(
			timestamp?.classList.contains("@[13rem]/space-item:inline-flex")
		).toBe(true);
		expect(pinButton.classList.contains("top-1.5")).toBe(true);
		expect(pinButton.classList.contains("top-1/2")).toBe(false);
		expect(pinButton.classList.contains("hover:bg-sidebar-accent")).toBe(true);
		expect(pinButton.classList.contains("rounded-md")).toBe(true);
		expect(pinButton.classList.contains("backdrop-blur-sm")).toBe(false);
	});

	it("shows active Agent names only from the Working orb tooltip", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now() + 12_566,
			items: [
				{
					activeTargets: [
						{
							activeWakeCount: 1,
							profileId: "agt_clico",
							profileName: "Clico Codex",
						},
					],
					activeWakeCount: 1,
					spaceId: "space-alpha",
				},
			],
		});

		renderSidebar(
			<AppSpacesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-beta"
			/>
		);

		const workingButton = await screen.findByRole("link", {
			name: "Alpha, active Wake",
		});
		const workingRow = workingButton.closest<HTMLElement>(
			'[data-slot="center-truncated-text"], li, div'
		);
		expect(workingRow).toBeTruthy();
		await waitFor(() => {
			expect(
				document.querySelectorAll('[data-space-active-wake-orb="true"]')
			).toHaveLength(1);
		});
		const orbSlot = document.querySelector<HTMLElement>(
			'[data-space-active-wake-orb="true"]'
		);
		expect(orbSlot?.querySelector("canvas")).toBeTruthy();
		expect(orbSlot?.classList.contains("pointer-events-auto")).toBe(true);
		expect(orbSlot?.classList.contains("group-hover/space-row:opacity-0")).toBe(
			false
		);
		const workingStatus = screen.getByRole("button", {
			name: "Clico Codex has an active Wake. Open Alpha",
		});
		expect(workingStatus).toBe(orbSlot);
		fireEvent.pointerEnter(workingStatus);
		fireEvent.mouseEnter(workingStatus);
		await waitFor(() => {
			expect(screen.getByText("Clico Codex has an active Wake")).toBeTruthy();
		});
		expect(
			orbSlot?.classList.contains("group-hover/space-row:scale-[0.625]")
		).toBe(false);

		// The idle row keeps the plain label and never mounts an orb.
		expect(screen.getByRole("link", { name: "Beta" })).toBeTruthy();

		// The pin action stays in the slot, hidden until hover/focus reveals it.
		const pinButton = screen.getByRole("button", { name: "Pin Alpha" });
		expect(pinButton.classList.contains("opacity-100")).toBe(false);
		expect(pinButton.hasAttribute("data-show-on-hover")).toBe(true);
		expect(
			pinButton.classList.contains("group-hover/space-row:opacity-100")
		).toBe(true);
		expect(pinButton.classList.contains("pointer-events-none")).toBe(false);
	});

	it("lists every named Agent in the Working orb tooltip", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{
					activeTargets: [
						{
							activeWakeCount: 1,
							profileId: "agt_clico",
							profileName: "Clico Codex",
						},
						{
							activeWakeCount: 1,
							profileId: "agt_felix",
							profileName: "Felix Codex",
						},
					],
					activeWakeCount: 2,
					spaceId: "space-alpha",
				},
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const workingStatus = await screen.findByRole("button", {
			name: "Clico Codex and Felix Codex have an active Wake. Open Alpha",
		});
		fireEvent.pointerEnter(workingStatus);
		fireEvent.mouseEnter(workingStatus);
		await waitFor(() => {
			expect(
				screen.getByText("Clico Codex and Felix Codex have an active Wake")
			).toBeTruthy();
		});
	});

	it("uses the frozen target name when current Working progress only has a raw Agent id", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{
					activeTargets: [
						{
							activeWakeCount: 1,
							profileId: "agt_deleted",
							profileName: "Clico Codex",
						},
					],
					activeWakeCount: 1,
					spaceId: "space-alpha",
				},
			],
		});
		const queryClient = createSidebarQueryClient();
		setSpaceWakeProgressPresentationItems({
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: "running",
					sourceSignalId: "signal-alpha",
					targetLabel: "@agt_deleted",
					targetProfileId: "agt_deleted",
					updatedAtMs: Date.now(),
				}),
			],
			openMeldProfileId: "human-1",
			queryClient,
			spaceId: "space-alpha",
		});

		renderSidebar(
			<AppSpacesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);

		expect(
			await screen.findByRole("link", {
				name: "Alpha, active Wake",
			})
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "Clico Codex is working. Open Alpha",
			})
		).toBeTruthy();
		expect(
			document.querySelector('[data-space-active-wake-orb="true"]')
		).toBeTruthy();
	});

	it("shows that the current Agent is waiting when its current task is occupied", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{
					activeTargets: [
						{
							activeWakeCount: 1,
							profileId: "agt_clico",
							profileName: "Clico Codex",
						},
					],
					activeWakeCount: 1,
					spaceId: "space-alpha",
				},
			],
		});
		const queryClient = createSidebarQueryClient();
		setSpaceWakeProgressPresentationItems({
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: "running",
					sourceSignalId: "signal-alpha",
					targetLabel: "Clico Codex",
					targetProfileId: "agt_clico",
					updatedAtMs: Date.now(),
					waitReasonCode: "runtime.agent_controller_conversation.occupied",
				}),
			],
			openMeldProfileId: "human-1",
			queryClient,
			spaceId: "space-alpha",
		});

		renderSidebar(
			<AppSpacesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);

		expect(
			await screen.findByRole("link", {
				name: "Alpha, agent waiting",
			})
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "Waiting for Clico Codex’s current task. Open Alpha",
			})
		).toBeTruthy();
		expect(
			document.querySelector('[data-space-active-wake-waiting="true"]')
		).toBeTruthy();
		expect(
			document.querySelector('[data-space-active-wake-orb="true"]')
		).toBeNull();
	});

	it("keeps the current Space orb aligned with a recovered Core active Wake summary", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockRejectedValue(
			new Error("account active Wake summary unavailable")
		);
		const queryClient = createSidebarQueryClient();
		const currentSpaceSummaryOptions =
			spaceActiveWakeProgressSummaryQueryOptions({
				enabled: false,
				openMeldProfileId: "human-1",
				spaceId: "space-alpha",
			});
		queryClient.setQueryData(currentSpaceSummaryOptions.queryKey, {
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: "running",
					sourceSignalId: "signal-alpha",
					targetLabel: "Runner",
					targetProfileId: "agent-alpha",
					updatedAtMs: Date.now(),
				}),
			],
			query: {
				spaceId: "space-alpha",
				targetProfileId: null,
			},
		});

		renderSidebar(
			<AppSpacesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);

		expect(
			await screen.findByRole("link", { name: "Alpha, active Wake" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "Runner is working. Open Alpha",
			})
		).toBeTruthy();
	});

	it.each([
		"failed",
		"stopped",
	] as const)("does not keep the current Space orb when newer shared progress is %s", async (terminalPhase) => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T02:00:00.000Z",
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [
				{ activeWakeCount: 1, spaceId: "space-alpha" },
				{ activeWakeCount: 1, spaceId: "space-beta" },
			],
		});
		const queryClient = createSidebarQueryClient();
		const nowMs = Date.now();
		const currentSpaceSummaryOptions =
			spaceActiveWakeProgressSummaryQueryOptions({
				enabled: false,
				openMeldProfileId: "human-1",
				spaceId: "space-alpha",
			});
		queryClient.setQueryData(currentSpaceSummaryOptions.queryKey, {
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: "running",
					sourceSignalId: "signal-alpha",
					targetLabel: "Runner",
					targetProfileId: "agent-alpha",
					updatedAtMs: nowMs,
				}),
			],
			query: {
				spaceId: "space-alpha",
				targetProfileId: null,
			},
		});
		setSpaceWakeProgressPresentationItems({
			items: [
				createWakeProgressItem({
					clientMessageId: "client-message-alpha",
					dispatchId: "dispatch-alpha",
					phase: terminalPhase,
					sourceSignalId: "signal-alpha",
					targetLabel: "Runner",
					targetProfileId: "agent-alpha",
					updatedAtMs: nowMs + 1,
				}),
			],
			openMeldProfileId: "human-1",
			queryClient,
			spaceId: "space-alpha",
		});

		renderSidebar(
			<AppSpacesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>,
			queryClient
		);

		expect(await screen.findByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Beta, active Wake" })
		).toBeTruthy();
		expect(
			document.querySelectorAll('[data-space-active-wake-orb="true"]')
		).toHaveLength(1);
	});

	it("clears the current Space orb when a final reply resolves the visible projection", async () => {
		const queryClient = createSidebarQueryClient();
		seedCurrentSpaceWakeRace(queryClient);
		const runningItems = [
			createWakeProgressItem({
				clientMessageId: "client-message-alpha",
				dispatchId: "dispatch-alpha",
				phase: "running",
				sourceSignalId: "signal-alpha",
				targetLabel: "Runner",
				targetProfileId: "agent-alpha",
				updatedAtMs: Date.now(),
			}),
		];
		const view = renderSidebar(
			<SpaceWakeProgressVisibleProjectionProvider>
				<WakeProgressProjectionPublisher items={runningItems} />
				<AppSpacesSidebar
					currentProfileId="human-1"
					currentSpaceId="space-alpha"
				/>
			</SpaceWakeProgressVisibleProjectionProvider>,
			queryClient
		);

		expect(
			await screen.findByRole("link", { name: "Alpha, active Wake" })
		).toBeTruthy();

		view.rerender(
			<SpaceWakeProgressVisibleProjectionProvider>
				<WakeProgressProjectionPublisher items={[]} />
				<AppSpacesSidebar
					currentProfileId="human-1"
					currentSpaceId="space-alpha"
				/>
			</SpaceWakeProgressVisibleProjectionProvider>
		);

		expect(screen.getByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Beta, active Wake" })
		).toBeTruthy();
		expect(
			document.querySelectorAll('[data-space-active-wake-orb="true"]')
		).toHaveLength(1);
	});

	it("uses an already-final projection on the first Space shell paint", () => {
		const queryClient = createSidebarQueryClient();
		seedCurrentSpaceWakeRace(queryClient);

		renderSidebar(
			<SpaceWakeProgressVisibleProjectionProvider>
				<WakeProgressProjectionPublisher items={[]} />
				<AppSpacesSidebar
					currentProfileId="human-1"
					currentSpaceId="space-alpha"
				/>
			</SpaceWakeProgressVisibleProjectionProvider>,
			queryClient
		);

		expect(screen.getByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Beta, active Wake" })
		).toBeTruthy();
		expect(
			document.querySelectorAll('[data-space-active-wake-orb="true"]')
		).toHaveLength(1);
	});

	it("does not render a working orb from an expired cached summary", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: 0,
			items: [{ activeWakeCount: 1, spaceId: "space-alpha" }],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(await screen.findByRole("link", { name: "Alpha" })).toBeTruthy();
		expect(
			document.querySelector('[data-space-active-wake-orb="true"]')
		).toBeNull();
	});

	it("keeps the orb visible while hover or focus reveals the pin beside it", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [{ activeWakeCount: 2, spaceId: "space-alpha" }],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const openSpaceButton = await screen.findByRole("link", {
			name: "Alpha, active Wake",
		});
		await waitFor(() => {
			expect(
				document.querySelector('[data-space-active-wake-orb="true"]')
			).toBeTruthy();
		});

		// The pin gives up its persistent visibility but stays reachable through
		// hover and keyboard focus without covering the working state.
		const pinButton = screen.getByRole("button", { name: "Unpin Alpha" });
		expect(pinButton.classList.contains("opacity-100")).toBe(false);
		expect(
			pinButton.classList.contains("group-focus-within/space-row:opacity-100")
		).toBe(true);
		expect(
			pinButton.classList.contains("group-hover/space-row:opacity-100")
		).toBe(true);
		const workingIndicator = document.querySelector<HTMLElement>(
			'[data-space-active-wake-orb="true"]'
		);
		expect(
			workingIndicator?.classList.contains("group-hover/space-row:opacity-0")
		).toBe(false);
		expect(
			workingIndicator?.classList.contains(
				"group-hover/space-row:translate-x-3"
			)
		).toBe(false);
		expect(
			workingIndicator?.classList.contains(
				"group-focus-within/space-row:-translate-y-3"
			)
		).toBe(false);

		// Status and action retain separate fixed slots.
		const spaceName = openSpaceButton.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text"]'
		);
		expect(spaceName?.classList.contains("pr-16")).toBe(true);
		expect(pinButton.getAttribute("data-sidebar")).toBe("menu-action");
		expect(pinButton.classList.contains("right-9")).toBe(true);
	});

	it("orders unread, working, and persistent pin states while keeping status visible on hover", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T03:00:00.000Z",
					spaceId: "space-working",
					spaceName: "Working",
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T02:00:00.000Z",
					spaceId: "space-unread",
					spaceName: "Unread",
				}),
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-idle",
					spaceName: "Idle",
				}),
			],
			spaceItems: [],
		});
		getAccountSpaceActiveWakeSummaryMock.mockResolvedValue({
			generatedAtMs: Date.now(),
			items: [{ activeWakeCount: 1, spaceId: "space-working" }],
		});
		getCurrentSpaceInboxSummaryMock.mockResolvedValue({
			organizationId: "org-acme",
			spaces: [
				{
					latestUnreadOccurredAtMs: 3000,
					spaceId: "space-working",
					unreadCount: 1,
				},
				{
					latestUnreadOccurredAtMs: 2000,
					spaceId: "space-unread",
					unreadCount: 1,
				},
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const workingRow = (
			await screen.findByRole("link", {
				name: "Working, unread messages, active Wake",
			})
		).parentElement;
		const unreadRow = screen.getByRole("link", {
			name: "Unread, unread messages",
		}).parentElement;
		const idleRow = screen.getByRole("link", { name: "Idle" }).parentElement;

		const workingUnreadIndicator = workingRow?.querySelector<HTMLElement>(
			'[data-space-unread-indicator="true"]'
		);
		expect(workingUnreadIndicator).toBeTruthy();
		expect(
			workingRow?.querySelector('[data-space-active-wake-orb="true"]')
		).toBeNull();

		const unreadIndicator = unreadRow?.querySelector<HTMLElement>(
			'[data-space-unread-indicator="true"]'
		);
		expect(unreadIndicator).toBeTruthy();
		expect(
			unreadRow?.querySelector('[data-space-active-wake-orb="true"]')
		).toBeNull();
		expect(
			unreadIndicator?.classList.contains("group-hover/space-row:opacity-0")
		).toBe(false);
		expect(
			unreadIndicator?.classList.contains(
				"group-focus-within/space-row:translate-x-3"
			)
		).toBe(false);

		for (const spaceName of ["Working", "Unread"]) {
			const pinButton = screen.getByRole("button", {
				name: `Unpin ${spaceName}`,
			});
			expect(pinButton.classList.contains("opacity-100")).toBe(false);
			expect(
				pinButton.classList.contains("group-hover/space-row:opacity-100")
			).toBe(true);
			expect(
				pinButton.classList.contains("group-focus-within/space-row:opacity-100")
			).toBe(true);
		}

		expect(
			idleRow?.querySelector('[data-space-active-wake-orb="true"]')
		).toBeNull();
		expect(
			idleRow?.querySelector('[data-space-unread-indicator="true"]')
		).toBeNull();
		expect(
			screen
				.getByRole("button", { name: "Unpin Idle" })
				.hasAttribute("data-show-on-hover")
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Unpin Idle" })
				.classList.contains("pointer-events-none")
		).toBe(false);
	});

	it("keeps room for a persistently visible pinned action", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
			spaceItems: [],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const openSpaceButton = await screen.findByRole("link", {
			name: "Alpha",
		});
		const spaceName = openSpaceButton.querySelector<HTMLElement>(
			'[data-slot="center-truncated-text"]'
		);

		expect(spaceName?.classList.contains("pr-8")).toBe(true);
		expect(
			openSpaceButton.querySelector('[data-slot="space-sidebar-date"]')
		).toBeNull();
		expect(screen.getByRole("button", { name: "Unpin Alpha" })).toBeTruthy();
	});

	it("shows the full space name quickly on row hover", async () => {
		const longSpaceName = "CLI Dogfood 20260506 000022";
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-29T00:00:00.000Z",
							pinnedAt: null,
							profileId: "agent-1",
							profileName: "OpenMeld Canary Web Codex 20260506 000022",
						},
						{
							lastJoinedAt: "2026-04-28T00:00:00.000Z",
							pinnedAt: null,
							profileId: "human-1",
							profileName: "OpenMeld Test",
						},
					],
					openProfileId: "human-1",
					openProfileName: "OpenMeld Test",
					spaceId: "space-alpha",
					spaceName: longSpaceName,
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const rowButton = await screen.findByRole("link", {
			name: longSpaceName,
		});
		expect(rowButton).toBeTruthy();
		expect(screen.queryByText(longSpaceName)).toBeNull();

		fireEvent.pointerEnter(rowButton as HTMLButtonElement);
		fireEvent.mouseEnter(rowButton as HTMLButtonElement);

		await waitFor(
			() => {
				expect(screen.getByText(longSpaceName)).toBeTruthy();
			},
			{ timeout: 500 }
		);
		expect(screen.queryByText("Joined as OpenMeld Test")).toBeNull();
		expect(screen.queryByText(OTHER_JOINED_PROFILE_TEXT)).toBeNull();
	});

	it("opens a space with the current Web profile even when the index open profile is an agent", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-29T00:00:00.000Z",
							pinnedAt: null,
							profileId: "agent-1",
							profileName: "Codex",
						},
						{
							lastJoinedAt: "2026-04-28T00:00:00.000Z",
							pinnedAt: null,
							profileId: "human-1",
							profileName: "Mira",
						},
					],
					openProfileId: "agent-1",
					openProfileName: "Codex",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Alpha" });
		expect(link.getAttribute("href")).toBe(
			"/o/acme/spaces/space-alpha?profileId=human-1"
		);
	});

	it("opens an agent-only Space with the current Human Web viewer", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					joinedProfiles: [
						{
							lastJoinedAt: "2026-04-29T00:00:00.000Z",
							pinnedAt: null,
							profileId: "agent-1",
							profileName: "Codex",
						},
					],
					lastSeenTs: null,
					openProfileId: "agent-1",
					openProfileName: "Codex",
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Alpha" });

		expect(link.getAttribute("href")).toBe(
			"/o/acme/spaces/space-alpha?profileId=human-1"
		);
	});

	it("uses the Router link for Space navigation", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const link = await screen.findByRole("link", { name: "Alpha" });

		expect(link.getAttribute("href")).toBe(
			"/o/acme/spaces/space-alpha?profileId=human-1"
		);
	});

	it("renders the current space with the fluid sidebar selection surface", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
				createAccountSpaceItem({
					spaceId: "space-beta",
					spaceName: "Beta",
				}),
			],
		});

		const { container } = renderSidebar(
			<AppSpacesSidebar
				currentProfileId="human-1"
				currentSpaceId="space-alpha"
			/>
		);

		const activeLink = await screen.findByRole("link", { name: "Alpha" });
		const activeRow = activeLink.closest("[data-fluid-nav-value]");

		expect(activeRow?.getAttribute("data-state")).toBe("active");
		fireEvent.focus(activeLink);
		await waitFor(() => {
			expect(
				container.querySelector('[data-slot="fluid-nav-menu-active-indicator"]')
			).toBeTruthy();
		});
	});

	it("removes the redundant discovery section outside a conversation", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		await screen.findByText("No spaces yet.");
		expect(
			screen.queryByRole("button", { name: BROWSE_SPACES_TEXT })
		).toBeNull();
		expect(screen.queryByText("Explore")).toBeNull();
	});

	it("offers creation from the Spaces section in a personal organization", async () => {
		appOrganizationMock.currentOrganization = {
			id: "org-personal",
			isPersonal: true,
			name: "Mira",
			slug: "mira",
		};
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		const createButton = await screen.findByRole("button", {
			name: "Add Space or group",
		});
		fireEvent.click(createButton);
		fireEvent.click(
			await screen.findByText("New Space", { selector: "button" })
		);
		expect(navigateMock).toHaveBeenCalledWith({ to: "/o/mira/new-space" });
		expect(screen.queryByText("Open your Spaces")).toBeNull();
		expect(screen.queryByText("Find public Spaces")).toBeNull();
	});

	it("places the create-space action in the Spaces section after pinned spaces", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [
				createAccountSpaceItem({
					pinnedAt: "2026-04-29T01:00:00.000Z",
					spaceId: "space-pinned",
					spaceName: "Pinned Alpha",
				}),
			],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-regular",
					spaceName: "Regular Beta",
				}),
			],
		});

		const { container } = renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		expect(
			await screen.findByRole("link", { name: "Pinned Alpha" })
		).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Add Space or group" })
		).toBeTruthy();
		expect(container.querySelector('[data-slot="sidebar-header"]')).toBeNull();
		expect(
			getSidebarGroupLabel("Pinned").compareDocumentPosition(
				getSidebarGroupLabel("Spaces")
			)
		).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
	});

	it("optimistically moves a space into the pinned section", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});
		setAccountSpaceItemPinnedMock.mockReturnValue(
			new Promise(() => {
				// Keep the mutation pending so the optimistic cache state is visible.
			})
		);

		renderSidebar(
			<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
		);

		fireEvent.click(await screen.findByLabelText("Pin Alpha"));

		await waitFor(() => {
			expect(getSidebarGroupLabel("Pinned")).toBeTruthy();
		});
		expect(screen.getByLabelText("Unpin Alpha")).toBeTruthy();
		expect(setAccountSpaceItemPinnedMock).toHaveBeenCalledWith({
			pinnedAt: expect.any(String),
			profileIds: ["human-1"],
			spaceId: "space-alpha",
		});
	});

	it("keeps the optimistic pinned state while the Space Index overlay is pending", async () => {
		focusManager.setFocused(false);
		const overlayStartedAtMs = Date.now();
		const nowSpy = vi.spyOn(Date, "now").mockReturnValue(overlayStartedAtMs);
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {
			// Expected for a pending projection in this regression test.
		});
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					spaceId: "space-alpha",
					spaceName: "Alpha",
				}),
			],
		});
		setAccountSpaceItemPinnedMock.mockResolvedValue([
			{
				item: {
					spaceId: "space-alpha",
				},
				spaceIndexOverlay: {
					repairAttempted: true,
					status: "pending",
					updated: false,
				},
			},
		]);

		try {
			renderSidebar(
				<AppSpacesSidebar currentProfileId="human-1" currentSpaceId="" />
			);

			fireEvent.click(await screen.findByLabelText("Pin Alpha"));

			await waitFor(() => {
				expect(getSidebarGroupLabel("Pinned")).toBeTruthy();
			});
			expect(screen.getByLabelText("Unpin Alpha")).toBeTruthy();
			await waitFor(() => {
				expect(warnSpy).toHaveBeenCalledWith(
					"Pinned space update is waiting for Space Index.",
					{
						spaceId: "space-alpha",
						statuses: ["pending"],
					}
				);
			});

			act(() => focusManager.setFocused(true));
			await waitFor(() => {
				expect(listAccountSpaceItemsMock).toHaveBeenCalledTimes(2);
			});
			expect(screen.getByLabelText("Unpin Alpha")).toBeTruthy();

			nowSpy.mockReturnValue(overlayStartedAtMs + 60_001);
			act(() => focusManager.setFocused(false));
			act(() => focusManager.setFocused(true));
			await waitFor(() => {
				expect(listAccountSpaceItemsMock).toHaveBeenCalledTimes(3);
			});
			expect(screen.getByLabelText("Pin Alpha")).toBeTruthy();
		} finally {
			nowSpy.mockRestore();
			warnSpy.mockRestore();
		}
	});
});

function createSidebarQueryClient(): QueryClient {
	return new QueryClient({
		defaultOptions: {
			mutations: { retry: false },
			queries: { retry: false },
		},
	});
}

function seedCurrentSpaceWakeRace(queryClient: QueryClient): void {
	const accountSpaces = {
		pinnedItems: [
			createAccountSpaceItem({
				pinnedAt: "2026-04-29T01:00:00.000Z",
				spaceId: "space-alpha",
				spaceName: "Alpha",
			}),
			createAccountSpaceItem({
				pinnedAt: "2026-04-29T02:00:00.000Z",
				spaceId: "space-beta",
				spaceName: "Beta",
			}),
		],
		spaceItems: [],
	};
	const accountWakeSummary = {
		generatedAtMs: Date.now(),
		items: [
			{ activeWakeCount: 1, spaceId: "space-alpha" },
			{ activeWakeCount: 1, spaceId: "space-beta" },
		],
	};
	listAccountSpaceItemsMock.mockResolvedValue(accountSpaces);
	getAccountSpaceActiveWakeSummaryMock.mockResolvedValue(accountWakeSummary);
	queryClient.setQueryData(
		accountSpaceQueryKeys.items("human-1", "account"),
		accountSpaces
	);
	queryClient.setQueryData(accountSpaceQueryKeys.activeWakeSummary("human-1"), {
		browserRequestStartedAtMonotonicMs: performance.now(),
		summary: accountWakeSummary,
	});
	const currentSpaceSummaryOptions = spaceActiveWakeProgressSummaryQueryOptions(
		{
			enabled: false,
			openMeldProfileId: "human-1",
			spaceId: "space-alpha",
		}
	);
	queryClient.setQueryData(currentSpaceSummaryOptions.queryKey, {
		items: [
			createWakeProgressItem({
				clientMessageId: "client-message-alpha",
				dispatchId: "dispatch-alpha",
				phase: "running",
				sourceSignalId: "signal-alpha",
				targetLabel: "Runner",
				targetProfileId: "agent-alpha",
				updatedAtMs: Date.now(),
			}),
		],
		query: {
			spaceId: "space-alpha",
			targetProfileId: null,
		},
	});
}

function renderSidebar(
	element: ReactElement,
	queryClient = createSidebarQueryClient()
) {
	const wrap = (ui: ReactElement) => (
		<QueryClientProvider client={queryClient}>
			<TooltipProvider>{ui}</TooltipProvider>
		</QueryClientProvider>
	);
	const view = render(wrap(element));
	return {
		...view,
		rerender: (ui: ReactElement) => view.rerender(wrap(ui)),
	};
}

function createAccountSpaceItem(input: {
	joinedProfiles?: Array<{
		lastJoinedAt: string;
		pinnedAt: string | null;
		profileId: string;
		profileName: string;
	}>;
	lastJoinedAt?: string;
	lastSeenTs?: number | null;
	openProfileId?: string;
	openProfileName?: string;
	organizationId?: string;
	pinnedAt?: string | null;
	spaceId: string;
	spaceName: string;
	spacePurpose?: string | null;
	activeMemberCount?: number | null;
}) {
	const pinnedAt = input.pinnedAt ?? null;
	const openProfileId = input.openProfileId ?? "human-1";
	const openProfileName = input.openProfileName ?? "Mira";
	const lastJoinedAt = input.lastJoinedAt ?? "2026-04-29T00:00:00.000Z";
	return {
		joinedProfiles: input.joinedProfiles ?? [
			{
				lastJoinedAt,
				pinnedAt,
				profileId: openProfileId,
				profileName: openProfileName,
			},
		],
		lastJoinedAt,
		lastSeenTs:
			input.lastSeenTs === undefined
				? Date.parse("2026-04-30T00:00:00.000Z")
				: input.lastSeenTs,
		openProfileId,
		openProfileName,
		organizationId: input.organizationId ?? "org-acme",
		pinnedAt,
		pinnedProfileIds: pinnedAt ? [openProfileId] : [],
		spaceId: input.spaceId,
		spaceName: input.spaceName,
		spacePurpose: input.spacePurpose ?? null,
		activeAgentCount: null,
		activeHumanCount: null,
		activeMemberCount: input.activeMemberCount ?? null,
		visibility: "private",
	};
}
