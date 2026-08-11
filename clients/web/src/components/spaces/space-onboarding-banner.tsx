import type {
	OnboardingFacts,
	OnboardingPlan,
	SpaceMembersSnapshot,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { SparkleIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { OnboardingSetupBanner } from "#/components/spaces/onboarding-setup-banner";
import { useAuthSession } from "#/hooks/auth.hooks";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { deriveSpaceOnboardingPlan } from "#/lib/onboarding/space-onboarding-plan";

type AccountProfileLike = {
	openMeldProfileId: string;
	profileName: string;
	profileKind: "human" | "agent";
	status: string;
};

type DeviceStatus = OnboardingFacts["device"]["status"];
type SetupDecisionId = OnboardingPlan["decisions"][number]["id"];
type LocalAgentRecoveryController = Pick<
	ReturnType<typeof useLocalAgentRecoveryController>,
	"currentLocalRuntimeReplyReadinessQuery" | "localRuntimesQuery"
>;

// The coarse, act-now setup decisions the banner surfaces (and the recall action
// reasons about). Order matches the banner's render order.
const SETUP_DECISION_IDS = [
	"connect_this_computer",
	"bring_agents",
] as const satisfies readonly SetupDecisionId[];

/**
 * Whether a setup decision should surface as an actionable Get-set-up row.
 * "available" decisions always do. Additionally, a joined account with no agent
 * yet (bring_agents "blocked", reason "agents.none_yet") is a real first-run gap
 * — surface it as an "add your first agent" row instead of silence, so a brand
 * new user is never left without a next step.
 */
function isShowableSetupDecision(
	decision: OnboardingPlan["decisions"][number]
): boolean {
	if (decision.status === "available") {
		return true;
	}
	return (
		decision.id === "bring_agents" &&
		decision.status === "blocked" &&
		decision.reason === "agents.none_yet"
	);
}

/** Whether the Get-set-up panel has anything to show and, if so, whether every
 * available row is currently dismissed (so the header can offer a recall). */
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
	/** Bumped by the header recall action to un-dismiss every row. */
	recallNonce: number;
	onVisibilityChange: (visibility: SpaceSetupVisibility) => void;
};

export function resolveDeviceStatus(input: {
	serviceConnected: boolean | null;
	pending: boolean;
	noConnectedComputer: boolean;
}): DeviceStatus {
	if (input.serviceConnected === true) {
		return "connected";
	}
	// Definitive: this account has no connected computer at all. The reply
	// readiness query is disabled in that state (it only runs once a computer
	// exists), so its perpetual isPending must NOT be read as "still checking".
	// A brand-new user with no computer is genuinely not_connected and must get
	// the "set up your first agent on this computer" guidance, not silence.
	if (input.noConnectedComputer) {
		return "not_connected";
	}
	if (input.pending) {
		// A device IS resolved but its readiness is still loading (e.g. a connected
		// user refreshing): report unknown so the planner blocks connect_this_computer
		// instead of speculatively flashing "Connect this computer" before the
		// connected fact arrives on first paint.
		return "unknown";
	}
	if (input.serviceConnected === false) {
		return "not_connected";
	}
	return "unknown";
}

/**
 * Header action for recalling the Get-set-up panel after every available setup
 * row has been dismissed.
 */
export function SetupRecallButton(input: { onClick: () => void }) {
	return (
		<Button
			className="me-1"
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
			Get set up
		</Button>
	);
}

function SpaceOnboardingBanner(props: SpaceOnboardingBannerProps) {
	const authSession = useAuthSession();
	// Per-row dismissal is presentation-only and session-scoped: a dismissed CTA
	// hides until a refresh recomputes the plan or the header "Get set up" action
	// recalls it. Never persisted (Invariant 4/6).
	const [dismissedIds, setDismissedIds] = useState<
		ReadonlySet<SetupDecisionId>
	>(() => new Set());

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

	const handleDismiss = useCallback((id: SetupDecisionId) => {
		setDismissedIds((prev) => {
			const next = new Set(prev);
			next.add(id);
			return next;
		});
	}, []);

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

	const visibleDecisionIds = props.onAddAgents
		? SETUP_DECISION_IDS
		: SETUP_DECISION_IDS.filter((id) => id !== "bring_agents");
	const availableCount = visibleDecisionIds.filter((id) =>
		plan.decisions.some(
			(decision) => decision.id === id && isShowableSetupDecision(decision)
		)
	).length;
	const visibleCount = visibleDecisionIds.filter(
		(id) =>
			!dismissedIds.has(id) &&
			plan.decisions.some(
				(decision) => decision.id === id && isShowableSetupDecision(decision)
			)
	).length;
	const hasSetup = availableCount > 0;
	const allHidden = hasSetup && visibleCount === 0;

	const { onVisibilityChange, recallNonce } = props;

	// Report visibility up so the header can show/hide the recall action.
	useEffect(() => {
		onVisibilityChange({ hasSetup, allHidden });
	}, [hasSetup, allHidden, onVisibilityChange]);

	// Recall (header chip) clears every dismissal so the panel reappears. Guarded
	// by a ref so it only fires on an actual recall, not on mount.
	const lastRecallNonceRef = useRef(recallNonce);
	useEffect(() => {
		if (recallNonce !== lastRecallNonceRef.current) {
			lastRecallNonceRef.current = recallNonce;
			setDismissedIds(new Set());
		}
	}, [recallNonce]);

	return (
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
	);
}

export type SpaceConversationRecoveryBannerProps = {
	accountProfiles: readonly AccountProfileLike[];
	actingProfileId: string;
	recovery: LocalAgentRecoveryController;
	snapshot: SpaceMembersSnapshot | null;
	spaceId: string;
	spaceName: string | null;
	onAddAgents?: () => void;
	setupRecallNonce: number;
	orgSlug: string;
	isDirectMessage: boolean;
	onSetupVisibilityChange: (visibility: SpaceSetupVisibility) => void;
};

/**
 * The conversation's setup banner slot. Computer-level setup lives here; per-agent
 * Wake recovery stays on member rows, member details, and Settings.
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
	const hasOwnedAgentMember =
		props.snapshot?.agents.some(
			(agent) =>
				agent.status === "active" &&
				agent.removedAt === null &&
				activeOwnedAgentProfileIds.has(agent.profileId)
		) === true;
	const suppressSetup = props.isDirectMessage && !hasOwnedAgentMember;
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
			recallNonce={props.setupRecallNonce}
			serviceConnected={readinessQuery.data?.service.connected ?? null}
			serviceReadinessPending={readinessQuery.isPending}
			spaceId={props.spaceId}
			spaceName={props.spaceName}
		/>
	);
}
