"use client";

import {
	buildAgentControllerRef,
	isAgentExecutionReadyOrConnecting,
} from "@openmeld/agent-runtime";
import type { StructuredApiClientFailure } from "@openmeld/api-client";
import {
	canonicalizeAgentControllerRef,
	prepareSessionStreamServerFrameSchema,
} from "@openmeld/schemas";
import type {
	AuthProfileView,
	CreatePrepareSessionRequest,
	CurrentLocalRuntimeReplyReadinessResponse,
	GetAgentExecutionReadinessResponse,
	PrepareBlocker,
	PrepareSessionSnapshot,
	PrepareStep as PrepareStepSnapshot,
	PrepareStepState,
} from "@openmeld/schemas/types";
import {
	getSetupFlowCopy,
	PREPARE_SESSION_RECONNECT_GRACE_MS,
	resolveSetupComputerActiveSummary,
	type SetupFlowCopy,
	type SetupFlowMode,
} from "@openmeld/start";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import { Card } from "@openmeld/ui/components/card";
import {
	SetupTimeline,
	SetupTimelineStep,
} from "@openmeld/ui/components/setup-timeline";
import { CheckCircleIcon, CircleNotchIcon } from "@phosphor-icons/react";
import type { UseQueryResult } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import { useBringAgentsSetupContext } from "#/components/connect/bring-agents-setup-context";
import {
	buildPrepareSessionKey,
	clearCompletedPrepareSessionPointer,
	clearPrepareSessionPointer,
	type PrepareSessionPointer,
	pointerMatchesPrepareSessionInput,
	readCompletedPrepareSessionPointer,
	readPrepareSessionPointer,
	writeCompletedPrepareSessionPointer,
	writePrepareSessionPointer,
} from "#/components/connect/prepare-session-pointer";
import {
	formatServiceUpdateVerificationFailureDetail,
	formatServiceUpdateVerificationSuccessDetail,
	isServiceUpdateStillRequired,
	resolveServiceUpdateVerificationState,
	SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE,
	type ServiceUpdateVerificationState,
} from "#/components/connect/service-update-verification";
import {
	BringAgentsSetupErrorContent,
	StartBringAgentsErrorState,
} from "#/components/connect/start-bring-agents-error-state";
import { StartChoicePage } from "#/components/connect/start-choice-page";
import { StartSetupCommandCard } from "#/components/connect/start-setup-command-card";
import { DesktopComputerConnection } from "#/desktop/computer-connection";
import { getDesktopPlatform } from "#/desktop/platform";
import {
	buildWebSetupCommand,
	copyCliEntryCommand,
	resolveBrowserSetupCommandPlatform,
	type WebSetupCommandPlatform,
} from "#/lib/cli-entry-command";
import { resolveComputerAuthorizationHandoffExpiresAt } from "#/lib/computer-authorization-expiry";
import {
	buildConnectRouteSearch,
	type ConnectRouteSearch,
	resolveConnectBackTarget,
	resolveConnectCompletionTarget,
} from "#/lib/connect/connect-route";
import { LOCAL_AGENTS_GUIDE_PATH } from "#/lib/local-agent-install-guides";
import { buildOrganizationComputerPath } from "#/lib/organizations/organization-routes";
import { createComputerAuthorizationGrant } from "#/query/auth-query";
import {
	createPrepareSession,
	mintPrepareSessionToken,
	readPrepareSession,
} from "#/query/connect/prepare-session";
import {
	CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_INTERVAL_MS,
	SERVICE_UPDATE_VERIFICATION_TIMEOUT_MS,
} from "#/strategy-constants";
import { ComputerSetupConversationShell } from "./computer-setup-conversation-shell";
import {
	isLocalMachinePrepareBlocker,
	resolvePrepareBlockerFollowUp,
} from "./prepare-blocker-presentation";
import { resolvePrepareTimelineStepDisplayState } from "./prepare-timeline-display-state";

type PrepareSessionPageState =
	| {
			error: StructuredApiClientFailure | Error | null;
			opaqueToken: string | null;
			opaqueTokenExpiresAt: string | null;
			snapshot: PrepareSessionSnapshot | null;
			snapshotSessionKey: string | null;
			status: "idle" | "loading" | "ready";
	  }
	| {
			error: StructuredApiClientFailure | Error;
			opaqueToken: string | null;
			opaqueTokenExpiresAt: string | null;
			snapshot: PrepareSessionSnapshot | null;
			snapshotSessionKey: string | null;
			status: "error";
	  };

type PrepareWebSocketStatus = "idle" | "connecting" | "connected" | "closed";

type PrepareTimelineUserStepId =
	| "connect_terminal"
	| "prepare_computer"
	| "ready";

type PrepareTimelineUserStep = {
	blockerStepIds: readonly PrepareStepSnapshot["id"][];
	id: PrepareTimelineUserStepId;
	internalStep: PrepareStepSnapshot;
	state: PrepareStepState;
	summary: string;
	title: string;
};

const PREPARE_COMPUTER_INTERNAL_STEP_IDS = [
	"prepare_selected_agents",
	"refresh_service",
	"report_runtime",
	"verify_setup",
] as const satisfies readonly PrepareStepSnapshot["id"][];

const prepareSessionLoadRequests = new Map<
	string,
	Promise<PrepareSessionLoadResult>
>();

export type StartBringAgentsSetupPageProps = {
	autoReturnOnCompletion?: boolean;
	orgSlug?: string;
	selfRoute?: string;
	selfRouteSearch?: ConnectRouteSearch;
	showBackControl?: boolean;
};

type ComputerSetupFlowProps = StartBringAgentsSetupPageProps & {
	onContinue?: () => void;
	onCompleted?: (
		snapshot: Pick<PrepareSessionSnapshot, "deviceId" | "runtimeLane">
	) => void;
	onNavigationActionAlreadyStarted?: () => void;
	preferExistingConnection?: boolean;
	presentation: "conversation" | "embedded" | "page";
	sourceNavigationAction?: NonNullable<
		CreatePrepareSessionRequest["sourceNavigationAction"]
	>;
};

export function StartBringAgentsSetupPage(
	input: StartBringAgentsSetupPageProps = {}
) {
	return <ComputerSetupFlow {...input} presentation="page" />;
}

export function ComputerSetupFlow(input: ComputerSetupFlowProps) {
	const bringAgentsSetup = useBringAgentsSetupContext();
	if (getDesktopPlatform()) {
		return (
			<DesktopComputerConnection
				onCompleted={input.onCompleted}
				onContinue={input.onContinue}
			/>
		);
	}
	if (input.presentation === "conversation") {
		return (
			<ConversationComputerConnectionGate
				input={input}
				setup={bringAgentsSetup}
			/>
		);
	}
	if (input.preferExistingConnection) {
		return (
			<ExistingComputerConnectionGate
				bringAgentsSetup={bringAgentsSetup}
				input={input}
			/>
		);
	}
	return <ComputerSetupSessionFlow {...input} />;
}

function ConversationComputerConnectionGate({
	setup,
	input,
}: {
	setup: ReturnType<typeof useBringAgentsSetupContext>;
	input: ComputerSetupFlowProps;
}) {
	const [connectRequested, setConnectRequested] = useState(false);
	const query = setup.localRuntimesQuery;
	// A named account computer is not proof of the browser's physical identity.
	const hasConnectedComputer = query.data?.peopleComputers.computers.some(
		(computer) => computer.connection.status === "connected"
	);
	if (
		connectRequested ||
		setup.routeIntent.serviceAction === "update_service" ||
		setup.routeIntent.resetThisComputer ||
		setup.routeIntent.connectedComputerId !== undefined ||
		(setup.routeIntent.kind === "space_recovery" &&
			setup.routeIntent.agentProfileIds.length > 0)
	) {
		return <ComputerSetupSessionFlow {...input} />;
	}
	if (query.isPending) {
		return (
			<p className="text-muted-foreground text-sm">
				Checking connected computers…
			</p>
		);
	}
	if (!query.isError && hasConnectedComputer && input.orgSlug) {
		return (
			<div className="grid gap-3 rounded-lg border bg-background p-4 pr-12">
				<ConnectedComputersSummary orgSlug={input.orgSlug} setup={setup} />
				<Button
					className="justify-self-start"
					onClick={() => setConnectRequested(true)}
					size="sm"
					variant="outline"
				>
					Connect a computer
				</Button>
			</div>
		);
	}
	return <ComputerSetupSessionFlow {...input} />;
}

function ExistingComputerConnectionGate(input: {
	bringAgentsSetup: ReturnType<typeof useBringAgentsSetupContext>;
	input: ComputerSetupFlowProps;
}) {
	const [setupRequested, setSetupRequested] = useState(false);
	const readinessQuery =
		input.bringAgentsSetup.currentLocalRuntimeReplyReadinessQuery;
	const connectionState = resolveExistingComputerConnectionState(
		input.bringAgentsSetup
	);

	// This gate only chooses whether setup is needed. Once started, the session
	// owns completion; inventory refreshes must not unmount its Terminal handoff.
	if (!setupRequested && connectionState.kind === "setup_required") {
		setSetupRequested(true);
	}
	if (setupRequested) {
		return <ComputerSetupSessionFlow {...input.input} />;
	}
	if (
		connectionState.kind === "checking_inventory" ||
		connectionState.kind === "checking_readiness"
	) {
		return (
			<Card
				aria-busy="true"
				className="flex-row items-center gap-3 rounded-md p-4"
			>
				<CircleNotchIcon
					aria-hidden="true"
					className="size-4 shrink-0 animate-spin text-muted-foreground"
				/>
				<div>
					<p className="font-medium text-sm">Checking this computer…</p>
					<p className="mt-1 text-muted-foreground text-xs">
						OpenMeld is confirming the current Service connection.
					</p>
				</div>
			</Card>
		);
	}
	if (
		connectionState.kind === "inventory_error" ||
		connectionState.kind === "readiness_error"
	) {
		const retry =
			connectionState.kind === "inventory_error"
				? input.bringAgentsSetup.refreshAll
				: readinessQuery.refetch;
		return (
			<Card className="gap-4 rounded-md p-4">
				<div>
					<p className="font-medium text-sm">
						OpenMeld could not check this computer
					</p>
					<p className="mt-1 text-muted-foreground text-xs leading-5">
						Retry the check before starting another Terminal setup.
					</p>
				</div>
				<div className="flex flex-wrap gap-2">
					<Button
						onClick={() => {
							retry().catch((error: unknown) => {
								console.error(
									"OpenMeld could not retry the current computer check.",
									{ error }
								);
							});
						}}
						size="sm"
						type="button"
						variant="outline"
					>
						Retry
					</Button>
					<Button
						onClick={() => setSetupRequested(true)}
						size="sm"
						type="button"
						variant="ghost"
					>
						Set up again
					</Button>
				</div>
			</Card>
		);
	}
	if (connectionState.kind === "connected") {
		return (
			<Card className="flex-row items-start gap-3 rounded-md p-4">
				<CheckCircleIcon
					aria-hidden="true"
					className="mt-0.5 size-4 shrink-0 text-emerald-500"
					weight="fill"
				/>
				<div className="min-w-0 flex-1">
					<p className="font-medium text-sm">Computer connected</p>
					<p className="mt-1 truncate text-muted-foreground text-xs">
						{connectionState.readiness.runtime.deviceDisplayName ??
							"Connected computer"}
					</p>
					<p className="mt-2 text-muted-foreground text-xs leading-5">
						OpenMeld Service is connected. Agent availability is checked
						separately.
					</p>
				</div>
				<Button
					onClick={() => setSetupRequested(true)}
					size="sm"
					type="button"
					variant="ghost"
				>
					Set up again
				</Button>
			</Card>
		);
	}
	return <ComputerSetupSessionFlow {...input.input} />;
}

type ExistingComputerConnectionState =
	| {
			kind:
				| "checking_inventory"
				| "checking_readiness"
				| "inventory_error"
				| "readiness_error"
				| "setup_required";
	  }
	| {
			kind: "connected";
			readiness: CurrentLocalRuntimeReplyReadinessResponse;
	  };

function resolveExistingComputerConnectionState(
	setup: ReturnType<typeof useBringAgentsSetupContext>
): ExistingComputerConnectionState {
	const currentDeviceTargetQuery = setup.currentDeviceTargetQuery;
	const localRuntimesQuery = setup.localRuntimesQuery;
	const readinessQuery = setup.currentLocalRuntimeReplyReadinessQuery;
	const hasComputer = setup.deviceId !== null && setup.runtimeLane !== null;
	const inventoryResolved =
		currentDeviceTargetQuery.isSuccess &&
		!currentDeviceTargetQuery.isFetching &&
		localRuntimesQuery.isSuccess &&
		!localRuntimesQuery.isFetching;

	if (currentDeviceTargetQuery.isError || localRuntimesQuery.isError) {
		return { kind: "inventory_error" };
	}
	if (!inventoryResolved) {
		return { kind: "checking_inventory" };
	}
	if (!hasComputer) {
		return { kind: "setup_required" };
	}

	if (readinessQuery.isError) {
		return { kind: "readiness_error" };
	}
	// Inventory proves this query is enabled, so pending now means its first
	// readiness result is genuinely unresolved rather than disabled and idle.
	if (readinessQuery.isPending || readinessQuery.isFetching) {
		return { kind: "checking_readiness" };
	}
	if (readinessQuery.data?.service.connected === true) {
		return { kind: "connected", readiness: readinessQuery.data };
	}
	return { kind: "setup_required" };
}

function ComputerSetupSessionFlow(input: ComputerSetupFlowProps) {
	const deliveredCompletionRef = useRef<string | null>(null);
	const bringAgentsSetup = useBringAgentsSetupContext();
	const navigate = useNavigate();
	const [inlineFreshSessionConsumed, setInlineFreshSessionConsumed] =
		useState(false);
	const selfRoute = input.selfRoute ?? "/login";
	const backTo = resolveConnectBackTarget(
		bringAgentsSetup.routeIntent,
		input.orgSlug
	);
	const pageBackTo = input.showBackControl === false ? undefined : backTo;
	const completionTarget = resolveConnectCompletionTarget(
		bringAgentsSetup.routeIntent,
		input.orgSlug
	);
	const mode: SetupFlowMode =
		"serviceAction" in bringAgentsSetup.routeIntent &&
		bringAgentsSetup.routeIntent.serviceAction === "update_service"
			? "update_service"
			: "setup";
	const setupCopy = getSetupFlowCopy(mode);
	const shouldForceFreshSession =
		(bringAgentsSetup.routeIntent.resetThisComputer ||
			input.sourceNavigationAction !== undefined) &&
		(input.presentation === "page" || !inlineFreshSessionConsumed);
	const consumeFreshSessionRouteIntent = useCallback(() => {
		if (!shouldForceFreshSession) {
			return;
		}
		if (input.presentation !== "page") {
			setInlineFreshSessionConsumed(true);
			return;
		}
		const consumedRouteIntent = {
			...bringAgentsSetup.routeIntent,
			resetThisComputer: false,
		};
		navigate({
			// Standalone hosts pass an explicit search so reset consumption does
			// not leave session/reset in the public URL.
			search:
				input.selfRouteSearch ?? buildConnectRouteSearch(consumedRouteIntent),
			to: selfRoute,
			replace: true,
		}).catch((error: unknown) => {
			console.error("Failed to consume the setup reset route intent.", error);
		});
	}, [
		bringAgentsSetup.routeIntent,
		input.selfRouteSearch,
		input.presentation,
		navigate,
		selfRoute,
		shouldForceFreshSession,
	]);
	const prepareSession = usePrepareSession({
		connectedComputerId:
			bringAgentsSetup.routeIntent.connectedComputerId ?? null,
		deviceId: bringAgentsSetup.deviceId,
		forceFreshSession: shouldForceFreshSession,
		humanProfileId: bringAgentsSetup.selectedHumanProfileId,
		loadGatewayUrl: bringAgentsSetup.loadGatewayUrl,
		onFreshSessionLoaded: consumeFreshSessionRouteIntent,
		onNavigationActionAlreadyStarted: input.onNavigationActionAlreadyStarted,
		preferCompletedSession:
			bringAgentsSetup.routeIntent.kind === "account_computer_setup",
		runtimeLane: bringAgentsSetup.runtimeLane,
		sourceNavigationAction: input.sourceNavigationAction,
		targetSpaceId: bringAgentsSetup.targetSpaceId,
	});
	const currentPrepareSessionSnapshot = resolveCurrentPrepareSessionSnapshot({
		connectedComputerId:
			bringAgentsSetup.routeIntent.connectedComputerId ?? null,
		deviceId: bringAgentsSetup.deviceId,
		humanProfileId: bringAgentsSetup.selectedHumanProfileId,
		runtimeLane: bringAgentsSetup.runtimeLane,
		sessionKey: prepareSession.sessionKey,
		snapshot: prepareSession.snapshot,
		snapshotSessionKey: prepareSession.snapshotSessionKey,
		targetSpaceId: bringAgentsSetup.targetSpaceId,
	});
	const completionReadinessRefresh = useRefreshReadinessAfterPrepareCompletion({
		refreshAll: bringAgentsSetup.refreshAll,
		snapshot: prepareSession.snapshot,
	});
	const serviceUpdateVerification = useServiceUpdateVerification({
		currentLocalRuntimeReplyReadinessQuery:
			bringAgentsSetup.currentLocalRuntimeReplyReadinessQuery,
		mode,
		snapshot: currentPrepareSessionSnapshot,
	});
	useEffect(() => {
		if (input.autoReturnOnCompletion === false && !input.onCompleted) {
			return;
		}
		if (bringAgentsSetup.routeIntent.kind !== "account_computer_setup") {
			return;
		}
		if (
			currentPrepareSessionSnapshot?.lifecycleStatus !== "completed" ||
			currentPrepareSessionSnapshot.phase !== "ready"
		) {
			return;
		}
		if (completionReadinessRefresh.status !== "ready") {
			return;
		}
		// A stale release channel can leave the local-components projection
		// reporting update_required after the terminal session itself is done.
		// Auto-return must wait for that projection to confirm the new version
		// (or hold on the page's explicit failure card) instead of bouncing the
		// user back to Computers on a false "Update complete".
		if (
			serviceUpdateVerification.status === "confirming" ||
			serviceUpdateVerification.status === "timed_out"
		) {
			return;
		}

		if (input.onCompleted) {
			if (
				deliveredCompletionRef.current !==
				currentPrepareSessionSnapshot.prepareSessionId
			) {
				deliveredCompletionRef.current =
					currentPrepareSessionSnapshot.prepareSessionId;
				input.onCompleted(currentPrepareSessionSnapshot);
			}
			return;
		}
		navigate({ to: completionTarget, replace: true }).catch(
			(error: unknown) => {
				console.error("Failed to return to Computers after setup.", error);
			}
		);
	}, [
		bringAgentsSetup.routeIntent.kind,
		completionReadinessRefresh.status,
		completionTarget,
		currentPrepareSessionSnapshot?.lifecycleStatus,
		currentPrepareSessionSnapshot?.phase,
		input.autoReturnOnCompletion,
		input.onCompleted,
		currentPrepareSessionSnapshot,
		navigate,
		serviceUpdateVerification.status,
	]);
	if (bringAgentsSetup.sessionExpiredState) {
		return (
			<ComputerSetupError
				backTo={pageBackTo}
				message={bringAgentsSetup.sessionExpiredState.message}
				onRetry={bringAgentsSetup.refreshAll}
				presentation={input.presentation}
				sessionExpiredState={bringAgentsSetup.sessionExpiredState}
				setupCopy={setupCopy}
			/>
		);
	}

	if (prepareSession.status === "error" && prepareSession.error) {
		return (
			<ComputerSetupError
				backTo={pageBackTo}
				message={prepareSession.error.message}
				onRetry={prepareSession.refresh}
				presentation={input.presentation}
				sessionExpiredState={bringAgentsSetup.sessionExpiredState}
				setupCopy={setupCopy}
			/>
		);
	}

	const snapshot = currentPrepareSessionSnapshot;
	const setupContent = (
		<div
			className="grid w-full max-w-4xl gap-6"
			data-testid="prepare-computer-card"
		>
			<ConnectedComputersSummary
				orgSlug={input.orgSlug}
				setup={bringAgentsSetup}
			/>
			{snapshot ? (
				<PrepareSessionTimeline
					command={prepareSession.command}
					commandPlatform={prepareSession.commandPlatform}
					completionTarget={completionTarget}
					copyCommand={prepareSession.copyCommand}
					copyStatus={prepareSession.copyStatus}
					isRefreshingCommand={prepareSession.isRefreshingCommand}
					onContinue={input.onContinue}
					onStartOver={prepareSession.startOver}
					opaqueTokenExpiresAt={prepareSession.commandExpiresAt}
					presentation={input.presentation}
					readinessRefresh={completionReadinessRefresh}
					refreshCommand={prepareSession.refreshCommand}
					serviceUpdateVerification={serviceUpdateVerification}
					setCommandPlatform={prepareSession.setCommandPlatform}
					setup={bringAgentsSetup}
					setupCopy={setupCopy}
					snapshot={snapshot}
					webSocketStatus={prepareSession.webSocketStatus}
				/>
			) : (
				<PrepareLoadingState />
			)}
			{bringAgentsSetup.blockingErrorMessage ? (
				<p className="text-muted-foreground text-sm">
					Could not check existing computers. You can still connect a computer
					using this command.
				</p>
			) : null}
			{prepareSession.error ? (
				<p className="text-destructive text-sm">
					{prepareSession.error.message}
				</p>
			) : null}
			<p className="text-muted-foreground text-sm">
				No agent CLIs installed yet?{" "}
				<Link
					className="font-medium text-foreground"
					to={LOCAL_AGENTS_GUIDE_PATH}
				>
					See the install guide
				</Link>
				.
			</p>
		</div>
	);

	if (input.presentation === "embedded") {
		return setupContent;
	}

	if (input.presentation === "conversation") {
		return (
			<ComputerSetupConversationShell
				description={setupCopy.pageDescription}
				title={setupCopy.pageTitle}
			>
				{setupContent}
			</ComputerSetupConversationShell>
		);
	}

	return (
		<StartChoicePage
			backTo={pageBackTo}
			description={setupCopy.pageDescription}
			title={setupCopy.pageTitle}
		>
			<div className="md:col-span-2">{setupContent}</div>
		</StartChoicePage>
	);
}

function ConnectedComputersSummary(input: {
	setup: ReturnType<typeof useBringAgentsSetupContext>;
	orgSlug?: string;
}) {
	const query = input.setup.localRuntimesQuery;
	const orgSlug = input.orgSlug;
	if (!orgSlug || query.isError) {
		return null;
	}
	const computers =
		query.data?.peopleComputers.computers.filter(
			(computer) => computer.connection.status === "connected"
		) ?? [];
	if (computers.length === 0) {
		return null;
	}
	return (
		<div className="grid divide-y rounded-md border text-sm">
			{computers.map((computer) => (
				<div
					className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
					key={computer.deviceId}
				>
					<p>
						<span className="font-medium">{computer.deviceDisplayName}</span>
						<span className="text-muted-foreground"> is connected</span>
					</p>
					<Link
						className="font-medium underline-offset-4 hover:underline"
						to={buildOrganizationComputerPath({
							deviceId: computer.deviceId,
							orgSlug,
						})}
					>
						Manage computer
					</Link>
				</div>
			))}
		</div>
	);
}

function ComputerSetupError(input: {
	backTo?: string;
	message: string;
	onRetry: () => Promise<unknown>;
	presentation: ComputerSetupFlowProps["presentation"];
	sessionExpiredState: ReturnType<
		typeof useBringAgentsSetupContext
	>["sessionExpiredState"];
	setupCopy: SetupFlowCopy;
}) {
	const retry = async () => {
		await input.onRetry();
	};
	if (input.presentation === "embedded") {
		return input.sessionExpiredState ? (
			<BringAgentsSetupErrorContent
				message={input.message}
				onRetry={retry}
				sessionExpiredState={input.sessionExpiredState}
			/>
		) : (
			<EmbeddedSetupError message={input.message} onRetry={retry} />
		);
	}
	if (input.presentation === "conversation") {
		return (
			<ComputerSetupConversationShell
				description={input.setupCopy.pageDescription}
				title={input.setupCopy.pageTitle}
			>
				<BringAgentsSetupErrorContent
					message={input.message}
					onRetry={retry}
					sessionExpiredState={input.sessionExpiredState}
				/>
			</ComputerSetupConversationShell>
		);
	}
	return (
		<StartBringAgentsErrorState
			backTo={input.backTo}
			message={input.message}
			onRetry={retry}
			sessionExpiredState={input.sessionExpiredState}
			title="Connect this computer"
		/>
	);
}

function EmbeddedSetupError(input: {
	message: string;
	onRetry: () => Promise<unknown>;
}) {
	return (
		<div className="rounded-md border border-destructive/25 bg-destructive/5 p-4">
			<p className="font-medium text-destructive text-sm">
				OpenMeld could not prepare this computer
			</p>
			<p className="mt-1 text-muted-foreground text-sm leading-6">
				{input.message}
			</p>
			<Button
				className="mt-4"
				onClick={() => {
					input.onRetry().catch((error: unknown) => {
						console.error("OpenMeld could not retry computer setup.", {
							error,
						});
					});
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				Try again
			</Button>
		</div>
	);
}

function PrepareSessionTimeline(input: {
	onContinue?: () => void;
	command: string | null;
	commandPlatform: WebSetupCommandPlatform;
	completionTarget: string;
	copyCommand: () => Promise<void>;
	copyStatus: "copied" | "idle" | "manual";
	isRefreshingCommand: boolean;
	onStartOver: () => Promise<void>;
	opaqueTokenExpiresAt: string | null;
	presentation: ComputerSetupFlowProps["presentation"];
	readinessRefresh: PrepareCompletionReadinessRefreshState;
	refreshCommand: () => Promise<void>;
	serviceUpdateVerification: ServiceUpdateVerificationState;
	setCommandPlatform: (platform: WebSetupCommandPlatform) => void;
	setup: ReturnType<typeof useBringAgentsSetupContext>;
	setupCopy: SetupFlowCopy;
	snapshot: PrepareSessionSnapshot;
	webSocketStatus: PrepareWebSocketStatus;
}) {
	const nowMs = useNowMs(
		1000,
		input.snapshot.lifecycleStatus === "active" &&
			input.snapshot.terminalConnection.status !== "connected"
	);
	const completionReadiness = resolvePrepareCompletionReadiness({
		agentExecutionReadinessByProfileId:
			input.setup.agentExecutionReadinessByProfileId,
		agentExecutionReadinessErrorByProfileId:
			input.setup.agentExecutionReadinessErrorByProfileId,
		agentExecutionReadinessPendingProfileIds:
			input.setup.agentExecutionReadinessPendingProfileIds,
		agentProfilesIsPending: input.setup.agentProfilesQuery.isPending,
		expectedAgentProfileIds: resolvePrepareCompletionExpectedAgentProfileIds({
			agentExecutionReadinessByProfileId:
				input.setup.agentExecutionReadinessByProfileId,
			agentProfiles: input.setup.agentProfiles,
			routeIntent: input.setup.routeIntent,
			snapshot: input.snapshot,
		}),
		readinessRefresh: input.readinessRefresh,
		snapshot: input.snapshot,
	});
	const userSteps = projectPrepareTimelineUserSteps({
		completionReadiness,
		nowMs,
		serviceUpdateVerification: input.serviceUpdateVerification,
		setupCopy: input.setupCopy,
		snapshot: input.snapshot,
	});
	const handoffBlockers = input.snapshot.blockers.filter(
		isHandoffStoppedBlocker
	);
	if (handoffBlockers.length > 0) {
		const canceled = handoffBlockers.some(
			(blocker) => blocker.reasonCode === "prepare.account_switch_cancelled"
		);
		return (
			<SetupTimeline>
				<SetupTimelineStep
					state="pending"
					summary=""
					title={
						canceled ? "Account switch canceled" : "Setup needs a new command"
					}
				>
					<PrepareBlockers
						blockers={handoffBlockers}
						onStartOver={input.onStartOver}
					/>
				</SetupTimelineStep>
			</SetupTimeline>
		);
	}

	return (
		<SetupTimeline>
			{userSteps.map((step) => (
				<SetupTimelineStep
					key={step.id}
					state={step.state}
					summary={step.summary}
					title={step.title}
				>
					{isCurrentPrepareUserStep(step) &&
					step.id === "connect_terminal" &&
					shouldShowConnectTerminalCard(step.internalStep, input.snapshot) ? (
						<ConnectTerminalCard
							command={input.command}
							commandPlatform={input.commandPlatform}
							copyCommand={input.copyCommand}
							copyStatus={input.copyStatus}
							isRefreshingCommand={input.isRefreshingCommand}
							nowMs={nowMs}
							opaqueTokenExpiresAt={input.opaqueTokenExpiresAt}
							refreshCommand={input.refreshCommand}
							setCommandPlatform={input.setCommandPlatform}
							setupCopy={input.setupCopy}
							snapshot={input.snapshot}
							webSocketStatus={input.webSocketStatus}
						/>
					) : null}
					{isCurrentPrepareUserStep(step) ? (
						<PrepareBlockers
							blockers={input.snapshot.blockers.filter((blocker) =>
								step.blockerStepIds.includes(blocker.stepId)
							)}
							onStartOver={input.onStartOver}
						/>
					) : null}
					{step.id === "ready" && step.internalStep.state === "complete" ? (
						<>
							<ServiceUpdateVerificationNotice
								verification={input.serviceUpdateVerification}
							/>
							{input.presentation !== "embedded" || input.onContinue ? (
								<PrepareReadyActions
									completionReadiness={completionReadiness}
									completionTarget={input.completionTarget}
									completionVerified={step.state === "complete"}
									onContinue={input.onContinue}
									onStartOver={input.onStartOver}
									presentation={input.presentation}
									routeIntent={input.setup.routeIntent}
									setupCopy={input.setupCopy}
								/>
							) : null}
						</>
					) : null}
				</SetupTimelineStep>
			))}
		</SetupTimeline>
	);
}

function ServiceUpdateVerificationNotice(input: {
	verification: ServiceUpdateVerificationState;
}) {
	if (input.verification.status === "timed_out") {
		return (
			<div className="grid gap-2 border border-destructive/20 p-4">
				<p className="font-medium text-destructive text-sm">
					{SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE}
				</p>
				<p className="text-muted-foreground text-sm">
					{formatServiceUpdateVerificationFailureDetail(input.verification)}
				</p>
			</div>
		);
	}

	if (input.verification.status === "confirmed") {
		const successDetail = formatServiceUpdateVerificationSuccessDetail(
			input.verification
		);
		return successDetail ? (
			<p className="text-muted-foreground text-sm">{successDetail}</p>
		) : null;
	}

	return null;
}

function PrepareReadyActions(input: {
	onContinue?: () => void;
	completionReadiness: PrepareCompletionReadinessState;
	completionTarget: string;
	completionVerified: boolean;
	onStartOver: () => Promise<void>;
	presentation: ComputerSetupFlowProps["presentation"];
	routeIntent: ReturnType<typeof useBringAgentsSetupContext>["routeIntent"];
	setupCopy: SetupFlowCopy;
}) {
	const continueLabel = resolveReadyPrimaryActionLabel(input.routeIntent);
	const description = resolveReadyActionDescription({
		completionReadiness: input.completionReadiness,
		presentation: input.presentation,
		routeIntent: input.routeIntent,
		setupCopy: input.setupCopy,
	});
	return (
		<div className="grid gap-3 py-3">
			<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				{input.completionVerified ? (
					<p className="min-w-0 text-muted-foreground text-sm">{description}</p>
				) : null}
				<div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
					<Button
						onClick={() => {
							input.onStartOver().catch(() => {
								// The hook stores the error state for this setup.
							});
						}}
						type="button"
						variant="outline"
					>
						Set up again
					</Button>
					{input.completionVerified && input.onContinue ? (
						<Button onClick={input.onContinue}>{continueLabel}</Button>
					) : null}
					{input.completionVerified &&
					!input.onContinue &&
					input.presentation === "page" ? (
						<Link className={buttonVariants()} to={input.completionTarget}>
							{continueLabel}
						</Link>
					) : null}
				</div>
			</div>
		</div>
	);
}

function resolveReadyPrimaryActionLabel(
	routeIntent: ReturnType<typeof useBringAgentsSetupContext>["routeIntent"]
) {
	if (routeIntent.kind === "account_computer_setup") {
		return routeIntent.returnTo === "agent_creation"
			? "Continue creating Agent"
			: "Back to Computers";
	}
	if (routeIntent.kind === "space_recovery") {
		return "Back to Space";
	}
	return "Continue";
}

function resolveReadyActionDescription(input: {
	completionReadiness: PrepareCompletionReadinessState;
	presentation: ComputerSetupFlowProps["presentation"];
	routeIntent: ReturnType<typeof useBringAgentsSetupContext>["routeIntent"];
	setupCopy: SetupFlowCopy;
}) {
	if (input.completionReadiness.kind === "checking") {
		return input.setupCopy.readyRefreshPendingActionSummary;
	}
	if (input.completionReadiness.kind === "needs_attention") {
		return input.setupCopy.readyDefaultActionSummary;
	}
	if (input.completionReadiness.kind === "error") {
		return input.setupCopy.readyDefaultActionSummary;
	}
	if (
		input.routeIntent.kind === "account_computer_setup" &&
		input.routeIntent.returnTo === "agent_creation"
	) {
		return "Return to Agent creation to choose a local agent and finish your profile.";
	}
	if (input.completionReadiness.kind === "no_selected_local_agents") {
		return input.presentation === "conversation"
			? `${input.setupCopy.readyNoSelectedLocalAgentsSummary} Center Agent can continue here.`
			: input.setupCopy.readyNoSelectedLocalAgentsActionSummary;
	}
	if (input.presentation === "conversation") {
		return `${input.setupCopy.readyCompleteSummary} Center Agent can continue here.`;
	}
	if (input.routeIntent.kind === "account_computer_setup") {
		return input.setupCopy.readyAccountComputerActionSummary;
	}
	if (input.routeIntent.kind === "space_recovery") {
		return input.setupCopy.readySpaceRecoveryActionSummary;
	}
	return input.setupCopy.readyDefaultActionSummary;
}

function ConnectTerminalCard(input: {
	command: string | null;
	commandPlatform: WebSetupCommandPlatform;
	copyCommand: () => Promise<void>;
	copyStatus: "copied" | "idle" | "manual";
	isRefreshingCommand: boolean;
	nowMs: number;
	opaqueTokenExpiresAt: string | null;
	refreshCommand: () => Promise<void>;
	setCommandPlatform: (platform: WebSetupCommandPlatform) => void;
	setupCopy: SetupFlowCopy;
	snapshot: PrepareSessionSnapshot;
	webSocketStatus: PrepareWebSocketStatus;
}) {
	const commandExpiry = resolvePrepareCommandExpiry({
		nowMs: input.nowMs,
		opaqueTokenExpiresAt: input.opaqueTokenExpiresAt,
	});
	const commandTokenMissing =
		input.command === null && input.opaqueTokenExpiresAt === null;
	const commandNeedsRefresh = commandExpiry.isExpired || commandTokenMissing;
	const expiresInLabel = commandNeedsRefresh
		? input.setupCopy.expiredCommandLabel
		: commandExpiry.label;

	return (
		<StartSetupCommandCard
			command={input.command}
			commandPlaceholder={
				commandNeedsRefresh
					? input.setupCopy.expiredCommandPlaceholder
					: input.setupCopy.commandPlaceholder
			}
			commandPlatform={input.commandPlatform}
			copyLabel={input.setupCopy.copyCommandLabel}
			copyStatus={input.copyStatus}
			expiresInLabel={expiresInLabel}
			expiresInState={commandNeedsRefresh ? "expired" : "normal"}
			isLoading={input.command === null && !commandNeedsRefresh}
			isRefreshingExpiredCommand={input.isRefreshingCommand}
			onCommandPlatformChange={input.setCommandPlatform}
			onCopyCommand={input.copyCommand}
			onRefreshExpiredCommand={
				commandNeedsRefresh ? input.refreshCommand : undefined
			}
			secondaryStatusText={resolveTerminalSecondaryStatus({
				snapshot: input.snapshot,
				webSocketStatus: input.webSocketStatus,
			})}
			statusText={resolveTerminalStatusText({
				nowMs: input.nowMs,
				setupCopy: input.setupCopy,
				snapshot: input.snapshot,
				webSocketStatus: input.webSocketStatus,
			})}
			statusTextIsShimmering={
				input.snapshot.terminalConnection.status !== "connected"
			}
		/>
	);
}

function projectPrepareTimelineUserSteps(input: {
	completionReadiness: PrepareCompletionReadinessState;
	nowMs: number;
	serviceUpdateVerification: ServiceUpdateVerificationState;
	setupCopy: SetupFlowCopy;
	snapshot: PrepareSessionSnapshot;
}): PrepareTimelineUserStep[] {
	const activeStepId =
		resolveActiveStepId(input.snapshot) ?? resolveReadyStepId(input.snapshot);
	const connectStep = requirePrepareStep(input.snapshot, "connect_terminal");
	const terminalReconnectGraceActive = isPrepareTerminalReconnectGraceActive({
		nowMs: input.nowMs,
		snapshot: input.snapshot,
	});
	const readyStep = requirePrepareStep(input.snapshot, "ready");
	const prepareStep = projectPrepareComputerStep({
		activeStepId,
		setupCopy: input.setupCopy,
		snapshot: input.snapshot,
	});

	const steps: PrepareTimelineUserStep[] = [
		{
			blockerStepIds: ["connect_terminal"],
			id: "connect_terminal",
			internalStep: connectStep,
			state: terminalReconnectGraceActive
				? "active"
				: resolvePrepareTimelineStepDisplayState({
						activeStepId,
						step: connectStep,
						snapshot: input.snapshot,
					}),
			summary: resolveTerminalStepSummary({
				nowMs: input.nowMs,
				setupCopy: input.setupCopy,
				snapshot: input.snapshot,
			}),
			title: "Connect Terminal",
		},
	];

	steps.push(prepareStep);
	const readyDisplayState = resolveReadyStepDisplayState({
		baseState: resolvePrepareTimelineStepDisplayState({
			activeStepId,
			step: readyStep,
			snapshot: input.snapshot,
		}),
		serviceUpdateVerification: input.serviceUpdateVerification,
	});
	const readyBaseSummary =
		resolvePrepareCompletionReadyStepSummary({
			completionReadiness: input.completionReadiness,
			setupCopy: input.setupCopy,
		}) ??
		resolvePrepareReadyStepFallbackSummary({
			readyStep,
			setupCopy: input.setupCopy,
			snapshot: input.snapshot,
		});
	steps.push({
		blockerStepIds: ["ready"],
		id: "ready",
		internalStep: readyStep,
		state: readyDisplayState,
		summary: resolveReadyStepDisplaySummary({
			baseSummary: readyBaseSummary,
			serviceUpdateVerification: input.serviceUpdateVerification,
		}),
		title: input.setupCopy.readyTitle,
	});

	return steps;
}

// update_service completion must not show the green "complete" checkmark
// merely because the terminal session finished; it must also wait for the
// local-components projection to confirm the required OpenMeld Service/CLI
// version landed. "active"/"blocked" are existing PrepareStepState values
// (spinner / warning icon) reused here on purpose so this stays a display
// override, not a new step-state contract.
function resolveReadyStepDisplayState(input: {
	baseState: PrepareStepState;
	serviceUpdateVerification: ServiceUpdateVerificationState;
}): PrepareStepState {
	if (input.serviceUpdateVerification.status === "confirming") {
		return "active";
	}
	if (input.serviceUpdateVerification.status === "timed_out") {
		return "blocked";
	}
	return input.baseState;
}

function resolveReadyStepDisplaySummary(input: {
	baseSummary: string;
	serviceUpdateVerification: ServiceUpdateVerificationState;
}): string {
	if (input.serviceUpdateVerification.status === "confirming") {
		return "Confirming the update reached the required version on this computer...";
	}
	if (input.serviceUpdateVerification.status === "timed_out") {
		// Kept distinct from SERVICE_UPDATE_VERIFICATION_FAILURE_TITLE, which
		// this same "ready" step already renders as the notice block's
		// headline below -- the row summary only needs to flag that something
		// needs attention, not repeat the full headline verbatim.
		return "The update did not finish. See the details below.";
	}
	return input.baseSummary;
}

function resolvePrepareReadyStepFallbackSummary(input: {
	readyStep: PrepareStepSnapshot;
	setupCopy: SetupFlowCopy;
	snapshot: PrepareSessionSnapshot;
}): string {
	if (
		input.readyStep.state === "complete" ||
		input.snapshot.lifecycleStatus === "completed" ||
		input.snapshot.phase === "ready"
	) {
		return input.setupCopy.readyCompleteSummary;
	}
	return input.setupCopy.readyIncompleteSummary;
}

function requirePrepareStep(
	snapshot: PrepareSessionSnapshot,
	stepId: PrepareStepSnapshot["id"]
): PrepareStepSnapshot {
	const step = snapshot.steps.find((candidate) => candidate.id === stepId);
	if (!step) {
		throw new Error(`Prepare session is missing ${stepId}.`);
	}
	return step;
}

function projectPrepareComputerStep(input: {
	activeStepId: PrepareStepSnapshot["id"] | null;
	setupCopy: SetupFlowCopy;
	snapshot: PrepareSessionSnapshot;
}): PrepareTimelineUserStep {
	const internalSteps = PREPARE_COMPUTER_INTERNAL_STEP_IDS.map((stepId) =>
		requirePrepareStep(input.snapshot, stepId)
	);
	const internalStates = internalSteps.map((step) =>
		resolvePrepareTimelineStepDisplayState({
			activeStepId: input.activeStepId,
			step,
			snapshot: input.snapshot,
		})
	);
	const state = resolvePrepareComputerState(internalStates);
	const activeInternalStep =
		internalSteps.find((step) => step.id === input.activeStepId) ??
		internalSteps.find((step) => step.state !== "complete") ??
		internalSteps[0];

	return {
		blockerStepIds: PREPARE_COMPUTER_INTERNAL_STEP_IDS,
		id: "prepare_computer",
		internalStep: activeInternalStep,
		state,
		summary: resolvePrepareComputerSummary({
			setupCopy: input.setupCopy,
			snapshot: input.snapshot,
			state,
			step: activeInternalStep,
		}),
		title: input.setupCopy.prepareComputerTitle,
	};
}

function resolvePrepareComputerState(
	internalStates: readonly PrepareStepState[]
): PrepareStepState {
	if (internalStates.includes("blocked")) {
		return "blocked";
	}
	if (internalStates.includes("terminal_disconnected")) {
		return "terminal_disconnected";
	}
	if (internalStates.includes("active")) {
		return "active";
	}
	if (internalStates.includes("waiting_for_user")) {
		return "waiting_for_user";
	}
	if (internalStates.every((state) => state === "complete")) {
		return "complete";
	}
	return "pending";
}

function resolvePrepareComputerSummary(input: {
	setupCopy: SetupFlowCopy;
	snapshot: PrepareSessionSnapshot;
	state: PrepareStepState;
	step: PrepareStepSnapshot;
}): string {
	if (input.state === "blocked") {
		return input.setupCopy.prepareComputerBlockedSummary;
	}
	if (input.state === "terminal_disconnected") {
		return input.setupCopy.prepareComputerTerminalDisconnectedSummary;
	}
	if (input.state === "complete") {
		return input.snapshot.selectedLocalAgentIds.length === 0
			? input.setupCopy.prepareComputerNoLocalAgentsSummary
			: input.setupCopy.prepareComputerCompleteSummary;
	}
	if (input.state === "pending") {
		return input.setupCopy.prepareComputerPendingSummary;
	}

	return resolveSetupComputerActiveSummary({
		copy: input.setupCopy,
		stepId: input.step.id,
	});
}

function isCurrentPrepareUserStep(step: PrepareTimelineUserStep): boolean {
	return (
		step.state === "active" ||
		step.state === "waiting_for_user" ||
		step.state === "blocked" ||
		step.state === "terminal_disconnected"
	);
}

type PrepareCompletionReadinessState =
	| { kind: "checking" }
	| { kind: "error" }
	| { count: number; kind: "needs_attention" }
	| { kind: "no_selected_local_agents" }
	| { count: number; kind: "ready" }
	| { kind: "unknown" };

type PrepareCompletionReadinessRefreshState = {
	key: string | null;
	status: "error" | "idle" | "pending" | "ready";
};

function useRefreshReadinessAfterPrepareCompletion(input: {
	refreshAll: () => Promise<void>;
	snapshot: PrepareSessionSnapshot | null;
}): PrepareCompletionReadinessRefreshState {
	const completionKey = resolvePrepareCompletionRefreshKey(input.snapshot);
	const refreshAllRef = useRef(input.refreshAll);
	const [refreshState, setRefreshState] =
		useState<PrepareCompletionReadinessRefreshState>({
			key: null,
			status: "idle",
		});
	const refreshStateRef = useRef(refreshState);

	useEffect(() => {
		refreshAllRef.current = input.refreshAll;
	}, [input.refreshAll]);

	useEffect(() => {
		if (completionKey === null) {
			return;
		}
		const currentRefreshState = refreshStateRef.current;
		if (
			currentRefreshState.key === completionKey &&
			(currentRefreshState.status === "pending" ||
				currentRefreshState.status === "ready" ||
				currentRefreshState.status === "error")
		) {
			return;
		}

		let cancelled = false;
		const markRefreshState = (
			nextState: PrepareCompletionReadinessRefreshState
		) => {
			refreshStateRef.current = nextState;
			setRefreshState(nextState);
		};
		markRefreshState({ key: completionKey, status: "pending" });
		refreshAllRef
			.current()
			.then(() => {
				if (!cancelled) {
					markRefreshState({ key: completionKey, status: "ready" });
				}
			})
			.catch((error: unknown) => {
				console.error(
					"Failed to refresh readiness after setup completed.",
					error
				);
				if (!cancelled) {
					markRefreshState({ key: completionKey, status: "error" });
				}
			});

		return () => {
			cancelled = true;
		};
	}, [completionKey]);

	if (completionKey === null) {
		return { key: null, status: "idle" };
	}
	if (refreshState.key === completionKey) {
		return refreshState;
	}
	return { key: completionKey, status: "pending" };
}

function resolvePrepareCompletionReadiness(input: {
	agentExecutionReadinessByProfileId: ReadonlyMap<
		string,
		GetAgentExecutionReadinessResponse
	>;
	agentExecutionReadinessErrorByProfileId: ReadonlyMap<string, string>;
	agentExecutionReadinessPendingProfileIds: ReadonlySet<string>;
	agentProfilesIsPending: boolean;
	expectedAgentProfileIds: ReadonlySet<string>;
	readinessRefresh: PrepareCompletionReadinessRefreshState;
	snapshot: PrepareSessionSnapshot;
}): PrepareCompletionReadinessState {
	if (input.snapshot.lifecycleStatus !== "completed") {
		return { kind: "unknown" };
	}

	if (input.readinessRefresh.status === "error") {
		return { kind: "error" };
	}
	if (input.readinessRefresh.status !== "ready") {
		return { kind: "checking" };
	}
	if (input.snapshot.selectedLocalAgentIds.length === 0) {
		return { kind: "no_selected_local_agents" };
	}
	if (input.expectedAgentProfileIds.size === 0) {
		return { kind: "unknown" };
	}

	const preparedProfiles: GetAgentExecutionReadinessResponse[] = [];
	for (const agentProfileId of input.expectedAgentProfileIds) {
		if (
			input.agentProfilesIsPending ||
			input.agentExecutionReadinessPendingProfileIds.has(agentProfileId)
		) {
			return { kind: "checking" };
		}
		if (input.agentExecutionReadinessErrorByProfileId.has(agentProfileId)) {
			return { kind: "error" };
		}

		const readiness =
			input.agentExecutionReadinessByProfileId.get(agentProfileId);
		if (!readiness) {
			return { kind: "error" };
		}
		preparedProfiles.push(readiness);
	}

	const profilesNeedingAttention = preparedProfiles.filter(
		(readiness) =>
			!isAgentExecutionReadyOrConnecting(readiness.agentExecutionReadiness)
	);
	if (profilesNeedingAttention.length > 0) {
		return {
			count: profilesNeedingAttention.length,
			kind: "needs_attention",
		};
	}

	return { count: preparedProfiles.length, kind: "ready" };
}

function resolvePrepareCompletionRefreshKey(
	snapshot: PrepareSessionSnapshot | null
): string | null {
	if (snapshot?.lifecycleStatus !== "completed" || snapshot.phase !== "ready") {
		return null;
	}

	return `${snapshot.prepareSessionId}:${snapshot.sessionRevision}`;
}

function buildPrepareCommandRefreshKey(input: {
	generation: number;
	prepareSessionId: string | null;
	sessionKey: string | null;
}): string | null {
	if (input.sessionKey === null || input.prepareSessionId === null) {
		return null;
	}
	return `${input.sessionKey}:${input.prepareSessionId}:${input.generation}`;
}

// Watches the local-components readiness projection after an update_service
// terminal session completes, re-fetching it until OpenMeld Service and CLI
// both clear `update_required`. Reaching the timeout window only flips the
// displayed status to "timed_out"; it does not stop the underlying refetch
// polling, so projection data that clears `update_required` afterward still
// recovers the display from "timed_out" to "confirmed". This is additive to
// the terminal-complete signal, not a replacement for it: plain "setup" mode
// (and update_service before the terminal reports completion) always
// resolves "not_applicable" and behaves exactly as before.
function useServiceUpdateVerification(input: {
	currentLocalRuntimeReplyReadinessQuery: UseQueryResult<
		CurrentLocalRuntimeReplyReadinessResponse,
		StructuredApiClientFailure
	>;
	mode: SetupFlowMode;
	snapshot: PrepareSessionSnapshot | null;
}): ServiceUpdateVerificationState {
	const completionKey =
		input.mode === "update_service"
			? resolvePrepareCompletionRefreshKey(input.snapshot)
			: null;
	// `startedAt` must be React state, not a ref: setting it is what forces the
	// re-render that flips the ready step out of "not_applicable"/base display
	// the moment the terminal session completes, instead of silently waiting
	// for some unrelated re-render to notice a mutated ref.
	const [startedAt, setStartedAt] = useState<{
		key: string;
		startedAtMs: number;
	} | null>(null);
	const [, forceRecomputeAtTimeout] = useState(0);
	const refetchRef = useRef(
		input.currentLocalRuntimeReplyReadinessQuery.refetch
	);

	useEffect(() => {
		refetchRef.current = input.currentLocalRuntimeReplyReadinessQuery.refetch;
	}, [input.currentLocalRuntimeReplyReadinessQuery.refetch]);

	useEffect(() => {
		if (completionKey === null) {
			setStartedAt(null);
			return;
		}
		setStartedAt((current) =>
			current?.key === completionKey
				? current
				: { key: completionKey, startedAtMs: Date.now() }
		);
	}, [completionKey]);

	const localComponents =
		input.currentLocalRuntimeReplyReadinessQuery.data?.localComponents ?? null;
	const stillRequired =
		completionKey !== null &&
		isServiceUpdateStillRequired(
			localComponents?.cli,
			localComponents?.service
		);

	useEffect(() => {
		if (!(completionKey && stillRequired)) {
			return;
		}
		const timeoutId = window.setTimeout(() => {
			forceRecomputeAtTimeout((tick) => tick + 1);
		}, SERVICE_UPDATE_VERIFICATION_TIMEOUT_MS);
		const intervalId = window.setInterval(() => {
			refetchRef.current().catch((error: unknown) => {
				console.error(
					"Failed to re-check OpenMeld Service update status.",
					error
				);
			});
		}, CURRENT_LOCAL_RUNTIME_REPLY_READINESS_REFRESH_INTERVAL_MS);
		return () => {
			window.clearTimeout(timeoutId);
			window.clearInterval(intervalId);
		};
	}, [completionKey, stillRequired]);

	const elapsedSinceCompletionMs =
		completionKey !== null && startedAt?.key === completionKey
			? Date.now() - startedAt.startedAtMs
			: null;

	return resolveServiceUpdateVerificationState({
		cli: localComponents?.cli,
		elapsedSinceCompletionMs,
		mode: input.mode,
		service: localComponents?.service,
		timeoutMs: SERVICE_UPDATE_VERIFICATION_TIMEOUT_MS,
	});
}

function resolvePrepareCompletionExpectedAgentProfileIds(input: {
	agentExecutionReadinessByProfileId: ReadonlyMap<
		string,
		GetAgentExecutionReadinessResponse
	>;
	agentProfiles: readonly AuthProfileView[];
	routeIntent: ReturnType<typeof useBringAgentsSetupContext>["routeIntent"];
	snapshot: PrepareSessionSnapshot;
}): ReadonlySet<string> {
	if (
		input.routeIntent.kind === "space_recovery" &&
		input.routeIntent.agentProfileIds.length > 0
	) {
		return new Set(input.routeIntent.agentProfileIds);
	}

	if (
		input.routeIntent.kind !== "account_computer_setup" &&
		input.routeIntent.kind !== "space_recovery"
	) {
		return new Set();
	}

	return resolvePreparedAgentProfileIds({
		agentExecutionReadinessByProfileId:
			input.agentExecutionReadinessByProfileId,
		agentProfiles: input.agentProfiles,
		snapshot: input.snapshot,
	});
}

function resolvePreparedAgentProfileIds(input: {
	agentExecutionReadinessByProfileId: ReadonlyMap<
		string,
		GetAgentExecutionReadinessResponse
	>;
	agentProfiles: readonly AuthProfileView[];
	snapshot: PrepareSessionSnapshot;
}): ReadonlySet<string> {
	const selectedAgentControllerRefs = resolveSelectedLocalAgentControllerRefs(
		input.snapshot
	);
	if (selectedAgentControllerRefs.size === 0) {
		return new Set();
	}

	const profileIds = new Set<string>();
	for (const profile of input.agentProfiles) {
		if (profile.profileKind !== "agent" || profile.status !== "active") {
			continue;
		}
		const readiness = input.agentExecutionReadinessByProfileId.get(
			profile.openMeldProfileId
		);
		if (
			!(
				readiness &&
				doesReadinessMatchSelectedLocalAgent({
					readiness,
					selectedAgentControllerRefs,
				})
			)
		) {
			continue;
		}
		profileIds.add(profile.openMeldProfileId);
	}

	return profileIds;
}

function doesReadinessMatchSelectedLocalAgent(input: {
	readiness: GetAgentExecutionReadinessResponse;
	selectedAgentControllerRefs: ReadonlySet<string>;
}): boolean {
	const agentControllerRef = canonicalizeAgentControllerRef(
		input.readiness.agentControllerRef
	);
	return agentControllerRef
		? input.selectedAgentControllerRefs.has(agentControllerRef)
		: false;
}

function resolveSelectedLocalAgentControllerRefs(
	snapshot: PrepareSessionSnapshot
): ReadonlySet<string> {
	if (
		!snapshot.localAgentCatalog ||
		snapshot.selectedLocalAgentIds.length === 0
	) {
		return new Set();
	}

	const selectedLocalAgentIds = new Set(snapshot.selectedLocalAgentIds);
	const controllerRefs = new Set<string>();
	for (const entry of snapshot.localAgentCatalog.entries) {
		if (!selectedLocalAgentIds.has(entry.agentId)) {
			continue;
		}
		const agentControllerRef = buildAgentControllerRef({
			kind: entry.targetKind,
			id: entry.agentId,
		});
		controllerRefs.add(agentControllerRef);
	}

	return controllerRefs;
}

function formatAgentProfileCount(count: number): string {
	return count === 1 ? "1 Agent Profile" : `${count} Agent Profiles`;
}

function PrepareBlockers(input: {
	blockers: PrepareBlocker[];
	onStartOver: () => Promise<void>;
}) {
	if (input.blockers.length === 0) {
		return null;
	}
	const hasForgottenComputerBlocker = input.blockers.some(
		isForgottenComputerBlocker
	);
	const hasLocalMachineBlocker = input.blockers.some(
		isLocalMachinePrepareBlocker
	);
	const hasTerminalAuthBlocker = input.blockers.some(isTerminalAuthBlocker);
	const handoffStopped = input.blockers.some(isHandoffStoppedBlocker);
	const followUp = resolvePrepareBlockerFollowUp({
		hasForgottenComputerBlocker,
		hasLocalMachineBlocker,
		hasTerminalAuthBlocker,
	});

	return (
		<div
			className={
				handoffStopped
					? "grid gap-2 rounded-lg border p-4"
					: "grid gap-2 border border-destructive/20 p-4"
			}
		>
			{input.blockers.map((blocker) => {
				const display = resolvePrepareBlockerDisplay(blocker);
				return (
					<div className="grid gap-1" key={blocker.blockerId}>
						<p
							className={
								handoffStopped
									? "font-medium text-sm"
									: "font-medium text-destructive text-sm"
							}
						>
							{display.message}
						</p>
						<p className="text-muted-foreground text-xs">
							Support code: {display.supportCode}
						</p>
					</div>
				);
			})}
			{!handoffStopped && followUp.nextStepText ? (
				<p className="text-muted-foreground text-sm">{followUp.nextStepText}</p>
			) : null}
			<div className="pt-2">
				<Button
					onClick={() => {
						input.onStartOver().catch(() => {
							// The hook stores the error state for this page.
						});
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					{handoffStopped ? "Get a new setup command" : followUp.actionLabel}
				</Button>
			</div>
		</div>
	);
}

function resolvePrepareBlockerDisplay(blocker: PrepareBlocker): {
	message: string;
	supportCode: string;
} {
	if (isForgottenComputerBlocker(blocker)) {
		return {
			message:
				"OpenMeld could not reconnect this computer because this computer was previously removed from your OpenMeld account.",
			supportCode: "runtime.registration.device_forgotten",
		};
	}
	return {
		message: blocker.message,
		supportCode: blocker.reasonCode,
	};
}

function isForgottenComputerBlocker(blocker: PrepareBlocker): boolean {
	return (
		blocker.reasonCode === "runtime.registration.device_forgotten" ||
		blocker.message.includes("runtime.registration.device_forgotten")
	);
}

function isTerminalAuthBlocker(blocker: PrepareBlocker): boolean {
	return blocker.reasonCode.startsWith("prepare.auth.");
}

function isHandoffStoppedBlocker(blocker: PrepareBlocker): boolean {
	return (
		blocker.reasonCode === "prepare.account_switch_cancelled" ||
		blocker.reasonCode === "prepare.authorization_failed"
	);
}

function PrepareLoadingState() {
	return (
		<SetupTimelineStep
			state="active"
			summary="OpenMeld is creating a setup session for this computer."
			title="Setting up OpenMeld"
		/>
	);
}

function usePrepareSession(input: {
	connectedComputerId: string | null;
	deviceId: string | null;
	forceFreshSession: boolean;
	humanProfileId: string | null;
	loadGatewayUrl: () => Promise<string>;
	onFreshSessionLoaded?: () => void;
	onNavigationActionAlreadyStarted?: () => void;
	preferCompletedSession: boolean;
	runtimeLane: string | null;
	sourceNavigationAction?: NonNullable<
		CreatePrepareSessionRequest["sourceNavigationAction"]
	>;
	targetSpaceId: string | null;
}) {
	const {
		connectedComputerId,
		deviceId,
		forceFreshSession,
		humanProfileId,
		loadGatewayUrl,
		preferCompletedSession,
		runtimeLane,
		sourceNavigationAction,
		targetSpaceId,
	} = input;
	const [state, setState] = useState<PrepareSessionPageState>({
		error: null,
		opaqueToken: null,
		opaqueTokenExpiresAt: null,
		snapshot: null,
		snapshotSessionKey: null,
		status: "idle",
	});
	const [command, setCommand] = useState<string | null>(null);
	const [commandExpiresAt, setCommandExpiresAt] = useState<string | null>(null);
	const [commandPlatform, setCommandPlatform] =
		useState<WebSetupCommandPlatform>(() =>
			resolveBrowserSetupCommandPlatform()
		);
	const [copyStatus, setCopyStatus] = useState<"copied" | "idle" | "manual">(
		"idle"
	);
	const [webSocketStatus, setWebSocketStatus] =
		useState<PrepareWebSocketStatus>("idle");
	const [refreshingCommandRefreshKey, setRefreshingCommandRefreshKey] =
		useState<string | null>(null);
	const socketRef = useRef<WebSocket | null>(null);
	const commandGenerationKeyRef = useRef<string | null>(null);
	const [commandRefreshGeneration, setCommandRefreshGeneration] = useState(0);
	const activePrepareSessionId = state.snapshot?.prepareSessionId ?? null;
	const sessionKey = buildPrepareSessionKey({
		connectedComputerId,
		deviceId,
		humanProfileId,
		runtimeLane,
		targetSpaceId,
	});
	const commandRefreshKey = buildPrepareCommandRefreshKey({
		generation: commandRefreshGeneration,
		prepareSessionId: activePrepareSessionId,
		sessionKey,
	});
	const activeCommandRefreshKeyRef = useRef<string | null>(commandRefreshKey);
	const isRefreshingCommand =
		commandRefreshKey !== null &&
		refreshingCommandRefreshKey === commandRefreshKey;
	const isPrepareSessionMountedRef = useRef(true);
	const commandRefreshRef = useRef<{
		key: string;
		request: object;
		task: Promise<string | null>;
	} | null>(null);
	const onFreshSessionLoadedRef = useRef(input.onFreshSessionLoaded);
	onFreshSessionLoadedRef.current = input.onFreshSessionLoaded;
	const onNavigationActionAlreadyStartedRef = useRef(
		input.onNavigationActionAlreadyStarted
	);
	onNavigationActionAlreadyStartedRef.current =
		input.onNavigationActionAlreadyStarted;
	const sourceNavigationActionSignalId =
		sourceNavigationAction?.signalId ?? null;
	const sourceNavigationActionSpaceId = sourceNavigationAction?.spaceId ?? null;

	useEffect(() => {
		isPrepareSessionMountedRef.current = true;
		return () => {
			isPrepareSessionMountedRef.current = false;
		};
	}, []);

	useLayoutEffect(() => {
		activeCommandRefreshKeyRef.current = commandRefreshKey;
		commandRefreshRef.current = null;
	}, [commandRefreshKey]);

	useEffect(() => {
		if (!sessionKey) {
			setState({
				error: null,
				opaqueToken: null,
				opaqueTokenExpiresAt: null,
				snapshot: null,
				snapshotSessionKey: null,
				status: "idle",
			});
			return;
		}

		let cancelled = false;
		setState((current) => ({
			error: null,
			opaqueToken: current.opaqueToken,
			opaqueTokenExpiresAt: current.opaqueTokenExpiresAt,
			snapshot: current.snapshot,
			snapshotSessionKey: current.snapshotSessionKey,
			status: "loading",
		}));

		const ensureSession = async () => {
			const sessionInput = {
				connectedComputerId,
				deviceId,
				humanProfileId,
				runtimeLane,
				...(sourceNavigationActionSignalId &&
					sourceNavigationActionSpaceId && {
						sourceNavigationAction: {
							signalId: sourceNavigationActionSignalId,
							spaceId: sourceNavigationActionSpaceId,
						},
					}),
				targetSpaceId,
			};
			const session = await loadPrepareSessionForInputOnce(sessionInput, {
				forceFreshSession,
				preferCompletedSession,
			});
			if (cancelled) {
				return;
			}
			persistPrepareSessionPointer(session, {
				connectedComputerId,
				deviceId,
				humanProfileId,
				runtimeLane,
				targetSpaceId,
			});
			setState({
				error: null,
				opaqueToken: session.opaqueToken,
				opaqueTokenExpiresAt: session.opaqueTokenExpiresAt,
				snapshot: session.snapshot,
				snapshotSessionKey: sessionKey,
				status: "ready",
			});
			if (forceFreshSession) {
				onFreshSessionLoadedRef.current?.();
			}
		};

		ensureSession().catch((error: unknown) => {
			if (cancelled) {
				return;
			}
			if (isPrepareSessionNavigationActionAlreadyStartedError(error)) {
				onNavigationActionAlreadyStartedRef.current?.();
				return;
			}
			setState((current) => ({
				error: normalizeError(error),
				opaqueToken: current.opaqueToken,
				opaqueTokenExpiresAt: current.opaqueTokenExpiresAt,
				snapshot: current.snapshot,
				snapshotSessionKey: current.snapshotSessionKey,
				status: "error",
			}));
		});

		return () => {
			cancelled = true;
		};
	}, [
		connectedComputerId,
		deviceId,
		forceFreshSession,
		humanProfileId,
		preferCompletedSession,
		runtimeLane,
		sessionKey,
		sourceNavigationActionSignalId,
		sourceNavigationActionSpaceId,
		targetSpaceId,
	]);

	const generateSetupCommand = useCallback(
		async (input: {
			opaqueToken: string;
			opaqueTokenExpiresAt: string | null;
		}) => {
			const [gatewayUrl, computerAuthorization] = await Promise.all([
				loadGatewayUrl(),
				createComputerAuthorizationGrant(),
			]);
			return {
				command: buildWebSetupCommand({
					setupPlatform: commandPlatform,
					gatewayUrl,
					startSession: input.opaqueToken,
					deviceCode: computerAuthorization.deviceCode,
				}),
				expiresAt: resolveComputerAuthorizationHandoffExpiresAt({
					prepareSessionExpiresAt: input.opaqueTokenExpiresAt,
					authorizationExpiresInSeconds: computerAuthorization.expiresIn,
				}),
			};
		},
		[commandPlatform, loadGatewayUrl]
	);

	useEffect(() => {
		const shouldBuildCommand =
			state.opaqueToken !== null &&
			state.snapshot?.lifecycleStatus !== "completed" &&
			!state.snapshot?.blockers.some(isHandoffStoppedBlocker);
		if (!shouldBuildCommand) {
			commandGenerationKeyRef.current = null;
			setCommand(null);
			setCommandExpiresAt(null);
			return;
		}
		const generationKey = `${commandPlatform}:${state.opaqueToken}`;
		if (commandGenerationKeyRef.current === generationKey) {
			return;
		}

		let cancelled = false;
		setCommand(null);
		setCommandExpiresAt(state.opaqueTokenExpiresAt);
		generateSetupCommand({
			opaqueToken: state.opaqueToken as string,
			opaqueTokenExpiresAt: state.opaqueTokenExpiresAt,
		})
			.then((generated) => {
				if (cancelled) {
					return;
				}
				commandGenerationKeyRef.current = generationKey;
				setCommand(generated.command);
				setCommandExpiresAt(generated.expiresAt);
				setCopyStatus("idle");
			})
			.catch((error: unknown) => {
				if (cancelled) {
					return;
				}
				setState((current) => ({
					...current,
					error: normalizeError(error),
				}));
			});

		return () => {
			cancelled = true;
		};
	}, [
		commandPlatform,
		generateSetupCommand,
		state.opaqueToken,
		state.opaqueTokenExpiresAt,
		state.snapshot?.lifecycleStatus,
		state.snapshot?.blockers,
	]);

	useEffect(() => {
		if (activePrepareSessionId === null) {
			setWebSocketStatus("idle");
			socketRef.current = null;
			return;
		}

		let isCancelled = false;
		let isReconnectCheckInFlight = false;
		let reconnectTimer: number | null = null;
		let socket: WebSocket | null = null;

		const applyPrepareSessionSnapshot = (snapshot: PrepareSessionSnapshot) => {
			persistPrepareSessionPointer(
				{
					opaqueToken: state.opaqueToken,
					opaqueTokenExpiresAt: state.opaqueTokenExpiresAt,
					snapshot,
				},
				{
					connectedComputerId,
					deviceId,
					humanProfileId,
					runtimeLane,
					targetSpaceId,
				}
			);
			setState((current) => ({
				...current,
				error: null,
				snapshot,
				status: "ready",
			}));
		};

		const replaceMissingActiveSession = async () => {
			setCommandRefreshGeneration((current) => current + 1);
			activeCommandRefreshKeyRef.current = null;
			commandRefreshRef.current = null;
			setRefreshingCommandRefreshKey(null);
			clearPrepareSessionPointer();
			clearCompletedPrepareSessionPointer();
			setState({
				error: null,
				opaqueToken: null,
				opaqueTokenExpiresAt: null,
				snapshot: null,
				snapshotSessionKey: null,
				status: "loading",
			});
			const session = await createFreshPrepareSession({
				connectedComputerId,
				deviceId,
				humanProfileId,
				runtimeLane,
				targetSpaceId,
			});
			if (isCancelled) {
				return;
			}
			persistPrepareSessionPointer(session, {
				connectedComputerId,
				deviceId,
				humanProfileId,
				runtimeLane,
				targetSpaceId,
			});
			setState({
				error: null,
				opaqueToken: session.opaqueToken,
				opaqueTokenExpiresAt: session.opaqueTokenExpiresAt,
				snapshot: session.snapshot,
				snapshotSessionKey: sessionKey,
				status: "ready",
			});
			setWebSocketStatus("idle");
		};

		const scheduleReconnectTimer = () => {
			if (isCancelled || reconnectTimer !== null) {
				return;
			}
			reconnectTimer = window.setTimeout(() => {
				reconnectTimer = null;
				connect();
			}, 1000);
		};

		const scheduleReconnect = () => {
			if (isCancelled || reconnectTimer !== null || isReconnectCheckInFlight) {
				return;
			}
			setWebSocketStatus("closed");
			isReconnectCheckInFlight = true;
			readPrepareSession({ prepareSessionId: activePrepareSessionId })
				.then((response) => {
					if (isCancelled) {
						return;
					}
					applyPrepareSessionSnapshot(response.snapshot);
					if (response.snapshot.lifecycleStatus === "active") {
						scheduleReconnectTimer();
					}
				})
				.catch((error: unknown) => {
					if (isCancelled) {
						return;
					}
					if (isPrepareSessionNotFoundError(error)) {
						replaceMissingActiveSession().catch((replaceError: unknown) => {
							if (isCancelled) {
								return;
							}
							setState((current) => ({
								...current,
								error: normalizeError(replaceError),
								status: "error",
							}));
						});
						return;
					}
					scheduleReconnectTimer();
				})
				.finally(() => {
					isReconnectCheckInFlight = false;
				});
		};

		const connect = () => {
			if (isCancelled) {
				return;
			}
			const nextSocket = new WebSocket(
				buildPrepareSessionStreamUrl(activePrepareSessionId)
			);
			socket = nextSocket;
			setWebSocketStatus("connecting");
			nextSocket.onopen = () => {
				socketRef.current = nextSocket;
				setWebSocketStatus("connected");
			};
			nextSocket.onmessage = (event) => {
				const frame = parsePrepareSessionStreamFrame(event.data);
				if (!frame) {
					return;
				}
				if (frame.type === "snapshot" || frame.type === "snapshot_changed") {
					applyPrepareSessionSnapshot(frame.payload.snapshot);
					return;
				}
				if (frame.type === "server.error") {
					setState((current) => ({
						...current,
						error: new Error(frame.payload.message),
					}));
				}
			};
			nextSocket.onclose = () => {
				if (socketRef.current === nextSocket) {
					socketRef.current = null;
				}
				scheduleReconnect();
			};
			nextSocket.onerror = () => {
				if (socketRef.current === nextSocket) {
					socketRef.current = null;
				}
				scheduleReconnect();
			};
		};

		connect();

		return () => {
			isCancelled = true;
			if (reconnectTimer !== null) {
				window.clearTimeout(reconnectTimer);
			}
			if (socketRef.current === socket) {
				socketRef.current = null;
			}
			if (socket !== null) {
				socket.onopen = null;
				socket.onmessage = null;
				socket.onclose = null;
				socket.onerror = null;
			}
			socket?.close(1000, "prepare_page_unmounted");
		};
	}, [
		activePrepareSessionId,
		connectedComputerId,
		deviceId,
		humanProfileId,
		runtimeLane,
		sessionKey,
		state.opaqueToken,
		state.opaqueTokenExpiresAt,
		targetSpaceId,
	]);

	const refresh = useCallback(async () => {
		if (state.snapshot === null) {
			return;
		}

		try {
			const response = await readPrepareSession({
				prepareSessionId: state.snapshot.prepareSessionId,
			});
			persistPrepareSessionPointer(
				{
					opaqueToken: state.opaqueToken,
					opaqueTokenExpiresAt: state.opaqueTokenExpiresAt,
					snapshot: response.snapshot,
				},
				{
					connectedComputerId,
					deviceId,
					humanProfileId,
					runtimeLane,
					targetSpaceId,
				}
			);
			setState((current) => ({
				error: null,
				opaqueToken: current.opaqueToken,
				opaqueTokenExpiresAt: current.opaqueTokenExpiresAt,
				snapshot: response.snapshot,
				snapshotSessionKey: current.snapshotSessionKey,
				status: "ready",
			}));
		} catch (error) {
			setState((current) => ({
				...current,
				error: normalizeError(error),
			}));
		}
	}, [
		connectedComputerId,
		deviceId,
		humanProfileId,
		runtimeLane,
		state.opaqueToken,
		state.opaqueTokenExpiresAt,
		state.snapshot,
		targetSpaceId,
	]);

	const startOver = useCallback(async () => {
		if (humanProfileId === null) {
			setState({
				error: new Error("Choose a profile before setup."),
				opaqueToken: null,
				opaqueTokenExpiresAt: null,
				snapshot: null,
				snapshotSessionKey: null,
				status: "error",
			});
			return;
		}

		setCommandRefreshGeneration((current) => current + 1);
		activeCommandRefreshKeyRef.current = null;
		commandRefreshRef.current = null;
		setRefreshingCommandRefreshKey(null);
		setState((current) => ({
			error: null,
			opaqueToken: current.opaqueToken,
			opaqueTokenExpiresAt: current.opaqueTokenExpiresAt,
			snapshot: current.snapshot,
			snapshotSessionKey: current.snapshotSessionKey,
			status: "loading",
		}));
		try {
			clearPrepareSessionPointer();
			clearCompletedPrepareSessionPointer();
			const session = await createFreshPrepareSession({
				connectedComputerId,
				deviceId,
				humanProfileId,
				runtimeLane,
				targetSpaceId,
			});
			persistPrepareSessionPointer(session, {
				connectedComputerId,
				deviceId,
				humanProfileId,
				runtimeLane,
				targetSpaceId,
			});
			setState({
				error: null,
				opaqueToken: session.opaqueToken,
				opaqueTokenExpiresAt: session.opaqueTokenExpiresAt,
				snapshot: session.snapshot,
				snapshotSessionKey: sessionKey,
				status: "ready",
			});
		} catch (error) {
			setState((current) => ({
				...current,
				error: normalizeError(error),
				status: "error",
			}));
		}
	}, [
		connectedComputerId,
		deviceId,
		humanProfileId,
		runtimeLane,
		sessionKey,
		targetSpaceId,
	]);

	const refreshCommandAndReturn = useCallback((): Promise<string | null> => {
		const snapshot = state.snapshot;
		if (snapshot === null || commandRefreshKey === null) {
			return Promise.resolve(null);
		}
		const existingRefresh = commandRefreshRef.current;
		if (existingRefresh?.key === commandRefreshKey) {
			return existingRefresh.task;
		}
		const refreshKey = commandRefreshKey;
		const isCurrentRefreshSession = () =>
			isPrepareSessionMountedRef.current &&
			activeCommandRefreshKeyRef.current === refreshKey;

		const refreshRequest = {};
		const reportRefreshError = (error: unknown) => {
			if (!isCurrentRefreshSession()) {
				return;
			}
			setState((current) => ({
				...current,
				error: normalizeError(error),
			}));
		};
		const refreshTask = (async () => {
			setRefreshingCommandRefreshKey(refreshKey);
			try {
				const session = await mintPrepareSessionToken({
					prepareSessionId: snapshot.prepareSessionId,
				});
				if (!isCurrentRefreshSession()) {
					return null;
				}
				const generated = await generateSetupCommand({
					opaqueToken: session.opaqueToken,
					opaqueTokenExpiresAt: session.opaqueTokenExpiresAt,
				});
				if (!isCurrentRefreshSession()) {
					return null;
				}
				commandGenerationKeyRef.current = `${commandPlatform}:${session.opaqueToken}`;
				setCommand(generated.command);
				setCommandExpiresAt(generated.expiresAt);
				setState((current) => ({
					...current,
					error: null,
					opaqueToken: session.opaqueToken,
					opaqueTokenExpiresAt: session.opaqueTokenExpiresAt,
					snapshot: session.snapshot,
					status: "ready",
				}));
				persistPrepareSessionPointer(session, {
					connectedComputerId,
					deviceId,
					humanProfileId,
					runtimeLane,
					targetSpaceId,
				});
				setCopyStatus("idle");
				return generated.command;
			} catch (error) {
				reportRefreshError(error);
				return null;
			} finally {
				if (commandRefreshRef.current?.request === refreshRequest) {
					commandRefreshRef.current = null;
					if (isCurrentRefreshSession()) {
						setRefreshingCommandRefreshKey(null);
					}
				}
			}
		})();
		commandRefreshRef.current = {
			key: refreshKey,
			request: refreshRequest,
			task: refreshTask,
		};
		return refreshTask;
	}, [
		commandPlatform,
		commandRefreshKey,
		connectedComputerId,
		deviceId,
		generateSetupCommand,
		humanProfileId,
		runtimeLane,
		state.snapshot,
		targetSpaceId,
	]);

	const refreshCommand = useCallback(async () => {
		await refreshCommandAndReturn();
	}, [refreshCommandAndReturn]);

	useEffect(() => {
		if (
			command === null ||
			commandExpiresAt === null ||
			state.snapshot?.lifecycleStatus === "completed"
		) {
			return;
		}
		const expiresAtMs = Date.parse(commandExpiresAt);
		if (!Number.isFinite(expiresAtMs)) {
			return;
		}
		const refreshTimer = window.setTimeout(
			() => {
				refreshCommandAndReturn().catch(() => undefined);
			},
			Math.max(0, expiresAtMs - Date.now()) + 25
		);
		return () => {
			window.clearTimeout(refreshTimer);
		};
	}, [
		command,
		commandExpiresAt,
		refreshCommandAndReturn,
		state.snapshot?.lifecycleStatus,
	]);

	const copyCommand = useCallback(async () => {
		let commandToCopy = command;
		const commandExpiresAtMs = Date.parse(commandExpiresAt ?? "");
		if (
			commandToCopy !== null &&
			Number.isFinite(commandExpiresAtMs) &&
			commandExpiresAtMs <= Date.now()
		) {
			commandToCopy = await refreshCommandAndReturn();
		}
		if (commandToCopy === null) {
			return;
		}
		const didCopy = await copyCliEntryCommand(commandToCopy);
		setCopyStatus(didCopy ? "copied" : "manual");
		if (didCopy) {
			toast.success("CLI command copied.");
		}
	}, [command, commandExpiresAt, refreshCommandAndReturn]);

	return {
		command,
		commandExpiresAt,
		commandPlatform,
		copyCommand,
		copyStatus,
		error: state.error,
		isRefreshingCommand,
		opaqueToken: state.opaqueToken,
		opaqueTokenExpiresAt: state.opaqueTokenExpiresAt,
		refresh,
		refreshCommand,
		setCommandPlatform,
		sessionKey,
		snapshot: state.snapshot,
		snapshotSessionKey: state.snapshotSessionKey,
		startOver,
		status: state.status,
		webSocketStatus,
	};
}

type PrepareSessionInput = {
	connectedComputerId: string | null;
	deviceId: string | null;
	humanProfileId: string | null;
	runtimeLane: string | null;
	sourceNavigationAction?: NonNullable<
		CreatePrepareSessionRequest["sourceNavigationAction"]
	>;
	targetSpaceId: string | null;
};

type PrepareSessionLoadResult = {
	opaqueToken: string | null;
	opaqueTokenExpiresAt: string | null;
	snapshot: PrepareSessionSnapshot;
};

async function loadPrepareSessionForInput(
	input: PrepareSessionInput,
	options: {
		forceFreshSession?: boolean;
		preferCompletedSession?: boolean;
	} = {}
): Promise<PrepareSessionLoadResult> {
	if (options.forceFreshSession === true) {
		clearPrepareSessionPointer();
		clearCompletedPrepareSessionPointer();
		return await createFreshPrepareSession(input);
	}

	const pointer = readPrepareSessionPointer();
	const completedPointer = readCompletedPrepareSessionPointer();
	if (options.preferCompletedSession === true) {
		const restoredCompletedSession =
			await restoreMatchingCompletedPrepareSession({
				completedPointer,
				input,
			});
		if (restoredCompletedSession !== null) {
			return restoredCompletedSession;
		}
	}

	const matchingPointer = pointerMatchesPrepareSessionInput(pointer, input)
		? pointer
		: null;
	if (matchingPointer !== null) {
		return await restorePrepareSession(matchingPointer, input);
	}

	const restoredCompletedSession = await restoreMatchingCompletedPrepareSession(
		{
			completedPointer,
			input,
		}
	);
	if (restoredCompletedSession !== null) {
		return restoredCompletedSession;
	}

	return await createFreshPrepareSession(input);
}

async function restoreMatchingCompletedPrepareSession(request: {
	completedPointer: PrepareSessionPointer | null;
	input: PrepareSessionInput;
}): Promise<PrepareSessionLoadResult | null> {
	const matchingCompletedPointer =
		request.completedPointer !== null &&
		completedPrepareSessionPointerMatchesInput(
			request.completedPointer,
			request.input
		)
			? request.completedPointer
			: null;
	if (matchingCompletedPointer !== null) {
		const restoredLastCompletedSession = await restoreCompletedPrepareSession(
			matchingCompletedPointer,
			request.input
		);
		if (restoredLastCompletedSession !== null) {
			return restoredLastCompletedSession;
		}
	}
	return null;
}

function loadPrepareSessionForInputOnce(
	input: PrepareSessionInput,
	options: {
		forceFreshSession?: boolean;
		preferCompletedSession?: boolean;
	} = {}
): Promise<PrepareSessionLoadResult> {
	const requestKey = buildPrepareSessionLoadRequestKey(input, options);
	const existingRequest = prepareSessionLoadRequests.get(requestKey);
	if (existingRequest !== undefined) {
		return existingRequest;
	}

	const request = loadPrepareSessionForInput(input, options).finally(() => {
		if (prepareSessionLoadRequests.get(requestKey) === request) {
			prepareSessionLoadRequests.delete(requestKey);
		}
	});
	prepareSessionLoadRequests.set(requestKey, request);
	return request;
}

function buildPrepareSessionLoadRequestKey(
	input: PrepareSessionInput,
	options: {
		forceFreshSession?: boolean;
		preferCompletedSession?: boolean;
	} = {}
): string {
	return [
		options.forceFreshSession === true ? "fresh" : "restore",
		options.preferCompletedSession === true
			? "completed-first"
			: "active-first",
		input.connectedComputerId ?? "",
		input.deviceId ?? "",
		input.humanProfileId ?? "",
		input.runtimeLane ?? "",
		input.sourceNavigationAction?.spaceId ?? "",
		input.sourceNavigationAction?.signalId ?? "",
		input.targetSpaceId ?? "",
	].join(":");
}

async function createFreshPrepareSession(
	input: PrepareSessionInput
): Promise<PrepareSessionLoadResult> {
	if (input.humanProfileId === null) {
		throw new Error("Choose a profile before setup.");
	}

	return await createPrepareSession({
		...(input.connectedComputerId
			? { connectedComputerId: input.connectedComputerId }
			: {}),
		deviceId: null,
		humanProfileId: input.humanProfileId,
		runtimeLane: null,
		targetSpaceId: input.targetSpaceId,
		selectedLocalAgentIds: [],
		...(input.sourceNavigationAction
			? { sourceNavigationAction: input.sourceNavigationAction }
			: {}),
	});
}

async function restorePrepareSession(
	pointer: PrepareSessionPointer,
	input: PrepareSessionInput
): Promise<PrepareSessionLoadResult> {
	try {
		const response = await readPrepareSession({
			prepareSessionId: pointer.prepareSessionId,
		});
		const matchesInput =
			response.snapshot.lifecycleStatus === "completed"
				? completedSnapshotMatchesPrepareSessionInput(response.snapshot, input)
				: snapshotMatchesPrepareSessionInput(response.snapshot, input);
		if (!matchesInput) {
			clearPrepareSessionPointer();
			return await createFreshPrepareSession(input);
		}
		return {
			opaqueToken: pointer.opaqueToken,
			opaqueTokenExpiresAt: pointer.opaqueTokenExpiresAt,
			snapshot: response.snapshot,
		};
	} catch (error) {
		if (isPrepareSessionNotFoundError(error)) {
			clearPrepareSessionPointer();
			return await createFreshPrepareSession(input);
		}
		throw error;
	}
}

async function restoreCompletedPrepareSession(
	pointer: PrepareSessionPointer,
	input: PrepareSessionInput
): Promise<PrepareSessionLoadResult | null> {
	try {
		const response = await readPrepareSession({
			prepareSessionId: pointer.prepareSessionId,
		});
		if (
			response.snapshot.lifecycleStatus !== "completed" ||
			!completedSnapshotMatchesPrepareSessionInput(response.snapshot, input)
		) {
			return null;
		}
		return {
			opaqueToken: pointer.opaqueToken,
			opaqueTokenExpiresAt: pointer.opaqueTokenExpiresAt,
			snapshot: response.snapshot,
		};
	} catch (error) {
		if (isPrepareSessionNotFoundError(error)) {
			return null;
		}
		throw error;
	}
}

function completedPrepareSessionPointerMatchesInput(
	pointer: PrepareSessionPointer,
	input: PrepareSessionInput
): boolean {
	if (input.connectedComputerId) {
		return (
			pointer.connectedComputerId === input.connectedComputerId &&
			pointer.humanProfileId === input.humanProfileId &&
			pointer.targetSpaceId === input.targetSpaceId
		);
	}
	return (
		input.humanProfileId !== null &&
		input.deviceId !== null &&
		input.runtimeLane !== null &&
		pointer.humanProfileId === input.humanProfileId &&
		pointer.targetSpaceId === input.targetSpaceId &&
		pointer.deviceId === input.deviceId &&
		pointer.runtimeLane === input.runtimeLane
	);
}

function completedSnapshotMatchesPrepareSessionInput(
	snapshot: PrepareSessionSnapshot,
	input: PrepareSessionInput
): boolean {
	if (input.connectedComputerId) {
		return (
			snapshot.connectedComputerId === input.connectedComputerId &&
			snapshot.humanProfileId === input.humanProfileId &&
			snapshot.targetSpaceId === input.targetSpaceId
		);
	}
	return (
		input.humanProfileId !== null &&
		input.deviceId !== null &&
		input.runtimeLane !== null &&
		snapshot.humanProfileId === input.humanProfileId &&
		snapshot.targetSpaceId === input.targetSpaceId &&
		snapshot.deviceId === input.deviceId &&
		snapshot.runtimeLane === input.runtimeLane
	);
}

function snapshotMatchesCurrentPreparePageSession(
	snapshot: PrepareSessionSnapshot,
	input: PrepareSessionInput
): boolean {
	if (
		input.humanProfileId !== null &&
		snapshot.humanProfileId === input.humanProfileId &&
		snapshot.targetSpaceId === input.targetSpaceId
	) {
		if (input.connectedComputerId !== null) {
			return snapshot.connectedComputerId === input.connectedComputerId;
		}
		if (input.deviceId !== null && snapshot.deviceId !== input.deviceId) {
			return false;
		}
		if (
			input.runtimeLane !== null &&
			snapshot.runtimeLane !== input.runtimeLane
		) {
			return false;
		}
		return true;
	}
	return false;
}

function resolveCurrentPrepareSessionSnapshot(input: {
	connectedComputerId: string | null;
	deviceId: string | null;
	humanProfileId: string | null;
	runtimeLane: string | null;
	sessionKey: string | null;
	snapshot: PrepareSessionSnapshot | null;
	snapshotSessionKey: string | null;
	targetSpaceId: string | null;
}): PrepareSessionSnapshot | null {
	if (input.snapshot === null) {
		return null;
	}
	const sessionInput = {
		connectedComputerId: input.connectedComputerId,
		deviceId: input.deviceId,
		humanProfileId: input.humanProfileId,
		runtimeLane: input.runtimeLane,
		targetSpaceId: input.targetSpaceId,
	};
	if (
		input.sessionKey !== null &&
		input.snapshotSessionKey === input.sessionKey &&
		snapshotMatchesLoadedPrepareSession(input.snapshot, sessionInput)
	) {
		return input.snapshot;
	}
	if (input.snapshot.lifecycleStatus === "completed") {
		return completedSnapshotMatchesPrepareSessionInput(
			input.snapshot,
			sessionInput
		) || snapshotMatchesCurrentPreparePageSession(input.snapshot, sessionInput)
			? input.snapshot
			: null;
	}
	return snapshotMatchesPrepareSessionInput(input.snapshot, sessionInput)
		? input.snapshot
		: null;
}

function snapshotMatchesLoadedPrepareSession(
	snapshot: PrepareSessionSnapshot,
	input: PrepareSessionInput
): boolean {
	if (
		input.humanProfileId === null ||
		snapshot.humanProfileId !== input.humanProfileId ||
		snapshot.targetSpaceId !== input.targetSpaceId
	) {
		return false;
	}
	return (
		input.connectedComputerId === null ||
		snapshot.connectedComputerId === input.connectedComputerId
	);
}

function snapshotMatchesPrepareSessionInput(
	snapshot: PrepareSessionSnapshot,
	input: PrepareSessionInput
): boolean {
	if (
		input.humanProfileId === null ||
		snapshot.humanProfileId !== input.humanProfileId ||
		snapshot.targetSpaceId !== input.targetSpaceId
	) {
		return false;
	}
	if (input.connectedComputerId) {
		return snapshot.connectedComputerId === input.connectedComputerId;
	}
	if (
		input.deviceId !== null &&
		snapshot.deviceId !== null &&
		snapshot.deviceId !== input.deviceId
	) {
		return false;
	}
	if (
		input.runtimeLane !== null &&
		snapshot.runtimeLane !== null &&
		snapshot.runtimeLane !== input.runtimeLane
	) {
		return false;
	}
	return true;
}

function persistPrepareSessionPointer(
	session: {
		opaqueToken: string | null;
		opaqueTokenExpiresAt: string | null;
		snapshot: PrepareSessionSnapshot;
	},
	fallback: {
		connectedComputerId: string | null;
		deviceId: string | null;
		humanProfileId: string | null;
		runtimeLane: string | null;
		targetSpaceId: string | null;
	}
): void {
	const humanProfileId =
		session.snapshot.humanProfileId ?? fallback.humanProfileId;
	if (humanProfileId === null) {
		return;
	}

	const pointer = {
		...(session.snapshot.connectedComputerId || fallback.connectedComputerId
			? {
					connectedComputerId:
						session.snapshot.connectedComputerId ??
						fallback.connectedComputerId,
				}
			: {}),
		deviceId: session.snapshot.deviceId,
		humanProfileId,
		opaqueToken: session.opaqueToken,
		opaqueTokenExpiresAt: session.opaqueTokenExpiresAt,
		prepareSessionId: session.snapshot.prepareSessionId,
		runtimeLane: session.snapshot.runtimeLane,
		targetSpaceId: session.snapshot.targetSpaceId,
	};
	writePrepareSessionPointer(pointer);
	if (session.snapshot.lifecycleStatus === "completed") {
		writeCompletedPrepareSessionPointer(pointer);
	}
}

function buildPrepareSessionStreamUrl(prepareSessionId: string): string {
	const url = new URL(window.location.href);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.pathname = `/v1/prepare/sessions/${encodeURIComponent(prepareSessionId)}/stream`;
	url.search = "role=web";
	url.hash = "";
	return url.toString();
}

function parsePrepareSessionStreamFrame(value: unknown) {
	if (typeof value !== "string") {
		return null;
	}

	try {
		const parsed = prepareSessionStreamServerFrameSchema.safeParse(
			JSON.parse(value) as unknown
		);
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

function resolvePrepareCompletionReadyStepSummary(input: {
	completionReadiness: PrepareCompletionReadinessState;
	setupCopy: SetupFlowCopy;
}): string | null {
	if (input.completionReadiness.kind === "checking") {
		return input.setupCopy.readyRefreshPendingSummary;
	}
	if (input.completionReadiness.kind === "no_selected_local_agents") {
		return input.setupCopy.readyNoSelectedLocalAgentsSummary;
	}
	if (input.completionReadiness.kind === "needs_attention") {
		return `${input.setupCopy.readyCompleteSummary} Agent availability still needs ${formatAgentProfileCount(input.completionReadiness.count)}.`;
	}
	if (input.completionReadiness.kind === "error") {
		return input.setupCopy.readyRefreshErrorSummary;
	}
	if (input.completionReadiness.kind === "ready") {
		return input.setupCopy.readyCompleteSummary;
	}
	return null;
}

export function resolveTerminalStepSummary(input: {
	nowMs?: number;
	setupCopy: SetupFlowCopy;
	snapshot: PrepareSessionSnapshot;
}) {
	if (input.snapshot.lifecycleStatus === "completed") {
		return input.setupCopy.connectTerminalCompleteSummary;
	}
	if (
		input.snapshot.steps.some(
			(step) => step.id === "connect_terminal" && step.state === "complete"
		)
	) {
		return "Terminal is connected.";
	}
	if (input.snapshot.terminalConnection.status === "connected") {
		return "Terminal is connected.";
	}
	const terminalAuthReasonCode = findConnectTerminalAuthReasonCode(
		input.snapshot
	);
	if (terminalAuthReasonCode === "prepare.auth.sign_in_required") {
		return "Terminal is not signed in to OpenMeld.";
	}
	if (terminalAuthReasonCode !== null) {
		return "Terminal is signed in to a different OpenMeld account.";
	}
	if (
		isPrepareTerminalReconnectGraceActive({
			nowMs: input.nowMs ?? Date.now(),
			snapshot: input.snapshot,
		})
	) {
		return input.setupCopy.connectTerminalReconnectingSummary;
	}
	if (input.snapshot.terminalConnection.status === "disconnected") {
		return input.setupCopy.connectTerminalDisconnectedSummary;
	}
	return input.setupCopy.connectTerminalPendingSummary;
}

export function resolveTerminalStatusText(input: {
	nowMs?: number;
	setupCopy: SetupFlowCopy;
	snapshot: PrepareSessionSnapshot;
	webSocketStatus: PrepareWebSocketStatus;
}) {
	if (input.snapshot.lifecycleStatus === "completed") {
		return input.setupCopy.connectTerminalCompleteSummary;
	}
	if (input.snapshot.terminalConnection.status === "connected") {
		return input.setupCopy.mode === "update_service"
			? "Terminal is connected. Keep it open while the update continues."
			: "Terminal is connected. Keep it open while setup continues.";
	}
	if (findConnectTerminalAuthReasonCode(input.snapshot) !== null) {
		return input.setupCopy.mode === "update_service"
			? "Sign in to the matching OpenMeld account in Terminal, then refresh the update command and run it again."
			: "Sign in to the matching OpenMeld account in Terminal, then refresh the setup command and run it again.";
	}
	if (
		isPrepareTerminalReconnectGraceActive({
			nowMs: input.nowMs ?? Date.now(),
			snapshot: input.snapshot,
		})
	) {
		return input.setupCopy.connectTerminalReconnectingSummary;
	}
	if (input.snapshot.terminalConnection.status === "disconnected") {
		// connectTerminalDisconnectedSummary already opens with "Terminal
		// disconnected."; prefixing it here double-printed the sentence.
		return input.setupCopy.connectTerminalDisconnectedSummary;
	}
	if (input.webSocketStatus === "closed") {
		return input.setupCopy.mode === "update_service"
			? "OpenMeld Web is reconnecting to the update session."
			: "OpenMeld Web is reconnecting to the setup session.";
	}
	return "Run the command in Terminal. OpenMeld is waiting for this computer.";
}

function isPrepareTerminalReconnectGraceActive(input: {
	nowMs: number;
	snapshot: PrepareSessionSnapshot;
}): boolean {
	// A completed session's terminal exits on purpose; that disconnect must
	// not resurrect the reconnect spinner or the setup command card.
	if (input.snapshot.lifecycleStatus === "completed") {
		return false;
	}
	if (input.snapshot.terminalConnection.status !== "disconnected") {
		return false;
	}
	const disconnectedAtMs = Date.parse(
		input.snapshot.terminalConnection.disconnectedAt ?? ""
	);
	if (!Number.isFinite(disconnectedAtMs)) {
		return false;
	}
	return (
		Math.max(0, input.nowMs - disconnectedAtMs) <
		PREPARE_SESSION_RECONNECT_GRACE_MS
	);
}

function findConnectTerminalAuthReasonCode(
	snapshot: PrepareSessionSnapshot
): string | null {
	const snapshotBlocker = snapshot.blockers.find(isTerminalAuthBlocker);
	if (snapshotBlocker) {
		return snapshotBlocker.reasonCode;
	}

	const stepBlocker = snapshot.steps.find(
		(step) =>
			step.id === "connect_terminal" &&
			step.state === "blocked" &&
			typeof step.blockerReasonCode === "string" &&
			step.blockerReasonCode.startsWith("prepare.auth.")
	);
	return stepBlocker?.blockerReasonCode ?? null;
}

function resolveTerminalSecondaryStatus(input: {
	snapshot: PrepareSessionSnapshot;
	webSocketStatus: PrepareWebSocketStatus;
}) {
	if (input.snapshot.phase === "waiting_for_agent_selection") {
		return "Choose local agents in Terminal to continue.";
	}
	return null;
}

function shouldShowConnectTerminalCard(
	step: PrepareStepSnapshot,
	snapshot: PrepareSessionSnapshot
) {
	if (
		snapshot.lifecycleStatus === "completed" ||
		snapshot.blockers.some(isHandoffStoppedBlocker)
	) {
		return false;
	}
	return (
		step.state !== "complete" ||
		snapshot.terminalConnection.status !== "connected"
	);
}

function resolveActiveStepId(snapshot: PrepareSessionSnapshot) {
	return (
		snapshot.steps.find(
			(step) =>
				step.state === "active" ||
				step.state === "waiting_for_user" ||
				step.state === "blocked" ||
				step.state === "terminal_disconnected"
		)?.id ?? null
	);
}

function resolveReadyStepId(snapshot: PrepareSessionSnapshot) {
	if (snapshot.phase !== "ready" && snapshot.lifecycleStatus !== "completed") {
		return null;
	}
	return (
		snapshot.steps.find(
			(step) => step.id === "ready" && step.state === "complete"
		)?.id ?? null
	);
}

function useNowMs(intervalMs: number, enabled = true) {
	const [nowMs, setNowMs] = useState(() => Date.now());

	useEffect(() => {
		if (!enabled) {
			return;
		}
		const intervalId = window.setInterval(() => {
			setNowMs(Date.now());
		}, intervalMs);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [enabled, intervalMs]);

	return nowMs;
}

function resolvePrepareCommandExpiry(input: {
	nowMs: number;
	opaqueTokenExpiresAt: string | null;
}): { isExpired: boolean; label: string | null } {
	if (input.opaqueTokenExpiresAt === null) {
		return { isExpired: false, label: null };
	}

	const date = new Date(input.opaqueTokenExpiresAt);
	if (Number.isNaN(date.getTime())) {
		return { isExpired: false, label: null };
	}
	if (date.getTime() <= input.nowMs) {
		return { isExpired: true, label: "Setup command expired." };
	}
	return {
		isExpired: false,
		label: `Setup command expires at ${date.toLocaleTimeString([], {
			hour: "numeric",
			minute: "2-digit",
		})}.`,
	};
}

function normalizeError(error: unknown): StructuredApiClientFailure | Error {
	if (isStructuredApiClientFailure(error)) {
		return error;
	}
	return error instanceof Error ? error : new Error("OpenMeld setup failed.");
}

function isPrepareSessionNotFoundError(error: unknown): boolean {
	const normalized = normalizeError(error);
	return (
		"code" in normalized && normalized.code === "prepare.session.not_found"
	);
}

function isPrepareSessionNavigationActionAlreadyStartedError(
	error: unknown
): boolean {
	const normalized = normalizeError(error);
	return (
		"code" in normalized &&
		normalized.code === "prepare.session.navigation_action_already_started"
	);
}

function isStructuredApiClientFailure(
	value: unknown
): value is StructuredApiClientFailure {
	return (
		typeof value === "object" &&
		value !== null &&
		"message" in value &&
		typeof (value as { message?: unknown }).message === "string" &&
		"status" in value &&
		"code" in value
	);
}
