import type {
	AuthProfileView,
	SpaceAccessMode,
	SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";
import { buildOnboardingPlan } from "@openmeld/start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useLocalRuntimeQueries } from "#/components/agents/use-local-runtime-queries";
import { FullPagePending } from "#/components/app/full-page-pending";
import { useStartFlowState } from "#/components/app/start-flow-state";
import { useUpdateUserName } from "#/hooks/account.hooks";
import { useAuthSession } from "#/hooks/auth.hooks";
import { resolveOnboardingFacts } from "#/lib/onboarding/onboarding-facts";
import { mapAccountProfiles } from "#/lib/onboarding/space-onboarding-plan";
import { useAppOrganization } from "#/lib/organizations/organization-context";
import {
	buildOrganizationCenterAgentChatPath,
	buildOrganizationConnectPath,
	buildOrganizationSpacePath,
	buildOrganizationSpacesPath,
} from "#/lib/organizations/organization-routes";
import { listActiveProfilesByKind } from "#/lib/profiles/human-profiles";
import { useSelectedHumanProfile } from "#/lib/profiles/use-selected-human-profile";
import {
	createSpaceInOrganization,
	ORGANIZATION_SPACE_SCOPE_ERROR_MESSAGE,
	OrganizationSpaceScopeError,
} from "#/lib/spaces/create-space-in-organization";
import { organizationQueryKeys } from "#/query/organizations/organization-directory";
import { accountSpaceItemsQueryOptions } from "#/query/spaces/account-spaces";
import {
	selectWelcomeScreen,
	type WelcomeScreen,
} from "./select-welcome-screen";
import { shouldOfferWelcomeComputerSetup } from "./welcome-computer-setup";
import { WelcomeNameScreen } from "./welcome-name-screen";
import {
	type WelcomeJoinableSpace,
	WelcomeSpaceScreen,
} from "./welcome-space-screen";

function resolveJoinableStatus(
	isError: boolean,
	isSuccess: boolean
): "loading" | "error" | "ready" {
	if (isError) {
		return "error";
	}
	if (isSuccess) {
		return "ready";
	}
	return "loading";
}

function resolveCreateSpaceErrorMessage(error: Error | null): string | null {
	if (error === null) {
		return null;
	}
	return error instanceof OrganizationSpaceScopeError
		? ORGANIZATION_SPACE_SCOPE_ERROR_MESSAGE
		: "Couldn't create the space. Try again.";
}

function resolveWelcomeScreen(input: {
	actingProfile: AuthProfileView | null;
	humanProfiles: readonly AuthProfileView[];
	signedIn: boolean;
	userId: string | null;
	userName: string | null;
}): WelcomeScreen | null {
	if (input.actingProfile === null) {
		return null;
	}
	const plan = buildOnboardingPlan(
		resolveOnboardingFacts({
			session: {
				signedIn: input.signedIn,
				userId: input.userId,
				actingProfileId: input.actingProfile.openMeldProfileId,
				actingDisplayName:
					input.actingProfile.profileName ?? input.userName ?? null,
			},
			accountProfiles: mapAccountProfiles(input.humanProfiles),
			space: null,
			deviceStatus: "unknown",
		})
	);
	return selectWelcomeScreen(plan);
}

function resolveWelcomeBackHandler(
	showBack: boolean | undefined,
	handleBack: () => void
) {
	return showBack === false ? undefined : handleBack;
}

function renderWelcomeSpaceStep(input: {
	presentation?: "page" | "dialog";
	initialMode?: "choices" | "create";
	accountSpacesIsError: boolean;
	accountSpacesIsSuccess: boolean;
	contextKind: "organization" | "personal";
	createSpace: ReturnType<
		typeof useMutation<
			unknown,
			Error,
			{
				accessMode: SpaceAccessMode;
				name: string;
				password?: string;
				visibility: SpaceOrganizationVisibility;
			}
		>
	>;
	centerAgentPath: string;
	handleConnectComputer: () => void;
	handleBack: () => void;
	joinableSpaces: readonly WelcomeJoinableSpace[];
	onJoin: (spaceId: string) => void;
	onRetryJoinable: () => void;
	shouldOfferAddComputer: boolean;
	showBack?: boolean;
}) {
	return (
		<WelcomeSpaceScreen
			computerSetupActions={
				input.shouldOfferAddComputer
					? {
							centerAgentPath: input.centerAgentPath,
							onConnectComputer: input.handleConnectComputer,
						}
					: undefined
			}
			contextKind={input.contextKind}
			errorMessage={resolveCreateSpaceErrorMessage(input.createSpace.error)}
			initialMode={input.initialMode}
			isPending={input.createSpace.isPending}
			joinableSpaces={input.joinableSpaces}
			joinableStatus={resolveJoinableStatus(
				input.accountSpacesIsError,
				input.accountSpacesIsSuccess
			)}
			onBack={resolveWelcomeBackHandler(input.showBack, input.handleBack)}
			onCreate={input.createSpace.mutate}
			onJoin={input.onJoin}
			onRetryJoinable={input.onRetryJoinable}
			presentation={input.presentation}
		/>
	);
}

/**
 * The plan-driven first-run controller behind `/o/:orgSlug/new-space`. It owns the
 * effects (rename, create Space, open a Space); the screens it renders are
 * presentational. The screen choice comes from the shared onboarding plan via
 * `selectWelcomeScreen`, so first-run never re-derives onboarding rules.
 */
export function WelcomeFirstRun(
	input: {
		presentation?: "page" | "dialog";
		showBack?: boolean;
		initialMode?: "choices" | "create";
		offerComputerSetup?: boolean;
		onOpenSpace?: (spaceId: string, profileId: string) => void;
	} = {}
) {
	const navigate = useNavigate();
	const { currentOrganization } = useAppOrganization();
	const orgSlug = currentOrganization.slug;
	const queryClient = useQueryClient();
	const { storageScope } = useStartFlowState();
	const sessionQuery = useAuthSession();
	const { selectedHumanProfile, profilesQuery } = useSelectedHumanProfile({
		selectDefaultWhenMissing: true,
	});
	const updateUserName = useUpdateUserName();

	const user = sessionQuery.data?.user ?? null;
	const actingProfile = selectedHumanProfile;

	const humanProfiles = listActiveProfilesByKind(
		profilesQuery.data ?? [],
		"human"
	);

	const accountSpacesOptions = accountSpaceItemsQueryOptions({
		enabled: actingProfile !== null,
		profileId: actingProfile?.openMeldProfileId ?? "",
	});
	const {
		data: accountSpaceSections,
		isError: accountSpacesIsError,
		isSuccess: accountSpacesIsSuccess,
		refetch: refetchAccountSpaces,
	} = useQuery(accountSpacesOptions);
	const localRuntimeQueries = useLocalRuntimeQueries({
		currentLocalRuntimeReplyReadinessRefetchIntervalMs: false,
		storageScope,
	});
	const shouldOfferAddComputer = shouldOfferWelcomeComputerSetup({
		currentDeviceTargetAvailability:
			localRuntimeQueries.currentDeviceTargetQuery.data?.availability,
		currentDeviceTargetReady:
			localRuntimeQueries.currentDeviceTargetQuery.isSuccess,
		localRuntimeCount:
			localRuntimeQueries.localRuntimesQuery.data?.localRuntimes.length,
		localRuntimesReady: localRuntimeQueries.localRuntimesQuery.isSuccess,
	});

	const joinableSpaces: readonly WelcomeJoinableSpace[] = accountSpaceSections
		? [
				...accountSpaceSections.pinnedItems,
				...accountSpaceSections.spaceItems,
			].map((item) => ({
				spaceId: item.spaceId,
				name: item.spaceName,
			}))
		: [];

	const screen = resolveWelcomeScreen({
		actingProfile,
		humanProfiles,
		signedIn: !!user,
		userId: user?.id ?? null,
		userName: user?.name ?? null,
	});

	const openSpace = (spaceId: string) => {
		if (actingProfile === null) {
			return;
		}
		if (input.onOpenSpace) {
			input.onOpenSpace(spaceId, actingProfile.openMeldProfileId);
			return;
		}
		navigate({
			to: buildOrganizationSpacePath({
				orgSlug,
				search: { profileId: actingProfile.openMeldProfileId },
				spaceId,
			}),
		}).catch(() => undefined);
	};

	const handleBack = () => {
		navigate({ to: buildOrganizationSpacesPath(orgSlug) }).catch(
			() => undefined
		);
	};

	const handleConnectComputer = () => {
		navigate({
			to: buildOrganizationConnectPath({ orgSlug }),
		}).catch(() => undefined);
	};

	// Create Space as a tracked mutation: one in-flight create at a time (the
	// button disables while pending) and a surfaced error instead of a silent
	// failure that would let the user retry into duplicate Spaces.
	const createSpace = useMutation({
		mutationFn: (input: {
			accessMode: SpaceAccessMode;
			name: string;
			password?: string;
			visibility: SpaceOrganizationVisibility;
		}) => {
			if (actingProfile === null) {
				return Promise.reject(
					new Error("No usable profile to create a space.")
				);
			}
			return createSpaceInOrganization({
				actingProfile,
				organizationId: currentOrganization.id,
				space: input,
			});
		},
		onSuccess: async (response) => {
			try {
				await Promise.all([
					queryClient.invalidateQueries({
						queryKey: accountSpacesOptions.queryKey,
					}),
					queryClient.invalidateQueries({
						queryKey: organizationQueryKeys.spaces(currentOrganization.id),
					}),
				]);
			} catch (error) {
				console.warn(
					"OpenMeld created a Space but could not refresh Space lists.",
					{
						error,
						organizationId: currentOrganization.id,
						spaceId: response.spaceId,
					}
				);
			}
			openSpace(response.spaceId);
		},
	});

	if (sessionQuery.isPending || profilesQuery.isPending) {
		return <WelcomeLoading />;
	}

	// Settled but no usable human profile (e.g. profile query error or an account
	// with no active human): bail to the org-scoped Spaces list rather than spinning forever.
	// `screen` is non-null whenever `actingProfile` is.
	if (actingProfile === null || screen === null) {
		return <WelcomeDoneRedirect orgSlug={orgSlug} />;
	}

	if (screen === "name") {
		// Submitting refreshes the auth user name; the plan's actingDisplayName
		// falls back to it, so set_display_name flips to done and the next render
		// advances to "space".
		return (
			<WelcomeNameScreen
				defaultName={actingProfile.profileName ?? user?.name ?? ""}
				isPending={updateUserName.isPending}
				onSubmit={updateUserName.mutate}
			/>
		);
	}

	if (screen === "space") {
		return renderWelcomeSpaceStep({
			presentation: input.presentation,
			initialMode: input.initialMode,
			accountSpacesIsError:
				accountSpacesIsError && accountSpaceSections === undefined,
			accountSpacesIsSuccess:
				accountSpacesIsSuccess || accountSpaceSections !== undefined,
			centerAgentPath: buildOrganizationCenterAgentChatPath(orgSlug),
			contextKind:
				currentOrganization.isPersonal === true ? "personal" : "organization",
			createSpace,
			handleConnectComputer,
			handleBack,
			joinableSpaces,
			onJoin: openSpace,
			onRetryJoinable: () => {
				refetchAccountSpaces().catch(() => undefined);
			},
			shouldOfferAddComputer:
				shouldOfferAddComputer && input.offerComputerSetup !== false,
			showBack: input.showBack,
		});
	}

	return <WelcomeDoneRedirect orgSlug={orgSlug} />;
}

function WelcomeLoading() {
	return <FullPagePending label="Loading" />;
}

function WelcomeDoneRedirect(input: { orgSlug: string }) {
	const navigate = useNavigate();
	useEffect(() => {
		navigate({ to: buildOrganizationSpacesPath(input.orgSlug) }).catch(
			() => undefined
		);
	}, [input.orgSlug, navigate]);
	return <WelcomeLoading />;
}
