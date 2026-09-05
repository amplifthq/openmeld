import type { GetSpaceStatusResponse } from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createInitialStartFlowState,
	resolveStartFlowStorageKey,
	StartFlowStateProvider,
	serializeStartFlowState,
} from "#/components/app/start-flow-state";
import { resolveLastUsedHumanProfileStorageKey } from "#/lib/spaces/last-used-profile";
import { startQueryKeys } from "#/query/query-keys";
import { createSpaceConversationDisplaySnapshot } from "#/query/spaces/display-snapshot";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";

const {
	appDirectMessageShellMock,
	appSpaceShellMock,
	getSpaceStatusMock,
	listAccountSpaceItemsMock,
	listStartProfilesMock,
	navigateMock,
	resolveSpaceEntryMock,
	spaceWindowShellMock,
	spaceProfileRequiredStateMock,
	spaceLandingMock,
} = vi.hoisted(() => ({
	appDirectMessageShellMock: vi.fn(
		(input: {
			children: ReactNode;
			currentProfileId: string;
			currentSpaceId: string;
		}) => (
			<section
				data-current-profile-id={input.currentProfileId}
				data-current-space-id={input.currentSpaceId}
				data-testid="app-direct-message-shell"
			>
				{input.children}
			</section>
		)
	),
	appSpaceShellMock: vi.fn(
		(input: {
			children: ReactNode;
			currentProfileId: string;
			currentSpaceId: string;
		}) => (
			<section
				data-current-profile-id={input.currentProfileId}
				data-current-space-id={input.currentSpaceId}
				data-testid="app-space-shell"
			>
				{input.children}
			</section>
		)
	),
	getSpaceStatusMock: vi.fn(),
	listAccountSpaceItemsMock: vi.fn(),
	spaceWindowShellMock: vi.fn((input: { children: ReactNode }) => (
		<section data-testid="space-window-shell">{input.children}</section>
	)),
	spaceLandingMock: vi.fn(
		({ profileId, spaceId }: { profileId: string; spaceId: string }) => (
			<div
				data-profile-id={profileId}
				data-space-id={spaceId}
				data-testid="space-landing"
			/>
		)
	),
	listStartProfilesMock: vi.fn(),
	navigateMock: vi.fn(),
	resolveSpaceEntryMock: vi.fn(),
	spaceProfileRequiredStateMock: vi.fn(),
}));

vi.mock("@tanstack/react-router", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@tanstack/react-router")>();
	return {
		...actual,
		useNavigate: () => navigateMock,
	};
});

vi.mock("#/components/spaces/app-space-shell", () => ({
	AppDirectMessageShell: appDirectMessageShellMock,
	AppSpaceShell: appSpaceShellMock,
	SpaceWindowShell: spaceWindowShellMock,
}));

vi.mock("#/components/spaces/space-landing", () => ({
	SpaceLanding: spaceLandingMock,
}));

vi.mock("#/components/spaces/space-profile-required-state", () => ({
	SpaceProfileRequiredState: (input: {
		recommendedHumanProfile?: {
			profileId: string;
			profileName: string;
			spaceId: string;
		} | null;
	}) => {
		spaceProfileRequiredStateMock(input);
		return (
			<div
				data-profile-id={input.recommendedHumanProfile?.profileId ?? ""}
				data-profile-name={input.recommendedHumanProfile?.profileName ?? ""}
				data-space-id={input.recommendedHumanProfile?.spaceId ?? ""}
				data-testid="space-profile-required-state"
			>
				Choose a profile to open this Space
			</div>
		);
	},
}));

vi.mock("#/lib/organizations/organization-context", () => ({
	useAppOrganization: () => ({
		activeOrganization: null,
		currentOrganization: {
			id: "org-acme",
			name: "Acme",
			slug: "acme",
		},
		organizations: [],
	}),
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
	};
});

vi.mock("#/lib/spaces/api", () => ({
	createOrganizationScopedWebSpaceApi: () => ({
		addMembers: vi.fn(),
		addOrganizationDirectoryProfilesToSpace: vi.fn(),
		removeMembers: vi.fn(),
	}),
	createUnscopedWebSpaceApi: () => ({
		getStatus: (...args: unknown[]) => getSpaceStatusMock(...args),
		resolveEntry: (...args: unknown[]) => resolveSpaceEntryMock(...args),
	}),
}));

import { AppSpaceEntryContent } from "./$spaceId";

describe("app space entry route", () => {
	beforeEach(() => {
		window.sessionStorage.clear();
		window.localStorage.clear();
		appDirectMessageShellMock.mockClear();
		appSpaceShellMock.mockClear();
		listAccountSpaceItemsMock.mockReset().mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});
		getSpaceStatusMock.mockReset().mockResolvedValue(
			createSpaceStatus({
				spaceId: "space-123",
				spacePurpose: "collaboration",
			})
		);
		spaceWindowShellMock.mockClear();
		listStartProfilesMock.mockReset().mockResolvedValue([
			createProfile({
				openMeldProfileId: "profile-123",
				isDefault: true,
				profileName: "Current Human",
			}),
		]);
		navigateMock.mockReset().mockResolvedValue(undefined);
		resolveSpaceEntryMock.mockReset().mockResolvedValue({
			participation: { state: "active_member" },
			recovery: null,
			safeContext: {
				organizationId: "org-acme",
				organizationSlug: "acme",
				spaceName: "Shared Space",
			},
			target: { spaceId: "space-123" },
			view: { experience: "member", state: "allowed" },
		});
		spaceProfileRequiredStateMock.mockClear();
		spaceLandingMock.mockClear();
	});

	afterEach(() => {
		cleanup();
		window.sessionStorage.clear();
		window.localStorage.clear();
		vi.restoreAllMocks();
	});

	it("redirects to the default human profile when profileId is missing", async () => {
		renderAppSpaceEntry({
			selectedHumanProfileId: null,
			spaceId: "space-123",
		});

		// A default human profile resolves → fill in the canonical ?profileId URL
		// instead of stopping the user with the chooser.
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				params: { orgSlug: "acme", spaceId: "space-123" },
				replace: true,
				search: { profileId: "profile-123" },
				to: "/o/$orgSlug/spaces/$spaceId",
			});
		});
		expect(screen.queryByTestId("space-profile-required-state")).toBeNull();
		expect(spaceProfileRequiredStateMock).not.toHaveBeenCalled();
		expect(spaceLandingMock).not.toHaveBeenCalled();
		expect(appSpaceShellMock).toHaveBeenCalledWith(
			expect.objectContaining({
				currentProfileId: "profile-123",
				currentSpaceId: "space-123",
			}),
			undefined
		);
	});

	it("redirects to the remembered human profile from localStorage when profileId is missing", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "human-default",
				isDefault: true,
				profileName: "Default Human",
			}),
			createProfile({
				openMeldProfileId: "human-remembered",
				isDefault: false,
				profileName: "Remembered Human",
			}),
		]);
		window.localStorage.setItem(
			resolveLastUsedHumanProfileStorageKey("user-123"),
			"human-remembered"
		);

		renderAppSpaceEntry({
			selectedHumanProfileId: null,
			spaceId: "space-123",
		});

		// Last-used wins over the default human profile.
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				params: { orgSlug: "acme", spaceId: "space-123" },
				replace: true,
				search: { profileId: "human-remembered" },
				to: "/o/$orgSlug/spaces/$spaceId",
			});
		});
		expect(spaceProfileRequiredStateMock).not.toHaveBeenCalled();
	});

	it("keeps profile choice explicit when no active default human profile is available", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "human-alpha",
				isDefault: false,
				profileName: "Human Alpha",
			}),
		]);

		renderAppSpaceEntry({
			selectedHumanProfileId: null,
			spaceId: "space-123",
		});

		expect(
			await screen.findByTestId("space-profile-required-state")
		).toBeTruthy();
		expect(spaceProfileRequiredStateMock.mock.calls.at(-1)?.[0]).toEqual({
			recommendedHumanProfile: null,
		});
		expect(spaceLandingMock).not.toHaveBeenCalled();
		expect(appSpaceShellMock).not.toHaveBeenCalled();
		expect(spaceWindowShellMock).toHaveBeenCalled();
	});

	it("centers the profile check loading state without a card surface", () => {
		listStartProfilesMock.mockImplementation(
			() =>
				new Promise(() => {
					// Keep the profile query pending so the loading state remains visible.
				})
		);

		renderAppSpaceEntry({
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-123",
		});

		const loadingState = screen.getByRole("status", {
			name: "Checking profile",
		});
		expect(
			screen.getByRole("heading", { name: "Checking your profile" })
		).toBeTruthy();
		// Horizontal centering + text alignment stay on the loading state; the
		// vertical centering now belongs to the app shell content body.
		expect(loadingState.classList.contains("items-center")).toBe(true);
		expect(loadingState.classList.contains("text-center")).toBe(true);
		expect(loadingState.querySelector('[data-slot="card"]')).toBeNull();
		expect(screen.queryByTestId("space-landing")).toBeNull();
		expect(appSpaceShellMock).not.toHaveBeenCalled();
		expect(spaceWindowShellMock).toHaveBeenCalled();
	});

	it("enters the conversation while current status confirms in the background", async () => {
		getSpaceStatusMock.mockImplementation(
			() =>
				new Promise(() => {
					// Keep status pending so the route-classification state remains visible.
				})
		);

		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			spaceQueryKeys.displaySnapshot("space-123", "profile-123"),
			createSpaceConversationDisplaySnapshot(
				createSpaceStatus({
					spaceId: "space-123",
					spacePurpose: "shared_space",
				})
			)
		);
		renderAppSpaceEntry({
			profileId: "profile-123",
			queryClient,
			selectedHumanProfileId: "profile-123",
			spaceId: "space-123",
		});

		expect(await screen.findByTestId("app-space-shell")).toBeTruthy();
		expect(await screen.findByTestId("space-landing")).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Checking your profile" })
		).toBeNull();
		expect(
			screen.queryByRole("heading", { name: "Opening this conversation" })
		).toBeNull();
	});

	it("renders the sidebar shell and space landing when profileId is present", async () => {
		renderAppSpaceEntry({
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-123",
		});

		expect(await screen.findByTestId("app-space-shell")).toBeTruthy();
		expect(await screen.findByTestId("space-landing")).toBeTruthy();
		expect(appSpaceShellMock).toHaveBeenCalledWith(
			expect.objectContaining({
				currentProfileId: "profile-123",
				currentSpaceId: "space-123",
			}),
			undefined
		);
		expect(spaceLandingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				profileId: "profile-123",
				spaceId: "space-123",
			}),
			undefined
		);
		expect(screen.queryByTestId("space-profile-required-state")).toBeNull();
	});

	it("redirects a current Direct Message from its legacy Space URL to the canonical route", async () => {
		getSpaceStatusMock.mockResolvedValue(
			createSpaceStatus({
				spaceId: "space-dm",
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					spaceId: "space-dm",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
		});

		renderAppSpaceEntry({
			focusInteractionId: "interaction-123",
			focusSignalId: "signal-123",
			focusThreadRootSignalId: "thread-123",
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-dm",
		});

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/direct-messages/space-dm?focusInteractionId=interaction-123&focusSignalId=signal-123&focusThreadRootSignalId=thread-123&profileId=profile-123",
			});
		});
		expect(spaceLandingMock).not.toHaveBeenCalled();
	});

	it("opens a newly created Direct Message without flashing or redirecting through Spaces when the account index is still stale", async () => {
		getSpaceStatusMock.mockResolvedValue(
			createSpaceStatus({
				spaceId: "space-new-dm",
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [],
		});

		renderAppSpaceEntry({
			navigationSurface: "directMessages",
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-new-dm",
		});

		expect(await screen.findByTestId("app-direct-message-shell")).toBeTruthy();
		expect(await screen.findByTestId("space-landing")).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalledWith(
			expect.objectContaining({
				to: expect.stringContaining("/spaces/"),
			})
		);
	});

	it("keeps a restored Direct Message mounted so its conversation can handle a current access failure", async () => {
		getSpaceStatusMock.mockRejectedValue(
			new Error("Current Direct Message access check failed")
		);
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			spaceQueryKeys.displaySnapshot("space-saved-dm", "profile-123"),
			createSpaceConversationDisplaySnapshot(
				createSpaceStatus({
					spaceId: "space-saved-dm",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				})
			)
		);

		renderAppSpaceEntry({
			navigationSurface: "directMessages",
			profileId: "profile-123",
			queryClient,
			selectedHumanProfileId: "profile-123",
			spaceId: "space-saved-dm",
		});

		expect(await screen.findByTestId("app-direct-message-shell")).toBeTruthy();
		expect(await screen.findByTestId("space-landing")).toBeTruthy();
	});

	it("preserves the exact focus target when a non-DM uses the Direct Messages URL", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 2,
					spaceId: "space-regular",
					spacePurpose: "collaboration",
				}),
			],
		});

		renderAppSpaceEntry({
			focusInteractionId: "interaction-123",
			focusSignalId: "signal-123",
			focusThreadRootSignalId: "thread-123",
			navigationSurface: "directMessages",
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-regular",
		});

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/spaces/space-regular?focusInteractionId=interaction-123&focusSignalId=signal-123&focusThreadRootSignalId=thread-123&profileId=profile-123",
			});
		});
	});

	it("keeps a degraded three-member DM-origin Space on the Spaces route", async () => {
		listAccountSpaceItemsMock.mockResolvedValue({
			pinnedItems: [],
			spaceItems: [
				createAccountSpaceItem({
					activeMemberCount: 3,
					spaceId: "space-degraded-dm",
					spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				}),
			],
		});

		renderAppSpaceEntry({
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-degraded-dm",
		});

		expect(await screen.findByTestId("space-landing")).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("keeps a converted two-member DM-origin Space on the Spaces route", async () => {
		getSpaceStatusMock.mockResolvedValue(
			createSpaceStatus({
				directMessageConvertedAt: "2026-08-07T12:00:00.000Z",
				spaceId: "space-converted-dm",
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
			})
		);

		renderAppSpaceEntry({
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-converted-dm",
		});

		expect(await screen.findByTestId("space-landing")).toBeTruthy();
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("keeps a Space visible when a saved profile exists and refresh fails", async () => {
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			startQueryKeys.profilesForStorageScope("user-123"),
			[
				createProfile({
					openMeldProfileId: "profile-123",
					isDefault: true,
					profileName: "Saved Human",
				}),
			]
		);
		await queryClient.invalidateQueries({
			queryKey: startQueryKeys.profilesForStorageScope("user-123"),
			refetchType: "none",
		});
		listStartProfilesMock.mockRejectedValue(
			new Error("Profile refresh failed")
		);

		renderAppSpaceEntry({
			profileId: "profile-123",
			queryClient,
			selectedHumanProfileId: "profile-123",
			spaceId: "space-123",
		});

		await waitFor(() => {
			expect(
				queryClient.getQueryState(
					startQueryKeys.profilesForStorageScope("user-123")
				)?.status
			).toBe("error");
		});
		expect(screen.getByTestId("space-landing")).toBeTruthy();
		expect(
			screen.queryByRole("heading", {
				name: "OpenMeld could not load profiles",
			})
		).toBeNull();
	});

	it("redirects an agent profile URL back to the user's human profile", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "current-human",
				isDefault: true,
				profileName: "Current Human",
			}),
			createProfile({
				openMeldProfileId: "agt_current-agent",
				profileKind: "agent",
				profileName: "Current Agent",
			}),
		]);

		renderAppSpaceEntry({
			profileId: "agt_current-agent",
			selectedHumanProfileId: "current-human",
			spaceId: "space-123",
		});

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				params: { orgSlug: "acme", spaceId: "space-123" },
				replace: true,
				search: { profileId: "current-human" },
				to: "/o/$orgSlug/spaces/$spaceId",
			});
		});
		expect(appSpaceShellMock).toHaveBeenCalledWith(
			expect.objectContaining({
				currentProfileId: "current-human",
				currentSpaceId: "space-123",
			}),
			undefined
		);
		expect(spaceLandingMock).not.toHaveBeenCalled();
		expect(
			screen.queryByRole("heading", {
				name: "Open This Space With Your Profile",
			})
		).toBeNull();
	});

	it("shows the owning Space and owner when an Organization member needs access", async () => {
		resolveSpaceEntryMock.mockResolvedValue({
			participation: { state: "owner_add_required" },
			recovery: { kind: "contact_space_owner" },
			safeContext: {
				organizationId: "org-acme",
				organizationSlug: "acme",
				owner: {
					displayName: "Mira Chen",
					profileId: "human-owner",
				},
				spaceName: "Release Planning",
			},
			target: { spaceId: "space-private" },
			view: { state: "membership_required" },
		});

		renderAppSpaceEntry({
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-private",
		});

		expect(
			await screen.findByRole("heading", {
				name: "You don't have access to Release Planning",
			})
		).toBeTruthy();
		expect(
			screen.getByText("Ask Mira Chen to add you to this Space.")
		).toBeTruthy();
		expect(
			screen.getByRole("link", { name: "Back to Spaces" }).getAttribute("href")
		).toBe("/o/acme/spaces");
		expect(spaceLandingMock).not.toHaveBeenCalled();
	});

	it("moves a public-only profile view to the public route without losing its message target", async () => {
		resolveSpaceEntryMock.mockResolvedValue({
			participation: { state: "self_join_available" },
			recovery: null,
			safeContext: {
				organizationId: "org-acme",
				organizationSlug: "acme",
				spaceName: "Public Notes",
			},
			target: {
				signalId: "signal-123",
				spaceId: "space-public",
				threadRootSignalId: "thread-root-123",
			},
			view: { experience: "public", state: "allowed" },
		});

		renderAppSpaceEntry({
			focusSignalId: "signal-123",
			focusThreadRootSignalId: "thread-root-123",
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-public",
		});

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				params: { spaceId: "space-public" },
				replace: true,
				search: {
					signalId: "signal-123",
					threadRootSignalId: "thread-root-123",
				},
				to: "/spaces/$spaceId",
			});
		});
		expect(spaceLandingMock).not.toHaveBeenCalled();
	});

	it("redirects to the public Space viewer when profileId is not in the current account", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "current-human",
				isDefault: true,
				profileName: "Current Human",
			}),
		]);

		renderAppSpaceEntry({
			profileId: "other-account-human",
			selectedHumanProfileId: "current-human",
			spaceId: "space-123",
		});

		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				params: { spaceId: "space-123" },
				replace: true,
				to: "/spaces/$spaceId",
			});
		});
		expect(
			screen.queryByRole("heading", {
				name: "Open This Space With Your Profile",
			})
		).toBeNull();
		expect(spaceLandingMock).not.toHaveBeenCalled();
		expect(appSpaceShellMock).not.toHaveBeenCalled();
	});
});

function renderAppSpaceEntry(input: {
	focusInteractionId?: string;
	focusSignalId?: string;
	focusThreadRootSignalId?: string;
	navigationSurface?: "directMessages" | "spaces";
	profileId?: string;
	queryClient?: ReturnType<typeof createTestQueryClient>;
	selectedHumanProfileId?: string | null;
	spaceId: string;
}) {
	window.sessionStorage.setItem(
		resolveStartFlowStorageKey("user-123"),
		serializeStartFlowState({
			...createInitialStartFlowState(),
			selectedHumanProfileId: input.selectedHumanProfileId ?? null,
		})
	);

	return render(
		<TestQueryClientProvider queryClient={input.queryClient}>
			<StartFlowStateProvider storageScope="user-123">
				<AppSpaceEntryContent
					{...(input.profileId ? { profileId: input.profileId } : {})}
					focusInteractionId={input.focusInteractionId}
					focusSignalId={input.focusSignalId}
					focusThreadRootSignalId={input.focusThreadRootSignalId}
					navigationSurface={input.navigationSurface}
					orgSlug="acme"
					spaceId={input.spaceId}
				/>
			</StartFlowStateProvider>
		</TestQueryClientProvider>
	);
}

function createAccountSpaceItem(input: {
	activeMemberCount: number;
	spaceId: string;
	spacePurpose: string;
}) {
	return {
		activeAgentCount: 1,
		activeHumanCount: 1,
		activeMemberCount: input.activeMemberCount,
		joinedProfiles: [
			{
				lastJoinedAt: "2026-08-05T00:00:00.000Z",
				pinnedAt: null,
				profileId: "profile-123",
				profileName: "Current Human",
			},
		],
		lastJoinedAt: "2026-08-05T00:00:00.000Z",
		openProfileId: "profile-123",
		openProfileName: "Current Human",
		organizationId: "org-acme",
		pinnedAt: null,
		pinnedProfileIds: [],
		spaceId: input.spaceId,
		spaceName: "Current Human and Build Agent",
		spacePurpose: input.spacePurpose,
		visibility: "private" as const,
	};
}

function createSpaceStatus(input: {
	directMessageConvertedAt?: string;
	spaceId: string;
	spacePurpose: string;
}): GetSpaceStatusResponse {
	return {
		...(input.directMessageConvertedAt
			? { directMessageConvertedAt: input.directMessageConvertedAt }
			: {}),
		spaceId: input.spaceId,
		generatedAt: "2026-08-07T00:00:00.000Z",
		name: "Conversation",
		spacePurpose: input.spacePurpose,
		accessMode: "public" as const,
		passwordProtected: false,
		dispatchPolicy: { mode: "mention_only" as const },
		publicationMode: "collaboration" as const,
		allowedActions: ["post_message", "post_status", "stay_silent"],
		resultArchivePolicy: { mode: "all_final_results" as const },
		entryBrief: "default" as const,
		dispatchBrief: "default" as const,
		members: {
			totalCount: 2,
			humanCount: 2,
			agentCount: 0,
			liveNowCount: 1,
			liveHumanCount: 1,
			liveAgentCount: 0,
		},
	};
}

function createProfile(input: {
	openMeldProfileId: string;
	isDefault?: boolean;
	profileKind?: "agent" | "human";
	profileName?: string;
	status?: "active" | "disabled";
}) {
	return {
		openMeldProfileId: input.openMeldProfileId,
		createdAt: "2026-01-01T00:00:00.000Z",
		isDefault: input.isDefault ?? false,
		lastUsedAt: null,
		ownerName: "Current User",
		ownerUserId: "user-123",
		profileHandle: input.openMeldProfileId,
		profileKind: input.profileKind ?? "human",
		profileName: input.profileName ?? "Current Human",
		status: input.status ?? "active",
		updatedAt: "2026-01-01T00:00:00.000Z",
	};
}
