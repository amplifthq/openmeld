import type {
	GetSpaceStatusResponse,
	ListSpaceThreadsResponse,
	SpaceBootstrapResponse,
} from "@openmeld/schemas/types";
import { OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE } from "@openmeld/space";
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import {
	type ComponentProps,
	type ReactNode,
	use,
	useEffect,
	useState,
} from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	createInitialStartFlowState,
	resolveStartFlowStorageKey,
	StartFlowStateProvider,
	serializeStartFlowState,
} from "#/components/app/start-flow-state";
import { resolveLastUsedHumanProfileStorageKey } from "#/lib/spaces/last-used-profile";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import { startQueryKeys } from "#/query/query-keys";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { createSpaceConversationDisplaySnapshot } from "#/query/spaces/display-snapshot";
import { spaceEntryResolutionQueryOptions } from "#/query/spaces/entry-resolution";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	createTestQueryClient,
	TestQueryClientProvider,
} from "#/test-support/query-client";

const {
	appDirectMessageShellMock,
	appSpaceShellMock,
	getSpaceStatusMock,
	getBootstrapMock,
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
	getBootstrapMock: vi.fn(),
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
		// These tests render the route content without a router; only the
		// location search and state are read.
		useLocation: (options?: {
			select?: (location: { search: object; state: object }) => unknown;
		}) => {
			const location = { search: {}, state: {} };
			return options?.select ? options.select(location) : location;
		},
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
		storageScope: "user-123",
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
		getBootstrap: (...args: unknown[]) => getBootstrapMock(...args),
		getStatus: (...args: unknown[]) => getSpaceStatusMock(...args),
		resolveEntry: (...args: unknown[]) => resolveSpaceEntryMock(...args),
	}),
}));

import { AppSpaceEntryContent } from "./$spaceId";

describe("app space entry route", () => {
	beforeEach(() => {
		vi.spyOn(
			resolveAppQueryPersistenceController(),
			"clearSpaceConversation"
		).mockResolvedValue(undefined);
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
		getBootstrapMock
			.mockReset()
			.mockImplementation(() => new Promise(() => undefined));
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
		// Restores the stateless default after tests that install their own.
		spaceLandingMock.mockReset();
	});

	afterEach(() => {
		cleanup();
		window.sessionStorage.clear();
		window.localStorage.clear();
		vi.restoreAllMocks();
	});
	it("mounts the conversation for local drafting while cold access is pending", async () => {
		resolveSpaceEntryMock.mockImplementation(
			() => new Promise(() => undefined)
		);
		const queryClient = createTestQueryClient();
		queryClient.setQueryData(
			accountSpaceQueryKeys.items("profile-123", "account"),
			{
				pinnedItems: [],
				spaceItems: [
					createAccountSpaceItem({
						activeMemberCount: 2,
						spaceId: "space-123",
						spacePurpose: "collaboration",
					}),
				],
			}
		);
		renderAppSpaceEntry({
			spaceId: "space-123",
			profileId: "profile-123",
			queryClient,
		});
		// The entry gate releases the identity-scoped conversation for drafting
		// while access is confirmed; writes still wait for the confirmation.
		expect(await screen.findByTestId("space-landing")).toBeTruthy();
		expect(screen.queryByText("Opening Space")).toBeNull();
	});
	it.each([
		undefined,
		"reply-1",
	])("reuses prefetched entry on a cold click with target %s, even when the catalog infers a Thread", async (signalId) => {
		const queryClient = createTestQueryClient();
		const threadId = "thr_11111111-1111-4111-8111-111111111111";
		const createdAt = "2026-09-15T00:00:00Z";
		const catalog: ListSpaceThreadsResponse = {
			threads: [
				{
					threadId,
					spaceId: "space-123",
					rootSignalId: "root-1",
					createdAt,
					updatedAt: createdAt,
					createdByProfileId: "profile-123",
				},
			],
			previews: [
				{
					threadId,
					replyCount: 1,
					signals: [],
					placements: [
						{ threadId, signalId: "reply-1", placement: "thread", createdAt },
					],
				},
			],
		};
		queryClient.setQueryData(
			spaceQueryKeys.threads("space-123", "profile-123"),
			catalog
		);
		await queryClient.prefetchQuery(
			spaceEntryResolutionQueryOptions({
				enabled: true,
				signalId,
				spaceId: "space-123",
				openMeldProfileId: "profile-123",
			})
		);
		renderAppSpaceEntry({
			focusSignalId: signalId,
			spaceId: "space-123",
			profileId: "profile-123",
			queryClient,
		});
		expect(await screen.findByTestId("space-landing")).toBeTruthy();
		expect(resolveSpaceEntryMock).toHaveBeenCalledOnce();
		expect(
			queryClient.getQueryData(
				spaceQueryKeys.displaySnapshot("space-123", "profile-123")
			)
		).toBeUndefined();
	});

	it("restores a saved conversation on browser mount without waiting for the entry resolver or a client loader", async () => {
		const queryClient = createTestQueryClient();
		resolveSpaceEntryMock.mockImplementation(
			() => new Promise(() => undefined)
		);
		const controller = resolveAppQueryPersistenceController();
		const restore = vi
			.spyOn(controller, "activateSpaceConversation")
			.mockImplementation(() => {
				queryClient.setQueryData(
					spaceQueryKeys.displaySnapshot("space-123", "profile-123"),
					createSpaceConversationDisplaySnapshot(
						createSpaceStatus({
							spaceId: "space-123",
							spacePurpose: "collaboration",
						})
					)
				);
				queryClient.setQueryData(
					spaceQueryKeys.history("space-123", "profile-123"),
					{ envelopes: [], nextCursor: null }
				);
				return Promise.resolve();
			});
		renderAppSpaceEntry({
			spaceId: "space-123",
			profileId: "profile-123",
			queryClient,
		});
		await waitFor(() =>
			expect(screen.getByTestId("space-landing")).toBeTruthy()
		);
		expect(restore).toHaveBeenCalledWith(
			expect.objectContaining({
				ownerAccountId: "user-123",
				organizationId: "org-acme",
				spaceId: "space-123",
				openMeldProfileId: "profile-123",
			})
		);
		expect(screen.queryByText("Checking Space access")).toBeNull();
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

	it("keeps the conversation frame on screen while the profile check is pending", () => {
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

		// The profile check shows the same conversation frame the conversation
		// replaces, not a centered status card.
		expect(screen.getByText("Loading messages…")).toBeTruthy();
		expect(
			screen.queryByRole("heading", { name: "Checking your profile" })
		).toBeNull();
		expect(document.querySelector('[data-slot="card"]')).toBeNull();
		expect(screen.queryByTestId("space-landing")).toBeNull();
		expect(appSpaceShellMock).not.toHaveBeenCalled();
		expect(spaceWindowShellMock).toHaveBeenCalled();
	});

	it("mounts the conversation shell while cold route classification is still pending", async () => {
		getSpaceStatusMock.mockImplementation(() => new Promise(() => undefined));
		renderAppSpaceEntry({
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-123",
		});
		await waitFor(() => expect(getBootstrapMock).toHaveBeenCalledOnce());
		expect(getSpaceStatusMock).not.toHaveBeenCalled();
		expect(getBootstrapMock).toHaveBeenCalledWith(
			expect.objectContaining({
				spaceId: "space-123",
				historyQuery: expect.objectContaining({
					recent: true,
					limit: 30,
					kinds: ["text", "status", "system_notice"],
				}),
			})
		);
		expect(await screen.findByTestId("space-landing")).toBeTruthy();
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
		expect(getBootstrapMock).not.toHaveBeenCalled();
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

	it("gives every Space its own conversation state when switching Spaces", async () => {
		const spaceIdsByInstance = new Map<object, Set<string>>();
		spaceLandingMock.mockImplementation(({ spaceId }) => (
			<StatefulSpaceLanding
				onRender={(instance) => {
					const seen = spaceIdsByInstance.get(instance) ?? new Set<string>();
					seen.add(spaceId);
					spaceIdsByInstance.set(instance, seen);
				}}
				spaceId={spaceId}
			/>
		));
		const queryClient = createTestQueryClient();
		const view = renderAppSpaceEntry({
			profileId: "profile-123",
			queryClient,
			selectedHumanProfileId: "profile-123",
			spaceId: "space-a",
		});
		await screen.findByTestId("space-landing");
		fireEvent.change(screen.getByLabelText("Draft"), {
			target: { value: "Draft for Space A" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Open Thread" }));
		fireEvent.click(screen.getByRole("button", { name: "Select message" }));
		fireEvent.click(screen.getByRole("button", { name: "Attach file" }));
		expect(screen.getByTestId("open-thread").textContent).toBe(
			"thread-space-a"
		);

		for (const spaceId of ["space-b", "space-a"]) {
			view.rerender(buildAppSpaceEntryElement({ queryClient, spaceId }));
			await waitFor(() =>
				expect(
					screen.getByTestId("space-landing").getAttribute("data-space-id")
				).toBe(spaceId)
			);
			expect(
				screen
					.getByTestId("app-space-shell")
					.getAttribute("data-current-space-id")
			).toBe(spaceId);
			// Draft, open Thread, selection, and pending uploads belong to the
			// Space they were made in; the next Space starts from its own state.
			expect((screen.getByLabelText("Draft") as HTMLInputElement).value).toBe(
				""
			);
			expect(screen.getByTestId("open-thread").textContent).toBe("");
			expect(screen.getByTestId("selected-signal").textContent).toBe("");
			expect(screen.getByTestId("pending-uploads").textContent).toBe("0");
		}
		// No conversation instance is ever reused for a different Space.
		expect(spaceIdsByInstance.size).toBe(3);
		for (const seen of spaceIdsByInstance.values()) {
			expect(seen.size).toBe(1);
		}
	});

	it("commits the new Space selection before the next conversation mounts", async () => {
		const pendingConversation = new Promise<never>(() => undefined);
		spaceLandingMock.mockImplementation(({ spaceId }) => (
			<SuspendingSpaceLanding
				pending={spaceId === "space-b" ? pendingConversation : null}
				spaceId={spaceId}
			/>
		));
		const queryClient = createTestQueryClient();
		const view = renderAppSpaceEntry({
			profileId: "profile-123",
			queryClient,
			selectedHumanProfileId: "profile-123",
			spaceId: "space-a",
		});
		expect(
			(await screen.findByTestId("space-landing")).getAttribute("data-space-id")
		).toBe("space-a");

		act(() => {
			view.rerender(
				buildAppSpaceEntryElement({ queryClient, spaceId: "space-b" })
			);
		});

		// The sidebar selection moves first, and the leaving Space is gone, while
		// Space B is still rendering in the background.
		expect(
			screen
				.getByTestId("app-space-shell")
				.getAttribute("data-current-space-id")
		).toBe("space-b");
		expect(screen.queryByTestId("space-landing")).toBeNull();
		expect(screen.getByText("Loading messages…")).toBeTruthy();
	});

	it("redirects a current Direct Message from its legacy Space URL to the canonical route", async () => {
		mockBootstrapStatus(
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
				to: "/o/acme/chats/space-dm?focusInteractionId=interaction-123&focusSignalId=signal-123&focusThreadRootSignalId=thread-123&profileId=profile-123",
			});
		});
		expect(screen.queryByTestId("space-landing")).toBeNull();
	});

	it("opens a newly created Direct Message without flashing or redirecting through Spaces when the account index is still stale", async () => {
		mockBootstrapStatus(
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

	it("defers a quick return to the previous Space before the next one commits", async () => {
		const pendingConversation = new Promise<never>(() => undefined);
		let conversationsPending = false;
		spaceLandingMock.mockImplementation(({ spaceId }) => (
			<SuspendingSpaceLanding
				pending={conversationsPending ? pendingConversation : null}
				spaceId={spaceId}
			/>
		));
		const queryClient = createTestQueryClient();
		const view = renderAppSpaceEntry({
			profileId: "profile-123",
			queryClient,
			selectedHumanProfileId: "profile-123",
			spaceId: "space-a",
		});
		await screen.findByTestId("space-landing");
		conversationsPending = true;

		for (const spaceId of ["space-b", "space-a"]) {
			// biome-ignore lint/suspicious/useAwait: act must be awaited while a conversation suspends.
			await act(async () => {
				view.rerender(buildAppSpaceEntryElement({ queryClient, spaceId }));
			});
			// Returning to A before B commits must not mount A inside the
			// navigation update; it goes through the deferred frame like B.
			expect(
				screen
					.getByTestId("app-space-shell")
					.getAttribute("data-current-space-id")
			).toBe(spaceId);
			expect(screen.queryByTestId("space-landing")).toBeNull();
			expect(screen.getByText("Loading messages…")).toBeTruthy();
		}
	});

	it("commits the shell before a freshly mounted cached Direct Message conversation", async () => {
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
		const pendingConversation = new Promise<never>(() => undefined);
		spaceLandingMock.mockImplementation(({ spaceId }) => (
			<SuspendingSpaceLanding pending={pendingConversation} spaceId={spaceId} />
		));

		// Space to Direct Message replaces the route component, so the
		// conversation mounts fresh rather than switching in place.
		renderAppSpaceEntry({
			navigationSurface: "directMessages",
			profileId: "profile-123",
			queryClient,
			selectedHumanProfileId: "profile-123",
			spaceId: "space-saved-dm",
		});

		const shell = await screen.findByTestId("app-direct-message-shell");
		expect(shell.getAttribute("data-current-space-id")).toBe("space-saved-dm");
		expect(screen.getByText("Loading messages…")).toBeTruthy();
		expect(screen.queryByTestId("space-landing")).toBeNull();
	});

	it("preserves the exact focus target when a non-DM uses the Direct Messages URL", async () => {
		mockBootstrapStatus(
			createSpaceStatus({
				spaceId: "space-regular",
				spacePurpose: "collaboration",
			})
		);
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

	it("routes an unconverted DM-origin Space with three members to its Direct Message", async () => {
		const queryClient = createTestQueryClient();
		mockBootstrapStatus(
			createSpaceStatus({
				spaceId: "space-degraded-dm",
				spacePurpose: OPENMELD_DIRECT_MESSAGE_SPACE_PURPOSE,
				activeMemberCount: 3,
			})
		);
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
			queryClient,
		});

		await waitFor(() =>
			expect(
				queryClient.getQueryData(
					spaceQueryKeys.bootstrap("space-degraded-dm", "profile-123")
				)
			).toBeDefined()
		);
		// Only a recorded conversion makes a DM-origin conversation a Space;
		// the member count does not.
		await waitFor(() => {
			expect(navigateMock).toHaveBeenCalledWith({
				replace: true,
				to: "/o/acme/chats/space-degraded-dm?profileId=profile-123",
			});
		});
		expect(screen.queryByTestId("space-landing")).toBeNull();
	});

	it("keeps a converted two-member DM-origin Space on the Spaces route", async () => {
		const queryClient = createTestQueryClient();
		mockBootstrapStatus(
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
			queryClient,
		});

		await waitFor(() =>
			expect(
				queryClient.getQueryData(
					spaceQueryKeys.bootstrap("space-converted-dm", "profile-123")
				)
			).toBeDefined()
		);
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
		// The draft conversation mounted while access was pending is removed once
		// the resolver rejects it.
		expect(screen.queryByTestId("space-landing")).toBeNull();
	});

	it("keeps an allowed public view in the App with its message target", async () => {
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

		await waitFor(() => expect(spaceLandingMock).toHaveBeenCalled());
		expect(spaceLandingMock).toHaveBeenCalledWith(
			expect.objectContaining({
				initialFocusSignalId: "signal-123",
				initialFocusThreadRootSignalId: "thread-root-123",
			}),
			undefined
		);
		expect(navigateMock).not.toHaveBeenCalled();
	});

	it("replaces a foreign profile with the current Human inside the App", async () => {
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
				params: { orgSlug: "acme", spaceId: "space-123" },
				replace: true,
				search: { profileId: "current-human" },
				to: "/o/$orgSlug/spaces/$spaceId",
			});
		});
		expect(
			screen.queryByRole("heading", {
				name: "Open This Space With Your Profile",
			})
		).toBeNull();
		expect(spaceLandingMock).not.toHaveBeenCalled();
		expect(appSpaceShellMock).toHaveBeenCalled();
	});

	it("opens a created Space with the creation handoff and the route's own inputs", async () => {
		let allowEntry: (value: unknown) => void = () => undefined;
		resolveSpaceEntryMock.mockReturnValue(
			new Promise((resolve) => {
				allowEntry = resolve;
			})
		);
		const lifecycle = { mounts: 0, unmounts: 0 };
		spaceLandingMock.mockImplementation(() => {
			useEffect(() => {
				lifecycle.mounts += 1;
				return () => {
					lifecycle.unmounts += 1;
				};
			}, []);
			return <div data-testid="space-landing" />;
		});
		const onComposerReady = vi.fn();
		const onInitialPendingMessageConsumed = vi.fn();
		const pendingMessage = {
			clientMessageId: "message-1",
			createdAtMs: 1,
			text: "Kickoff notes",
		};

		// The tab that created the Space follows a notification into one of its
		// threads: the regular route supplies the focus targets and Profiles.
		renderAppSpaceEntry({
			focusInteractionId: "interaction-1",
			focusRequestId: "request-1",
			focusSignalId: "signal-2",
			focusThreadRootSignalId: "signal-1",
			handoff: {
				composerDraftMigrationScopes: [
					{
						kind: "space",
						ownerAccountId: "user-123",
						profileId: "profile-123",
						spaceId: "creating-1",
					},
				],
				initialPendingMessage: pendingMessage,
				initialSpaceView: "messages",
				onComposerReady,
				onInitialPendingMessageConsumed,
			},
			profileId: "profile-123",
			selectedHumanProfileId: "profile-123",
			spaceId: "space-123",
		});

		await screen.findByTestId("space-landing");
		expect(spaceLandingMock).toHaveBeenLastCalledWith(
			expect.objectContaining({
				accountProfiles: [
					expect.objectContaining({ openMeldProfileId: "profile-123" }),
				],
				composerDraftMigrationScopes: [
					expect.objectContaining({ spaceId: "creating-1" }),
				],
				initialFocusInteractionId: "interaction-1",
				initialFocusRequestId: "request-1",
				initialFocusSignalId: "signal-2",
				initialFocusThreadRootSignalId: "signal-1",
				initialPendingMessage: pendingMessage,
				initialSpaceView: "messages",
				isPersonalContext: false,
				onComposerReady,
				onInitialPendingMessageConsumed,
				profileId: "profile-123",
				spaceId: "space-123",
			}),
			undefined
		);

		// Access confirmation must keep the staged draft's conversation mounted.
		await act(async () => {
			allowEntry({
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
			await Promise.resolve();
		});
		await waitFor(() => expect(resolveSpaceEntryMock).toHaveBeenCalledTimes(1));
		expect(screen.getByTestId("space-landing")).toBeTruthy();
		expect(lifecycle).toEqual({ mounts: 1, unmounts: 0 });
	});

	it("does not open a created Space as an inactive acting Profile", async () => {
		listStartProfilesMock.mockResolvedValue([
			createProfile({
				openMeldProfileId: "current-human",
				isDefault: true,
			}),
			createProfile({
				openMeldProfileId: "former-human",
				status: "disabled",
			}),
		]);

		renderAppSpaceEntry({
			handoff: { initialSpaceView: "messages" },
			profileId: "former-human",
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
		expect(spaceLandingMock).not.toHaveBeenCalled();
	});
});

function StatefulSpaceLanding(input: {
	onRender: (instance: object) => void;
	spaceId: string;
}) {
	const [instance] = useState(() => ({}));
	const [draft, setDraft] = useState("");
	const [openThreadId, setOpenThreadId] = useState<string | null>(null);
	const [selectedSignalId, setSelectedSignalId] = useState<string | null>(null);
	const [pendingUploadCount, setPendingUploadCount] = useState(0);
	// Record on commit: React can discard a deferred render and rerun the
	// state initializer, which would count an instance that never mounted.
	const { onRender } = input;
	useEffect(() => {
		onRender(instance);
	}, [instance, onRender]);
	return (
		<div data-space-id={input.spaceId} data-testid="space-landing">
			<input
				aria-label="Draft"
				onChange={(event) => setDraft(event.target.value)}
				value={draft}
			/>
			<button
				onClick={() => setOpenThreadId(`thread-${input.spaceId}`)}
				type="button"
			>
				Open Thread
			</button>
			<button
				onClick={() => setSelectedSignalId(`signal-${input.spaceId}`)}
				type="button"
			>
				Select message
			</button>
			<button
				onClick={() => setPendingUploadCount((count) => count + 1)}
				type="button"
			>
				Attach file
			</button>
			<output data-testid="open-thread">{openThreadId ?? ""}</output>
			<output data-testid="selected-signal">{selectedSignalId ?? ""}</output>
			<output data-testid="pending-uploads">{pendingUploadCount}</output>
		</div>
	);
}

function SuspendingSpaceLanding(input: {
	pending: Promise<never> | null;
	spaceId: string;
}) {
	if (input.pending) {
		use(input.pending);
	}
	return <div data-space-id={input.spaceId} data-testid="space-landing" />;
}

function buildAppSpaceEntryElement(input: {
	queryClient: ReturnType<typeof createTestQueryClient>;
	spaceId: string;
}) {
	return (
		<TestQueryClientProvider queryClient={input.queryClient}>
			<StartFlowStateProvider storageScope="user-123">
				<AppSpaceEntryContent
					orgSlug="acme"
					profileId="profile-123"
					spaceId={input.spaceId}
				/>
			</StartFlowStateProvider>
		</TestQueryClientProvider>
	);
}

function renderAppSpaceEntry(input: {
	focusInteractionId?: string;
	focusRequestId?: string;
	handoff?: ComponentProps<typeof AppSpaceEntryContent>["handoff"];
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
					focusRequestId={input.focusRequestId}
					focusSignalId={input.focusSignalId}
					focusThreadRootSignalId={input.focusThreadRootSignalId}
					handoff={input.handoff}
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

function mockBootstrapStatus(status: GetSpaceStatusResponse) {
	const bootstrap: SpaceBootstrapResponse = {
		status,
		members: {
			agents: [],
			humans: [],
			generatedAt: status.generatedAt,
			spaceId: status.spaceId,
			summary: { totalCount: 0, humanCount: 0, agentCount: 0, liveNowCount: 0 },
		},
		history: { signals: [], nextCursor: null },
		threads: { threads: [], previews: [] },
	};
	getBootstrapMock.mockResolvedValue(bootstrap);
}

function createSpaceStatus(input: {
	activeMemberCount?: number;
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
			totalCount: input.activeMemberCount ?? 2,
			humanCount: input.activeMemberCount ?? 2,
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
