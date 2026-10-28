"use client";

import { toStructuredApiClientFailure } from "@openmeld/api-client";
import type {
	AuthProfileView,
	OrganizationSpaceDirectoryWithMemberCountsItem,
} from "@openmeld/schemas/types";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { cn } from "@openmeld/ui/lib/utils";
import { ChatCircleTextIcon, PlusIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQueryState } from "nuqs";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { AppMainContent } from "#/components/app/app-main-content";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { OrganizationScopedErrorState } from "#/components/organizations/organization-scoped-error-state";
import {
	type SpaceUnreadById,
	selectAccountSpaceSections,
} from "#/components/spaces/account-space-sections";
import {
	AppSpaceShell,
	SpaceWindowShell,
} from "#/components/spaces/app-space-shell";
import { ChatsDirectory } from "#/components/spaces/chats-directory";
import { ConversationsHome } from "#/components/spaces/conversations-home";
import { SpaceDirectory } from "#/components/spaces/space-directory";
import { SpaceWindowHeader } from "#/components/spaces/space-header";
import { SpacePendingInvitations } from "#/components/spaces/space-pending-invitations";
import { SpaceProfileRequiredState } from "#/components/spaces/space-profile-required-state";
import { SpacesDirectoryNavigation } from "#/components/spaces/spaces-directory-navigation";
import { useAccountSpaceIndicators } from "#/components/spaces/use-account-space-indicators";
import { useAccountSpacePinMutation } from "#/components/spaces/use-account-space-pin-mutation";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import { prefetchSpacesRouteData } from "#/lib/organizations/app-route-prefetch";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationNewSpacePath,
	buildOrganizationSpacePath,
} from "#/lib/organizations/organization-routes";
import {
	joinOrganizationSpace,
	type OrganizationSpacesFailure,
} from "#/lib/organizations/organization-spaces";
import type { OrganizationSummary } from "#/lib/organizations/organization-types";
import { spacesViewParser } from "#/lib/page-tab-search";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	type AppSidebarPersistedStates,
	getAppSidebarStatesForRoute,
} from "#/lib/sidebar-width-cookie";
import type {
	AccountSpaceItem,
	AccountSpaceSections,
} from "#/lib/spaces/account-spaces";
import { resolveAppSpacesProfileId } from "#/lib/spaces/app-spaces-profile";
import {
	organizationQueryKeys,
	organizationSpacesQueryOptions,
} from "#/query/organizations/organization-directory";
import {
	isOrganizationMembershipRequiredFailure,
	type OrganizationMembershipSelfHealStatus,
	useOrganizationMembershipSelfHeal,
} from "#/query/organizations/organization-membership-self-heal";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import {
	acceptOrganizationSpaceMembership,
	accountSpaceItemsQueryOptions,
	accountSpaceQueryKeys,
} from "#/query/spaces/account-spaces";

export const Route = createFileRoute("/o/$orgSlug/spaces/")({
	validateSearch: (
		search: Record<string, unknown>
	): { view?: "conversations" | "spaces" | "discover" | "messages" } => ({
		view:
			typeof search.view === "string"
				? (spacesViewParser.parse(search.view) ?? undefined)
				: undefined,
	}),
	staticData: appShellStaticData.space,
	pendingComponent: AppSpacesIndexPendingRoute,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	// SSR-read persisted rail/sidebar geometry so the shell renders at the
	// remembered sizes with no first-paint flash.
	loader: async ({ context, location, params }) => {
		prefetchSpacesRouteData({
			organizationSlug: params.orgSlug,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
		}).catch((error: unknown) => {
			console.error("Failed to prefetch the Spaces route data.", error);
		});
		return { sidebarStates: await getAppSidebarStatesForRoute("spaces") };
	},
	component: AppSpacesIndexRoute,
});

function AppSpacesIndexPendingRoute() {
	return (
		<AppSpacesIndexEntryShell>
			<SpaceIndexLoadingState />
		</AppSpacesIndexEntryShell>
	);
}

function AppSpacesIndexRoute() {
	const { orgSlug } = Route.useParams();
	const { sidebarStates } = Route.useLoaderData();
	return (
		<AppSpacesIndexContent
			initialSidebarStates={sidebarStates}
			orgSlug={orgSlug}
		/>
	);
}

export function AppSpacesIndexContent(input: {
	initialSidebarStates?: AppSidebarPersistedStates;
	orgSlug: string;
}) {
	const [view] = useQueryState("view", spacesViewParser);
	return view === "conversations" ? (
		<ConversationsHome initialSidebarStates={input.initialSidebarStates} />
	) : (
		<AppSpacesDirectoryContent {...input} />
	);
}

function AppSpacesDirectoryContent(input: {
	initialSidebarStates?: AppSidebarPersistedStates;
	orgSlug: string;
}) {
	// Keep the shell mounted and read the same immediate URL state as its tabs.
	const [view] = useQueryState("view", spacesViewParser);
	const queryClient = useQueryClient();
	const navigate = useNavigate();
	const { activeOrganization, currentOrganization } = useAppOrganization();
	const { state, storageScope } = useStartFlowState();
	const [joinError, setJoinError] = useState<SpaceJoinError | null>(null);
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope,
		})
	);
	const profileId = resolveAppSpacesProfileId({
		profiles: profilesQuery.data ?? [],
		selectedHumanProfileId: state.selectedHumanProfileId,
	});
	const accountSpacesQuery = useQuery(
		accountSpaceItemsQueryOptions({
			enabled: Boolean(profileId),
			profileId: profileId ?? "",
		})
	);
	const { unreadBySpaceId } = useAccountSpaceIndicators({
		enabled: Boolean(profileId),
		organizationId: currentOrganization.id,
		profileId: profileId ?? "",
	});
	const pinMutation = useAccountSpacePinMutation({
		currentProfileId: profileId ?? "",
	});
	const organizationSpacesQuery = useQuery(
		organizationSpacesQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);
	// Close the activation loop: if the session's active organization drifted
	// out of sync with this membership, repair it once instead of stranding the
	// user on a dead-end error card.
	const spacesSelfHeal = useOrganizationMembershipSelfHeal({
		currentOrganization,
		query: organizationSpacesQuery,
	});
	useClearInaccessibleOrganizationPersistence({
		organizationId: currentOrganization.id,
		ownerAccountId: storageScope,
		selfHealStatus: spacesSelfHeal.status,
	});
	const joinSpaceMutation = useMutation({
		mutationFn: async (input: { spaceId: string }) =>
			await joinOrganizationSpace({
				organizationId: currentOrganization.id,
				spaceId: input.spaceId,
			}),
		onError: (error, variables) => {
			setJoinError({
				message: toStructuredApiClientFailure(error).message,
				spaceId: variables.spaceId,
			});
		},
		onMutate: (variables) => {
			setJoinError(null);
			return variables;
		},
		onSuccess: (result, variables) => {
			setJoinError(null);
			if (profileId) {
				acceptOrganizationSpaceMembership(queryClient, {
					organizationId: currentOrganization.id,
					spaceId: variables.spaceId,
					profileId,
					response: result,
				});
			}
			Promise.all([
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.spaces(currentOrganization.id),
				}),
				queryClient.invalidateQueries({
					queryKey: accountSpaceQueryKeys.all,
				}),
			]).catch((error: unknown) => {
				console.error("Failed to refresh Spaces after joining.", error);
			});

			if (!profileId) {
				console.error("Joined a Space without an active human profile.", {
					spaceId: variables.spaceId,
				});
				return;
			}

			navigate({
				to: buildOrganizationSpacePath({
					orgSlug: input.orgSlug,
					search: { profileId },
					spaceId: variables.spaceId,
				}),
			}).catch((error: unknown) => {
				console.error("Failed to open the joined Space.", error);
			});
		},
	});
	const accountState = useMemo(
		() =>
			selectSpaceIndexAccountState({
				currentOrganizationId: currentOrganization.id,
				sections: accountSpacesQuery.data,
				unreadBySpaceId,
			}),
		[accountSpacesQuery.data, currentOrganization.id, unreadBySpaceId]
	);
	const regularOrganizationSpaces = useMemo(
		() =>
			(organizationSpacesQuery.data?.spaces ?? []).filter(
				(space) => !accountState.directMessageSpaceIds.has(space.spaceId)
			),
		[accountState.directMessageSpaceIds, organizationSpacesQuery.data?.spaces]
	);

	if (profilesQuery.isPending) {
		return (
			<AppSpacesIndexEntryShell
				initialSidebarStates={input.initialSidebarStates}
			>
				<SpaceIndexLoadingState />
			</AppSpacesIndexEntryShell>
		);
	}

	if (profilesQuery.isError && profilesQuery.data === undefined) {
		return (
			<AppSpacesIndexEntryShell
				initialSidebarStates={input.initialSidebarStates}
			>
				<SpaceProfilesLoadErrorState
					errorMessage={profilesQuery.error.message}
					isRetrying={profilesQuery.isRefetching}
					onRetry={() => {
						profilesQuery.refetch().catch((error) => {
							console.error("Failed to refresh human profiles.", error);
						});
					}}
				/>
			</AppSpacesIndexEntryShell>
		);
	}

	if (!profileId) {
		return (
			<AppSpacesIndexEntryShell
				initialSidebarStates={input.initialSidebarStates}
			>
				<SpaceProfileRequiredState recommendedHumanProfile={null} />
			</AppSpacesIndexEntryShell>
		);
	}

	const savedViewState = resolveSpaceIndexSavedViewState({
		organizationError: organizationSpacesQuery.isError,
		organizationFailure: organizationSpacesQuery.error,
		organizationIsFetching: organizationSpacesQuery.isFetching,
		organizationIsPaused: organizationSpacesQuery.isPaused,
		profilesError: profilesQuery.isError,
		profilesHaveData: profilesQuery.data !== undefined,
		profilesIsFetching: profilesQuery.isFetching,
		profilesIsPaused: profilesQuery.isPaused,
		spacesHaveData: organizationSpacesQuery.data !== undefined,
	});
	const accountSpacesHaveData = accountSpacesQuery.data !== undefined;
	const accountSpacesBlockingError =
		accountSpacesQuery.isError && !accountSpacesHaveData;
	const errorMessage = resolveSpaceIndexErrorMessage({
		accountSpacesBlockingError,
		accountSpacesError: accountSpacesQuery.error,
		organizationError: organizationSpacesQuery.isError,
		organizationFailure: organizationSpacesQuery.error,
		savedViewState,
	});
	const showSpacesSidebar = savedViewState.hasSavedSpaces;

	return (
		<AppSpaceShell
			browseSpacesActive={view !== "messages"}
			currentProfileId={profileId}
			currentSpaceId=""
			initialOuterSidebarState={
				input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
			initialSidebarState={
				input.initialSidebarStates?.inner ?? APP_SIDEBAR_DEFAULT_STATES.inner
			}
			showSpacesSidebar={view === "messages" || showSpacesSidebar}
		>
			<SpaceIndexContentState
				accountProfiles={profilesQuery.data ?? []}
				accountSpaceItemsById={accountState.accountSpaceItemsById}
				activeOrganization={activeOrganization}
				canJoinSpaces={savedViewState.canJoinSpaces}
				errorMessage={errorMessage}
				isMembershipError={savedViewState.isMembershipError}
				isPending={
					organizationSpacesQuery.isPending ||
					(!accountSpacesHaveData &&
						accountSpacesQuery.isPending &&
						!accountSpacesQuery.isPaused)
				}
				isPersonalContext={currentOrganization.isPersonal === true}
				isRetrying={
					organizationSpacesQuery.isRefetching ||
					profilesQuery.isRefetching ||
					accountSpacesQuery.isRefetching
				}
				joinError={joinError}
				onJoinSpace={(spaceId) => {
					joinSpaceMutation.mutate({ spaceId });
				}}
				onRetry={() => {
					Promise.all([
						profilesQuery.refetch(),
						organizationSpacesQuery.refetch(),
						accountSpacesQuery.refetch(),
					]).catch((error) => {
						console.error("Failed to refresh Spaces.", error);
					});
				}}
				onTogglePinned={pinMutation.toggle}
				orgSlug={input.orgSlug}
				pendingJoinSpaceId={
					joinSpaceMutation.isPending
						? (joinSpaceMutation.variables?.spaceId ?? null)
						: null
				}
				pinActionsPending={pinMutation.arePinActionsPending}
				profileId={profileId}
				selfHealStatus={spacesSelfHeal.status}
				showSavedViewWarning={
					savedViewState.showSavedViewWarning ||
					(accountSpacesQuery.isError && accountSpacesHaveData)
				}
				spaces={regularOrganizationSpaces}
			/>
		</AppSpaceShell>
	);
}

function useClearInaccessibleOrganizationPersistence(input: {
	organizationId: string;
	ownerAccountId: string;
	selfHealStatus: OrganizationMembershipSelfHealStatus;
}) {
	useEffect(() => {
		if (input.selfHealStatus !== "access-denied") {
			return;
		}
		resolveAppQueryPersistenceController()
			.clearOrganization(input.ownerAccountId, input.organizationId)
			.catch((error: unknown) => {
				console.error(
					"Failed to clear inaccessible organization browser data.",
					error
				);
			});
	}, [input.organizationId, input.ownerAccountId, input.selfHealStatus]);
}

function resolveSpaceIndexSavedViewState(input: {
	organizationError: boolean;
	organizationFailure: OrganizationSpacesFailure | null;
	organizationIsFetching: boolean;
	organizationIsPaused: boolean;
	profilesError: boolean;
	profilesHaveData: boolean;
	profilesIsFetching: boolean;
	profilesIsPaused: boolean;
	spacesHaveData: boolean;
}) {
	const isMembershipError =
		input.organizationError &&
		isOrganizationMembershipRequiredFailure(input.organizationFailure);
	return {
		canJoinSpaces: !(
			input.organizationIsFetching ||
			input.organizationIsPaused ||
			input.organizationError ||
			input.profilesIsFetching ||
			input.profilesIsPaused ||
			input.profilesError
		),
		hasSavedSpaces: input.spacesHaveData && !isMembershipError,
		isMembershipError,
		showSavedViewWarning:
			(input.profilesError && input.profilesHaveData) ||
			(input.organizationError && input.spacesHaveData && !isMembershipError),
	};
}

function resolveSpaceIndexErrorMessage(input: {
	accountSpacesBlockingError: boolean;
	accountSpacesError: Error | null;
	organizationError: boolean;
	organizationFailure: OrganizationSpacesFailure | null;
	savedViewState: ReturnType<typeof resolveSpaceIndexSavedViewState>;
}): string | null {
	if (
		input.organizationError &&
		(!input.savedViewState.hasSavedSpaces ||
			input.savedViewState.isMembershipError)
	) {
		return (
			input.organizationFailure?.message ?? "OpenMeld could not load Spaces."
		);
	}
	if (input.accountSpacesBlockingError) {
		return (
			input.accountSpacesError?.message ??
			"OpenMeld could not separate Direct Messages from Spaces."
		);
	}
	return null;
}

function selectSpaceIndexAccountState(input: {
	currentOrganizationId: string;
	sections: AccountSpaceSections | undefined;
	unreadBySpaceId: SpaceUnreadById;
}) {
	if (!input.sections) {
		return {
			accountSpaceItemsById: new Map<string, AccountSpaceItem>(),
			directMessageSpaceIds: new Set<string>(),
		};
	}

	const sections = selectAccountSpaceSections({
		currentOrganizationId: input.currentOrganizationId,
		sections: input.sections,
		unreadBySpaceId: input.unreadBySpaceId,
	});
	const accountSpaceItems = [...sections.pinnedItems, ...sections.spaceItems];

	return {
		accountSpaceItemsById: new Map(
			accountSpaceItems.map((item) => [item.spaceId, item])
		),
		directMessageSpaceIds: new Set(
			sections.directMessageItems.map((item) => item.spaceId)
		),
	};
}

function AppSpacesIndexEntryShell(input: {
	children: ReactNode;
	initialSidebarStates?: AppSidebarPersistedStates;
}) {
	return (
		<SpaceWindowShell
			defaultModuleSidebarOpen={false}
			initialOuterSidebarState={
				input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
			initialSidebarState={
				input.initialSidebarStates?.inner ?? APP_SIDEBAR_DEFAULT_STATES.inner
			}
			sidebarPreferenceKey="spaces"
		>
			<AppMainContent>{input.children}</AppMainContent>
		</SpaceWindowShell>
	);
}

type SpaceIndexContentStateInput = {
	accountProfiles: readonly AuthProfileView[];
	accountSpaceItemsById: ReadonlyMap<string, AccountSpaceItem>;
	activeOrganization: OrganizationSummary | null;
	canJoinSpaces: boolean;
	errorMessage: string | null;
	isMembershipError: boolean;
	isPending: boolean;
	isPersonalContext: boolean;
	isRetrying: boolean;
	joinError: SpaceJoinError | null;
	onJoinSpace: (spaceId: string) => void;
	onTogglePinned: (item: AccountSpaceItem) => void;
	onRetry: () => void;
	pendingJoinSpaceId: string | null;
	pinActionsPending: boolean;
	orgSlug: string;
	profileId: string;
	selfHealStatus: OrganizationMembershipSelfHealStatus;
	showSavedViewWarning: boolean;
	spaces: readonly OrganizationSpaceDirectoryWithMemberCountsItem[];
};

function SpaceIndexContentState(input: SpaceIndexContentStateInput) {
	const [view] = useQueryState("view", spacesViewParser);
	if (view === "messages") {
		return <ChatsDirectory />;
	}
	const tab = view === "discover" && !input.isPersonalContext ? 1 : 0;
	const body = resolveSpaceIndexBody(input, tab);

	return (
		<AppMainContent
			header={
				<SpaceWindowHeader
					actions={
						<Link
							className={cn(buttonVariants({ size: "sm" }), "max-lg:min-h-8")}
							to={buildOrganizationNewSpacePath(input.orgSlug)}
						>
							<PlusIcon />
							New Space
						</Link>
					}
					leadingControl={
						<ChatCircleTextIcon className="size-4 text-muted-foreground" />
					}
					navigation={<SpacesDirectoryNavigation />}
					renderFrame={false}
					title="Spaces"
				/>
			}
		>
			{tab === 1 ? <SpacePendingInvitations /> : null}
			{body}
		</AppMainContent>
	);
}

function resolveSpaceIndexBody(
	input: SpaceIndexContentStateInput,
	tab: number
) {
	// While a one-shot activation repair is in flight (or the mismatch was just
	// detected and the repair is about to run), show loading rather than the
	// raw membership error that is being resolved.
	if (
		input.selfHealStatus === "healing" ||
		input.selfHealStatus === "recovering" ||
		(input.isMembershipError && input.selfHealStatus === "inactive")
	) {
		return <SpaceIndexLoadingState />;
	}

	// The repair confirmed this account is not a member of the URL organization:
	// route to the shared access-denied experience.
	if (input.selfHealStatus === "access-denied") {
		return (
			<SpaceIndexTerminalErrorState>
				<OrganizationScopedErrorState
					activeOrganization={input.activeOrganization}
					currentOrganizationSlug={input.orgSlug}
					description="This organization is not available from your OpenMeld account. Switch back to an organization you belong to."
					title="Organization access unavailable"
				/>
			</SpaceIndexTerminalErrorState>
		);
	}

	// A membership mismatch that could not be repaired automatically. If Auth
	// still recognizes the URL organization but Core rejects it, do not link
	// back to the same URL; keep the user on a soft, retryable recovery state.
	if (input.isMembershipError || input.selfHealStatus === "failed") {
		return (
			<SpaceIndexTerminalErrorState>
				<OrganizationScopedErrorState
					activeOrganization={input.activeOrganization}
					currentOrganizationSlug={input.orgSlug}
					description="OpenMeld could not confirm your access right now. Try again in a moment."
					isRetrying={input.isRetrying}
					onRetry={input.onRetry}
					title="OpenMeld could not load your Spaces."
				/>
			</SpaceIndexTerminalErrorState>
		);
	}

	if (input.isPending) {
		return <SpaceIndexLoadingState />;
	}

	// Any other failure is genuinely transient: keep Retry.
	if (input.errorMessage) {
		return (
			<SpaceIndexSpacesLoadErrorState
				errorMessage={input.errorMessage}
				isRetrying={input.isRetrying}
				onRetry={input.onRetry}
			/>
		);
	}

	return (
		<SpaceDirectory
			accountProfiles={input.accountProfiles}
			accountSpaceItemsById={input.accountSpaceItemsById}
			canJoinSpaces={input.canJoinSpaces}
			joinError={input.joinError}
			onJoinSpace={input.onJoinSpace}
			onTogglePinned={input.onTogglePinned}
			orgSlug={input.orgSlug}
			pendingJoinSpaceId={input.pendingJoinSpaceId}
			pinActionsPending={input.pinActionsPending}
			profileId={input.profileId}
			savedViewWarning={
				input.showSavedViewWarning
					? {
							isRetrying: input.isRetrying,
							onRetry: input.onRetry,
						}
					: null
			}
			spaces={input.spaces}
			tab={tab}
		/>
	);
}

function SpaceIndexTerminalErrorState(input: { children: ReactNode }) {
	return (
		<div className="flex h-full items-center justify-center px-6 py-10">
			{input.children}
		</div>
	);
}

type SpaceJoinError = {
	message: string;
	spaceId: string;
};

function SpaceIndexLoadingState() {
	return (
		<section
			aria-busy="true"
			aria-label="Loading Spaces"
			className="space-y-5 px-6 py-6 lg:px-8"
		>
			<output aria-label="Loading Spaces" className="sr-only">
				Loading Spaces
			</output>
			<Skeleton className="h-4 w-24" />
			{[0, 1, 2, 3, 4, 5].map((index) => (
				<Skeleton className="h-16 w-full" key={index} />
			))}
		</section>
	);
}

function SpaceIndexSpacesLoadErrorState(input: {
	errorMessage: string;
	isRetrying: boolean;
	onRetry: () => void;
}) {
	return (
		<div className="flex h-full items-center justify-center px-6 py-10">
			<SpaceProfilesLoadErrorState {...input} />
		</div>
	);
}

function SpaceProfilesLoadErrorState(input: {
	errorMessage: string;
	isRetrying: boolean;
	onRetry: () => void;
}) {
	return (
		<section className="max-w-sm space-y-4">
			<div className="space-y-2">
				<p className="font-medium text-foreground text-sm">
					OpenMeld could not load your Spaces.
				</p>
				<p className="text-muted-foreground text-sm">{input.errorMessage}</p>
			</div>
			<Button
				disabled={input.isRetrying}
				onClick={input.onRetry}
				size="sm"
				type="button"
				variant="outline"
			>
				Retry
			</Button>
		</section>
	);
}
