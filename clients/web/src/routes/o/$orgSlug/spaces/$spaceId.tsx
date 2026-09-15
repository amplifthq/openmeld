import { isDirectMessageSpace } from "@openmeld/space";
import { Bars } from "@openmeld/ui/components/bars";
import { Button } from "@openmeld/ui/components/button";
import { Card, CardContent, CardHeader } from "@openmeld/ui/components/card";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import {
	type ComponentProps,
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
} from "react";
import { z } from "zod/v4";
import { AppMainContent } from "#/components/app/app-main-content";
import { appShellStaticData } from "#/components/app/shell-layout";
import { useStartFlowState } from "#/components/app/start-flow-state";
import {
	AppDirectMessageShell,
	AppSpaceShell,
	SpaceWindowShell,
} from "#/components/spaces/app-space-shell";
import { SpaceEntryGate } from "#/components/spaces/space-entry-gate";
import { SpaceLanding } from "#/components/spaces/space-landing";
import { SpaceProfileRequiredState } from "#/components/spaces/space-profile-required-state";
import { SpaceLandingLoadingShell } from "#/components/spaces/space-state-surfaces";
import {
	APP_ROUTE_PENDING_DELAY_MS,
	APP_ROUTE_PENDING_MIN_DURATION_MS,
} from "#/lib/app-route-loading";
import {
	observeSpaceOpen,
	readSpacePrefetch,
	recordSpacePrefetch,
} from "#/lib/observability/space-open";
import {
	prefetchSpaceConversationRouteData,
	restoreSpaceConversationRouteData,
} from "#/lib/organizations/app-route-prefetch";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationDirectMessagePath,
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { findActiveProfileById } from "#/lib/profiles/profiles";
import {
	APP_SIDEBAR_DEFAULT_STATES,
	type AppSidebarPersistedStates,
	getAppSidebarStatesForRoute,
} from "#/lib/sidebar-width-cookie";
import { clearSpaceConversationPositions } from "#/lib/space-conversation-position";
import { resolveAppSpacesProfile } from "#/lib/spaces/app-spaces-profile";
import {
	readLastUsedHumanProfileId,
	writeLastUsedHumanProfileId,
} from "#/lib/spaces/last-used-profile";
import { centerAgentDirectMessageSpaceProjectionQueryOptions } from "#/query/organizations/center-agent";
import { resolveAppQueryPersistenceController } from "#/query/persistence/app-query-persistence";
import { buildStartProfilesQueryOptions } from "#/query/profiles/profiles";
import { isQueryCancellationError } from "#/query/query-cancellation";
import { spaceBootstrapQueryOptions } from "#/query/spaces/bootstrap";
import { spaceConversationDisplaySnapshotQueryOptions } from "#/query/spaces/display-snapshot";
import { spaceHistoryQueryOptions } from "#/query/spaces/history";
import { spaceStatusQueryOptions } from "#/query/spaces/status";

const appSpaceRouteSearchSchema = z.object({
	focusInteractionId: z.string().trim().min(1).optional(),
	focusSignalId: z.string().trim().min(1).optional(),
	focusThreadRootSignalId: z.string().trim().min(1).optional(),
	profileId: z.string().trim().min(1).optional(),
});

type AppSpaceFocusSearch = Pick<
	z.infer<typeof appSpaceRouteSearchSchema>,
	"focusInteractionId" | "focusSignalId" | "focusThreadRootSignalId"
>;

export type AppSpaceNavigationSurface = "directMessages" | "spaces";

export const Route = createFileRoute("/o/$orgSlug/spaces/$spaceId")({
	staticData: appShellStaticData.space,
	validateSearch: (search) => {
		const parsed = appSpaceRouteSearchSchema.safeParse(search);
		return parsed.success ? parsed.data : {};
	},
	loaderDeps: ({ search }) => ({ profileId: search.profileId }),
	pendingComponent: AppSpaceConversationPendingRoute,
	pendingMinMs: APP_ROUTE_PENDING_MIN_DURATION_MS,
	pendingMs: APP_ROUTE_PENDING_DELAY_MS,
	// SSR-read persisted rail/sidebar geometry so the shell renders at the
	// remembered sizes with no first-paint flash.
	loader: async ({ context, deps, location, params, preload }) => {
		const sidebarStates = getAppSidebarStatesForRoute("spaces");
		const prefetchKey = JSON.stringify([
			params.orgSlug,
			params.spaceId,
			deps.profileId,
		]);
		if (preload) {
			recordSpacePrefetch(prefetchKey, "in_flight");
		} else {
			observeSpaceOpen(params.spaceId, {
				prefetch: readSpacePrefetch(prefetchKey),
			});
		}
		await restoreSpaceConversationRouteData({
			organizationSlug: params.orgSlug,
			profileId: deps.profileId,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
			spaceId: params.spaceId,
		});
		prefetchSpaceConversationRouteData({
			organizationSlug: params.orgSlug,
			profileId: deps.profileId,
			queryClient: context.queryClient,
			queryPersistence: context.queryPersistence,
			routeFamily: location.href,
			spaceId: params.spaceId,
		})
			.then(() => {
				if (preload) {
					recordSpacePrefetch(prefetchKey, "complete");
				}
			})
			.catch((error: unknown) => {
				if (isQueryCancellationError(error)) {
					return;
				}
				console.error("Failed to prefetch the Space conversation data.", error);
			});
		return { sidebarStates: await sidebarStates };
	},
	component: AppSpaceEntryRoute,
});

function AppSpaceConversationPendingRoute() {
	return (
		<SpaceWindowShell
			initialOuterSidebarState={APP_SIDEBAR_DEFAULT_STATES.outer}
			initialSidebarState={APP_SIDEBAR_DEFAULT_STATES.inner}
			sidebarPreferenceKey="spaces"
		>
			<AppMainContent bodyClassName="flex" header={null}>
				<SpaceLandingLoadingShell />
			</AppMainContent>
		</SpaceWindowShell>
	);
}

export function AppSpaceEntryRoute() {
	const { orgSlug, spaceId } = Route.useParams();
	const search = Route.useSearch();
	const { sidebarStates } = Route.useLoaderData();

	return (
		<AppSpaceEntryContent
			focusInteractionId={search.focusInteractionId}
			focusSignalId={search.focusSignalId}
			focusThreadRootSignalId={search.focusThreadRootSignalId}
			initialSidebarStates={sidebarStates}
			orgSlug={orgSlug}
			profileId={search.profileId}
			spaceId={spaceId}
		/>
	);
}

export function AppSpaceEntryContent(
	input: {
		spaceId: string;
		orgSlug: string;
		profileId?: string;
		initialSidebarStates?: AppSidebarPersistedStates;
		navigationSurface?: AppSpaceNavigationSurface;
	} & AppSpaceFocusSearch
) {
	const navigationSurface = input.navigationSurface ?? "spaces";
	if (!input.profileId) {
		return (
			<MissingAppSpaceProfileContent
				focusInteractionId={input.focusInteractionId}
				focusSignalId={input.focusSignalId}
				focusThreadRootSignalId={input.focusThreadRootSignalId}
				initialSidebarStates={input.initialSidebarStates}
				navigationSurface={navigationSurface}
				orgSlug={input.orgSlug}
				spaceId={input.spaceId}
			/>
		);
	}

	return (
		<ValidatedAppSpaceEntryContent
			{...input}
			navigationSurface={navigationSurface}
			profileId={input.profileId}
		/>
	);
}

function MissingAppSpaceProfileContent(
	input: {
		spaceId: string;
		orgSlug: string;
		initialSidebarStates?: AppSidebarPersistedStates;
		navigationSurface: AppSpaceNavigationSurface;
	} & AppSpaceFocusSearch
) {
	const navigate = useNavigate();
	const { hasRestored, state, storageScope } = useStartFlowState();
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope,
		})
	);
	const profilesHaveData = profilesQuery.data !== undefined;

	// Resolve the human profile to open this Space with from memory:
	// last-used (durable localStorage) → in-session selection → default human.
	// When one resolves we redirect to the canonical ?profileId URL instead of
	// stopping the user with a chooser; the chooser only renders on genuine
	// ambiguity (multiple human profiles, none default, no remembered choice).
	const isProfilesReady =
		hasRestored &&
		(profilesHaveData || !(profilesQuery.isPending || profilesQuery.isError));
	const recommendedHumanProfile = useMemo(() => {
		if (!isProfilesReady) {
			return null;
		}
		const rememberedHumanProfileId =
			readLastUsedHumanProfileId(storageScope) ?? state.selectedHumanProfileId;
		return resolveAppSpacesProfile({
			profiles: profilesQuery.data ?? [],
			selectedHumanProfileId: rememberedHumanProfileId,
		});
	}, [
		isProfilesReady,
		profilesQuery.data,
		state.selectedHumanProfileId,
		storageScope,
	]);
	const recommendedProfileId =
		recommendedHumanProfile?.openMeldProfileId ?? null;

	useEffect(() => {
		if (!recommendedProfileId) {
			return;
		}
		navigate({
			params: { orgSlug: input.orgSlug, spaceId: input.spaceId },
			replace: true,
			search: buildAppSpaceRouteSearch({
				focusInteractionId: input.focusInteractionId,
				focusSignalId: input.focusSignalId,
				focusThreadRootSignalId: input.focusThreadRootSignalId,
				profileId: recommendedProfileId,
			}),
			to: resolveAppSpaceEntryRouteTo(input.navigationSurface),
		}).catch((error: unknown) => {
			console.error("Failed to open Space with the remembered profile.", error);
		});
	}, [
		navigate,
		recommendedProfileId,
		input.focusInteractionId,
		input.focusSignalId,
		input.focusThreadRootSignalId,
		input.orgSlug,
		input.spaceId,
		input.navigationSurface,
	]);

	if (!hasRestored || (profilesQuery.isPending && !profilesHaveData)) {
		return (
			<AppSpaceEntryShell
				initialSidebarStates={input.initialSidebarStates}
				navigationSurface={input.navigationSurface}
				spaceId={input.spaceId}
			>
				<SpaceProfileCheckState />
			</AppSpaceEntryShell>
		);
	}

	if (profilesQuery.isError && !profilesHaveData) {
		return (
			<AppSpaceEntryShell
				initialSidebarStates={input.initialSidebarStates}
				navigationSurface={input.navigationSurface}
				spaceId={input.spaceId}
			>
				<SpaceProfileLoadFailureState
					errorMessage={profilesQuery.error.message}
					isRetrying={profilesQuery.isRefetching}
					onRetry={() => {
						profilesQuery.refetch().catch((error) => {
							console.error("Failed to refresh human profiles.", error);
						});
					}}
				/>
			</AppSpaceEntryShell>
		);
	}

	// A remembered/default profile resolved → show the brief redirecting state
	// while the effect navigates to the canonical ?profileId URL.
	if (recommendedProfileId) {
		return (
			<AppSpaceEntryShell
				initialSidebarStates={input.initialSidebarStates}
				navigationSurface={input.navigationSurface}
				spaceId={input.spaceId}
				verifiedProfileId={recommendedProfileId}
			>
				<SpaceProfileCheckState />
			</AppSpaceEntryShell>
		);
	}

	return (
		<AppSpaceEntryShell
			initialSidebarStates={input.initialSidebarStates}
			navigationSurface={input.navigationSurface}
			spaceId={input.spaceId}
		>
			<SpaceProfileRequiredState recommendedHumanProfile={null} />
		</AppSpaceEntryShell>
	);
}

function ValidatedAppSpaceEntryContent(
	input: {
		spaceId: string;
		orgSlug: string;
		profileId: string;
		initialSidebarStates?: AppSidebarPersistedStates;
		navigationSurface: AppSpaceNavigationSurface;
	} & AppSpaceFocusSearch
) {
	const { hasRestored, state, storageScope } = useStartFlowState();
	const { currentOrganization } = useAppOrganization();
	const profilesQuery = useQuery(
		buildStartProfilesQueryOptions({
			enabled: true,
			storageScope,
		})
	);
	const profilesHaveData = profilesQuery.data !== undefined;
	const centerAgentDirectMessageProjectionQuery = useQuery(
		centerAgentDirectMessageSpaceProjectionQueryOptions({
			enabled: true,
			organizationId: currentOrganization.id,
		})
	);

	// Remember the human profile this Space was opened with so future direct
	// links resolve silently instead of prompting (durable localStorage). Only
	// human profiles are remembered — the web speaks as a human; agents are CLI.
	const accountProfilesData = profilesQuery.data;
	useEffect(() => {
		if (!accountProfilesData) {
			return;
		}
		const openedHumanProfile = findActiveProfileById(accountProfilesData, {
			profileId: input.profileId,
			profileKind: "human",
		});
		if (openedHumanProfile) {
			writeLastUsedHumanProfileId({
				profileId: openedHumanProfile.openMeldProfileId,
				storageScope,
			});
		}
	}, [accountProfilesData, input.profileId, storageScope]);

	if (!hasRestored || (profilesQuery.isPending && !profilesHaveData)) {
		return (
			<AppSpaceEntryShell
				initialSidebarStates={input.initialSidebarStates}
				navigationSurface={input.navigationSurface}
				spaceId={input.spaceId}
			>
				<SpaceProfileCheckState />
			</AppSpaceEntryShell>
		);
	}

	if (profilesQuery.isError && !profilesHaveData) {
		return (
			<AppSpaceEntryShell
				initialSidebarStates={input.initialSidebarStates}
				navigationSurface={input.navigationSurface}
				spaceId={input.spaceId}
			>
				<SpaceProfileLoadFailureState
					errorMessage={profilesQuery.error.message}
					isRetrying={profilesQuery.isRefetching}
					onRetry={() => {
						profilesQuery.refetch().catch((error) => {
							console.error("Failed to refresh account profiles.", error);
						});
					}}
				/>
			</AppSpaceEntryShell>
		);
	}

	const selectedProfile = findActiveProfileById(profilesQuery.data ?? [], {
		profileId: input.profileId,
	});
	// A copied or stale Profile belongs to neither the destination nor its
	// authority. Resolve this account's Human without leaving the app shell.
	if (!selectedProfile || selectedProfile.profileKind !== "human") {
		const rememberedHumanProfileId =
			readLastUsedHumanProfileId(storageScope) ?? state.selectedHumanProfileId;
		const humanProfile = resolveAppSpacesProfile({
			profiles: profilesQuery.data ?? [],
			selectedHumanProfileId: rememberedHumanProfileId,
		});
		if (humanProfile) {
			return (
				<RedirectToAppSpaceProfile
					focusInteractionId={input.focusInteractionId}
					focusSignalId={input.focusSignalId}
					focusThreadRootSignalId={input.focusThreadRootSignalId}
					initialSidebarStates={input.initialSidebarStates}
					navigationSurface={input.navigationSurface}
					orgSlug={input.orgSlug}
					profileId={humanProfile.openMeldProfileId}
					spaceId={input.spaceId}
				/>
			);
		}
		return (
			<AppSpaceEntryShell
				initialSidebarStates={input.initialSidebarStates}
				navigationSurface={input.navigationSurface}
				spaceId={input.spaceId}
			>
				<SpaceProfileRequiredState recommendedHumanProfile={null} />
			</AppSpaceEntryShell>
		);
	}

	return (
		<ResolvedAppSpaceEntryContent
			accountProfiles={profilesQuery.data ?? []}
			centerAgentDirectMessageSpaceId={
				centerAgentDirectMessageProjectionQuery.data?.projection?.spaceId ??
				null
			}
			focusInteractionId={input.focusInteractionId}
			focusSignalId={input.focusSignalId}
			focusThreadRootSignalId={input.focusThreadRootSignalId}
			initialSidebarStates={input.initialSidebarStates}
			isPersonalContext={currentOrganization.isPersonal === true}
			navigationSurface={input.navigationSurface}
			orgSlug={input.orgSlug}
			profileId={selectedProfile.openMeldProfileId}
			spaceId={input.spaceId}
		/>
	);
}

function ResolvedAppSpaceEntryContent(
	input: {
		accountProfiles: ComponentProps<typeof SpaceLanding>["accountProfiles"];
		centerAgentDirectMessageSpaceId: string | null;
		initialSidebarStates?: AppSidebarPersistedStates;
		isPersonalContext: boolean;
		navigationSurface: AppSpaceNavigationSurface;
		orgSlug: string;
		profileId: string;
		spaceId: string;
	} & AppSpaceFocusSearch
) {
	const allowedContent =
		input.navigationSurface === "directMessages" ? (
			<ValidatedDirectMessageEntryContent
				accountProfiles={input.accountProfiles}
				focusInteractionId={input.focusInteractionId}
				focusSignalId={input.focusSignalId}
				focusThreadRootSignalId={input.focusThreadRootSignalId}
				initialSidebarStates={input.initialSidebarStates}
				isPersonalContext={input.isPersonalContext}
				orgSlug={input.orgSlug}
				profileId={input.profileId}
				spaceId={input.spaceId}
			/>
		) : (
			<ValidatedSpaceNavigationContent
				focusInteractionId={input.focusInteractionId}
				focusSignalId={input.focusSignalId}
				focusThreadRootSignalId={input.focusThreadRootSignalId}
				initialSidebarStates={input.initialSidebarStates}
				orgSlug={input.orgSlug}
				profileId={input.profileId}
				spaceId={input.spaceId}
			>
				<AppSpaceShell
					currentProfileId={input.profileId}
					currentSpaceId={input.spaceId}
					initialOuterSidebarState={
						input.initialSidebarStates?.outer ??
						APP_SIDEBAR_DEFAULT_STATES.outer
					}
					initialSidebarState={
						input.initialSidebarStates?.inner ??
						APP_SIDEBAR_DEFAULT_STATES.inner
					}
					showSpacesSidebar={
						input.centerAgentDirectMessageSpaceId !== input.spaceId
					}
				>
					<SpaceLanding
						accountProfiles={input.accountProfiles}
						initialFocusInteractionId={input.focusInteractionId}
						initialFocusSignalId={input.focusSignalId}
						initialFocusThreadRootSignalId={input.focusThreadRootSignalId}
						isPersonalContext={input.isPersonalContext}
						key={`${input.spaceId}:${input.profileId}`}
						orgSlug={input.orgSlug}
						profileId={input.profileId}
						spaceId={input.spaceId}
					/>
				</AppSpaceShell>
			</ValidatedSpaceNavigationContent>
		);

	return (
		<AppSpaceAccessGate
			focusSignalId={input.focusSignalId}
			focusThreadRootSignalId={input.focusThreadRootSignalId}
			initialSidebarStates={input.initialSidebarStates}
			navigationSurface={input.navigationSurface}
			orgSlug={input.orgSlug}
			profileId={input.profileId}
			spaceId={input.spaceId}
		>
			{allowedContent}
		</AppSpaceAccessGate>
	);
}

function AppSpaceAccessGate(
	input: {
		children: ReactNode;
		initialSidebarStates?: AppSidebarPersistedStates;
		navigationSurface: AppSpaceNavigationSurface;
		orgSlug: string;
		profileId: string;
		spaceId: string;
	} & Pick<AppSpaceFocusSearch, "focusSignalId" | "focusThreadRootSignalId">
) {
	const organization = useAppOrganization();
	const queryClient = useQueryClient();
	// SSR loader hydration does not rerun the route loader in the browser.
	// Activate here too, after the account, Organization, and Profile checks.
	useEffect(() => {
		resolveAppQueryPersistenceController()
			.activateSpaceConversation({
				organizationId: organization.currentOrganization.id,
				organizationSlug: organization.currentOrganization.slug,
				ownerAccountId: organization.storageScope,
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
			})
			.catch((error: unknown) =>
				console.error("Failed to restore saved Space messages.", error)
			);
	}, [
		organization.currentOrganization.id,
		organization.currentOrganization.slug,
		organization.storageScope,
		queryClient,
		input.spaceId,
		input.profileId,
	]);
	const display = useQuery(
		spaceConversationDisplaySnapshotQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		})
	);
	const history = useQuery(
		spaceHistoryQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled: false,
		})
	);
	const onAccessRejected = useCallback(() => {
		clearSpaceConversationPositions(
			`${input.profileId}:space-conversation:${input.spaceId}`
		);
		resolveAppQueryPersistenceController()
			.clearSpaceConversation({
				organizationId: organization.currentOrganization.id,
				organizationSlug: organization.currentOrganization.slug,
				ownerAccountId: organization.storageScope,
				queryClient,
				spaceId: input.spaceId,
				openMeldProfileId: input.profileId,
			})
			.catch((error: unknown) =>
				console.error(
					"Failed to clear an inaccessible saved Space view.",
					error
				)
			);
	}, [
		organization.currentOrganization.id,
		organization.currentOrganization.slug,
		organization.storageScope,
		queryClient,
		input.spaceId,
		input.profileId,
	]);
	const appTarget = buildOrganizationSpacePath({
		orgSlug: input.orgSlug,
		search: buildAppSpaceRouteSearch({
			focusSignalId: input.focusSignalId,
			focusThreadRootSignalId: input.focusThreadRootSignalId,
			profileId: input.profileId,
		}),
		spaceId: input.spaceId,
	});
	return (
		<SpaceEntryGate
			backHref={buildOrganizationSpacesPath(input.orgSlug)}
			onAccessRejected={onAccessRejected}
			openMeldProfileId={input.profileId}
			renderFrame={(content) => (
				<AppSpaceEntryShell
					initialSidebarStates={input.initialSidebarStates}
					navigationSurface={input.navigationSurface}
					spaceId={input.spaceId}
					verifiedProfileId={input.profileId}
				>
					{content}
				</AppSpaceEntryShell>
			)}
			restoredContent={
				display.data && history.data ? input.children : undefined
			}
			signalId={input.focusSignalId}
			signInHref={`/login?redirect=${encodeURIComponent(appTarget)}`}
			spaceId={input.spaceId}
			threadRootSignalId={input.focusThreadRootSignalId}
		>
			{() => input.children}
		</SpaceEntryGate>
	);
}

function useSpaceConversationEntryQueries(input: {
	spaceId: string;
	profileId: string;
}) {
	const statusQuery = useQuery(
		spaceStatusQueryOptions({
			enabled: true,
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		})
	);
	const displaySnapshotQuery = useQuery(
		spaceConversationDisplaySnapshotQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
		})
	);
	// Cold entry already passed the access gate. Start the bounded conversation
	// read alongside route classification instead of waiting for status first.
	// SpaceLanding consumes this same query; warm visits keep their saved tail.
	useQuery(
		spaceBootstrapQueryOptions({
			spaceId: input.spaceId,
			openMeldProfileId: input.profileId,
			enabled:
				statusQuery.isPending &&
				!statusQuery.data &&
				!displaySnapshotQuery.data,
		})
	);
	return { statusQuery, displaySnapshotQuery };
}

function ValidatedSpaceNavigationContent(
	input: {
		children: ReactNode;
		initialSidebarStates?: AppSidebarPersistedStates;
		orgSlug: string;
		profileId: string;
		spaceId: string;
	} & AppSpaceFocusSearch
) {
	const { statusQuery } = useSpaceConversationEntryQueries(input);

	if (
		statusQuery.data &&
		isDirectMessageSpace(toDirectMessageState(statusQuery.data))
	) {
		return (
			<RedirectToCanonicalDirectMessage
				focusInteractionId={input.focusInteractionId}
				focusSignalId={input.focusSignalId}
				focusThreadRootSignalId={input.focusThreadRootSignalId}
				orgSlug={input.orgSlug}
				profileId={input.profileId}
				spaceId={input.spaceId}
			/>
		);
	}

	return input.children;
}

function ValidatedDirectMessageEntryContent(
	input: {
		accountProfiles: ComponentProps<typeof SpaceLanding>["accountProfiles"];
		initialSidebarStates?: AppSidebarPersistedStates;
		isPersonalContext: boolean;
		orgSlug: string;
		profileId: string;
		spaceId: string;
	} & AppSpaceFocusSearch
) {
	const { statusQuery, displaySnapshotQuery } =
		useSpaceConversationEntryQueries(input);
	if (!statusQuery.data && statusQuery.isError && !displaySnapshotQuery.data) {
		return (
			<AppSpaceEntryShell
				initialSidebarStates={input.initialSidebarStates}
				navigationSurface="directMessages"
				spaceId={input.spaceId}
				verifiedProfileId={input.profileId}
			>
				<DirectMessagesLoadFailureState
					isRetrying={statusQuery.isRefetching}
					onRetry={() => {
						statusQuery.refetch().catch((error: unknown) => {
							console.error("Failed to refresh Direct Messages.", error);
						});
					}}
				/>
			</AppSpaceEntryShell>
		);
	}
	if (
		statusQuery.data &&
		!isDirectMessageSpace(toDirectMessageState(statusQuery.data))
	) {
		return (
			<RedirectToCanonicalSpace
				focusInteractionId={input.focusInteractionId}
				focusSignalId={input.focusSignalId}
				focusThreadRootSignalId={input.focusThreadRootSignalId}
				orgSlug={input.orgSlug}
				profileId={input.profileId}
				spaceId={input.spaceId}
			/>
		);
	}

	return (
		<AppDirectMessageShell
			currentProfileId={input.profileId}
			currentSpaceId={input.spaceId}
			initialOuterSidebarState={
				input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer
			}
			initialSidebarState={
				input.initialSidebarStates?.inner ?? APP_SIDEBAR_DEFAULT_STATES.inner
			}
		>
			<SpaceLanding
				accountProfiles={input.accountProfiles}
				initialFocusInteractionId={input.focusInteractionId}
				initialFocusSignalId={input.focusSignalId}
				initialFocusThreadRootSignalId={input.focusThreadRootSignalId}
				isDirectMessageConversation
				isPersonalContext={input.isPersonalContext}
				key={`${input.spaceId}:${input.profileId}`}
				orgSlug={input.orgSlug}
				profileId={input.profileId}
				spaceId={input.spaceId}
			/>
		</AppDirectMessageShell>
	);
}

function toDirectMessageState(status: {
	directMessageConvertedAt?: string;
	spacePurpose?: string;
	members: { totalCount: number };
}) {
	return {
		activeMemberCount: status.members.totalCount,
		directMessageConvertedAt: status.directMessageConvertedAt,
		purpose: status.spacePurpose,
	};
}

function SpaceProfileCheckState() {
	return (
		<output
			aria-label="Checking profile"
			className="flex w-full max-w-sm flex-col items-center gap-4 text-center"
		>
			<Bars aria-hidden="true" className="h-7 w-10 text-muted-foreground" />
			<div className="space-y-2">
				<h1 className="font-medium text-base text-foreground">
					Checking your profile
				</h1>
				<p className="text-muted-foreground text-sm">
					OpenMeld is confirming which profile can open this Space.
				</p>
			</div>
		</output>
	);
}

function AppSpaceEntryShell(input: {
	children: ReactNode;
	spaceId: string;
	verifiedProfileId?: string;
	initialSidebarStates?: AppSidebarPersistedStates;
	navigationSurface?: AppSpaceNavigationSurface;
}) {
	const content = (
		<AppMainContent>
			<div className="flex h-full items-center justify-center px-6 py-10">
				{input.children}
			</div>
		</AppMainContent>
	);
	const outerState =
		input.initialSidebarStates?.outer ?? APP_SIDEBAR_DEFAULT_STATES.outer;
	const innerState =
		input.initialSidebarStates?.inner ?? APP_SIDEBAR_DEFAULT_STATES.inner;

	if (input.verifiedProfileId) {
		if (input.navigationSurface === "directMessages") {
			return (
				<AppDirectMessageShell
					currentProfileId={input.verifiedProfileId}
					currentSpaceId={input.spaceId}
					initialOuterSidebarState={outerState}
					initialSidebarState={innerState}
				>
					{content}
				</AppDirectMessageShell>
			);
		}
		return (
			<AppSpaceShell
				currentProfileId={input.verifiedProfileId}
				currentSpaceId={input.spaceId}
				initialOuterSidebarState={outerState}
				initialSidebarState={innerState}
			>
				{content}
			</AppSpaceShell>
		);
	}

	return (
		<SpaceWindowShell
			initialOuterSidebarState={outerState}
			initialSidebarState={innerState}
			sidebarPreferenceKey="spaces"
		>
			{content}
		</SpaceWindowShell>
	);
}

function SpaceProfileLoadFailureState(input: {
	errorMessage: string;
	isRetrying: boolean;
	onRetry: () => void;
}) {
	return (
		<Card className="w-full max-w-md border-destructive bg-destructive/10">
			<CardHeader className="flex flex-col gap-2">
				<p className="font-medium text-muted-foreground text-xs">
					OpenMeld Space
				</p>
				<h1 className="font-medium text-base">
					Couldn&apos;t Load Your Profile
				</h1>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<p className="max-w-prose text-muted-foreground text-sm">
					{input.errorMessage}
				</p>
				<Button
					disabled={input.isRetrying}
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					Retry
				</Button>
			</CardContent>
		</Card>
	);
}

function RedirectToAppSpaceProfile(
	input: {
		profileId: string;
		spaceId: string;
		orgSlug: string;
		initialSidebarStates?: AppSidebarPersistedStates;
		navigationSurface: AppSpaceNavigationSurface;
	} & AppSpaceFocusSearch
) {
	const navigate = useNavigate();

	useEffect(() => {
		navigate({
			params: { orgSlug: input.orgSlug, spaceId: input.spaceId },
			replace: true,
			search: buildAppSpaceRouteSearch({
				focusInteractionId: input.focusInteractionId,
				focusSignalId: input.focusSignalId,
				focusThreadRootSignalId: input.focusThreadRootSignalId,
				profileId: input.profileId,
			}),
			to: resolveAppSpaceEntryRouteTo(input.navigationSurface),
		}).catch((error: unknown) => {
			console.error(
				"OpenMeld could not open the Space with your profile.",
				error
			);
		});
	}, [
		navigate,
		input.focusInteractionId,
		input.focusSignalId,
		input.focusThreadRootSignalId,
		input.profileId,
		input.orgSlug,
		input.spaceId,
		input.navigationSurface,
	]);

	return (
		<AppSpaceEntryShell
			initialSidebarStates={input.initialSidebarStates}
			navigationSurface={input.navigationSurface}
			spaceId={input.spaceId}
			verifiedProfileId={input.profileId}
		>
			<SpaceProfileCheckState />
		</AppSpaceEntryShell>
	);
}

function RedirectToCanonicalSpace(
	input: {
		orgSlug: string;
		profileId: string;
		spaceId: string;
	} & AppSpaceFocusSearch
) {
	const navigate = useNavigate();

	useEffect(() => {
		navigate({
			replace: true,
			to: buildOrganizationSpacePath({
				orgSlug: input.orgSlug,
				search: buildAppSpaceRouteSearch({
					focusInteractionId: input.focusInteractionId,
					focusSignalId: input.focusSignalId,
					focusThreadRootSignalId: input.focusThreadRootSignalId,
					profileId: input.profileId,
				}),
				spaceId: input.spaceId,
			}),
		}).catch((error: unknown) => {
			console.error("Failed to open this conversation as a Space.", error);
		});
	}, [
		navigate,
		input.focusInteractionId,
		input.focusSignalId,
		input.focusThreadRootSignalId,
		input.orgSlug,
		input.profileId,
		input.spaceId,
	]);

	return (
		<AppSpaceEntryShell spaceId={input.spaceId}>
			<SpaceProfileCheckState />
		</AppSpaceEntryShell>
	);
}

function RedirectToCanonicalDirectMessage(
	input: {
		orgSlug: string;
		profileId: string;
		spaceId: string;
	} & AppSpaceFocusSearch
) {
	const navigate = useNavigate();

	useEffect(() => {
		navigate({
			replace: true,
			to: buildOrganizationDirectMessagePath({
				orgSlug: input.orgSlug,
				search: buildAppSpaceRouteSearch({
					focusInteractionId: input.focusInteractionId,
					focusSignalId: input.focusSignalId,
					focusThreadRootSignalId: input.focusThreadRootSignalId,
					profileId: input.profileId,
				}),
				spaceId: input.spaceId,
			}),
		}).catch((error: unknown) => {
			console.error(
				"Failed to open this conversation as a Direct Message.",
				error
			);
		});
	}, [
		navigate,
		input.focusInteractionId,
		input.focusSignalId,
		input.focusThreadRootSignalId,
		input.orgSlug,
		input.profileId,
		input.spaceId,
	]);

	return (
		<AppSpaceEntryShell spaceId={input.spaceId}>
			<SpaceProfileCheckState />
		</AppSpaceEntryShell>
	);
}

function DirectMessagesLoadFailureState(input: {
	isRetrying: boolean;
	onRetry: () => void;
}) {
	return (
		<Card className="w-full max-w-md border-destructive bg-destructive/10">
			<CardHeader className="flex flex-col gap-2">
				<p className="font-medium text-muted-foreground text-xs">
					Direct Messages
				</p>
				<h1 className="font-medium text-base">
					Couldn&apos;t Verify This Conversation
				</h1>
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				<p className="max-w-prose text-muted-foreground text-sm">
					OpenMeld could not confirm that this is still a Direct Message.
				</p>
				<Button
					disabled={input.isRetrying}
					onClick={input.onRetry}
					size="sm"
					type="button"
					variant="outline"
				>
					Retry
				</Button>
			</CardContent>
		</Card>
	);
}

function resolveAppSpaceEntryRouteTo(
	navigationSurface: AppSpaceNavigationSurface
): "/o/$orgSlug/chats/$spaceId" | "/o/$orgSlug/spaces/$spaceId" {
	return navigationSurface === "directMessages"
		? "/o/$orgSlug/chats/$spaceId"
		: "/o/$orgSlug/spaces/$spaceId";
}

function buildAppSpaceRouteSearch(
	input: AppSpaceFocusSearch & { profileId: string }
) {
	return {
		focusInteractionId: input.focusInteractionId,
		focusSignalId: input.focusSignalId,
		focusThreadRootSignalId: input.focusThreadRootSignalId,
		profileId: input.profileId,
	};
}
