import {
	findOpenMeldToolsUpdateFailureCode,
	formatLocalSetupActionLabel,
	formatOpenMeldToolsUpdateFailureMessage,
	resolveOpenMeldToolsUpdateTargetVersions,
} from "@openmeld/schemas";
import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalComponentUpdateStatus,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	OpenMeldToolsUpdateFailureCode,
	OpenMeldToolsUpdateOperation,
	OrganizationComputerOpenMeldTools,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
import { Bars } from "@openmeld/ui/components/bars";
import { Button, buttonVariants } from "@openmeld/ui/components/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@openmeld/ui/components/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@openmeld/ui/components/dialog";
import {
	DropdownMenu,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@openmeld/ui/components/dropdown-menu";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
import {
	Accordion,
	AccordionContent,
	AccordionItem,
	AccordionTrigger,
} from "@openmeld/ui/fluid/accordion";
import {
	FluidDropdownMenuCheckboxItem,
	FluidDropdownMenuContent,
	FluidDropdownMenuGroup,
	FluidDropdownMenuItem,
} from "@openmeld/ui/fluid/dropdown-menu";
import {
	resolveStatusToneIndicatorClassName,
	resolveStatusToneOutlineActionClassName,
	resolveStatusToneSoftTextClassName,
	resolveStatusToneStrongTextClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowsClockwiseIcon,
	CheckIcon,
	DesktopTowerIcon,
	DotsThreeIcon,
	InfoIcon,
	PlugIcon,
	PulseIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import type { QueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import {
	type ReactNode,
	type Ref,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { APP_MOBILE_TOUCH_TARGET_CLASS_NAME } from "#/components/app/app-touch-target";
import {
	canConfigureLocalComputer,
	getDesktopPlatform,
	openDesktopWeb,
} from "#/desktop/platform";
import { useDesktopComputerConnection } from "#/desktop/use-computer-connection";
import { useAuthSession } from "#/hooks/auth.hooks";
import {
	copyCliEntryCommand,
	formatWebCliCommand,
} from "#/lib/cli-entry-command";
import {
	type ComputerSummaryStatus,
	resolveCurrentLocalRuntimeComputerSummaryStatus,
	resolveOrganizationComputerSummaryStatus,
} from "#/lib/computer-summary-status";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import {
	requestPeopleComputerOpenMeldToolsUpdate,
	setPeopleComputerOpenMeldToolsMaintenance,
} from "#/lib/connect/local-runtimes";
import {
	hasOpenMeldToolsUpdate,
	isOpenMeldToolsComponentUpdateActionable,
	isOpenMeldToolsComponentUpdateRequired,
} from "#/lib/openmeld-tools-update";
import { useCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { refreshWebAgentReadinessSharedCaches } from "#/query/agents/execution-readiness";
import { startQueryKeys } from "#/query/query-keys";
import { resolveAgentsPageFocusedSurfaceClassName } from "./agents-page-agent-profile-helpers";
import { formatComputerReplyReadinessDescription } from "./agents-page-computer";
import {
	createExecutionTargetKey,
	formatMutationError,
	formatObservedAt,
	formatRuntimeLane,
} from "./agents-page-formatters";
import { resolveCurrentLocalRuntimeServiceActionLabel } from "./agents-page-service-action";
import { ComputerConnectionHistory } from "./computer-connection-history";
import { DisconnectComputerDialog } from "./disconnect-computer-dialog";

type AgentsPageController = ReturnType<typeof useLocalAgentRecoveryController>;

const COMPUTER_CONNECTION_CARD_TITLE = "Computer Connection";
const RECONNECT_MANUALLY_LABEL = "Reconnect Computer";
const UPDATE_MANUALLY_LABEL = "Update manually";
const UPDATE_STATUS_REFRESH_INTERVAL_MS = 2000;
const UPDATE_STATUS_MAX_REFRESH_ATTEMPTS = 60;
const UPDATE_STATUS_MAX_CONSECUTIVE_REFRESH_FAILURES = 3;
type PendingManagedUpdate =
	| {
			currentVersion: string;
			kind: "confirmation";
	  }
	| {
			kind: "operation";
			operation: OpenMeldToolsUpdateOperation;
	  };

export type OpenMeldServiceCardOwnerProps = {
	computer: LocalRuntimeComputer;
	connectionAction?: ReactNode;
	currentExpectedServiceVersion: string | null;
	currentLocalRuntimeReplyReadiness: CurrentLocalRuntimeReplyReadinessResponse | null;
	focusService: boolean;
	hasSelectedEnvironment: boolean;
	isReconcilingStatus: boolean;
	onCheckingStatusChange?: (checking: boolean) => void;
	onFocusConsumed?: () => void;
	organizationId: string;
	queryClient: QueryClient;
	replyReadiness: ComputerReplyReadiness | null;
	recovery: AgentsPageController;
	setupCompleteRefreshPending: boolean;
	view?: "owner";
};

type TeamOpenMeldServiceCardProps = {
	computer: {
		deviceDisplayName: string;
		openMeldTools?: OrganizationComputerOpenMeldTools | null;
		ownerLabel: string;
		serviceState:
			| "connected"
			| "needs_attention"
			| "not_connected"
			| "unknown"
			| null;
	};
	view: "team";
};

export function OpenMeldServiceCard(
	input: OpenMeldServiceCardOwnerProps | TeamOpenMeldServiceCardProps
) {
	if (input.view === "team") {
		return <TeamOpenMeldServiceCard computer={input.computer} />;
	}
	return (
		<OwnedOpenMeldServiceCard
			{...input}
			key={[
				input.recovery.storageScope,
				input.organizationId,
				input.computer.connectedComputerId,
				input.computer.deviceId,
				input.recovery.selectedExecutionTarget?.runtimeLane,
			].join(":")}
		/>
	);
}

function TeamOpenMeldServiceCard(input: {
	computer: TeamOpenMeldServiceCardProps["computer"];
}) {
	const status = resolveOrganizationComputerSummaryStatus(
		input.computer.serviceState
	);
	const statusDescription = resolveTeamOpenMeldToolsStatusDescription(
		input.computer
	);
	const serviceConnected =
		input.computer.serviceState === "connected" ||
		input.computer.serviceState === "needs_attention";
	const componentDetails = input.computer.openMeldTools
		? buildOpenMeldToolsComponentDetails({
				canManage: false,
				cliUpdate: input.computer.openMeldTools.cli,
				serviceConnected,
				serviceUpdate: input.computer.openMeldTools.service,
				serviceVersionDescription: formatOpenMeldServiceVersionDescription({
					expectedServiceVersion: null,
					serviceUpdate: input.computer.openMeldTools.service,
				}),
				serviceVersionValue: formatOpenMeldServiceVersionValue({
					expectedServiceVersion: null,
					serviceConnected,
					serviceUpdate: input.computer.openMeldTools.service,
				}),
				skillsUpdate: input.computer.openMeldTools.skills,
			})
		: null;
	return (
		<OpenMeldToolsCardFrame
			description={`Keeps OpenMeld Service connected and local agent tools ready on ${input.computer.deviceDisplayName}.`}
		>
			<div className="min-w-0 space-y-1.5">
				<p
					className={cn(
						"flex items-center gap-2 font-medium text-sm",
						resolveStatusToneStrongTextClassName(status.tone)
					)}
				>
					<span
						aria-hidden="true"
						className={cn(
							"status-dot",
							resolveStatusToneIndicatorClassName(status.tone)
						)}
					/>
					{status.label}
				</p>
				<p className="max-w-2xl text-muted-foreground text-xs leading-5">
					{statusDescription}
				</p>
			</div>
			{componentDetails ? (
				<OpenMeldToolsComponentDetails items={componentDetails} />
			) : null}
		</OpenMeldToolsCardFrame>
	);
}

function resolveTeamOpenMeldToolsStatusDescription(
	computer: TeamOpenMeldServiceCardProps["computer"]
): string {
	switch (computer.serviceState) {
		case "connected":
			return "This computer is connected to OpenMeld.";
		case "needs_attention":
			return `${computer.ownerLabel} needs to update OpenMeld on this computer.`;
		case "not_connected":
			return `No active OpenMeld connection is reported for ${computer.ownerLabel} on this computer.`;
		default:
			return "OpenMeld is waiting for a current status from this computer.";
	}
}

function OwnedOpenMeldServiceCard(input: OpenMeldServiceCardOwnerProps) {
	const orgSlug = useCurrentOrganizationSlug();
	const [isCheckingStatus, setIsCheckingStatus] = useState(false);
	const [isUpdatingTools, setIsUpdatingTools] = useState(false);
	const [pendingManagedUpdate, setPendingManagedUpdate] =
		useState<PendingManagedUpdate | null>(null);
	const [updateRequestFailed, setUpdateRequestFailed] = useState(false);
	const [exhaustedUpdateVerificationKey, setExhaustedUpdateVerificationKey] =
		useState<string | null>(null);
	const [isSavingAutomaticUpdates, setIsSavingAutomaticUpdates] =
		useState(false);
	const [isServiceHighlighted, setIsServiceHighlighted] = useState(false);
	const serviceCardRef = useRef<HTMLDivElement | null>(null);
	const highlightEndTimerRef = useRef<number | null>(null);
	const settledPendingManagedUpdateRef = useRef<PendingManagedUpdate | null>(
		null
	);
	const updateVerificationBudgetRef = useRef({
		consecutiveFailures: 0,
		key: null as string | null,
		refreshAttempts: 0,
	});
	useEffect(() => {
		if (!(input.focusService && input.hasSelectedEnvironment)) {
			return;
		}

		const serviceCard = serviceCardRef.current;
		if (!serviceCard || typeof serviceCard.scrollIntoView !== "function") {
			return;
		}

		serviceCard.scrollIntoView({
			behavior: "smooth",
			block: "center",
		});
		if (highlightEndTimerRef.current !== null) {
			window.clearTimeout(highlightEndTimerRef.current);
		}
		setIsServiceHighlighted(true);
		highlightEndTimerRef.current = window.setTimeout(() => {
			setIsServiceHighlighted(false);
			highlightEndTimerRef.current = null;
		}, 1800);
		input.onFocusConsumed?.();
	}, [input.focusService, input.hasSelectedEnvironment, input.onFocusConsumed]);

	useEffect(() => {
		return () => {
			if (highlightEndTimerRef.current !== null) {
				window.clearTimeout(highlightEndTimerRef.current);
			}
		};
	}, []);

	const checkServiceStatus = async () => {
		setIsCheckingStatus(true);
		input.onCheckingStatusChange?.(true);
		try {
			await refreshWebAgentReadinessSharedCaches({
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				storageScope: input.recovery.storageScope,
			});
			await input.recovery.refreshAll();
		} catch (error) {
			toast.error(
				formatMutationError(error, "Could not check OpenMeld status.")
			);
		} finally {
			setIsCheckingStatus(false);
			input.onCheckingStatusChange?.(false);
		}
	};
	const refreshServiceStatus = useCallback(async () => {
		await refreshWebAgentReadinessSharedCaches({
			organizationId: input.organizationId,
			queryClient: input.queryClient,
			storageScope: input.recovery.storageScope,
		});
		await input.recovery.refreshAll();
	}, [
		input.queryClient,
		input.organizationId,
		input.recovery.refreshAll,
		input.recovery.storageScope,
	]);
	const observedLocalComponents =
		input.currentLocalRuntimeReplyReadiness?.localComponents ?? null;
	const pendingManagedUpdateSettled = pendingManagedUpdate
		? hasObservedPendingManagedUpdateSettled({
				localComponents: observedLocalComponents,
				pending: pendingManagedUpdate,
			}) ||
			hasObservedFailedManagedUpdate({
				localComponents: observedLocalComponents,
				pending: pendingManagedUpdate,
			})
		: false;
	const activePendingManagedUpdate =
		pendingManagedUpdate &&
		!pendingManagedUpdateSettled &&
		settledPendingManagedUpdateRef.current !== pendingManagedUpdate
			? pendingManagedUpdate
			: null;
	const visibleUpdateOperation = resolveVisibleOpenMeldToolsUpdateOperation({
		observed: observedLocalComponents?.updateOperation ?? null,
		pending: activePendingManagedUpdate,
	});
	const updateTargetVersion = resolveOpenMeldToolsUpdateTargetVersion({
		operation: visibleUpdateOperation,
		pending: activePendingManagedUpdate,
	});
	const updateTargetObserved = hasObservedOpenMeldToolsUpdateTarget({
		localComponents: observedLocalComponents,
		operation: visibleUpdateOperation,
		targetVersion: updateTargetVersion,
	});
	const updateVerificationKey = resolveOpenMeldToolsUpdateVerificationKey({
		operation: visibleUpdateOperation,
		pending: activePendingManagedUpdate,
		targetObserved: updateTargetObserved,
	});
	const updateVerificationExhausted =
		updateVerificationKey !== null &&
		exhaustedUpdateVerificationKey === updateVerificationKey;
	useEffect(() => {
		if (pendingManagedUpdate && pendingManagedUpdateSettled) {
			settledPendingManagedUpdateRef.current = pendingManagedUpdate;
		}
	}, [pendingManagedUpdate, pendingManagedUpdateSettled]);
	useEffect(() => {
		if (!updateVerificationKey || updateVerificationExhausted) {
			return;
		}
		let cancelled = false;
		let refreshTimer: number | null = null;
		if (updateVerificationBudgetRef.current.key !== updateVerificationKey) {
			updateVerificationBudgetRef.current = {
				consecutiveFailures: 0,
				key: updateVerificationKey,
				refreshAttempts: 0,
			};
		}
		const verificationBudget = updateVerificationBudgetRef.current;
		const refreshUntilSettled = async () => {
			verificationBudget.refreshAttempts += 1;
			try {
				await refreshServiceStatus();
				verificationBudget.consecutiveFailures = 0;
			} catch (error) {
				verificationBudget.consecutiveFailures += 1;
				console.error("OpenMeld Tools update status refresh failed.", error);
			}
			if (cancelled) {
				return;
			}
			if (
				verificationBudget.refreshAttempts >=
					UPDATE_STATUS_MAX_REFRESH_ATTEMPTS ||
				verificationBudget.consecutiveFailures >=
					UPDATE_STATUS_MAX_CONSECUTIVE_REFRESH_FAILURES
			) {
				setExhaustedUpdateVerificationKey(updateVerificationKey);
				return;
			}
			refreshTimer = window.setTimeout(
				refreshUntilSettled,
				UPDATE_STATUS_REFRESH_INTERVAL_MS
			);
		};
		refreshTimer = window.setTimeout(
			refreshUntilSettled,
			UPDATE_STATUS_REFRESH_INTERVAL_MS
		);
		return () => {
			cancelled = true;
			if (refreshTimer !== null) {
				window.clearTimeout(refreshTimer);
			}
		};
	}, [
		refreshServiceStatus,
		updateVerificationExhausted,
		updateVerificationKey,
	]);
	const updateOpenMeldTools = async () => {
		setUpdateRequestFailed(false);
		setExhaustedUpdateVerificationKey(null);
		updateVerificationBudgetRef.current = {
			consecutiveFailures: 0,
			key: null,
			refreshAttempts: 0,
		};
		setIsUpdatingTools(true);
		try {
			const target = input.currentLocalRuntimeReplyReadiness?.currentTarget;
			if (target?.availability !== "resolved") {
				throw new Error("Choose a computer environment first.");
			}
			const result = await requestPeopleComputerOpenMeldToolsUpdate(target);
			if (result.status === "current") {
				setPendingManagedUpdate({
					currentVersion: result.currentVersion,
					kind: "confirmation",
				});
				await refreshServiceStatus();
			} else if (
				result.status === "started" ||
				result.status === "already_running"
			) {
				setPendingManagedUpdate({
					kind: "operation",
					operation: result.operation,
				});
				input.queryClient.setQueryData<CurrentLocalRuntimeReplyReadinessResponse>(
					[
						...startQueryKeys.currentLocalRuntimeReplyReadiness(
							input.recovery.storageScope
						),
						target.deviceId,
						target.runtimeLane,
					],
					(current) =>
						current
							? {
									...current,
									localComponents: {
										...current.localComponents,
										updateOperation: result.operation,
									},
								}
							: current
				);
			} else {
				setPendingManagedUpdate(null);
				setUpdateRequestFailed(true);
				toast.error("Update failed.");
			}
		} catch (error) {
			console.error("OpenMeld Tools update request failed.", error);
			setPendingManagedUpdate(null);
			setUpdateRequestFailed(true);
			toast.error("Update failed.");
		} finally {
			setIsUpdatingTools(false);
		}
	};
	const setAutomaticUpdates = async (automaticUpdatesEnabled: boolean) => {
		setIsSavingAutomaticUpdates(true);
		try {
			const target = input.currentLocalRuntimeReplyReadiness?.currentTarget;
			if (target?.availability !== "resolved") {
				throw new Error("Choose a computer environment first.");
			}
			await setPeopleComputerOpenMeldToolsMaintenance({
				deviceId: target.deviceId,
				runtimeLane: target.runtimeLane,
				automaticUpdatesEnabled,
			});
			await refreshServiceStatus();
		} catch (error) {
			toast.error(formatMutationError(error, "Setting not saved."));
		} finally {
			setIsSavingAutomaticUpdates(false);
		}
	};
	const setupPath = buildConnectComputerPath({
		...(input.computer.connectedComputerId
			? { connectedComputerId: input.computer.connectedComputerId }
			: {}),
		orgSlug,
		session: "fresh",
	});

	if (!input.hasSelectedEnvironment) {
		const setupLabel = "Set up";
		const needsSelection = input.computer.executionTargets.length > 1;
		const showSetup = canConfigureLocalComputer(!needsSelection);
		return (
			<OpenMeldToolsCardFrame
				action={
					<OpenMeldServiceMoreMenu
						isCheckingStatus={false}
						onCheckStatus={checkServiceStatus}
						setupLabel={setupLabel}
						setupPath={setupPath}
						showCheckStatus={false}
					/>
				}
				connectionAction={input.connectionAction}
				description="Connects this computer to OpenMeld and manages local tools."
			>
				<p className="text-muted-foreground text-sm">
					{selectedComputerConnectionLabel(
						input.currentLocalRuntimeReplyReadiness,
						input.replyReadiness
					)}
				</p>
				<p className="text-muted-foreground text-sm">
					{needsSelection
						? "This computer has multiple Service connections. Open Advanced connection details below to choose one."
						: "Connect this computer to view its tools and manage updates."}
				</p>
				{input.currentLocalRuntimeReplyReadiness?.primaryBlocker !== "none" &&
				input.currentLocalRuntimeReplyReadiness ? (
					<p className="text-muted-foreground text-sm">
						{input.currentLocalRuntimeReplyReadiness.message}
					</p>
				) : null}
				{showSetup ? (
					<Link
						className={cn(
							buttonVariants({ size: "sm", variant: "outline" }),
							"w-fit"
						)}
						to={setupPath}
					>
						{setupLabel}
					</Link>
				) : null}
				<ComputerReportDetails computer={input.computer} />
			</OpenMeldToolsCardFrame>
		);
	}

	const serviceUpdatePath = buildConnectComputerPath({
		...(input.computer.connectedComputerId
			? { connectedComputerId: input.computer.connectedComputerId }
			: {}),
		orgSlug,
		serviceAction: "update_service",
		session: "fresh",
	});
	let serviceContent: ReactNode;
	if (input.isReconcilingStatus) {
		serviceContent = (
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Bars className="h-3 w-5" />
				Checking OpenMeld status...
			</p>
		);
	} else if (input.replyReadiness === null) {
		serviceContent = (
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Bars className="h-3 w-5" />
				Loading OpenMeld status...
			</p>
		);
	} else {
		serviceContent = (
			<CurrentLocalRuntimeServiceFacts
				computer={input.computer}
				connectionHistory={
					<>
						<ComputerConnectionHistory
							storageScope={input.recovery.storageScope}
							target={input.currentLocalRuntimeReplyReadiness?.currentTarget}
						/>
						<ComputerReportDetails computer={input.computer} />
					</>
				}
				currentLocalRuntimeReplyReadiness={
					input.currentLocalRuntimeReplyReadiness
				}
				executionTarget={input.recovery.selectedExecutionTarget}
				expectedServiceVersion={input.currentExpectedServiceVersion}
				isCheckingStatus={isCheckingStatus}
				isSavingAutomaticUpdates={isSavingAutomaticUpdates}
				isUpdatingTools={isUpdatingTools}
				onAutomaticUpdatesChange={setAutomaticUpdates}
				onUpdateOpenMeldTools={updateOpenMeldTools}
				pendingManagedUpdate={activePendingManagedUpdate}
				replyReadiness={input.replyReadiness}
				serviceUpdatePath={serviceUpdatePath}
				setupCompleteRefreshPending={input.setupCompleteRefreshPending}
				setupPath={setupPath}
				updateRequestFailed={updateRequestFailed}
				updateVerificationExhausted={updateVerificationExhausted}
			/>
		);
	}

	return (
		<OpenMeldToolsCardFrame
			action={
				<OpenMeldServiceMoreMenu
					automaticUpdatesEnabled={
						input.currentLocalRuntimeReplyReadiness?.localComponents.maintenance
							?.automaticUpdatesEnabled
					}
					computerName={input.computer.deviceDisplayName}
					disconnectTarget={
						input.currentLocalRuntimeReplyReadiness?.currentTarget
					}
					isCheckingStatus={isCheckingStatus}
					isSavingAutomaticUpdates={isSavingAutomaticUpdates}
					onAutomaticUpdatesChange={setAutomaticUpdates}
					onCheckStatus={checkServiceStatus}
					setupPath={setupPath}
				/>
			}
			cardRef={serviceCardRef}
			className={cn(
				resolveAgentsPageFocusedSurfaceClassName(isServiceHighlighted)
			)}
			connectionAction={input.connectionAction}
			description="Connects this computer to OpenMeld and manages local tools."
		>
			{serviceContent}
		</OpenMeldToolsCardFrame>
	);
}

function OpenMeldToolsCardFrame(input: {
	action?: ReactNode;
	connectionAction?: ReactNode;
	cardRef?: Ref<HTMLDivElement>;
	children: ReactNode;
	className?: string;
	description: string;
}) {
	return (
		<Card
			className={input.className}
			data-testid="openmeld-service-card"
			ref={input.cardRef}
		>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<PulseIcon className="h-5 w-5" />
					{COMPUTER_CONNECTION_CARD_TITLE}
				</CardTitle>
				<CardDescription>{input.description}</CardDescription>
				{input.action || input.connectionAction ? (
					<CardAction className="flex flex-wrap items-center justify-end gap-2">
						{input.connectionAction}
						{input.action}
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{input.children}
			</CardContent>
		</Card>
	);
}

function DesktopComputerRecovery(input: {
	action: OpenMeldToolsAction | null;
	computer: LocalRuntimeComputer;
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null;
}) {
	const connection = useDesktopComputerConnection();
	const accountId = useAuthSession().data?.user.id;
	const [state, setState] = useState<"idle" | "opening" | "opened" | "failed">(
		"idle"
	);
	const opening = useRef(false);
	const active = useRef(true);
	useEffect(() => {
		active.current = true;
		return () => {
			active.current = false;
		};
	}, []);
	const target = input.readiness?.currentTarget;
	const targetKnown =
		target?.availability === "resolved" &&
		input.computer.executionTargets.some(
			(candidate) =>
				candidate.deviceId === target.deviceId &&
				candidate.runtimeLane === target.runtimeLane
		);
	if (!getDesktopPlatform()) {
		return null;
	}
	if (
		!(
			targetKnown &&
			input.computer.connectedComputerId &&
			input.action?.kind === "link"
		)
	) {
		return null;
	}
	const path = input.action.path;
	const desktop = getDesktopPlatform();
	const isUpdate = input.action.label === UPDATE_MANUALLY_LABEL;
	const local = connection.data;
	const canUseNativeAction =
		local?.status === "available" &&
		local.accountId === accountId &&
		target?.availability === "resolved" &&
		local.target.deviceId === target.deviceId &&
		local.target.runtimeLane === target.runtimeLane &&
		Boolean(isUpdate ? desktop?.updateComputer : desktop?.connectComputer);
	if (canUseNativeAction) {
		return (
			<div className="space-y-2 border-t pt-3">
				<Link
					className={buttonVariants({ size: "sm", variant: "outline" })}
					to={path}
				>
					{isUpdate ? "Update OpenMeld" : "Reconnect computer"}
				</Link>
				<p className="text-muted-foreground text-xs">
					Continue in OpenMeld to {isUpdate ? "update" : "reconnect"} this
					computer.
				</p>
			</div>
		);
	}
	const open = async () => {
		if (opening.current) {
			return;
		}
		opening.current = true;
		setState("opening");
		try {
			await openDesktopWeb(path);
			if (active.current) {
				setState("opened");
			}
		} catch {
			if (active.current) {
				setState("failed");
			}
		} finally {
			opening.current = false;
		}
	};
	const label =
		input.action.label === UPDATE_MANUALLY_LABEL
			? "Update in browser"
			: "Reconnect in browser";
	return (
		<div className="space-y-2 border-t pt-3">
			<Button
				disabled={state === "opening"}
				onClick={open}
				size="sm"
				variant="outline"
			>
				{state === "opening" ? "Opening browser…" : label}
			</Button>
			<p className="text-muted-foreground text-xs">
				Run any setup command on {input.computer.deviceDisplayName}, the
				computer shown on this card. Sign in to its owner's account in the
				browser.
			</p>
			{state === "opened" ? (
				<output className="text-muted-foreground text-xs">
					Continue in your browser.
				</output>
			) : null}
			{state === "failed" ? (
				<p className="text-destructive text-xs" role="alert">
					Could not open the browser. Try again.
				</p>
			) : null}
		</div>
	);
}

function OpenMeldServiceMoreMenu(input: {
	automaticUpdatesEnabled?: boolean;
	isSavingAutomaticUpdates?: boolean;
	onAutomaticUpdatesChange?: (enabled: boolean) => Promise<void>;
	isCheckingStatus: boolean;
	onCheckStatus: () => Promise<void>;
	setupLabel?: string;
	setupPath: string;
	showCheckStatus?: boolean;
	disconnectTarget?: CurrentLocalRuntimeReplyReadinessResponse["currentTarget"];
	computerName?: string;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const [showDisconnect, setShowDisconnect] = useState(false);
	const navigate = useNavigate();
	const disconnectTarget =
		input.disconnectTarget?.availability === "resolved"
			? input.disconnectTarget
			: undefined;
	const showCheckStatus = input.showCheckStatus ?? true;
	const setupLabel = input.setupLabel ?? RECONNECT_MANUALLY_LABEL;
	return (
		<>
			<DropdownMenu onOpenChange={setIsOpen} open={isOpen}>
				<DropdownMenuTrigger
					render={
						<Button
							aria-label="OpenMeld options"
							size="icon"
							type="button"
							variant="ghost"
						/>
					}
				>
					<DotsThreeIcon aria-hidden="true" />
				</DropdownMenuTrigger>
				<FluidDropdownMenuContent align="end">
					{canConfigureLocalComputer() &&
					typeof input.automaticUpdatesEnabled === "boolean" ? (
						<>
							<FluidDropdownMenuCheckboxItem
								checked={input.automaticUpdatesEnabled}
								closeOnClick={false}
								disabled={
									input.isSavingAutomaticUpdates ||
									!input.onAutomaticUpdatesChange
								}
								index={0}
								onCheckedChange={(enabled) => {
									input
										.onAutomaticUpdatesChange?.(enabled)
										.catch(() => toast.error("Setting not saved."));
								}}
							>
								Automatic updates
							</FluidDropdownMenuCheckboxItem>
							<DropdownMenuSeparator />
						</>
					) : null}
					<FluidDropdownMenuGroup>
						{showCheckStatus ? (
							<FluidDropdownMenuItem
								disabled={input.isCheckingStatus}
								index={0}
								onClick={() => {
									input
										.onCheckStatus()
										.catch((error: unknown) =>
											console.error(
												"Failed to check OpenMeld tools state.",
												error
											)
										);
								}}
							>
								<ArrowsClockwiseIcon aria-hidden="true" />
								{input.isCheckingStatus ? "Checking..." : "Check status"}
							</FluidDropdownMenuItem>
						) : null}
						{canConfigureLocalComputer() ? (
							<FluidDropdownMenuItem
								index={1}
								onClick={() => {
									navigate({ to: input.setupPath }).catch((error: Error) =>
										toast.error(error.message)
									);
								}}
							>
								<WrenchIcon aria-hidden="true" />
								{setupLabel}
							</FluidDropdownMenuItem>
						) : null}
					</FluidDropdownMenuGroup>
					{canConfigureLocalComputer() && disconnectTarget ? (
						<>
							<DropdownMenuSeparator />
							<FluidDropdownMenuGroup>
								<FluidDropdownMenuItem
									index={0}
									onClick={() => setShowDisconnect(true)}
								>
									<PlugIcon aria-hidden="true" />
									Disconnect Computer…
								</FluidDropdownMenuItem>
							</FluidDropdownMenuGroup>
						</>
					) : null}
				</FluidDropdownMenuContent>
			</DropdownMenu>
			{showDisconnect && disconnectTarget ? (
				<DisconnectComputerDialog
					computerName={input.computerName ?? "Computer"}
					onClose={() => setShowDisconnect(false)}
					target={disconnectTarget}
				/>
			) : null}
		</>
	);
}

function selectedComputerConnectionLabel(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null,
	display: ComputerReplyReadiness | null
): string {
	if (readiness?.service.connected === true) {
		return "Connected";
	}
	if (readiness?.primaryBlocker === "service_not_connected") {
		return (
			resolveCurrentLocalRuntimeComputerSummaryStatus({ readiness })?.label ??
			"Connection status unavailable"
		);
	}
	if (display?.status === "checking") {
		return "Checking connection…";
	}
	return "Connection status unavailable";
}

function ComputerReportDetails(input: { computer: LocalRuntimeComputer }) {
	if (input.computer.executionTargets.length < 2) {
		return null;
	}

	return (
		<details
			className="border-t pt-3 text-sm"
			data-testid="read-only-runtime-target-status"
		>
			<summary className="cursor-pointer font-medium text-muted-foreground text-sm leading-8">
				Connection reports
			</summary>
			<p className="py-3 text-muted-foreground text-xs">
				Saved reports are not proof of a current connection.
			</p>
			<div className="divide-y">
				{input.computer.executionTargets.map((target) => (
					<div
						className="flex flex-wrap items-baseline justify-between gap-2 py-3"
						key={createExecutionTargetKey(target)}
					>
						<p>
							{formatRuntimeLane(target.runtimeLane)}{" "}
							<span className="text-muted-foreground">
								· {target.deviceId.slice(-8)}
							</span>
						</p>
						<p className="text-muted-foreground text-xs">
							{formatObservedAt(target.lastObservedAtMs)}
						</p>
					</div>
				))}
			</div>
		</details>
	);
}

function CurrentLocalRuntimeServiceFacts(input: {
	computer: LocalRuntimeComputer;
	connectionHistory: ReactNode;
	currentLocalRuntimeReplyReadiness: CurrentLocalRuntimeReplyReadinessResponse | null;
	executionTarget: LocalRuntimeExecutionTarget | null;
	expectedServiceVersion: string | null;
	isCheckingStatus: boolean;
	isSavingAutomaticUpdates: boolean;
	isUpdatingTools: boolean;
	pendingManagedUpdate: PendingManagedUpdate | null;
	onAutomaticUpdatesChange: (enabled: boolean) => Promise<void>;
	onUpdateOpenMeldTools: () => Promise<void>;
	replyReadiness: ComputerReplyReadiness;
	serviceUpdatePath: string;
	setupPath: string;
	setupCompleteRefreshPending: boolean;
	updateVerificationExhausted: boolean;
	updateRequestFailed: boolean;
}) {
	const hasCurrentServiceObservation =
		input.currentLocalRuntimeReplyReadiness !== null;
	const serviceConnected = hasCurrentServiceObservation
		? isCurrentLocalRuntimeServiceConnected(
				input.currentLocalRuntimeReplyReadiness
			)
		: input.replyReadiness.status === "ready";
	const localComponents =
		input.currentLocalRuntimeReplyReadiness?.localComponents ?? null;
	const maintenance = localComponents?.maintenance ?? null;
	const updateOperation = resolveVisibleOpenMeldToolsUpdateOperation({
		observed: localComponents?.updateOperation ?? null,
		pending: input.pendingManagedUpdate,
	});
	const updateTargetVersion = resolveOpenMeldToolsUpdateTargetVersion({
		operation: updateOperation,
		pending: input.pendingManagedUpdate,
	});
	const updateTargetObserved = hasObservedOpenMeldToolsUpdateTarget({
		localComponents,
		operation: updateOperation,
		targetVersion: updateTargetVersion,
	});
	const updateIsActive =
		!input.updateVerificationExhausted &&
		(input.isUpdatingTools ||
			input.pendingManagedUpdate !== null ||
			updateOperation?.phase === "updating" ||
			updateOperation?.phase === "waiting_for_work" ||
			(updateOperation?.phase === "updated" && !updateTargetObserved));
	const serviceUpdate = localComponents?.service ?? null;
	const cliUpdate = resolveOpenMeldToolsCliUpdate(localComponents);
	const updateFailureCode = resolveOpenMeldToolsUpdateFailureCode(cliUpdate);
	const skillsUpdate = resolveOpenMeldToolsSkillsUpdate(localComponents);
	const requiredServiceUpdate =
		isOpenMeldToolsComponentUpdateRequired(serviceUpdate);
	const setupCompleteRefreshChecking =
		input.setupCompleteRefreshPending && requiredServiceUpdate;
	const computerSummaryStatus = resolveCurrentLocalRuntimeComputerSummaryStatus(
		{
			executionTarget: input.executionTarget,
			readiness: input.currentLocalRuntimeReplyReadiness,
		}
	);
	const display = resolveCurrentLocalRuntimeServiceDisplay({
		cliUpdate,
		computerSummaryStatus,
		currentReadiness: input.currentLocalRuntimeReplyReadiness,
		isCheckingStatus: input.isCheckingStatus,
		replyReadiness: input.replyReadiness,
		requiredServiceUpdate,
		serviceUpdate,
		serviceConnected,
		serviceDisconnected: hasCurrentServiceObservation && !serviceConnected,
		serviceAccountConflict:
			input.currentLocalRuntimeReplyReadiness?.service.reasonCodes.includes(
				"daemon.session.reject_conflict"
			) ?? false,
		serviceUpdatePath: input.serviceUpdatePath,
		setupCompleteRefreshChecking,
		setupPath: input.setupPath,
		skillsUpdate,
	});
	const serviceVersionValue = formatOpenMeldServiceVersionValue({
		expectedServiceVersion: input.expectedServiceVersion,
		serviceConnected,
		serviceUpdate,
	});
	const serviceVersionDescription = formatOpenMeldServiceVersionDescription({
		expectedServiceVersion: input.expectedServiceVersion,
		serviceUpdate,
	});
	const componentDetails = buildOpenMeldToolsComponentDetails({
		canManage: canConfigureLocalComputer(),
		cliUpdate,
		serviceConnected,
		serviceUpdate,
		serviceVersionDescription,
		serviceVersionValue,
		skillsUpdate,
	});
	const displayAction = resolveCoreActionableOpenMeldToolsDisplayAction({
		action: display.primaryAction,
		localComponents,
	});
	const primaryAction = resolveCurrentOpenMeldToolsPrimaryAction({
		displayAction,
		maintenanceAvailable: maintenance !== null,
		onUpdateOpenMeldTools: input.onUpdateOpenMeldTools,
		updateIsActive,
	});
	return (
		<div className="flex flex-col">
			<div
				className={cn(
					"flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between",
					display.hideVersionDetails ? "py-1" : "pb-4"
				)}
			>
				<div className="min-w-0 space-y-1.5">
					<p
						className={cn(
							"flex items-center gap-2 font-medium text-sm",
							resolveOpenMeldServiceStatusTextClassName(display.tone)
						)}
					>
						<span
							aria-hidden="true"
							className={cn(
								"status-dot",
								resolveOpenMeldServiceStatusDotClassName(display.tone)
							)}
						/>
						{display.statusLabel}
					</p>
					<p
						className={cn(
							"max-w-2xl text-xs leading-5",
							display.descriptionTone === "warning"
								? resolveStatusToneSoftTextClassName("warning")
								: "text-muted-foreground"
						)}
					>
						{display.description}
					</p>
				</div>
				{canConfigureLocalComputer() && primaryAction ? (
					<div className="flex w-fit shrink-0 items-center gap-3">
						{primaryAction.kind === "managed" ? (
							<Link
								className="text-muted-foreground text-xs underline-offset-4 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
								to={input.serviceUpdatePath}
							>
								{UPDATE_MANUALLY_LABEL}
							</Link>
						) : null}
						<OpenMeldToolsActionControl
							action={primaryAction}
							className="w-fit shrink-0"
							tone={display.tone}
						/>
					</div>
				) : null}
			</div>
			<DesktopComputerRecovery
				action={displayAction}
				computer={input.computer}
				key={JSON.stringify(
					input.currentLocalRuntimeReplyReadiness?.currentTarget
				)}
				readiness={input.currentLocalRuntimeReplyReadiness}
			/>
			<OpenMeldToolsUpdateFeedback
				confirmationPending={
					input.pendingManagedUpdate?.kind === "confirmation"
				}
				failureCode={updateFailureCode}
				operation={updateOperation}
				requestFailed={input.updateRequestFailed && updateOperation === null}
				requesting={input.isUpdatingTools}
				targetObserved={updateTargetObserved}
				verificationExhausted={input.updateVerificationExhausted}
			/>

			<Accordion>
				<AccordionItem value="technical-details">
					<AccordionTrigger className="border-t py-3 font-medium text-muted-foreground text-sm">
						Technical details
					</AccordionTrigger>
					<AccordionContent>
						<div className="space-y-3 pb-3 pl-4">
							<OpenMeldToolsUpdateDetails
								failureCode={updateFailureCode}
								operation={updateOperation}
								readiness={input.currentLocalRuntimeReplyReadiness}
							/>
							{display.hideVersionDetails ? null : (
								<details className="border-t pt-3">
									<summary className="cursor-pointer font-medium text-muted-foreground text-sm leading-8">
										Software versions
									</summary>
									<div className="pt-3">
										<OpenMeldToolsComponentDetails items={componentDetails} />
									</div>
								</details>
							)}
							{input.connectionHistory}
						</div>
					</AccordionContent>
				</AccordionItem>
			</Accordion>
		</div>
	);
}

type CurrentLocalRuntimeServiceDisplay = {
	description: string;
	descriptionTone: "muted" | "warning";
	hideVersionDetails: boolean;
	primaryAction: OpenMeldToolsAction | null;
	statusLabel: string;
	tone: OpenMeldServiceVisualTone;
};

type CurrentLocalRuntimeServiceDisplayInput = {
	cliUpdate: OpenMeldToolsCliUpdate | null;
	computerSummaryStatus: ComputerSummaryStatus | null;
	currentReadiness: CurrentLocalRuntimeReplyReadinessResponse | null;
	isCheckingStatus: boolean;
	replyReadiness: ComputerReplyReadiness;
	requiredServiceUpdate: boolean;
	serviceUpdate:
		| CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["service"]
		| null;
	serviceConnected: boolean;
	serviceDisconnected: boolean;
	serviceAccountConflict?: boolean;
	serviceUpdatePath: string;
	setupCompleteRefreshChecking: boolean;
	setupPath: string;
	skillsUpdate: OpenMeldToolsSkillsUpdate | null;
};

function resolveCurrentLocalRuntimeServiceDisplay(
	input: CurrentLocalRuntimeServiceDisplayInput
): CurrentLocalRuntimeServiceDisplay {
	const serviceBoundaryDisplay =
		resolveOpenMeldToolsServiceBoundaryDisplay(input);
	if (serviceBoundaryDisplay) {
		return serviceBoundaryDisplay;
	}
	const updateDisplay = resolveOpenMeldToolsUpdateDisplay(input);
	return updateDisplay ?? resolveOpenMeldToolsDefaultDisplay(input);
}

function resolveOpenMeldToolsServiceBoundaryDisplay(
	input: CurrentLocalRuntimeServiceDisplayInput
): CurrentLocalRuntimeServiceDisplay | null {
	if (input.setupCompleteRefreshChecking) {
		return {
			description: "OpenMeld is checking Service, CLI, and skill status.",
			descriptionTone: "muted",
			hideVersionDetails: true,
			primaryAction: null,
			statusLabel: "Checking OpenMeld",
			tone: "checking",
		};
	}

	if (input.serviceAccountConflict) {
		return {
			description:
				"This computer is connected to another OpenMeld account. Reconnect it to use it with this account.",
			descriptionTone: "muted",
			hideVersionDetails: false,
			primaryAction: {
				kind: "link",
				label: RECONNECT_MANUALLY_LABEL,
				path: input.setupPath,
			},
			statusLabel: "Reconnect required",
			tone: "warning",
		};
	}
	if (input.serviceDisconnected) {
		return {
			description:
				"This computer may be asleep, offline, or not running OpenMeld. Make sure it is awake and online. If it stays disconnected, reconnect it.",
			descriptionTone: "muted",
			hideVersionDetails: false,
			primaryAction: {
				kind: "link",
				label: RECONNECT_MANUALLY_LABEL,
				path: input.setupPath,
			},
			statusLabel: "Disconnected",
			tone: "muted",
		};
	}

	if (
		input.requiredServiceUpdate &&
		input.computerSummaryStatus?.reason === "openmeld_tools_update"
	) {
		return {
			description:
				"Update OpenMeld to run local agents on this computer through OpenMeld.",
			descriptionTone: "muted",
			hideVersionDetails: false,
			primaryAction: buildOpenMeldToolsLinkAction(input.serviceUpdatePath),
			statusLabel: "Update required",
			tone: "warning",
		};
	}

	return null;
}

function resolveOpenMeldToolsUpdateDisplay(
	input: CurrentLocalRuntimeServiceDisplayInput
): CurrentLocalRuntimeServiceDisplay | null {
	const hasRequiredToolsUpdate =
		isOpenMeldToolsComponentUpdateRequired(input.serviceUpdate) ||
		isOpenMeldToolsComponentUpdateRequired(input.skillsUpdate) ||
		isOpenMeldToolsComponentUpdateRequired(input.cliUpdate);
	const hasServiceOrSkillsUpdate =
		isOpenMeldToolsComponentUpdateActionable(input.serviceUpdate) ||
		isOpenMeldToolsComponentUpdateActionable(input.skillsUpdate);
	const hasCliUpdate = isOpenMeldToolsComponentUpdateActionable(
		input.cliUpdate
	);
	if (!(input.serviceConnected && (hasServiceOrSkillsUpdate || hasCliUpdate))) {
		return null;
	}
	return {
		description: hasRequiredToolsUpdate
			? "Update OpenMeld to run local agents on this computer through OpenMeld."
			: "A newer version of OpenMeld is available.",
		descriptionTone: hasRequiredToolsUpdate ? "muted" : "warning",
		hideVersionDetails: false,
		primaryAction: buildOpenMeldToolsLinkAction(input.serviceUpdatePath),
		statusLabel: hasRequiredToolsUpdate
			? "Update required"
			: "Update available",
		tone: "warning",
	};
}

function resolveOpenMeldToolsDefaultDisplay(
	input: CurrentLocalRuntimeServiceDisplayInput
): CurrentLocalRuntimeServiceDisplay {
	if (
		input.serviceConnected &&
		input.currentReadiness?.primaryBlocker === "execution_host_unavailable"
	) {
		return {
			description: input.currentReadiness.message,
			descriptionTone: "warning",
			hideVersionDetails: false,
			primaryAction: null,
			statusLabel: "Local execution paused",
			tone: "warning",
		};
	}
	const primaryActionLabel = resolveOpenMeldServiceActionLabel({
		replyReadiness: input.replyReadiness,
		serviceConnected: input.serviceConnected,
	});
	const primaryAction = primaryActionLabel
		? {
				kind: "link" as const,
				label: primaryActionLabel,
				path: input.setupPath,
			}
		: null;
	const toolsReady =
		input.serviceConnected &&
		(input.replyReadiness.status === "ready" ||
			isLocalAgentControllerReportReadinessReason(
				input.replyReadiness.reasonCode
			));

	const tone = resolveCurrentLocalRuntimeServiceTone({
		isCheckingStatus: input.isCheckingStatus,
		replyReadiness: input.replyReadiness,
		serviceConnected: input.serviceConnected,
	});
	if (input.isCheckingStatus) {
		return {
			description: "OpenMeld is checking Service, CLI, and skill status.",
			descriptionTone: "muted",
			hideVersionDetails: false,
			primaryAction,
			statusLabel: "Checking OpenMeld",
			tone,
		};
	}
	if (toolsReady) {
		return {
			description: "This computer is connected to OpenMeld.",
			descriptionTone: "muted",
			hideVersionDetails: false,
			primaryAction,
			statusLabel: "Connected",
			tone,
		};
	}
	return {
		description: formatOpenMeldServiceDescription({
			replyReadiness: input.replyReadiness,
			serviceConnected: input.serviceConnected,
		}),
		descriptionTone: "muted",
		hideVersionDetails: false,
		primaryAction,
		statusLabel: formatCurrentLocalRuntimeServiceStatus({
			replyReadiness: input.replyReadiness,
			serviceConnected: input.serviceConnected,
		}),
		tone,
	};
}

function buildOpenMeldToolsLinkAction(path: string): OpenMeldToolsAction {
	return {
		kind: "link",
		label: UPDATE_MANUALLY_LABEL,
		path,
	};
}

function resolveCoreActionableOpenMeldToolsDisplayAction(input: {
	action: OpenMeldToolsAction | null;
	localComponents: OpenMeldToolsProjection | null;
}): OpenMeldToolsAction | null {
	if (
		input.action?.kind !== "link" ||
		input.action.label !== UPDATE_MANUALLY_LABEL
	) {
		return input.action;
	}
	return hasOpenMeldToolsUpdate(input.localComponents) ? input.action : null;
}

function resolveCurrentOpenMeldToolsPrimaryAction(input: {
	displayAction: OpenMeldToolsAction | null;
	maintenanceAvailable: boolean;
	onUpdateOpenMeldTools: () => Promise<void>;
	updateIsActive: boolean;
}): OpenMeldToolsAction | null {
	const managedUpdateCandidate =
		input.displayAction?.kind === "link" &&
		input.displayAction.label === UPDATE_MANUALLY_LABEL;
	if (!(input.maintenanceAvailable && managedUpdateCandidate)) {
		return input.displayAction;
	}
	return {
		disabled: input.updateIsActive,
		kind: "managed",
		label: input.updateIsActive ? "Updating…" : "Update",
		onClick: input.onUpdateOpenMeldTools,
	};
}

function resolveOpenMeldToolsUpdateTargetVersion(input: {
	operation: OpenMeldToolsUpdateOperation | null;
	pending: PendingManagedUpdate | null;
}): string | null {
	return input.pending?.kind === "confirmation"
		? input.pending.currentVersion
		: (input.operation?.targetVersion ?? null);
}

function hasObservedOpenMeldToolsUpdateTarget(input: {
	localComponents: OpenMeldToolsProjection | null;
	operation: OpenMeldToolsUpdateOperation | null;
	targetVersion: string | null;
}): boolean {
	let target: { cliVersion: string; serviceVersion: string } | null = null;
	if (input.operation) {
		target = resolveOpenMeldToolsUpdateTargetVersions(input.operation);
	} else if (input.targetVersion) {
		target = {
			cliVersion: input.targetVersion,
			serviceVersion: input.targetVersion,
		};
	}
	return Boolean(
		input.localComponents &&
			target &&
			input.localComponents.service.installedVersion ===
				target.serviceVersion &&
			input.localComponents.cli.installedPackageVersion === target.cliVersion
	);
}

function resolveOpenMeldToolsUpdateVerificationKey(input: {
	operation: OpenMeldToolsUpdateOperation | null;
	pending: PendingManagedUpdate | null;
	targetObserved: boolean;
}): string | null {
	if (input.pending?.kind === "confirmation" && !input.targetObserved) {
		return `confirmation:${input.pending.currentVersion}`;
	}
	if (
		!input.operation ||
		input.operation.phase === "restored" ||
		input.operation.phase === "needs_help" ||
		(input.operation.phase === "updated" && input.targetObserved)
	) {
		return null;
	}
	return [
		"operation",
		input.operation.operationId,
		input.operation.phase,
		input.operation.updatedAt,
		input.operation.targetVersion,
	].join(":");
}

function hasActionableOpenMeldToolsUpdate(
	localComponents: OpenMeldToolsProjection | null
): boolean {
	if (!localComponents) {
		return true;
	}
	return (
		isOpenMeldToolsComponentUpdateActionable(localComponents.service) ||
		isOpenMeldToolsComponentUpdateActionable(localComponents.skills) ||
		isOpenMeldToolsComponentUpdateActionable(localComponents.cli)
	);
}

function hasObservedPendingManagedUpdateSettled(input: {
	localComponents: OpenMeldToolsProjection | null;
	pending: PendingManagedUpdate;
}): boolean {
	if (!input.localComponents) {
		return false;
	}
	if (
		input.pending.kind === "confirmation" &&
		hasActionableOpenMeldToolsUpdate(input.localComponents)
	) {
		return false;
	}
	const expectedVersion =
		input.pending.kind === "confirmation"
			? input.pending.currentVersion
			: input.pending.operation.targetVersion;
	const exactTargetObserved = hasObservedOpenMeldToolsUpdateTarget({
		localComponents: input.localComponents,
		operation:
			input.pending.kind === "operation" ? input.pending.operation : null,
		targetVersion: expectedVersion,
	});
	if (input.pending.kind === "confirmation") {
		return exactTargetObserved;
	}
	const observedOperation = input.localComponents.updateOperation ?? null;
	return (
		exactTargetObserved &&
		observedOperation?.operationId === input.pending.operation.operationId &&
		observedOperation.phase === "updated"
	);
}

function hasObservedFailedManagedUpdate(input: {
	localComponents: OpenMeldToolsProjection | null;
	pending: PendingManagedUpdate;
}): boolean {
	if (input.pending.kind !== "operation") {
		return false;
	}
	const observedOperation = input.localComponents?.updateOperation ?? null;
	return (
		observedOperation?.operationId === input.pending.operation.operationId &&
		(observedOperation.phase === "restored" ||
			observedOperation.phase === "needs_help")
	);
}

function resolveVisibleOpenMeldToolsUpdateOperation(input: {
	observed: OpenMeldToolsUpdateOperation | null;
	pending: PendingManagedUpdate | null;
}): OpenMeldToolsUpdateOperation | null {
	const pendingOperation =
		input.pending?.kind === "operation" ? input.pending.operation : null;
	if (!pendingOperation) {
		return input.observed;
	}
	if (!input.observed) {
		return pendingOperation;
	}
	if (input.observed.operationId === pendingOperation.operationId) {
		const observedUpdatedAt = Date.parse(input.observed.updatedAt);
		const pendingUpdatedAt = Date.parse(pendingOperation.updatedAt);
		if (observedUpdatedAt !== pendingUpdatedAt) {
			return observedUpdatedAt > pendingUpdatedAt
				? input.observed
				: pendingOperation;
		}
		return resolveOpenMeldToolsUpdatePhaseOrder(input.observed.phase) >
			resolveOpenMeldToolsUpdatePhaseOrder(pendingOperation.phase)
			? input.observed
			: pendingOperation;
	}
	return Date.parse(input.observed.updatedAt) >=
		Date.parse(pendingOperation.updatedAt)
		? input.observed
		: pendingOperation;
}

function resolveOpenMeldToolsUpdatePhaseOrder(
	phase: OpenMeldToolsUpdateOperation["phase"]
): number {
	switch (phase) {
		case "waiting_for_work":
			return 0;
		case "updating":
			return 1;
		case "updated":
		case "restored":
		case "needs_help":
			return 2;
		default: {
			const exhaustive: never = phase;
			return exhaustive;
		}
	}
}

type OpenMeldToolsProjection =
	CurrentLocalRuntimeReplyReadinessResponse["localComponents"];
type OpenMeldToolsCliUpdate = OrganizationComputerOpenMeldTools["cli"];
type OpenMeldToolsServiceUpdate = OrganizationComputerOpenMeldTools["service"];
type OpenMeldToolsSkillsUpdate = OrganizationComputerOpenMeldTools["skills"];

function resolveOpenMeldToolsCliUpdate(
	localComponents: OpenMeldToolsProjection | null
): OpenMeldToolsCliUpdate | null {
	return (
		(localComponents as Partial<OpenMeldToolsProjection> | null)?.cli ?? null
	);
}

function resolveOpenMeldToolsSkillsUpdate(
	localComponents: OpenMeldToolsProjection | null
): OpenMeldToolsSkillsUpdate | null {
	return (
		(localComponents as Partial<OpenMeldToolsProjection> | null)?.skills ?? null
	);
}

function formatOpenMeldServiceVersionValue(input: {
	expectedServiceVersion: string | null;
	serviceConnected: boolean;
	serviceUpdate: OpenMeldToolsServiceUpdate | null;
}): string {
	const serviceUpdate = input.serviceUpdate;
	if (serviceUpdate?.installedVersion) {
		return `Installed v${serviceUpdate.installedVersion}`;
	}
	if (serviceUpdate?.wakeBlocked) {
		return "Installed version not reported";
	}
	if (input.expectedServiceVersion) {
		return `Latest v${input.expectedServiceVersion}`;
	}
	if (input.serviceConnected) {
		return "Version unavailable";
	}
	return "Not connected";
}

function formatOpenMeldServiceVersionDescription(input: {
	expectedServiceVersion: string | null;
	serviceUpdate: OpenMeldToolsServiceUpdate | null;
}): string | undefined {
	const serviceUpdate = input.serviceUpdate;
	if (!serviceUpdate) {
		return input.expectedServiceVersion
			? `Latest available: v${input.expectedServiceVersion}.`
			: undefined;
	}
	if (
		serviceUpdate.requiredVersion &&
		serviceUpdate.requiredVersion === serviceUpdate.latestVersion
	) {
		return `Update to v${serviceUpdate.requiredVersion}.`;
	}
	const details = [
		serviceUpdate.requiredVersion
			? `Required: v${serviceUpdate.requiredVersion}.`
			: null,
		serviceUpdate.latestVersion
			? `Latest available: v${serviceUpdate.latestVersion}.`
			: null,
	].filter((value): value is string => Boolean(value));
	return details.length > 0 ? details.join(" ") : undefined;
}
function resolveOpenMeldServiceActionLabel(input: {
	replyReadiness: ComputerReplyReadiness;
	serviceConnected: boolean;
}): string | null {
	if (
		input.serviceConnected &&
		(isLocalAgentControllerReportReadinessReason(
			input.replyReadiness.reasonCode
		) ||
			input.replyReadiness.reasonCode === "execution_host.unavailable")
	) {
		return null;
	}
	const actionLabel = resolveCurrentLocalRuntimeServiceActionLabel(
		input.replyReadiness
	);
	if (actionLabel === formatLocalSetupActionLabel("connect_local_agent")) {
		return null;
	}
	return actionLabel === formatLocalSetupActionLabel("reconnect_service")
		? RECONNECT_MANUALLY_LABEL
		: actionLabel;
}

function formatCurrentLocalRuntimeServiceStatus(input: {
	replyReadiness: ComputerReplyReadiness;
	serviceConnected: boolean;
}): string {
	if (input.replyReadiness.status === "ready") {
		return "OpenMeld Service is connected";
	}
	if (input.replyReadiness.status === "checking") {
		return "Checking status...";
	}
	if (
		input.replyReadiness.reasonCode === "background_helper.update_required" ||
		input.replyReadiness.reasonCode === "background_helper.installed_outdated"
	) {
		return "OpenMeld Service update required";
	}
	if (input.replyReadiness.reasonCode === "background_helper.not_running") {
		return "OpenMeld Service is not connected";
	}
	if (
		input.serviceConnected &&
		(isLocalAgentControllerReportReadinessReason(
			input.replyReadiness.reasonCode
		) ||
			input.replyReadiness.reasonCode === "execution_host.unavailable")
	) {
		return "OpenMeld Service is connected";
	}
	if (input.replyReadiness.status === "needs_setup") {
		return formatLocalSetupActionLabel("connect_service");
	}
	if (input.replyReadiness.status === "needs_repair") {
		return formatLocalSetupActionLabel("reconnect_service");
	}
	return "Connection status delayed";
}

function formatOpenMeldServiceDescription(input: {
	replyReadiness: ComputerReplyReadiness;
	serviceConnected: boolean;
}): string {
	if (input.replyReadiness.status === "checking") {
		return formatComputerReplyReadinessDescription(input.replyReadiness);
	}
	if (input.replyReadiness.status === "ready") {
		return "OpenMeld Service is connected on this computer.";
	}
	if (
		input.serviceConnected &&
		(isLocalAgentControllerReportReadinessReason(
			input.replyReadiness.reasonCode
		) ||
			input.replyReadiness.reasonCode === "execution_host.unavailable")
	) {
		return "OpenMeld Service is connected on this computer.";
	}
	if (
		isCurrentRuntimeSessionMissingReason(input.replyReadiness.detailReasonCode)
	) {
		return "OpenMeld Service is not connected for this account on this computer.";
	}
	if (input.replyReadiness.reasonCode === "background_helper.not_running") {
		return "Reconnect this computer to refresh OpenMeld and local agents.";
	}
	return formatComputerReplyReadinessDescription(input.replyReadiness);
}

function resolveCurrentLocalRuntimeServiceTone(input: {
	isCheckingStatus: boolean;
	replyReadiness: ComputerReplyReadiness;
	serviceConnected: boolean;
}): OpenMeldServiceVisualTone {
	if (input.isCheckingStatus || input.replyReadiness.status === "checking") {
		return "checking";
	}
	if (input.replyReadiness.status === "ready") {
		return "ready";
	}
	if (
		input.serviceConnected &&
		(isLocalAgentControllerReportReadinessReason(
			input.replyReadiness.reasonCode
		) ||
			input.replyReadiness.reasonCode === "execution_host.unavailable")
	) {
		return "ready";
	}
	if (input.replyReadiness.status === "needs_setup") {
		return "danger";
	}
	if (
		input.replyReadiness.reasonCode === "background_helper.update_required" ||
		input.replyReadiness.reasonCode === "background_helper.installed_outdated"
	) {
		return "warning";
	}
	if (input.replyReadiness.status === "needs_repair") {
		return "danger";
	}
	return "muted";
}

function isCurrentLocalRuntimeServiceConnected(
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null
): boolean {
	return (
		readiness?.service.connected === true &&
		readiness.service.matchingCurrentRuntime === true
	);
}

function isLocalAgentControllerReportReadinessReason(
	reasonCode: ComputerReplyReadiness["reasonCode"]
): boolean {
	return (
		reasonCode === "execution_target.partial" ||
		reasonCode === "execution_target.not_ready" ||
		reasonCode === "execution_target.stale" ||
		reasonCode === "execution_target.unknown"
	);
}

function isCurrentRuntimeSessionMissingReason(
	reasonCode: string | null
): boolean {
	return (
		reasonCode === "service.current_runtime_session_missing" ||
		reasonCode === "daemon.session.not_found"
	);
}

type OpenMeldServiceVisualTone =
	| "checking"
	| "danger"
	| "muted"
	| "ready"
	| "warning";

type OpenMeldToolsComponentDetailsItem = {
	description?: ReactNode;
	help?: {
		ariaLabel: string;
		content: ReactNode;
	};
	label: string;
	tone: OpenMeldServiceVisualTone;
	value: ReactNode;
};

type OpenMeldToolsAction =
	| {
			kind: "command";
			command: string;
			description: string;
			label: string;
			title: string;
	  }
	| {
			kind: "link";
			label: string;
			path: string;
	  }
	| {
			disabled: boolean;
			kind: "managed";
			label: string;
			onClick: () => Promise<void>;
	  };

function OpenMeldToolsUpdateFeedback(input: {
	confirmationPending: boolean;
	failureCode: OpenMeldToolsUpdateFailureCode | null;
	operation:
		| CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["updateOperation"]
		| null;
	requestFailed: boolean;
	requesting: boolean;
	targetObserved: boolean;
	verificationExhausted: boolean;
}) {
	const updateStatus = resolveOpenMeldToolsUpdateStatus(input);
	if (!updateStatus) {
		return null;
	}
	return (
		<p
			aria-atomic="true"
			aria-live="polite"
			className="pb-3 text-muted-foreground text-sm"
		>
			{updateStatus}
		</p>
	);
}

function OpenMeldToolsUpdateDetails(input: {
	readiness: CurrentLocalRuntimeReplyReadinessResponse | null;
	failureCode: OpenMeldToolsUpdateFailureCode | null;
	operation: OpenMeldToolsUpdateOperation | null;
}) {
	const failed =
		input.operation?.phase === "needs_help" ||
		input.operation?.phase === "restored";
	if (!(failed && input.operation)) {
		return null;
	}
	const target = input.readiness?.currentTarget;
	const service = input.readiness?.service;
	const runtime = input.readiness?.runtime;
	// Core owns connection freshness and account alignment. A later matching
	// report proves reconnection only, never installed/running bundle integrity.
	const reconnected =
		target?.availability === "resolved" &&
		service?.connected &&
		service.matchingCurrentRuntime &&
		service.sessionDeviceId === target.deviceId &&
		service.sessionLane === target.runtimeLane &&
		runtime?.deviceId === target.deviceId &&
		runtime.runtimeLane === target.runtimeLane &&
		(runtime.lastObservedAtMs ?? 0) > Date.parse(input.operation.updatedAt);
	const targets = resolveOpenMeldToolsUpdateTargetVersions(input.operation);
	return (
		<details className="border-t pt-3">
			<summary className="cursor-pointer font-medium text-muted-foreground text-sm leading-8">
				Last update details
			</summary>
			<div className="space-y-1 pt-3 text-muted-foreground text-xs">
				<p>
					{reconnected
						? "Service reconnected after this update attempt. Installation was not confirmed."
						: "No connection has been confirmed since this update attempt."}
				</p>
				<p className="break-all">Operation: {input.operation.operationId}</p>
				<p>Recorded: {input.operation.updatedAt}</p>
				<p>
					Requested CLI: {targets?.cliVersion}; Service:{" "}
					{targets?.serviceVersion}
				</p>
				{input.operation.phase === "restored" ? (
					<p>
						The previous installation was restored; the requested update did not
						complete.
					</p>
				) : null}
				<p>
					{input.failureCode
						? formatOpenMeldToolsUpdateFailureMessage(input.failureCode)
						: "The update did not finish successfully."}
				</p>
			</div>
		</details>
	);
}

function resolveOpenMeldToolsUpdateStatus(input: {
	confirmationPending: boolean;
	failureCode: OpenMeldToolsUpdateFailureCode | null;
	operation:
		| CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["updateOperation"]
		| null;
	requestFailed: boolean;
	requesting: boolean;
	targetObserved: boolean;
	verificationExhausted: boolean;
}): string | null {
	if (input.requestFailed) {
		return "Update failed. Try again.";
	}
	if (input.verificationExhausted) {
		return "Couldn't verify the update. Try again or update manually.";
	}
	if (input.confirmationPending && !input.targetObserved) {
		return "Verifying…";
	}
	if (input.requesting) {
		return "Checking…";
	}
	return input.operation
		? formatOpenMeldToolsUpdatePhase({
				failureCode: input.failureCode,
				phase: input.operation.phase,
				targetObserved: input.targetObserved,
			})
		: null;
}

function resolveOpenMeldToolsUpdateFailureCode(
	cliUpdate: OpenMeldToolsCliUpdate | null
): OpenMeldToolsUpdateFailureCode | null {
	return findOpenMeldToolsUpdateFailureCode(cliUpdate?.reasonCodes ?? []);
}

function formatOpenMeldToolsUpdatePhase(input: {
	failureCode: OpenMeldToolsUpdateFailureCode | null;
	phase: NonNullable<
		CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["updateOperation"]
	>["phase"];
	targetObserved: boolean;
}): string | null {
	switch (input.phase) {
		case "waiting_for_work":
			return "Finishing…";
		case "updating":
			return "Updating…";
		case "updated":
			return input.targetObserved ? null : "Verifying…";
		case "restored":
		case "needs_help":
			return "Last update failed.";
		default: {
			const exhaustive: never = input.phase;
			return exhaustive;
		}
	}
}

function buildOpenMeldToolsComponentDetails(input: {
	canManage: boolean;
	cliUpdate: OpenMeldToolsCliUpdate | null;
	serviceConnected: boolean;
	serviceUpdate: OpenMeldToolsServiceUpdate | null;
	serviceVersionDescription?: ReactNode;
	serviceVersionValue: ReactNode;
	skillsUpdate: OpenMeldToolsSkillsUpdate | null;
}): OpenMeldToolsComponentDetailsItem[] {
	return [
		{
			description: input.serviceVersionDescription,
			label: "OpenMeld Service",
			tone: resolveOpenMeldServiceComponentTone({
				serviceConnected: input.serviceConnected,
				serviceUpdate: input.serviceUpdate,
			}),
			value: input.serviceVersionValue,
		},
		{
			description: formatOpenMeldCliVersionDescription(input.cliUpdate),
			label: "OpenMeld CLI",
			tone: resolveOpenMeldToolsComponentTone(input.cliUpdate),
			value: formatOpenMeldCliVersionValue(input.cliUpdate),
		},
		{
			description: formatOpenMeldSkillsDescription({
				canManage: input.canManage,
				update: input.skillsUpdate,
			}),
			help: {
				ariaLabel: "OpenMeld skill help",
				content: <OpenMeldSkillHelpTooltipContent />,
			},
			label: "OpenMeld skill",
			tone: resolveOpenMeldToolsComponentTone(input.skillsUpdate),
			value: formatOpenMeldSkillsValue(input.skillsUpdate),
		},
	];
}

function formatOpenMeldCliVersionValue(
	update: OpenMeldToolsCliUpdate | null
): string {
	if (!update) {
		return "Not checked";
	}
	if (update.status === "update_required") {
		return "Update required";
	}
	if (update.status === "update_available") {
		return "Update available";
	}
	if (update.installedPackageVersion) {
		return `Installed v${update.installedPackageVersion}`;
	}
	return "Not checked";
}

function formatOpenMeldCliVersionDescription(
	update: OpenMeldToolsCliUpdate | null
): string | undefined {
	if (!update) {
		return "OpenMeld has not received CLI version facts from this computer.";
	}
	const details = [
		resolveOpenMeldCliUpdateReasonCopy(update),
		update.latestPackageVersion
			? `Latest available: v${update.latestPackageVersion}.`
			: null,
		update.status === "unknown"
			? "OpenMeld has not received CLI version facts from this computer."
			: null,
	].filter((value): value is string => Boolean(value));
	return details.length > 0 ? details.join(" ") : undefined;
}

// A required CLI update can mean two different things and must not share one
// sentence: `cli.command_contract_mismatch` means the CLI/Core command
// contract itself changed (this computer needs the matching CLI to keep
// talking to Core correctly). A plain `update_required` status without that
// reason code means the release manifest marked this release required while
// the CLI package itself is only behind on version -- the command contract is
// unchanged. Collapsing both into "Required CLI contract update." falsely
// blamed a contract change for what was actually a stale release channel.
function resolveOpenMeldCliUpdateReasonCopy(
	update: OpenMeldToolsCliUpdate
): string | null {
	if (update.reasonCodes.includes("cli.command_contract_mismatch")) {
		return "Required CLI contract update.";
	}
	if (update.status === "update_required") {
		return "CLI update required.";
	}
	return null;
}

function formatOpenMeldSkillsValue(
	update: OpenMeldToolsSkillsUpdate | null
): string {
	if (!update) {
		return "Not checked";
	}
	if (update.status === "update_required") {
		return "Update required";
	}
	if (update.status === "update_available") {
		return "Update available";
	}
	if (update.status === "unknown") {
		return "Not checked";
	}
	if (hasNoOpenMeldSkillInstallTarget(update)) {
		return "Not installed";
	}
	return "Installed";
}

function formatOpenMeldSkillsDescription(input: {
	canManage: boolean;
	update: OpenMeldToolsSkillsUpdate | null;
}): string | undefined {
	const update = input.update;
	if (!update) {
		return "OpenMeld has not received OpenMeld skill facts from this computer.";
	}
	if (update.status === "unknown") {
		return "OpenMeld has not received OpenMeld skill facts from this computer.";
	}
	if (update.status === "update_required") {
		return input.canManage
			? "Run Update OpenMeld skills to refresh the OpenMeld skill."
			: "The computer owner needs to update the OpenMeld skill.";
	}
	if (update.status === "update_available") {
		return "A newer OpenMeld skill is available.";
	}
	if (hasNoOpenMeldSkillInstallTarget(update)) {
		return "OpenMeld has not found a local agent skills folder to manage.";
	}
	return "The OpenMeld skill is installed and up to date for local agents.";
}

function hasNoOpenMeldSkillInstallTarget(
	update: OpenMeldToolsSkillsUpdate
): boolean {
	return (
		update.targetCount === 0 || update.reasonCodes.includes("skills.no_targets")
	);
}

function resolveOpenMeldServiceComponentTone(input: {
	serviceConnected: boolean;
	serviceUpdate: OpenMeldToolsServiceUpdate | null;
}): OpenMeldServiceVisualTone {
	if (
		input.serviceUpdate?.wakeBlocked ||
		input.serviceUpdate?.status === "update_required"
	) {
		return input.serviceUpdate?.installedVersion ? "ready" : "danger";
	}
	if (input.serviceUpdate?.status === "update_available") {
		return "warning";
	}
	return input.serviceConnected ? "ready" : "muted";
}

function resolveOpenMeldToolsComponentTone(
	update: {
		status: LocalComponentUpdateStatus;
		wakeBlocked: boolean;
	} | null
): OpenMeldServiceVisualTone {
	if (!update || update.status === "unknown") {
		return "muted";
	}
	if (update.status === "update_required" || update.wakeBlocked) {
		return "danger";
	}
	if (update.status === "update_available") {
		return "warning";
	}
	return "ready";
}

function OpenMeldToolsComponentDetails(input: {
	items: readonly OpenMeldToolsComponentDetailsItem[];
}) {
	return (
		<div
			className="flex flex-col border-border/60 border-t"
			data-testid="openmeld-tools-component-details"
		>
			{input.items.map((item) => (
				<div
					className="flex flex-col gap-1 border-border/60 border-b py-3 first:pt-4 last:border-b-0 last:pb-0"
					key={item.label}
				>
					<div className="flex items-center justify-between gap-3">
						<OpenMeldToolsComponentLabel item={item} />
						<p
							className={cn(
								"shrink-0 text-right font-medium text-sm",
								resolveOpenMeldToolsComponentValueClassName(item.tone)
							)}
						>
							{item.value}
						</p>
					</div>
					{item.description ? (
						<div className="text-muted-foreground text-xs leading-5">
							{item.description}
						</div>
					) : null}
				</div>
			))}
		</div>
	);
}

function OpenMeldToolsActionControl(input: {
	action: OpenMeldToolsAction;
	className?: string;
	tone: OpenMeldServiceVisualTone;
}) {
	if (input.action.kind === "managed") {
		return (
			<Button
				className={cn(
					input.className,
					resolveOpenMeldToolsComponentActionClassName(input.tone)
				)}
				disabled={input.action.disabled}
				onClick={() => {
					input.action.kind === "managed" &&
						input.action.onClick().catch((error: unknown) => {
							console.error("OpenMeld Tools update failed.", error);
						});
				}}
				size="sm"
				type="button"
				variant="outline"
			>
				<ArrowsClockwiseIcon aria-hidden="true" data-icon="inline-start" />
				<span className={input.action.disabled ? "shimmer-text" : undefined}>
					{input.action.label}
				</span>
			</Button>
		);
	}
	if (input.action.kind === "link") {
		return (
			<Link
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					input.className,
					resolveOpenMeldToolsComponentActionClassName(input.tone)
				)}
				to={input.action.path}
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.action.label}
			</Link>
		);
	}

	return <OpenMeldToolsCommandDialogAction {...input} action={input.action} />;
}

function OpenMeldToolsCommandDialogAction(input: {
	action: Extract<OpenMeldToolsAction, { kind: "command" }>;
	className?: string;
	tone: OpenMeldServiceVisualTone;
}) {
	const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "manual">(
		"idle"
	);

	const copyCommand = async () => {
		const didCopy = await copyCliEntryCommand(input.action.command);
		setCopyStatus(didCopy ? "copied" : "manual");
		if (didCopy) {
			toast.success("Command copied.");
		}
	};

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					setCopyStatus("idle");
				}
			}}
		>
			<DialogTrigger
				render={
					<Button
						className={cn(
							input.className,
							resolveOpenMeldToolsComponentActionClassName(input.tone)
						)}
						size="sm"
						type="button"
						variant="outline"
					/>
				}
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.action.label}
			</DialogTrigger>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>{input.action.title}</DialogTitle>
					<DialogDescription>{input.action.description}</DialogDescription>
				</DialogHeader>
				<div className="grid gap-3">
					<button
						className="min-h-20 w-full whitespace-pre-wrap break-all border border-border bg-muted/10 px-4 py-3 text-left font-mono text-sm transition-colors hover:bg-muted/30"
						onClick={copyCommand}
						type="button"
					>
						{input.action.command}
					</button>
					<p className="text-muted-foreground text-xs">
						After the command finishes, OpenMeld Service will report the new
						status. Use Check status if this page has not refreshed.
					</p>
					{copyStatus === "manual" ? (
						<p className="text-muted-foreground text-xs">
							OpenMeld could not copy automatically. Select the command text,
							copy it manually, and paste it into Terminal.
						</p>
					) : null}
				</div>
				<DialogFooter>
					<Button onClick={copyCommand} type="button" variant="outline">
						{copyStatus === "copied" ? (
							<CheckIcon
								aria-hidden="true"
								data-icon="inline-start"
								weight="bold"
							/>
						) : null}
						{copyStatus === "copied" ? "Copied" : "Copy command"}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function OpenMeldToolsComponentLabel(input: {
	item: OpenMeldToolsComponentDetailsItem;
}) {
	return (
		<div className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
			<span className="min-w-0 truncate">{input.item.label}</span>
			{input.item.help ? (
				<Tooltip>
					<TooltipTrigger
						render={
							<button
								aria-label={input.item.help.ariaLabel}
								className={cn(
									APP_MOBILE_TOUCH_TARGET_CLASS_NAME,
									"inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 max-lg:size-11"
								)}
								type="button"
							>
								<InfoIcon aria-hidden="true" className="size-3.5" />
							</button>
						}
					/>
					<TooltipContent
						className="max-w-sm flex-col items-start whitespace-normal text-left leading-5"
						side="top"
					>
						{input.item.help.content}
					</TooltipContent>
				</Tooltip>
			) : null}
		</div>
	);
}

function OpenMeldSkillHelpTooltipContent() {
	return (
		<>
			<span>
				The OpenMeld skill helps local agents use OpenMeld. To manage it in this
				environment, run:
			</span>
			<code className="mt-1 block break-all bg-background/15 px-1.5 py-1 font-mono text-[11px] text-background">
				{formatWebCliCommand("openmeld skills")}
			</code>
		</>
	);
}

function resolveOpenMeldToolsComponentValueClassName(
	tone: OpenMeldServiceVisualTone
): string {
	switch (tone) {
		case "danger":
			return "text-destructive";
		case "warning":
			return resolveStatusToneStrongTextClassName("warning");
		case "muted":
			return "text-muted-foreground";
		default:
			return "text-foreground";
	}
}

function resolveOpenMeldToolsComponentActionClassName(
	tone: OpenMeldServiceVisualTone
): string {
	switch (tone) {
		case "warning":
			return resolveStatusToneOutlineActionClassName("warning");
		case "danger":
			return resolveStatusToneOutlineActionClassName("danger");
		default:
			return "";
	}
}

function resolveOpenMeldServiceStatusTextClassName(
	tone: OpenMeldServiceVisualTone
): string {
	switch (tone) {
		case "ready":
			return "text-foreground";
		case "warning":
			return "text-foreground";
		case "danger":
			return "text-destructive";
		case "checking":
			return "text-foreground";
		case "muted":
			return "text-foreground";
		default:
			return "text-foreground";
	}
}

function resolveOpenMeldServiceStatusDotClassName(
	tone: OpenMeldServiceVisualTone
): string {
	return resolveStatusToneIndicatorClassName(tone);
}

export function ComputersLoadingCard() {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<DesktopTowerIcon className="h-5 w-5" />
					Computers
				</CardTitle>
				<CardDescription className="flex items-center gap-2">
					<Bars className="h-3 w-5" />
					Loading computers...
				</CardDescription>
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				<Skeleton className="h-8 w-48" />
				<Skeleton className="h-32 w-full" />
			</CardContent>
		</Card>
	);
}

export function NoComputersCard() {
	const orgSlug = useCurrentOrganizationSlug();
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<DesktopTowerIcon className="h-5 w-5" />
					Computers
				</CardTitle>
				<CardDescription>
					No computers are connected to this account yet.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<Link
					className={buttonVariants({ size: "sm", variant: "outline" })}
					to={buildConnectComputerPath({ orgSlug })}
				>
					<WrenchIcon aria-hidden="true" data-icon="inline-start" />
					{formatLocalSetupActionLabel("connect_service")}
				</Link>
			</CardContent>
		</Card>
	);
}
