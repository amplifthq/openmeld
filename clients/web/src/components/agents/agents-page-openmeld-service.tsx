import { Popover } from "@base-ui/react/popover";
import { formatLocalSetupActionLabel } from "@openmeld/schemas";
import type {
	CurrentLocalRuntimeReplyReadinessResponse,
	LocalComponentUpdateStatus,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	OpenMeldToolsUpdateOperation,
	OrganizationComputerOpenMeldTools,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
import { Badge } from "@openmeld/ui/components/badge";
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
import { LocalAgentLogo } from "@openmeld/ui/components/local-agent-logo";
import { Skeleton } from "@openmeld/ui/components/skeleton";
import { Switch } from "@openmeld/ui/components/switch";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@openmeld/ui/components/tooltip";
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
	CpuIcon,
	DesktopTowerIcon,
	DotsThreeIcon,
	InfoIcon,
	PulseIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import type { QueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { copyCliEntryCommand } from "#/lib/cli-entry-command";
import {
	type ComputerSummaryStatus,
	resolveCurrentLocalRuntimeComputerSummaryStatus,
	resolveOrganizationComputerSummaryStatus,
} from "#/lib/computer-summary-status";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { buildExecutionTargetLabel } from "#/lib/connect/local-runtime-display";
import {
	requestCurrentOpenMeldToolsUpdate,
	setCurrentOpenMeldToolsMaintenance,
} from "#/lib/connect/local-runtimes";
import {
	isOpenMeldToolsComponentUpdateActionable,
	isOpenMeldToolsComponentUpdateRequired,
} from "#/lib/openmeld-tools-update";
import { useCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { refreshWebAgentReadinessSharedCaches } from "#/query/agents/execution-readiness";
import { startQueryKeys } from "#/query/query-keys";
import { resolveAgentsPageFocusedSurfaceClassName } from "./agents-page-agent-profile-helpers";
import {
	formatComputerReplyReadinessDescription,
	resolveCurrentExecutionTarget,
} from "./agents-page-computer";
import {
	createExecutionTargetKey,
	formatExecutionTargetStatus,
	formatMutationError,
	formatObservedAt,
	formatRuntimeLane,
} from "./agents-page-formatters";
import { resolveCurrentLocalRuntimeServiceActionLabel } from "./agents-page-service-action";

type AgentsPageController = ReturnType<typeof useLocalAgentRecoveryController>;

const OPENMELD_TOOLS_CARD_TITLE = "OpenMeld Tools";
const OPENMELD_SKILLS_MANAGEMENT_COMMAND = "npx -y openmeld@latest skills";
const RECONNECT_MANUALLY_LABEL = "Reconnect manually";
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
	currentExpectedServiceVersion: string | null;
	currentLocalRuntimeReplyReadiness: CurrentLocalRuntimeReplyReadinessResponse | null;
	focusService: boolean;
	isCurrentComputer: boolean;
	isReconcilingStatus: boolean;
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
	return <OwnedOpenMeldServiceCard {...input} />;
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
							"h-2 w-2 shrink-0 rounded-full",
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
			return "OpenMeld Tools are ready on this computer.";
		case "needs_attention":
			return `${computer.ownerLabel} needs to update OpenMeld Tools on this computer.`;
		case "not_connected":
			return `${computer.ownerLabel} needs to reconnect OpenMeld Service on this computer.`;
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
		if (!(input.focusService && input.isCurrentComputer)) {
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
	}, [input.focusService, input.isCurrentComputer, input.onFocusConsumed]);

	useEffect(() => {
		return () => {
			if (highlightEndTimerRef.current !== null) {
				window.clearTimeout(highlightEndTimerRef.current);
			}
		};
	}, []);

	const checkServiceStatus = async () => {
		setIsCheckingStatus(true);
		try {
			await refreshWebAgentReadinessSharedCaches({
				organizationId: input.organizationId,
				queryClient: input.queryClient,
				storageScope: input.recovery.storageScope,
			});
			await input.recovery.refreshAll();
		} catch (error) {
			toast.error(
				formatMutationError(
					error,
					"OpenMeld could not check OpenMeld tools status."
				)
			);
		} finally {
			setIsCheckingStatus(false);
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
			const result = await requestCurrentOpenMeldToolsUpdate();
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
					startQueryKeys.currentLocalRuntimeReplyReadiness(
						input.recovery.storageScope
					),
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
			await setCurrentOpenMeldToolsMaintenance({ automaticUpdatesEnabled });
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

	if (!input.isCurrentComputer) {
		const setupLabel = resolveNonCurrentOpenMeldServiceSetupLabel(
			input.computer
		);
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
				description={`Last reported OpenMeld tools state from ${input.computer.deviceDisplayName}.`}
			>
				<NonCurrentOpenMeldServiceGuidance
					computer={input.computer}
					setupLabel={setupLabel}
					setupPath={setupPath}
				/>
				<ReadOnlyRuntimeTargetList computer={input.computer} />
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
				Checking OpenMeld tools status...
			</p>
		);
	} else if (input.replyReadiness === null) {
		serviceContent = (
			<p className="flex items-center gap-2 text-muted-foreground text-sm">
				<Bars className="h-3 w-5" />
				Loading OpenMeld tools state...
			</p>
		);
	} else {
		serviceContent = (
			<CurrentLocalRuntimeServiceFacts
				currentLocalRuntimeReplyReadiness={
					input.currentLocalRuntimeReplyReadiness
				}
				executionTarget={resolveCurrentExecutionTarget(input.computer)}
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
					isCheckingStatus={isCheckingStatus}
					onCheckStatus={checkServiceStatus}
					setupPath={setupPath}
				/>
			}
			cardRef={serviceCardRef}
			className={cn(
				resolveAgentsPageFocusedSurfaceClassName(isServiceHighlighted)
			)}
			description={`Keeps OpenMeld Service connected and local agent tools ready on ${input.computer.deviceDisplayName}.`}
		>
			{serviceContent}
		</OpenMeldToolsCardFrame>
	);
}

function OpenMeldToolsCardFrame(input: {
	action?: ReactNode;
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
					{OPENMELD_TOOLS_CARD_TITLE}
				</CardTitle>
				<CardDescription>{input.description}</CardDescription>
				{input.action ? <CardAction>{input.action}</CardAction> : null}
			</CardHeader>
			<CardContent className="flex flex-col gap-3">
				{input.children}
			</CardContent>
		</Card>
	);
}

function OpenMeldServiceMoreMenu(input: {
	isCheckingStatus: boolean;
	onCheckStatus: () => Promise<void>;
	setupLabel?: string;
	setupPath: string;
	showCheckStatus?: boolean;
}) {
	const [isOpen, setIsOpen] = useState(false);
	const showCheckStatus = input.showCheckStatus ?? true;
	const setupLabel = input.setupLabel ?? RECONNECT_MANUALLY_LABEL;

	const checkStatus = () => {
		setIsOpen(false);
		input.onCheckStatus().catch((error: unknown) => {
			console.error("Failed to check OpenMeld tools state.", error);
		});
	};

	return (
		<Popover.Root modal={false} onOpenChange={setIsOpen} open={isOpen}>
			<Popover.Trigger
				render={
					<Button
						aria-label="OpenMeld tools options"
						size="icon"
						type="button"
						variant="ghost"
					/>
				}
			>
				<DotsThreeIcon aria-hidden="true" />
			</Popover.Trigger>
			<Popover.Portal>
				<Popover.Positioner
					align="end"
					collisionAvoidance={{
						align: "shift",
						fallbackAxisSide: "start",
						side: "flip",
					}}
					collisionPadding={12}
					side="bottom"
					sideOffset={8}
				>
					<Popover.Popup
						className="z-50 min-w-56 rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg outline-none"
						finalFocus={false}
					>
						{showCheckStatus ? (
							<button
								className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
								disabled={input.isCheckingStatus}
								onClick={checkStatus}
								type="button"
							>
								<ArrowsClockwiseIcon aria-hidden="true" className="h-4 w-4" />
								{input.isCheckingStatus ? "Checking..." : "Check status"}
							</button>
						) : null}
						<Link
							className="flex w-full items-center gap-2 rounded-sm px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
							onClick={() => setIsOpen(false)}
							to={input.setupPath}
						>
							<WrenchIcon aria-hidden="true" className="h-4 w-4" />
							{setupLabel}
						</Link>
					</Popover.Popup>
				</Popover.Positioner>
			</Popover.Portal>
		</Popover.Root>
	);
}

function NonCurrentOpenMeldServiceGuidance(input: {
	computer: LocalRuntimeComputer;
	setupLabel: string;
	setupPath: string;
}) {
	if (input.computer.executionTargets.some(isUsableComputerTarget)) {
		return null;
	}

	const isStale = input.computer.executionTargets.some(
		(target) => target.status === "stale"
	);
	const title = isStale ? "Needs a fresh check" : "Set up OpenMeld tools";
	const description = isStale
		? "This is the last OpenMeld tools report from that computer. Run setup again to refresh this record."
		: "Set up OpenMeld tools on that computer so OpenMeld can report service state and local agents.";

	return (
		<div className="flex flex-col gap-4 border-border/60 border-b pb-4 sm:flex-row sm:items-start sm:justify-between">
			<div className="min-w-0 space-y-1.5">
				<p className="font-medium text-foreground text-sm">{title}</p>
				<p className="max-w-2xl text-muted-foreground text-xs leading-5">
					{description}
				</p>
			</div>
			<Link
				className={cn(
					buttonVariants({ size: "sm", variant: "outline" }),
					"w-fit shrink-0"
				)}
				to={input.setupPath}
			>
				<WrenchIcon aria-hidden="true" data-icon="inline-start" />
				{input.setupLabel}
			</Link>
		</div>
	);
}

function resolveNonCurrentOpenMeldServiceSetupLabel(
	computer: LocalRuntimeComputer
): string {
	return computer.executionTargets.some((target) => target.status === "stale")
		? "Set up again"
		: "Set up this computer";
}

function isUsableComputerTarget(target: LocalRuntimeExecutionTarget): boolean {
	return target.status === "ready" || target.status === "partial";
}

function ReadOnlyRuntimeTargetList(input: {
	compact?: boolean;
	computer: LocalRuntimeComputer;
}) {
	if (input.computer.executionTargets.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No OpenMeld Service targets have checked in from this computer yet.
			</p>
		);
	}

	return (
		<div
			className="flex flex-col gap-3"
			data-testid="read-only-runtime-target-status"
		>
			{input.computer.executionTargets.map((target) => (
				<div
					className="flex flex-col gap-2 border border-border px-3 py-3"
					key={createExecutionTargetKey(target)}
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<p className="flex items-center gap-2 font-medium text-sm">
							<CpuIcon className="h-4 w-4 text-muted-foreground" />
							{formatRuntimeLane(target.runtimeLane)}
						</p>
						<Badge
							variant={target.status === "ready" ? "secondary" : "outline"}
						>
							{formatExecutionTargetStatus(target.status)}
						</Badge>
					</div>
					<p className="text-muted-foreground text-xs">
						{buildExecutionTargetLabel(target)}
					</p>
					{input.compact ? null : (
						<p className="text-muted-foreground text-xs">
							Last checked {formatObservedAt(target.lastObservedAtMs)}
						</p>
					)}
				</div>
			))}
		</div>
	);
}

function CurrentLocalRuntimeServiceFacts(input: {
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
		targetVersion: updateTargetVersion,
	});
	const nextUpdateAvailable = hasActionableOpenMeldToolsUpdate(localComponents);
	const updateIsActive =
		!input.updateVerificationExhausted &&
		(input.isUpdatingTools ||
			input.pendingManagedUpdate !== null ||
			updateOperation?.phase === "updating" ||
			updateOperation?.phase === "waiting_for_work" ||
			(updateOperation?.phase === "updated" && !updateTargetObserved));
	const serviceUpdate = localComponents?.service ?? null;
	const cliUpdate = resolveOpenMeldToolsCliUpdate(localComponents);
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
		isCheckingStatus: input.isCheckingStatus,
		replyReadiness: input.replyReadiness,
		requiredServiceUpdate,
		serviceUpdate,
		serviceConnected,
		serviceDisconnected: hasCurrentServiceObservation && !serviceConnected,
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
		canManage: true,
		cliUpdate,
		serviceConnected,
		serviceUpdate,
		serviceVersionDescription,
		serviceVersionValue,
		skillsUpdate,
	});
	const primaryAction = resolveCurrentOpenMeldToolsPrimaryAction({
		displayAction: display.primaryAction,
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
								"h-2 w-2 shrink-0 rounded-full",
								resolveOpenMeldServiceStatusDotClassName(display.tone)
							)}
						/>
						{computerSummaryStatus?.localAgent ? (
							<LocalAgentLogo
								agentId={computerSummaryStatus.localAgent.agentId}
								size="xs"
							/>
						) : null}
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
				{primaryAction ? (
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
			{maintenance ? (
				<OpenMeldToolsMaintenanceControls
					automaticUpdatesEnabled={maintenance.automaticUpdatesEnabled}
					confirmationPending={
						input.pendingManagedUpdate?.kind === "confirmation"
					}
					disabled={input.isSavingAutomaticUpdates}
					nextUpdateAvailable={nextUpdateAvailable}
					onAutomaticUpdatesChange={input.onAutomaticUpdatesChange}
					operation={updateOperation}
					requestFailed={input.updateRequestFailed && updateOperation === null}
					requesting={input.isUpdatingTools}
					targetObserved={updateTargetObserved}
					verificationExhausted={input.updateVerificationExhausted}
				/>
			) : null}

			{display.hideVersionDetails ? null : (
				<OpenMeldToolsComponentDetails items={componentDetails} />
			)}
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
	isCheckingStatus: boolean;
	replyReadiness: ComputerReplyReadiness;
	requiredServiceUpdate: boolean;
	serviceUpdate:
		| CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["service"]
		| null;
	serviceConnected: boolean;
	serviceDisconnected: boolean;
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
			statusLabel: "Checking OpenMeld Tools",
			tone: "checking",
		};
	}

	if (input.serviceDisconnected) {
		return {
			description:
				"Reconnect OpenMeld Service to use local agents on this computer.",
			descriptionTone: "muted",
			hideVersionDetails: false,
			primaryAction: {
				kind: "link",
				label: RECONNECT_MANUALLY_LABEL,
				path: input.setupPath,
			},
			statusLabel: "OpenMeld Service is not connected",
			tone: "danger",
		};
	}

	if (
		input.requiredServiceUpdate &&
		input.computerSummaryStatus?.reason === "openmeld_tools_update"
	) {
		return {
			description:
				"An update is required to keep local agents ready on this computer.",
			descriptionTone: "muted",
			hideVersionDetails: false,
			primaryAction: buildOpenMeldToolsLinkAction(input.serviceUpdatePath),
			statusLabel: "OpenMeld Tools need an update",
			tone: "danger",
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
			? "An update is required to keep local agents ready on this computer."
			: "A newer version of OpenMeld Tools is available.",
		descriptionTone: hasRequiredToolsUpdate ? "muted" : "warning",
		hideVersionDetails: false,
		primaryAction: buildOpenMeldToolsLinkAction(input.serviceUpdatePath),
		statusLabel: hasRequiredToolsUpdate
			? "OpenMeld Tools need an update"
			: "OpenMeld Tools update available",
		tone: hasRequiredToolsUpdate ? "danger" : "warning",
	};
}

function resolveOpenMeldToolsDefaultDisplay(
	input: CurrentLocalRuntimeServiceDisplayInput
): CurrentLocalRuntimeServiceDisplay {
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
			statusLabel: "Checking OpenMeld Tools",
			tone,
		};
	}
	if (toolsReady) {
		return {
			description: "OpenMeld Tools are ready on this computer.",
			descriptionTone: "muted",
			hideVersionDetails: false,
			primaryAction,
			statusLabel: "OpenMeld Tools are ready",
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
	targetVersion: string | null;
}): boolean {
	return Boolean(
		input.localComponents &&
			input.targetVersion &&
			input.localComponents.service.installedVersion === input.targetVersion &&
			input.localComponents.cli.installedPackageVersion === input.targetVersion
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
	return (
		input.localComponents.service.installedVersion === expectedVersion &&
		input.localComponents.cli.installedPackageVersion === expectedVersion
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
		isLocalAgentControllerReportReadinessReason(input.replyReadiness.reasonCode)
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
		isLocalAgentControllerReportReadinessReason(input.replyReadiness.reasonCode)
	) {
		return "OpenMeld Service is connected";
	}
	if (input.replyReadiness.status === "needs_setup") {
		return formatLocalSetupActionLabel("connect_service");
	}
	if (input.replyReadiness.status === "needs_repair") {
		return formatLocalSetupActionLabel("reconnect_service");
	}
	return "Status unavailable";
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
		isLocalAgentControllerReportReadinessReason(input.replyReadiness.reasonCode)
	) {
		return "OpenMeld Service is connected on this computer.";
	}
	if (
		isCurrentRuntimeSessionMissingReason(input.replyReadiness.detailReasonCode)
	) {
		return "OpenMeld Service is not connected for this account on this computer.";
	}
	if (input.replyReadiness.reasonCode === "background_helper.not_running") {
		return "Reconnect OpenMeld Service to refresh OpenMeld tools and local agents on this computer.";
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
		isLocalAgentControllerReportReadinessReason(input.replyReadiness.reasonCode)
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

function OpenMeldToolsMaintenanceControls(input: {
	automaticUpdatesEnabled: boolean;
	confirmationPending: boolean;
	disabled: boolean;
	nextUpdateAvailable: boolean;
	onAutomaticUpdatesChange: (enabled: boolean) => Promise<void>;
	operation:
		| CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["updateOperation"]
		| null;
	requestFailed: boolean;
	requesting: boolean;
	targetObserved: boolean;
	verificationExhausted: boolean;
}) {
	const updateStatus = resolveOpenMeldToolsUpdateStatus(input);
	return (
		<div className="flex flex-col gap-3 border-border/60 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
			<div className="min-w-0">
				<p className="font-medium text-sm">Keep OpenMeld Tools up to date</p>
				{updateStatus ? (
					<p
						aria-atomic="true"
						aria-live="polite"
						className="mt-1 text-muted-foreground text-xs"
					>
						{updateStatus}
					</p>
				) : null}
			</div>
			<Switch
				aria-label="Keep OpenMeld Tools up to date"
				checked={input.automaticUpdatesEnabled}
				disabled={input.disabled}
				onCheckedChange={(enabled) => {
					input.onAutomaticUpdatesChange(enabled).catch((error: unknown) => {
						console.error("OpenMeld Tools update setting failed.", error);
					});
				}}
			/>
		</div>
	);
}

function resolveOpenMeldToolsUpdateStatus(input: {
	confirmationPending: boolean;
	nextUpdateAvailable: boolean;
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
	if (
		input.targetObserved &&
		(input.operation?.phase === "updated" ||
			input.operation?.phase === "restored" ||
			input.operation?.phase === "needs_help")
	) {
		return input.nextUpdateAvailable ? null : "Up to date";
	}
	return input.operation
		? formatOpenMeldToolsUpdatePhase({
				phase: input.operation.phase,
				targetObserved: input.targetObserved,
			})
		: null;
}

function formatOpenMeldToolsUpdatePhase(input: {
	phase: NonNullable<
		CurrentLocalRuntimeReplyReadinessResponse["localComponents"]["updateOperation"]
	>["phase"];
	targetObserved: boolean;
}): string {
	switch (input.phase) {
		case "waiting_for_work":
			return "Finishing…";
		case "updating":
			return "Updating…";
		case "updated":
			return input.targetObserved ? "Up to date" : "Verifying…";
		case "restored":
			return "Update failed. Try again.";
		case "needs_help":
			return "Update failed. Try again.";
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
				The OpenMeld skill helps local agents use OpenMeld. To manage it without
				installing OpenMeld CLI globally, run:
			</span>
			<code className="mt-1 block break-all bg-background/15 px-1.5 py-1 font-mono text-[11px] text-background">
				{OPENMELD_SKILLS_MANAGEMENT_COMMAND}
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
