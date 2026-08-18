"use client";

import type { OrganizationSpaceDirectoryWithMemberCountsItem } from "@openmeld/schemas/types";
import { Badge } from "@openmeld/ui/components/badge";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import { Input } from "@openmeld/ui/components/input";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { FluidCardGroup, FluidCardItem } from "@openmeld/ui/fluid/card";
import { ChatCircleTextIcon, UsersThreeIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	type ReactNode,
	useDeferredValue,
	useEffect,
	useMemo,
	useState,
} from "react";
import { AppMainContent } from "#/components/app/app-main-content";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { OrganizationScopedErrorState } from "#/components/organizations/organization-scoped-error-state";
import { selectAccountSpaceSidebarSections } from "#/components/spaces/account-space-sidebar-sections";
import {
	AppSpaceShell,
	SpaceWindowShell,
} from "#/components/spaces/app-space-shell";
import { SpaceProfileRequiredState } from "#/components/spaces/space-profile-required-state";
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
import {
	APP_SIDEBAR_DEFAULT_STATES,
	type AppSidebarPersistedStates,
	getAppSidebarStatesForRoute,
} from "#/lib/sidebar-width-cookie";
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
	accountSpaceItemsQueryOptions,
	accountSpaceQueryKeys,
} from "#/query/spaces/account-spaces";

export const Route = createFileRoute("/o/$orgSlug/spaces/")({
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
				message:
					error instanceof Error && error.message
						? error.message
						: "OpenMeld could not join this Space.",
				spaceId: variables.spaceId,
			});
		},
		onMutate: (variables) => {
			setJoinError(null);
			return variables;
		},
		onSuccess: (_result, variables) => {
			setJoinError(null);
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
	const directMessageSpaceIds = useMemo(() => {
		if (!accountSpacesQuery.data) {
			return new Set<string>();
		}

		return new Set(
			selectAccountSpaceSidebarSections({
				currentOrganizationId: currentOrganization.id,
				sections: accountSpacesQuery.data,
			}).directMessageItems.map((item) => item.spaceId)
		);
	}, [accountSpacesQuery.data, currentOrganization.id]);
	const regularOrganizationSpaces = useMemo(
		() =>
			(organizationSpacesQuery.data?.spaces ?? []).filter(
				(space) => !directMessageSpaceIds.has(space.spaceId)
			),
		[directMessageSpaceIds, organizationSpacesQuery.data?.spaces]
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
			browseSpacesActive
			currentProfileId={profileId}
			currentSpaceId=""
			initialOuterSidebarState={
				input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
			initialSidebarState={
				input.initialSidebarStates?.inner ?? APP_SIDEBAR_DEFAULT_STATES.inner
			}
			showSpacesSidebar={showSpacesSidebar}
		>
			<SpaceIndexContentState
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
				orgSlug={input.orgSlug}
				pendingJoinSpaceId={
					joinSpaceMutation.isPending
						? (joinSpaceMutation.variables?.spaceId ?? null)
						: null
				}
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

function AppSpacesIndexEntryShell(input: {
	children: ReactNode;
	initialSidebarStates?: AppSidebarPersistedStates;
}) {
	return (
		<SpaceWindowShell
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
	activeOrganization: OrganizationSummary | null;
	canJoinSpaces: boolean;
	errorMessage: string | null;
	isMembershipError: boolean;
	isPending: boolean;
	isPersonalContext: boolean;
	isRetrying: boolean;
	joinError: SpaceJoinError | null;
	onJoinSpace: (spaceId: string) => void;
	onRetry: () => void;
	pendingJoinSpaceId: string | null;
	orgSlug: string;
	profileId: string;
	selfHealStatus: OrganizationMembershipSelfHealStatus;
	showSavedViewWarning: boolean;
	spaces: readonly OrganizationSpaceDirectoryWithMemberCountsItem[];
};

function SpaceIndexContentState(input: SpaceIndexContentStateInput) {
	const body = resolveSpaceIndexBody(input);

	return <AppMainContent>{body}</AppMainContent>;
}

function resolveSpaceIndexBody(input: SpaceIndexContentStateInput) {
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
		<SpaceIndexDirectoryState
			canJoinSpaces={input.canJoinSpaces}
			isPersonalContext={input.isPersonalContext}
			joinError={input.joinError}
			onJoinSpace={input.onJoinSpace}
			orgSlug={input.orgSlug}
			pendingJoinSpaceId={input.pendingJoinSpaceId}
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

function SpaceIndexDirectoryState(input: {
	canJoinSpaces: boolean;
	isPersonalContext: boolean;
	joinError: SpaceJoinError | null;
	onJoinSpace: (spaceId: string) => void;
	orgSlug: string;
	pendingJoinSpaceId: string | null;
	profileId: string;
	savedViewWarning: {
		isRetrying: boolean;
		onRetry: () => void;
	} | null;
	spaces: readonly OrganizationSpaceDirectoryWithMemberCountsItem[];
}) {
	const [searchQuery, setSearchQuery] = useState("");
	const deferredSearchQuery = useDeferredValue(
		searchQuery.trim().toLowerCase()
	);
	const visibleSpaces = useMemo(
		() =>
			input.spaces.filter((space) => {
				if (!space.joined && space.visibility !== "public") {
					return false;
				}
				return (
					deferredSearchQuery.length === 0 ||
					space.name.toLowerCase().includes(deferredSearchQuery)
				);
			}),
		[deferredSearchQuery, input.spaces]
	);
	const joinedSpaces = visibleSpaces.filter((space) => space.joined);
	const discoverableSpaces = visibleSpaces.filter(
		(space) => !space.joined && space.visibility === "public"
	);
	const hasDirectorySpaces = input.spaces.some(
		(space) => space.joined || space.visibility === "public"
	);

	return (
		<div className="h-full overflow-auto px-6 py-8">
			<section
				aria-labelledby="space-index-title"
				className="mx-auto flex w-full max-w-5xl flex-col gap-6"
			>
				<header className="flex flex-wrap items-start justify-between gap-4">
					<div className="max-w-2xl">
						<p className="font-medium text-muted-foreground text-xs">
							OpenMeld Spaces
						</p>
						<h1
							className="mt-2 font-medium text-2xl text-foreground"
							id="space-index-title"
						>
							Spaces
						</h1>
						<p className="mt-3 text-muted-foreground text-sm leading-6">
							{input.isPersonalContext
								? "Browse your Spaces and open the work you want to continue."
								: "Browse Spaces in this organization. Public Spaces are open to every member; private Spaces require an invitation."}
						</p>
					</div>
					{hasDirectorySpaces ? (
						<Link
							className={buttonVariants({
								size: "sm",
								variant: "outline",
							})}
							to={buildOrganizationNewSpacePath(input.orgSlug)}
						>
							New Space
						</Link>
					) : null}
				</header>

				{input.savedViewWarning ? (
					<output className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border/70 bg-card/35 px-4 py-3">
						<p className="text-muted-foreground text-sm">
							Couldn't refresh Spaces. Showing the last saved view from this
							browser.
						</p>
						<Button
							disabled={input.savedViewWarning.isRetrying}
							onClick={input.savedViewWarning.onRetry}
							size="sm"
							type="button"
							variant="outline"
						>
							Retry
						</Button>
					</output>
				) : null}

				{hasDirectorySpaces ? (
					<>
						<div className="max-w-md">
							<label className="sr-only" htmlFor="space-directory-search">
								Search Spaces
							</label>
							<Input
								id="space-directory-search"
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder="Search Spaces"
								type="search"
								value={searchQuery}
							/>
						</div>
						<SpaceDirectorySection
							canJoinSpaces={input.canJoinSpaces}
							description="Spaces you have already joined."
							emptyMessage={
								deferredSearchQuery
									? "No joined Spaces match your search."
									: "You have not joined any Spaces yet."
							}
							joinError={input.joinError}
							onJoinSpace={input.onJoinSpace}
							orgSlug={input.orgSlug}
							pendingJoinSpaceId={input.pendingJoinSpaceId}
							profileId={input.profileId}
							spaces={joinedSpaces}
							title="Your Spaces"
						/>
						{input.isPersonalContext ? null : (
							<SpaceDirectorySection
								canJoinSpaces={input.canJoinSpaces}
								description="Public Spaces anyone in this organization can join."
								emptyMessage={
									deferredSearchQuery
										? "No public Spaces match your search."
										: "You have joined every public Space."
								}
								joinError={input.joinError}
								onJoinSpace={input.onJoinSpace}
								orgSlug={input.orgSlug}
								pendingJoinSpaceId={input.pendingJoinSpaceId}
								profileId={input.profileId}
								spaces={discoverableSpaces}
								title="Discover"
							/>
						)}
					</>
				) : (
					<SpaceIndexNoSpacesState
						isPersonalContext={input.isPersonalContext}
						orgSlug={input.orgSlug}
					/>
				)}
			</section>
		</div>
	);
}

function SpaceDirectorySection(input: {
	canJoinSpaces: boolean;
	description: string;
	emptyMessage: string;
	joinError: SpaceJoinError | null;
	onJoinSpace: (spaceId: string) => void;
	orgSlug: string;
	pendingJoinSpaceId: string | null;
	profileId: string;
	spaces: readonly OrganizationSpaceDirectoryWithMemberCountsItem[];
	title: string;
}) {
	return (
		<section
			aria-labelledby={`space-directory-${input.title.toLowerCase().replace(" ", "-")}`}
		>
			<div className="mb-3 space-y-1">
				<h2
					className="font-medium text-base text-foreground"
					id={`space-directory-${input.title.toLowerCase().replace(" ", "-")}`}
				>
					{input.title}
				</h2>
				<p className="text-muted-foreground text-xs">{input.description}</p>
			</div>
			{input.spaces.length > 0 ? (
				<FluidCardGroup>
					<ul className="grid gap-3 md:grid-cols-2">
						{input.spaces.map((space) => (
							<li key={space.spaceId}>
								<FluidCardItem itemId={space.spaceId}>
									<OrganizationSpaceDirectoryCard
										canJoin={input.canJoinSpaces}
										joinError={
											input.joinError?.spaceId === space.spaceId
												? input.joinError.message
												: null
										}
										onJoinSpace={input.onJoinSpace}
										orgSlug={input.orgSlug}
										pendingJoin={input.pendingJoinSpaceId === space.spaceId}
										profileId={input.profileId}
										space={space}
									/>
								</FluidCardItem>
							</li>
						))}
					</ul>
				</FluidCardGroup>
			) : (
				<p className="rounded-md border border-border border-dashed px-4 py-5 text-muted-foreground text-xs">
					{input.emptyMessage}
				</p>
			)}
		</section>
	);
}

function SpaceIndexNoSpacesState(input: {
	isPersonalContext: boolean;
	orgSlug: string;
}) {
	return (
		<section
			aria-labelledby="space-index-no-spaces-title"
			className="flex min-h-64 flex-col items-center justify-center rounded-md border border-border border-dashed px-6 py-12 text-center"
		>
			<h2
				className="max-w-sm text-balance font-medium text-foreground text-xl"
				id="space-index-no-spaces-title"
			>
				{input.isPersonalContext ? "No Spaces yet" : "No public Spaces to join"}
			</h2>
			<p className="mt-3 max-w-sm text-pretty text-muted-foreground text-sm leading-6">
				{input.isPersonalContext
					? "Create your first Space to get started."
					: "Private Spaces appear here after someone invites you."}
			</p>
			<Link
				className={buttonVariants({
					className: "mt-5",
					size: "sm",
				})}
				to={buildOrganizationNewSpacePath(input.orgSlug)}
			>
				Create Space
			</Link>
		</section>
	);
}

function OrganizationSpaceDirectoryCard(input: {
	canJoin: boolean;
	joinError: string | null;
	onJoinSpace: (spaceId: string) => void;
	orgSlug: string;
	pendingJoin: boolean;
	profileId: string;
	space: OrganizationSpaceDirectoryWithMemberCountsItem;
}) {
	const memberLabel =
		typeof input.space.activeMemberCount === "number"
			? `${String(input.space.activeMemberCount)} ${input.space.activeMemberCount === 1 ? "member" : "members"}`
			: "Member count unavailable";
	const action = input.space.joined ? (
		<Link
			aria-label={`Open ${input.space.name}`}
			className={buttonVariants({ size: "sm" })}
			to={buildOrganizationSpacePath({
				orgSlug: input.orgSlug,
				search: { profileId: input.profileId },
				spaceId: input.space.spaceId,
			})}
		>
			Open
		</Link>
	) : (
		<Button
			aria-label={`Join ${input.space.name}`}
			disabled={input.pendingJoin || !input.canJoin}
			onClick={() => {
				input.onJoinSpace(input.space.spaceId);
			}}
			size="sm"
			type="button"
		>
			{input.pendingJoin ? "Joining..." : "Join"}
		</Button>
	);

	return (
		<Card
			className="h-full min-h-48 bg-transparent"
			data-testid={`organization-space-card-${input.space.spaceId}`}
			size="sm"
		>
			<CardHeader>
				<CardTitle className="flex min-w-0 items-center gap-2">
					<ChatCircleTextIcon
						aria-hidden="true"
						className="size-5 shrink-0 text-muted-foreground"
					/>
					<h3 className="truncate">{input.space.name}</h3>
				</CardTitle>
				<CardAction>
					<Badge variant="outline">
						{input.space.visibility === "public" ? "Public" : "Private"}
					</Badge>
				</CardAction>
			</CardHeader>
			<CardContent className="flex flex-1 flex-col justify-center gap-4 py-2">
				<p className="max-w-md text-muted-foreground text-sm leading-6">
					{input.space.joined
						? "Open this Space to continue where you left off."
						: "Join this public Space to see its conversation and collaborate."}
				</p>
				<p className="flex items-center gap-2 text-muted-foreground text-xs">
					<UsersThreeIcon aria-hidden="true" className="size-4 shrink-0" />
					{memberLabel}
				</p>
			</CardContent>
			{input.joinError ? (
				<p className="px-3 text-destructive text-xs" role="alert">
					{input.joinError}
				</p>
			) : null}
			<CardFooter className="mt-auto justify-end">{action}</CardFooter>
		</Card>
	);
}

function SpaceIndexLoadingState() {
	return (
		<div className="h-full overflow-hidden px-6 py-8">
			<section
				aria-busy="true"
				aria-label="Loading Spaces"
				className="mx-auto flex w-full max-w-5xl flex-col gap-6"
			>
				<output aria-label="Loading Spaces" className="sr-only">
					Loading Spaces
				</output>
				<header className="flex items-start justify-between gap-4">
					<div className="flex w-full max-w-2xl flex-col gap-3">
						<Skeleton className="h-3 w-28" />
						<Skeleton className="h-8 w-36" />
						<Skeleton className="h-4 w-full max-w-xl" />
						<Skeleton className="h-4 w-4/5 max-w-lg" />
					</div>
					<Skeleton className="h-8 w-24 shrink-0" />
				</header>
				<ul aria-hidden="true" className="grid gap-3 md:grid-cols-2">
					{[
						"space-loading-card-1",
						"space-loading-card-2",
						"space-loading-card-3",
						"space-loading-card-4",
					].map((key) => (
						<li key={key}>
							<Card className="min-h-48" size="sm">
								<CardHeader>
									<CardTitle className="flex items-center gap-3">
										<Skeleton className="size-10" />
										<Skeleton className="h-4 w-32" />
									</CardTitle>
									<CardAction>
										<Skeleton className="h-5 w-16" />
									</CardAction>
								</CardHeader>
								<CardContent className="flex flex-1 flex-col justify-center gap-4 py-2">
									<Skeleton className="h-4 w-4/5" />
									<Skeleton className="h-3 w-24" />
								</CardContent>
								<CardFooter className="mt-auto justify-end">
									<Skeleton className="h-7 w-16" />
								</CardFooter>
							</Card>
						</li>
					))}
				</ul>
			</section>
		</div>
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
