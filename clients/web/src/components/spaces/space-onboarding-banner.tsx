import { isHostedAgentControllerRef } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SparkleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import {
	OnboardingSetupBanner,
	OnboardingSetupEmptyStateActions,
} from "#/components/spaces/onboarding-setup-banner";
import {
	type OnboardingSetupPresentation,
	resolveDeviceStatus,
	resolveOnboardingSetupActionVisibility,
} from "#/components/spaces/onboarding-setup-presentation";
import { useSpaceSetupDismissals } from "#/components/spaces/use-space-setup-dismissals";
import { useAuthSession } from "#/hooks/auth.hooks";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { deriveSpaceOnboardingPlan } from "#/lib/onboarding/space-onboarding-plan";

type AccountProfileLike = {
	openMeldProfileId: string;
	profileName: string;
	profileKind: "human" | "agent";
	status: string;
};

type LocalAgentRecoveryController = Pick<
	ReturnType<typeof useLocalAgentRecoveryController>,
	"currentLocalRuntimeReplyReadinessQuery" | "localRuntimesQuery"
>;

/** Whether the current setup presentation has anything to show and, for the
 * banner, whether every available row is dismissed so the header can recall it. */
export type SpaceSetupVisibility = {
	hasSetup: boolean;
	allHidden: boolean;
};

type SpaceOnboardingBannerProps = {
	spaceId: string;
	spaceName: string | null;
	actingProfileId: string;
	accountProfiles: readonly AccountProfileLike[];
	membersSnapshot: SpaceMembersSnapshot | null;
	serviceConnected: boolean | null;
	serviceReadinessPending: boolean;
	/** True when this account has no connected computer at all (no local runtime
	 * has checked in). Connectivity is a ServiceRuntime liveness fact, so this —
	 * not the Binding-derived current-device pointer — is the honest "not
	 * connected" signal for a first-time user. When there are zero computers the
	 * reply-readiness query is disabled (perpetually pending), so this, not its
	 * isPending, is what surfaces the connect / first-agent guidance. */
	noConnectedComputer: boolean;
	onAddAgents?: () => void;
	orgSlug: string;
	presentation: OnboardingSetupPresentation;
	/** Bumped by the header recall action to un-dismiss every row. */
	recallNonce: number;
	onVisibilityChange: (visibility: SpaceSetupVisibility) => void;
};

/**
 * Header action for recalling the Get-set-up panel after every available setup
 * row has been dismissed.
 */
export function SetupRecallButton(input: { onClick: () => void }) {
	return (
		<Button
			aria-label="Get set up"
			className="me-1 max-lg:min-h-11 max-lg:min-w-11"
			onClick={input.onClick}
			size="sm"
			type="button"
			variant="ghost"
		>
			<SparkleIcon
				aria-hidden="true"
				className="size-3.5"
				data-icon="inline-start"
			/>
			<span className="hidden sm:inline">Get set up</span>
		</Button>
	);
}

function SpaceOnboardingBanner(props: SpaceOnboardingBannerProps) {
	const authSession = useAuthSession();
	const {
		dismissedIds,
		dismiss: handleDismiss,
		recall,
		isReady,
	} = useSpaceSetupDismissals({
		userId: authSession.data?.user?.id ?? null,
		orgSlug: props.orgSlug,
		spaceId: props.spaceId,
	});

	const navigate = useNavigate();
	const spaceId = props.spaceId;
	const handleConnect = useCallback(() => {
		navigate({
			to: buildConnectComputerPath({
				orgSlug: props.orgSlug,
				returnTo: "space",
				spaceId,
			}),
		}).catch(() => undefined);
	}, [navigate, props.orgSlug, spaceId]);

	const plan = deriveSpaceOnboardingPlan({
		accountProfiles: props.accountProfiles,
		actingProfileId: props.actingProfileId,
		authSession: authSession.data ?? null,
		deviceStatus: resolveDeviceStatus({
			noConnectedComputer: props.noConnectedComputer,
			pending: props.serviceReadinessPending,
			serviceConnected: props.serviceConnected,
		}),
		membersSnapshot: props.membersSnapshot,
		spaceId: props.spaceId,
	});

	const availableActions = resolveOnboardingSetupActionVisibility({
		canAddAgents: typeof props.onAddAgents === "function",
		plan,
	});
	const visibleActions = resolveOnboardingSetupActionVisibility({
		canAddAgents: typeof props.onAddAgents === "function",
		dismissedIds: props.presentation === "banner" ? dismissedIds : undefined,
		plan,
	});
	const hasSetup =
		availableActions.showConnect || availableActions.showBringAgents;
	const allHidden =
		props.presentation === "banner" &&
		hasSetup &&
		!(visibleActions.showConnect || visibleActions.showBringAgents);

	const { onVisibilityChange, recallNonce } = props;

	// Report visibility up so the header can show/hide the recall action.
	useEffect(() => {
		onVisibilityChange({ hasSetup, allHidden });
	}, [hasSetup, allHidden, onVisibilityChange]);

	// Recall (header chip) clears every dismissal so the panel reappears. Guarded
	// by a ref so it only fires on an actual recall, not on mount.
	const recallScope = JSON.stringify([
		authSession.data?.user?.id,
		props.orgSlug,
		props.spaceId,
	]);
	const lastRecallNonceRef = useRef({ scope: recallScope, nonce: recallNonce });
	useEffect(() => {
		if (
			recallScope === lastRecallNonceRef.current.scope &&
			recallNonce !== lastRecallNonceRef.current.nonce
		) {
			recall();
		}
		lastRecallNonceRef.current = { scope: recallScope, nonce: recallNonce };
	}, [recallNonce, recall, recallScope]);

	if (props.presentation === "empty-state") {
		return (
			<OnboardingSetupEmptyStateActions
				onAddAgents={props.onAddAgents}
				onConnect={handleConnect}
				plan={plan}
			/>
		);
	}

	return isReady ? (
		<OnboardingSetupBanner
			dismissedIds={dismissedIds}
			onAddAgents={props.onAddAgents}
			onConnect={handleConnect}
			onDismiss={handleDismiss}
			orgSlug={props.orgSlug}
			plan={plan}
			spaceId={props.spaceId}
			spaceName={props.spaceName}
		/>
	) : null;
}

export type SpaceConversationRecoveryBannerProps = {
	accountProfiles: readonly AccountProfileLike[];
	actingProfileId: string;
	recovery: LocalAgentRecoveryController;
	snapshot: SpaceMembersSnapshot | null;
	spaceId: string;
	spaceName: string | null;
	onAddAgents?: () => void;
	presentation: OnboardingSetupPresentation;
	setupRecallNonce: number;
	orgSlug: string;
	isDirectMessage: boolean;
	onSetupVisibilityChange: (visibility: SpaceSetupVisibility) => void;
};

/**
 * The conversation's plan-driven setup slot. It renders centered cards before
 * the first message and the dismissible banner afterward. Per-agent Wake
 * recovery stays on member rows, member details, and Settings.
 */
export function SpaceConversationRecoveryBanner(
	props: SpaceConversationRecoveryBannerProps
) {
	const activeOwnedAgentProfileIds = new Set<string>();
	for (const profile of props.accountProfiles) {
		if (profile.profileKind === "agent" && profile.status === "active") {
			activeOwnedAgentProfileIds.add(profile.openMeldProfileId);
		}
	}
	const hasOwnedLocalAgentMember =
		props.snapshot?.agents.some(
			(agent) =>
				agent.status === "active" &&
				agent.removedAt === null &&
				!isHostedAgentControllerRef(agent.agentControllerRef) &&
				activeOwnedAgentProfileIds.has(agent.profileId)
		) === true;
	const suppressSetup = props.isDirectMessage && !hasOwnedLocalAgentMember;
	const allowAddAgentsGuidance = !props.isDirectMessage;
	const { onSetupVisibilityChange } = props;
	useEffect(() => {
		if (suppressSetup) {
			onSetupVisibilityChange({ hasSetup: false, allHidden: false });
		}
	}, [onSetupVisibilityChange, suppressSetup]);

	if (suppressSetup) {
		return null;
	}

	const readinessQuery = props.recovery.currentLocalRuntimeReplyReadinessQuery;
	// Definitive "no connected computer at all" fact, read from ServiceRuntime
	// liveness (the local runtime inventory) rather than the Binding-derived
	// current-device pointer: a freshly connected computer with no Agent Profile
	// bound yet still has a local runtime, so it must NOT count as not_connected.
	// When there are zero computers the readiness query above is disabled (so
	// perpetually isPending); this is the honest not_connected signal that
	// surfaces first-run guidance.
	const localRuntimesQuery = props.recovery.localRuntimesQuery;
	const noConnectedComputer =
		localRuntimesQuery.isSuccess &&
		(localRuntimesQuery.data?.localRuntimes.length ?? 0) === 0;
	return (
		<SpaceOnboardingBanner
			accountProfiles={props.accountProfiles}
			actingProfileId={props.actingProfileId}
			membersSnapshot={props.snapshot}
			noConnectedComputer={noConnectedComputer}
			onAddAgents={allowAddAgentsGuidance ? props.onAddAgents : undefined}
			onVisibilityChange={props.onSetupVisibilityChange}
			orgSlug={props.orgSlug}
			presentation={props.presentation}
			recallNonce={props.setupRecallNonce}
			serviceConnected={readinessQuery.data?.service.connected ?? null}
			serviceReadinessPending={readinessQuery.isPending}
			spaceId={props.spaceId}
			spaceName={props.spaceName}
		/>
	);
}
