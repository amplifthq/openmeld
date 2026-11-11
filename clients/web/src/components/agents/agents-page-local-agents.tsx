import {
	createAgentControllerInterfaceDisplayRows,
	createAgentControllerInterfaceOperationalDisplayRows,
	formatAgentControllerInterfaceOperationalSummary,
	formatAgentControllerInterfaceSummary,
	getAgentControllerVersionAdvisoryPresentation,
	resolveAgentControllerInterfaceDescription,
} from "@openmeld/agent-runtime";
import { LOCAL_AGENTS_GUIDE_PATH } from "@openmeld/product-catalog/local-agent-install-guides";
import {
	compareAgentControllerRefsForDisplay,
	formatLocalSetupActionLabel,
} from "@openmeld/schemas";
import type {
	AgentControllerInterfaceSnapshot,
	CurrentLocalAgentInstallationsResponse,
	LocalAgentInstallationOption,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
	OrganizationComputerLocalAgentDetails,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import type { ComputerReplyReadiness } from "@openmeld/start";
import { Badge } from "@openmeld/ui/components/badge";
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
} from "@openmeld/ui/components/dialog";
import { SettingsActionMenu } from "@openmeld/ui/components/settings-action-menu";
import {
	SettingsLocalAgentAdvisoryBadge,
	SettingsLocalAgentCardGrid,
	type SettingsLocalAgentRow,
	SettingsLocalAgentUsageLimits,
	SettingsLocalAgentUsageSummary,
} from "@openmeld/ui/components/settings-computers";
import {
	SettingsDetailList,
	type SettingsDetailListRow,
} from "@openmeld/ui/components/settings-detail-list";
import { Switch } from "@openmeld/ui/components/switch";
import { TooltipHint } from "@openmeld/ui/components/tooltip";
import { ScrollArea } from "@openmeld/ui/fluid/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from "@openmeld/ui/fluid/select";
import {
	resolveStatusToneIndicatorClassName,
	resolveStatusToneSoftTextClassName,
	resolveStatusToneSurfaceClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowsClockwiseIcon,
	CheckIcon,
	CopyIcon,
	RobotIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { domAnimation, LazyMotion, m, useReducedMotion } from "motion/react";
import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { APP_MOBILE_TOUCH_TARGET_CLASS_NAME } from "#/components/app/app-touch-target";
import { canConfigureLocalComputer } from "#/desktop/platform";
import { copyCliEntryCommand } from "#/lib/cli-entry-command";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import {
	readPeopleComputerLocalAgentInstallations,
	selectPeopleComputerLocalAgentInstallation,
} from "#/lib/connect/local-runtimes";
import { useCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { resolveCurrentExecutionTarget } from "./agents-page-computer";
import {
	formatCheckedAt,
	formatMutationError,
	isLocalAgentControlStillRunningError,
} from "./agents-page-formatters";
import { resolveCurrentLocalRuntimeServiceActionLabel } from "./agents-page-service-action";
import {
	LocalAgentConsumptionDetails,
	LocalAgentConsumptionPreview,
	type LocalAgentConsumptionScope,
} from "./local-agent-consumption";
import { LocalAgentInstallEmptyState } from "./local-agent-install-empty-state";
import { LocalAgentUpdateControl } from "./local-agent-update-control";

type AgentsPageController = ReturnType<typeof useLocalAgentRecoveryController>;
type DeviceAgentCatalogEntry =
	LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"][number];
type LocalAgentCatalogRowSummaryStatus = NonNullable<
	SettingsLocalAgentRow["summaryStatus"]
>;
type LocalAgentEnabledOverrides = Record<string, boolean>;
const SLOW_LOCAL_AGENT_CHECK_RECONCILE_INTERVAL_MS = 750;
const SLOW_LOCAL_AGENT_CHECK_RECONCILE_TIMEOUT_MS = 12_000;
const LOCAL_AGENT_INSTALLATION_QUERY_STALE_TIME_MS = 30_000;
const LOCAL_AGENT_CHECK_COMPLETE_MESSAGE = "Local agent check complete.";

export type LocalAgentsCardOwnerProps = {
	usageScope?: LocalAgentConsumptionScope;
	controlTarget?: PeopleComputerTarget | null;
	controlCapabilities?: LocalRuntimeExecutionTarget["localAgentControl"];
	computer: LocalRuntimeComputer;
	hasSelectedEnvironment: boolean;
	isReconcilingStatus?: boolean;
	recovery: AgentsPageController;
	replyReadiness: ComputerReplyReadiness | null;
	view?: "owner";
};

type TeamLocalAgent = {
	controller?: string;
	agentId: string;
	details?: OrganizationComputerLocalAgentDetails | null;
	displayName: string;
	enabled: boolean;
	status: "not_ready" | "ready" | "stale" | "unknown";
};

type TeamLocalAgentsCardProps = {
	usageScope?: LocalAgentConsumptionScope;
	computer: {
		deviceDisplayName: string;
		localAgents: readonly TeamLocalAgent[];
	};
	view: "team";
};

export function LocalAgentsCard(
	input: LocalAgentsCardOwnerProps | TeamLocalAgentsCardProps
) {
	if (input.view === "team") {
		return (
			<TeamLocalAgentsCard
				computer={input.computer}
				usageScope={input.usageScope}
			/>
		);
	}
	return <OwnedLocalAgentsCard {...input} />;
}

function TeamLocalAgentsCard(input: {
	usageScope?: LocalAgentConsumptionScope;
	computer: TeamLocalAgentsCardProps["computer"];
}) {
	const rows = [...input.computer.localAgents]
		.sort((left, right) =>
			compareAgentControllerRefsForDisplay(left.agentId, right.agentId)
		)
		.map((agent) => buildTeamLocalAgentRow(agent, input.usageScope));
	return (
		<LocalAgentsCardFrame description="See which local agents are available on this computer. Only the computer owner can change these settings.">
			{rows.length > 0 ? (
				<SettingsLocalAgentCardGrid rows={rows} />
			) : (
				<p className="text-muted-foreground text-sm">
					No local agents have been reported from this computer yet.
				</p>
			)}
		</LocalAgentsCardFrame>
	);
}

function buildTeamLocalAgentRow(
	agent: TeamLocalAgent,
	usageScope?: LocalAgentConsumptionScope
): SettingsLocalAgentRow {
	const description = resolveTeamLocalAgentDescription(agent);
	const detailRows = agent.details
		? placeLaunchCheckSecond(
				withoutCheckedAtDetailRows(
					createAgentControllerInterfaceOperationalDisplayRows(agent.details)
				)
			)
		: [
				{
					label: "Controller",
					value: agent.enabled ? "Enabled" : "Off",
				},
				{ label: "Status", value: description },
			];
	return {
		checkedAtLabel: formatAgentControllerCheckedAtLabel(agent.details),
		control: (
			<Switch
				aria-label={`${agent.displayName} local agent`}
				checked={agent.enabled}
				disabled
			/>
		),
		description,
		detail: (
			<div className="space-y-4">
				<SettingsLocalAgentUsageLimits
					agentName={agent.displayName}
					fillColumns
					limits={agent.details?.usageLimits}
				/>
				{usageScope && agent.controller ? (
					<LocalAgentConsumptionDetails
						{...usageScope}
						controller={agent.controller}
					/>
				) : null}
				<SettingsDetailList rows={detailRows} />
			</div>
		),
		displayName: agent.displayName,
		id: agent.agentId,
		summarySupplement:
			usageScope && agent.controller ? (
				<LocalAgentConsumptionPreview
					{...usageScope}
					controller={agent.controller}
				/>
			) : null,
		identityMuted: !agent.enabled || agent.details?.status === "unavailable",
		logoAgentId: agent.agentId,
		muted: !agent.enabled || agent.details?.status === "unavailable",
		summaryStatus: resolveTeamLocalAgentSummaryStatus(agent),
		summaryMeta: agent.details
			? formatAgentControllerInterfaceOperationalSummary(agent.details)
			: null,
		summaryAccessory: (
			<SettingsLocalAgentUsageSummary
				agentName={agent.displayName}
				limits={agent.details?.usageLimits}
			/>
		),
	};
}

function resolveTeamLocalAgentSummaryStatus(
	agent: TeamLocalAgent
): SettingsLocalAgentRow["summaryStatus"] {
	if (!agent.enabled) {
		return { label: "Off", tone: "muted" };
	}
	switch (agent.status) {
		case "ready":
			return { label: "Ready", tone: "ready" };
		case "not_ready": {
			if (agent.details?.check?.status === "failed") {
				return { label: "Check delayed", tone: "checking" };
			}
			if (agent.details?.status === "error") {
				return agent.details.launch.status === "needs_repair"
					? { label: "Can’t start", tone: "danger" }
					: { label: "Needs attention", tone: "danger" };
			}
			return { label: "Unavailable", tone: "warning" };
		}
		case "stale":
			return { label: "Status out of date", tone: "warning" };
		default:
			return { label: "Not confirmed", tone: "muted" };
	}
}

function resolveTeamLocalAgentDescription(agent: TeamLocalAgent): string {
	if (!agent.enabled) {
		return "Off on this computer";
	}
	switch (agent.status) {
		case "ready":
			return "Available on this computer";
		case "not_ready":
			return agent.details?.check?.status === "failed"
				? "OpenMeld will retry automatically"
				: "Unavailable on this computer";
		case "stale":
			return "Availability is unknown until this computer reports a new check";
		default:
			return "Status not confirmed";
	}
}

function OwnedLocalAgentsCard(input: LocalAgentsCardOwnerProps) {
	const orgSlug = useCurrentOrganizationSlug();
	const [isCheckingAgents, setIsCheckingAgents] = useState(false);
	const recoveryRef = useRef(input.recovery);
	useEffect(() => {
		recoveryRef.current = input.recovery;
	}, [input.recovery]);
	const catalogState = resolveLocalAgentsCatalogState(input);
	const setupPath = buildConnectComputerPath({
		orgSlug,
		session: "fresh",
	});
	const cardDescription = input.hasSelectedEnvironment
		? "OpenMeld can use the local agents that are turned on for this computer. Turning an agent off stops OpenMeld from launching it."
		: `Last local agent report from ${input.computer.deviceDisplayName}.`;
	const setupAction = catalogState.primaryActionLabel ? (
		<Link
			className={buttonVariants({ size: "sm", variant: "outline" })}
			to={setupPath}
		>
			<WrenchIcon aria-hidden="true" data-icon="inline-start" />
			{catalogState.primaryActionLabel}
		</Link>
	) : null;
	const checkLocalAgents = async () => {
		const selectedTarget = input.controlTarget ?? catalogState.target;
		const target = selectedTarget
			? {
					deviceId: selectedTarget.deviceId,
					runtimeLane: selectedTarget.runtimeLane,
				}
			: null;
		const previousChecks = readLocalAgentChecks(
			recoveryRef.current.selectedExecutionTarget,
			target
		);
		const storageScope = recoveryRef.current.storageScope;
		setIsCheckingAgents(true);
		try {
			if (!target) {
				throw new Error("Choose a computer environment first.");
			}
			await input.recovery.refreshLocalAgentCatalog(target);
			toast.success(LOCAL_AGENT_CHECK_COMPLETE_MESSAGE);
		} catch (error) {
			if (isLocalAgentControlStillRunningError(error)) {
				// The probe outran the request budget but keeps running on the OpenMeld
				// Service. Reconcile from the canonical catalog instead of reporting a
				// transport timeout as a failed check, and stay in the checking state
				// until that read settles so the result - not the timeout - is shown.
				try {
					const reconciliation = await reconcileLocalAgentsAfterSlowCheck({
						getRecovery: () => recoveryRef.current,
						previousChecks,
						target,
						storageScope,
					});
					if (reconciliation === "updated") {
						toast.success("Local agent status refreshed.");
					} else {
						toast.info(
							"Some agent checks have not returned yet. Check their status in a moment."
						);
					}
				} catch (reconciliationError) {
					console.error(
						"Failed to read the latest local agent check result.",
						reconciliationError
					);
					toast.error(
						formatMutationError(
							reconciliationError,
							"OpenMeld could not refresh the local agent check result."
						)
					);
				}
				return;
			}
			toast.error(
				formatMutationError(error, "OpenMeld could not check local agents.")
			);
		} finally {
			setIsCheckingAgents(false);
		}
	};
	const canRefreshCatalog = catalogState.canRefreshCatalog;
	const localAgentsAction = canRefreshCatalog ? (
		<LocalAgentsMoreMenu
			isCheckingAgents={isCheckingAgents}
			onCheckAgents={checkLocalAgents}
		/>
	) : null;

	return (
		<LocalAgentsCardFrame
			action={
				setupAction || localAgentsAction ? (
					<div className="flex items-center gap-2">
						{setupAction}
						{localAgentsAction}
					</div>
				) : null
			}
			description={cardDescription}
		>
			{catalogState.notice ? (
				<LocalAgentsCatalogNotice notice={catalogState.notice} />
			) : null}
			<LocalAgentCatalogList
				capabilities={{
					manageInstallations: catalogState.canManageInstallations,
					updateInstallations: catalogState.canUpdateInstallations,
					refreshCatalog: canRefreshCatalog,
					setEnabled: catalogState.canSetEnabled,
				}}
				connectionStatus={catalogState.connectionStatus}
				entries={catalogState.entries}
				isCheckingAgents={isCheckingAgents}
				muted={catalogState.rowsMuted}
				onCheckAgents={checkLocalAgents}
				onRefresh={input.recovery.refreshAll}
				onSetEnabled={(change) => {
					if (!catalogState.target) {
						return Promise.reject(
							new Error("Choose a computer environment first.")
						);
					}
					return input.recovery.setLocalAgentEnabled({
						...change,
						deviceId: catalogState.target.deviceId,
						runtimeLane: catalogState.target.runtimeLane,
					});
				}}
				showInstallGuideLink={shouldShowLocalAgentInstallGuideLink(
					catalogState.entries
				)}
				storageScope={input.recovery.storageScope}
				target={catalogState.target}
				targetStatus={catalogState.targetStatus}
				usageScope={input.usageScope}
			/>
		</LocalAgentsCardFrame>
	);
}

function LocalAgentsCardFrame(input: {
	action?: ReactNode;
	children: ReactNode;
	description: string;
}) {
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<RobotIcon className="h-5 w-5" />
					Local agents
				</CardTitle>
				<CardDescription>{input.description}</CardDescription>
				{input.action ? <CardAction>{input.action}</CardAction> : null}
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{input.children}
			</CardContent>
		</Card>
	);
}

function reconcileLocalAgentsAfterSlowCheck(input: {
	getRecovery: () => AgentsPageController;
	previousChecks: ReadonlyMap<string, number | null>;
	target: PeopleComputerTarget | null;
	storageScope: AgentsPageController["storageScope"];
}): Promise<"updated" | "timed_out"> {
	const deadlineMs = Date.now() + SLOW_LOCAL_AGENT_CHECK_RECONCILE_TIMEOUT_MS;
	return pollForLocalAgentCheck({ ...input, deadlineMs });
}

function reconcileLocalAgentEnabledChange(input: {
	agentId: string;
	enabled: boolean;
	getEntries: () => readonly DeviceAgentCatalogEntry[];
	refresh: () => Promise<unknown>;
}): Promise<"updated" | "timed_out"> {
	const deadlineMs = Date.now() + SLOW_LOCAL_AGENT_CHECK_RECONCILE_TIMEOUT_MS;
	return pollForLocalAgentEnabledChange({ ...input, deadlineMs });
}

function reconcileLocalAgentInstallationChange(input: {
	target: PeopleComputerTarget;
	agentId: string;
	installationId: string;
}): Promise<
	| { data: CurrentLocalAgentInstallationsResponse; status: "updated" }
	| { status: "timed_out" }
> {
	const deadlineMs = Date.now() + SLOW_LOCAL_AGENT_CHECK_RECONCILE_TIMEOUT_MS;
	return pollForLocalAgentInstallationChange({ ...input, deadlineMs });
}

async function pollForLocalAgentInstallationChange(input: {
	target: PeopleComputerTarget;
	agentId: string;
	deadlineMs: number;
	installationId: string;
}): Promise<
	| { data: CurrentLocalAgentInstallationsResponse; status: "updated" }
	| { status: "timed_out" }
> {
	const data = await readPeopleComputerLocalAgentInstallations({
		...input.target,
		agentId: input.agentId,
	});
	if (data.selectedInstallationId === input.installationId) {
		return { data, status: "updated" };
	}

	const remainingMs = input.deadlineMs - Date.now();
	if (remainingMs <= 0) {
		return { status: "timed_out" };
	}
	await waitForLocalAgentReconciliation(
		Math.min(SLOW_LOCAL_AGENT_CHECK_RECONCILE_INTERVAL_MS, remainingMs)
	);
	return pollForLocalAgentInstallationChange(input);
}

async function pollForLocalAgentEnabledChange(input: {
	agentId: string;
	deadlineMs: number;
	enabled: boolean;
	getEntries: () => readonly DeviceAgentCatalogEntry[];
	refresh: () => Promise<unknown>;
}): Promise<"updated" | "timed_out"> {
	await input.refresh();
	const entry = input
		.getEntries()
		.find((candidate) => candidate.agentId === input.agentId);
	if (entry?.enabled === input.enabled) {
		return "updated";
	}

	const remainingMs = input.deadlineMs - Date.now();
	if (remainingMs <= 0) {
		return "timed_out";
	}
	await waitForLocalAgentReconciliation(
		Math.min(SLOW_LOCAL_AGENT_CHECK_RECONCILE_INTERVAL_MS, remainingMs)
	);
	return pollForLocalAgentEnabledChange(input);
}

async function pollForLocalAgentCheck(input: {
	deadlineMs: number;
	getRecovery: () => AgentsPageController;
	previousChecks: ReadonlyMap<string, number | null>;
	target: PeopleComputerTarget | null;
	storageScope: AgentsPageController["storageScope"];
}): Promise<"updated" | "timed_out"> {
	await input.getRecovery().refreshAll();
	const recovery = input.getRecovery();
	if (recovery.storageScope !== input.storageScope) {
		return "timed_out";
	}
	const checks = readLocalAgentChecks(
		recovery.selectedExecutionTarget,
		input.target
	);
	if (
		input.previousChecks.size > 0 &&
		[...input.previousChecks].every(([ref, previous]) => {
			const current = checks.get(ref);
			return (
				current !== undefined &&
				current !== null &&
				(previous === null || current > previous)
			);
		})
	) {
		return "updated";
	}

	const remainingMs = input.deadlineMs - Date.now();
	if (remainingMs <= 0) {
		return "timed_out";
	}
	await waitForLocalAgentReconciliation(
		Math.min(SLOW_LOCAL_AGENT_CHECK_RECONCILE_INTERVAL_MS, remainingMs)
	);
	return pollForLocalAgentCheck(input);
}

function readLocalAgentChecks(
	target: LocalRuntimeExecutionTarget | null,
	requested: PeopleComputerTarget | null
): Map<string, number | null> {
	const checks = new Map<string, number | null>();
	if (
		!requested ||
		target?.deviceId !== requested.deviceId ||
		target.runtimeLane !== requested.runtimeLane
	) {
		return checks;
	}
	for (const capability of target?.capabilities ?? []) {
		// Disabled controllers are inventoried but do not run native checks.
		if (!capability.enabled) {
			continue;
		}
		const checkedAt = capability.agentControllerInterface?.checkedAt;
		const checkedAtMs = checkedAt ? Date.parse(checkedAt) : Number.NaN;
		checks.set(
			capability.agentControllerRef,
			Number.isFinite(checkedAtMs) ? checkedAtMs : null
		);
	}
	return checks;
}

function waitForLocalAgentReconciliation(delayMs: number): Promise<void> {
	return new Promise((resolve) => {
		window.setTimeout(resolve, delayMs);
	});
}

function LocalAgentsMoreMenu(input: {
	isCheckingAgents: boolean;
	onCheckAgents: () => Promise<void>;
}) {
	return (
		<SettingsActionMenu
			ariaLabel="Local agents options"
			items={[
				{
					disabled: input.isCheckingAgents,
					icon: <ArrowsClockwiseIcon aria-hidden="true" className="h-4 w-4" />,
					id: "check-agents",
					label: input.isCheckingAgents ? "Checking..." : "Check agents",
					onSelect: () => {
						input.onCheckAgents().catch((error: unknown) => {
							console.error("Failed to check local agents.", error);
						});
					},
				},
			]}
		/>
	);
}

type LocalAgentsCatalogNoticeModel = {
	description: string;
	title: string;
	tone: "checking" | "muted" | "ready" | "warning";
	variant?: "inline" | "panel";
};

type LocalAgentsCatalogState = {
	connectionStatus: LocalAgentCatalogRowSummaryStatus | null;
	canManageInstallations: boolean;
	canUpdateInstallations: boolean;
	canRefreshCatalog: boolean;
	canSetEnabled: boolean;
	entries: readonly DeviceAgentCatalogEntry[];
	notice: LocalAgentsCatalogNoticeModel | null;
	primaryActionLabel: string | null;
	rowsMuted: boolean;
	target: LocalRuntimeExecutionTarget | null;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
};

function resolveLocalAgentsCatalogState(input: {
	controlCapabilities?: LocalRuntimeExecutionTarget["localAgentControl"];
	computer: LocalRuntimeComputer;
	hasSelectedEnvironment: boolean;
	isReconcilingStatus?: boolean;
	recovery: AgentsPageController;
	replyReadiness: ComputerReplyReadiness | null;
}): LocalAgentsCatalogState {
	const target = resolveLocalAgentsCatalogTarget(input);
	const canConfigure = canConfigureLocalComputer();
	const controls = input.controlCapabilities ?? target?.localAgentControl;
	const serviceDependency = resolveLocalAgentsServiceDependency(
		input.replyReadiness
	);
	const checking =
		input.isReconcilingStatus ||
		!input.replyReadiness ||
		input.replyReadiness.status === "checking";
	const connectionStatus: LocalAgentCatalogRowSummaryStatus | null =
		input.hasSelectedEnvironment
			? resolveLocalAgentConnectionStatus(checking, serviceDependency)
			: { label: "Status unavailable", tone: "muted" };
	const usesCatalogRowsForLocalAgentSetup =
		input.hasSelectedEnvironment && usesLocalAgentCatalogRowsForSetup(target);
	const notice = resolveLocalAgentsCatalogNotice({
		hasSelectedEnvironment: input.hasSelectedEnvironment,
		replyReadiness: input.replyReadiness,
		serviceDependency,
		target,
	});
	const resolvedPrimaryActionLabel =
		input.hasSelectedEnvironment && input.replyReadiness
			? resolveLocalAgentsCatalogPrimaryActionLabel({
					recovery: input.recovery,
					replyReadiness: input.replyReadiness,
				})
			: null;
	const primaryActionLabel =
		serviceDependency ||
		(usesCatalogRowsForLocalAgentSetup &&
			resolvedPrimaryActionLabel ===
				formatLocalSetupActionLabel("connect_local_agent"))
			? null
			: resolvedPrimaryActionLabel;
	const controlsAvailable =
		input.hasSelectedEnvironment && !checking && !serviceDependency;

	return {
		connectionStatus,
		...resolveLocalAgentControlCapabilities(
			controlsAvailable,
			canConfigure,
			controls
		),
		entries: target?.localAgentCatalog.entries ?? [],
		notice: checking
			? {
					title: "Checking local agents",
					description:
						"Waiting for a current local agent report from this computer.",
					tone: "checking",
				}
			: notice,
		primaryActionLabel: checking || !canConfigure ? null : primaryActionLabel,
		rowsMuted:
			!input.hasSelectedEnvironment ||
			(serviceDependency !== null &&
				input.replyReadiness?.status !== "checking"),
		target,
		targetStatus: target?.status ?? null,
	};
}

function resolveLocalAgentControlCapabilities(
	available: boolean,
	canConfigure: boolean,
	controls: LocalRuntimeExecutionTarget["localAgentControl"] | undefined
) {
	return {
		canUpdateInstallations: available && controls?.updateInstallations === true,
		canManageInstallations:
			available &&
			canConfigure &&
			controls?.manageInstallations === true &&
			controls.manageInstallationsSafely === true,
		canRefreshCatalog:
			available && canConfigure && controls?.refreshCatalog === true,
		canSetEnabled: available && canConfigure && controls?.setEnabled === true,
	};
}

function resolveLocalAgentConnectionStatus(
	checking: boolean,
	dependency: LocalAgentsServiceDependency
): LocalAgentCatalogRowSummaryStatus | null {
	if (checking) {
		return { label: "Checking", tone: "muted" };
	}
	if (dependency === "not_connected") {
		return { label: "Disconnected", tone: "muted" };
	}
	if (dependency === "update_required") {
		return { label: "Waiting for computer update", tone: "muted" };
	}
	if (dependency === "unavailable") {
		return { label: "Status unavailable", tone: "muted" };
	}
	return null;
}

function resolveLocalAgentsCatalogPrimaryActionLabel(input: {
	recovery: AgentsPageController;
	replyReadiness: ComputerReplyReadiness;
}): string | null {
	const actionLabel = resolveCurrentLocalRuntimeServiceActionLabel(
		input.replyReadiness
	);
	if (
		actionLabel === formatLocalSetupActionLabel("connect_local_agent") &&
		input.recovery.agentProfiles.length > 0 &&
		isAgentProfileOwnedLocalAgentSetupReason(input.replyReadiness.reasonCode)
	) {
		return null;
	}
	return actionLabel;
}

function isAgentProfileOwnedLocalAgentSetupReason(
	reasonCode: ComputerReplyReadiness["reasonCode"]
): boolean {
	return (
		reasonCode === "execution_target.partial" ||
		reasonCode === "execution_target.not_ready"
	);
}

function usesLocalAgentCatalogRowsForSetup(
	target: LocalRuntimeExecutionTarget | null
): boolean {
	if (target === null) {
		return false;
	}
	if (target.status === "ready") {
		return true;
	}
	// A partially-ready target still renders per-agent rows that carry their
	// own issue text and repair affordances. The generic connect banner is
	// reserved for the true zero-agent case; showing it above healthy rows
	// contradicts the agents already reported on this computer.
	return (
		filterUsableLocalAgentCatalogEntries(target.localAgentCatalog.entries)
			.length > 0
	);
}

function resolveLocalAgentsCatalogTarget(input: {
	computer: LocalRuntimeComputer;
	hasSelectedEnvironment: boolean;
	recovery: AgentsPageController;
}): LocalRuntimeExecutionTarget | null {
	if (input.hasSelectedEnvironment) {
		return input.recovery.selectedExecutionTarget;
	}
	return resolveCurrentExecutionTarget(input.computer);
}

function resolveLocalAgentsCatalogNotice(input: {
	hasSelectedEnvironment: boolean;
	replyReadiness: ComputerReplyReadiness | null;
	serviceDependency: LocalAgentsServiceDependency;
	target: LocalRuntimeExecutionTarget | null;
}): LocalAgentsCatalogNoticeModel | null {
	if (!input.hasSelectedEnvironment) {
		if (input.target === null) {
			return {
				description:
					"This computer has not reported local agents yet. Run setup on that computer to refresh the list.",
				title: "No local agent report yet",
				tone: "muted",
			};
		}
		if (input.target.status === "stale") {
			return {
				description:
					"This is the last local agent report from that computer. Run setup on that computer to refresh the list.",
				title: "Needs a fresh check",
				tone: "warning",
			};
		}
		if (input.target.status === "unknown") {
			return {
				description:
					"OpenMeld is waiting for that computer to report which local agents are installed.",
				title: "Checking local agents",
				tone: "checking",
			};
		}
		return null;
	}

	if (!input.replyReadiness) {
		return {
			description:
				"OpenMeld is loading the latest local agent report for this computer.",
			title: "Loading local agents",
			tone: "checking",
		};
	}

	if (input.replyReadiness.status === "ready") {
		return null;
	}

	if (input.replyReadiness.status === "checking") {
		return {
			description:
				"OpenMeld is checking which local agents are installed on this computer.",
			title: "Checking local agents",
			tone: "checking",
		};
	}

	if (input.serviceDependency === "not_connected") {
		return {
			description: "Local agents will refresh after this computer reconnects.",
			title: "Waiting for OpenMeld Service",
			tone: "muted",
			variant: "inline",
		};
	}

	if (input.serviceDependency === "update_required") {
		return {
			description:
				"Local agents will refresh after OpenMeld Service is updated.",
			title: "Waiting for OpenMeld Service update",
			tone: "muted",
			variant: "inline",
		};
	}
	if (input.serviceDependency === "unavailable") {
		return {
			title: "Status unavailable",
			description:
				"OpenMeld could not check local agents on this computer. Try again.",
			tone: "muted",
			variant: "inline",
		};
	}

	if (
		input.replyReadiness.reasonCode === "execution_target.stale" ||
		input.target?.status === "stale"
	) {
		return {
			description: "Reconnect this computer to refresh the local agent list.",
			title: "Reconnect Computer",
			tone: "warning",
		};
	}

	if (input.target === null) {
		return {
			description: "Connect this computer to detect its local agents.",
			title: "Connect Computer",
			tone: "warning",
		};
	}

	// Agent rows or the empty state already explain the next step.
	return null;
}

type LocalAgentsServiceDependency =
	| "not_connected"
	| "update_required"
	| "unavailable"
	| null;

function resolveLocalAgentsServiceDependency(
	replyReadiness: ComputerReplyReadiness | null
): LocalAgentsServiceDependency {
	if (
		!replyReadiness ||
		(replyReadiness.status === "unknown" &&
			replyReadiness.reasonCode !== "execution_target.unknown")
	) {
		return "unavailable";
	}
	if (
		replyReadiness.reasonCode === "background_helper.update_required" ||
		replyReadiness.reasonCode === "background_helper.installed_outdated"
	) {
		return "update_required";
	}
	if (
		replyReadiness.reasonCode === "background_helper.not_running" ||
		replyReadiness.reasonCode === "current_device.missing" ||
		replyReadiness.reasonCode === "device_projection.missing"
	) {
		return "not_connected";
	}
	return null;
}

function LocalAgentsCatalogNotice(input: {
	notice: LocalAgentsCatalogNoticeModel;
}) {
	if (input.notice.variant === "inline") {
		return (
			<p className="border-border/60 border-t pt-3 text-foreground text-xs leading-5">
				{input.notice.description}
			</p>
		);
	}

	return (
		<div
			className={cn(
				"rounded-md border px-3 py-3",
				resolveLocalAgentsNoticeClassName(input.notice.tone)
			)}
		>
			<p
				className={cn(
					"flex items-center gap-2 font-medium text-sm",
					resolveLocalAgentsNoticeTitleClassName(input.notice.tone)
				)}
			>
				<span
					aria-hidden="true"
					className={cn(
						"status-dot",
						resolveLocalAgentsNoticeDotClassName(input.notice.tone)
					)}
				/>
				{input.notice.title}
			</p>
			<p className="mt-1 max-w-2xl text-muted-foreground text-sm leading-6">
				{input.notice.description}
			</p>
		</div>
	);
}

function LocalAgentCatalogList(input: {
	usageScope?: LocalAgentConsumptionScope;
	storageScope: string;
	connectionStatus: LocalAgentCatalogRowSummaryStatus | null;
	capabilities: {
		manageInstallations: boolean;
		updateInstallations: boolean;
		refreshCatalog: boolean;
		setEnabled: boolean;
	};
	entries: readonly DeviceAgentCatalogEntry[];
	isCheckingAgents: boolean;
	muted: boolean;
	onCheckAgents: () => Promise<void>;
	onSetEnabled: (input: { agentId: string; enabled: boolean }) => Promise<void>;
	onRefresh: () => Promise<unknown>;
	showInstallGuideLink: boolean;
	target: LocalRuntimeExecutionTarget | null;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
}) {
	const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const [enabledOverrides, setEnabledOverrides] =
		useState<LocalAgentEnabledOverrides>({});
	const [revealedAccountEmailAgentIds, setRevealedAccountEmailAgentIds] =
		useState<ReadonlySet<string>>(() => new Set());
	const [disableConfirmation, setDisableConfirmation] = useState<{
		agentId: string;
		displayName: string;
	} | null>(null);
	const entriesRef = useRef(input.entries);
	useEffect(() => {
		entriesRef.current = input.entries;
	}, [input.entries]);
	const usableEntries = filterUsableLocalAgentCatalogEntries(input.entries);
	const visibleEntries = [...usableEntries].sort(
		compareLocalAgentCatalogEntries
	);
	const handleSetEnabled = async (target: {
		agentId: string;
		enabled: boolean;
	}) => {
		setPendingAgentId(target.agentId);
		setErrorMessage(null);
		setStatusMessage(null);
		setEnabledOverrides((current) => ({
			...current,
			[target.agentId]: target.enabled,
		}));
		try {
			await input.onSetEnabled(target);
		} catch (error) {
			if (isLocalAgentControlStillRunningError(error)) {
				try {
					const reconciliation = await reconcileLocalAgentEnabledChange({
						agentId: target.agentId,
						enabled: target.enabled,
						getEntries: () => entriesRef.current,
						refresh: input.onRefresh,
					});
					if (reconciliation === "timed_out") {
						setStatusMessage(
							"OpenMeld is still applying this change. Check again in a moment."
						);
					}
				} catch (reconciliationError) {
					console.error(
						"Failed to read the latest local agent setting.",
						reconciliationError
					);
					setErrorMessage(
						resolveLocalAgentEnabledErrorMessage(reconciliationError)
					);
				}
			} else {
				setErrorMessage(resolveLocalAgentEnabledErrorMessage(error));
			}
		} finally {
			setEnabledOverrides((current) =>
				removeLocalAgentEnabledOverride(current, target.agentId)
			);
			setPendingAgentId(null);
		}
	};
	const requestSetEnabled = (
		entry: DeviceAgentCatalogEntry,
		enabled: boolean
	) => {
		if (!enabled && entry.enabled) {
			setDisableConfirmation({
				agentId: entry.agentId,
				displayName: entry.displayName,
			});
			return;
		}
		handleSetEnabled({ agentId: entry.agentId, enabled }).catch(
			(error: unknown) => {
				console.error("Failed to update local agent setting.", error);
			}
		);
	};
	const revealAccountEmail = (agentId: string) => {
		setRevealedAccountEmailAgentIds((current) => {
			if (current.has(agentId)) {
				return current;
			}
			const next = new Set(current);
			next.add(agentId);
			return next;
		});
	};

	if (input.entries.length === 0 || usableEntries.length === 0) {
		const checkedWithoutAgents =
			!(input.muted || input.connectionStatus || input.isCheckingAgents) &&
			input.targetStatus !== "unknown" &&
			input.targetStatus !== "stale" &&
			input.entries.length > 0 &&
			input.entries.every((entry) => !entry.detected);
		if (checkedWithoutAgents) {
			return (
				<LocalAgentInstallEmptyState
					installGuide={
						input.showInstallGuideLink ? <LocalAgentInstallGuideLink /> : null
					}
				/>
			);
		}
		return (
			<div
				className="flex min-h-40 flex-col items-center justify-center gap-3 rounded-md border border-border/70 border-dashed bg-card/25 px-6 py-6 text-center"
				data-testid="local-agent-catalog-empty"
			>
				<span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-border bg-muted/20 text-muted-foreground">
					<RobotIcon aria-hidden="true" className="h-4 w-4" />
				</span>
				<p className="font-medium text-sm">
					Local agents haven’t been checked yet
				</p>
				<p className="max-w-md text-muted-foreground text-xs leading-5">
					The list will appear after OpenMeld checks this computer.
				</p>
				{input.showInstallGuideLink ? <LocalAgentInstallGuideLink /> : null}
			</div>
		);
	}

	return (
		<>
			{input.showInstallGuideLink ? <LocalAgentInstallGuideLink /> : null}
			<div className="grid gap-3" data-testid="local-agent-catalog-list">
				{/* Local agent search is intentionally hidden while the supported agent list is short. */}
				<div data-testid="local-agent-catalog-rows">
					<SettingsLocalAgentCardGrid
						rows={visibleEntries.map((entry) => {
							const effectiveEntry = applyLocalAgentEnabledOverride({
								enabledOverrides,
								entry,
							});
							return buildLocalAgentCatalogRow({
								usageScope: input.usageScope,
								connectionStatus: input.connectionStatus,
								accountEmailRevealed: revealedAccountEmailAgentIds.has(
									entry.agentId
								),
								canRefreshCatalog: input.capabilities.refreshCatalog,
								canManageInstallations: input.capabilities.manageInstallations,
								canUpdateInstallations: input.capabilities.updateInstallations,
								canSetEnabled: input.capabilities.setEnabled,
								entry: effectiveEntry,
								isCheckingAgents: input.isCheckingAgents,
								muted: input.muted,
								onCheckAgents: input.onCheckAgents,
								onRefresh: input.onRefresh,
								onRevealAccountEmail: revealAccountEmail,
								onSetEnabled: requestSetEnabled,
								pending: pendingAgentId === entry.agentId,
								storageScope: input.storageScope,
								target: input.target,
								targetStatus: input.targetStatus,
							});
						})}
					/>
				</div>
				{errorMessage ? (
					<p className="text-destructive text-sm leading-5">{errorMessage}</p>
				) : null}
				{statusMessage ? (
					<p className="text-muted-foreground text-sm leading-5">
						{statusMessage}
					</p>
				) : null}
			</div>
			<LocalAgentDisableConfirmationDialog
				busy={
					disableConfirmation !== null &&
					pendingAgentId === disableConfirmation.agentId
				}
				confirmation={disableConfirmation}
				onCancel={() => setDisableConfirmation(null)}
				onConfirm={(target) => {
					setDisableConfirmation(null);
					handleSetEnabled({ agentId: target.agentId, enabled: false }).catch(
						(error: unknown) => {
							console.error("Failed to disable local agent.", error);
						}
					);
				}}
			/>
		</>
	);
}

type LocalAgentInstallationTarget = PeopleComputerTarget & {
	storageScope: string;
};

function localAgentInstallationsQueryKey(
	agentId: string,
	target: LocalAgentInstallationTarget
) {
	return [
		"people-computer-local-agent-installations",
		target.storageScope,
		target.deviceId,
		target.runtimeLane,
		agentId,
	] as const;
}

function useLocalAgentInstallations(
	agentId: string,
	target: LocalAgentInstallationTarget
) {
	return useQuery({
		queryFn: () =>
			readPeopleComputerLocalAgentInstallations({
				agentId,
				deviceId: target.deviceId,
				runtimeLane: target.runtimeLane,
			}),
		queryKey: localAgentInstallationsQueryKey(agentId, target),
		staleTime: LOCAL_AGENT_INSTALLATION_QUERY_STALE_TIME_MS,
	});
}

function LocalAgentInstallationSummary(input: {
	agentId: string;
	target: LocalAgentInstallationTarget;
}) {
	const installationsQuery = useLocalAgentInstallations(
		input.agentId,
		input.target
	);
	const installation = resolveSelectedLocalAgentInstallation(
		installationsQuery.data
	);
	return installation ? <> · {installation.name}</> : null;
}

function LocalAgentInstallationControl(input: {
	target: LocalAgentInstallationTarget;
	canUpdate: boolean;
	canSelect: boolean;
	agentId: string;
	displayName: string;
	onChanged: () => Promise<unknown>;
}) {
	const [chosenInstallationId, setChosenInstallationId] = useState<
		string | null
	>(null);
	const [pendingInstallationId, setPendingInstallationId] = useState<
		string | null
	>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [statusMessage, setStatusMessage] = useState<string | null>(null);
	const labelId = useId();
	const queryClient = useQueryClient();
	const queryKey = localAgentInstallationsQueryKey(input.agentId, input.target);
	const installationsQuery = useLocalAgentInstallations(
		input.agentId,
		input.target
	);
	const currentInstallation = resolveSelectedLocalAgentInstallation(
		installationsQuery.data
	);
	const effectiveChosenInstallationId =
		chosenInstallationId ?? currentInstallation?.installationId ?? null;
	const chosenInstallation = installationsQuery.data?.installations.find(
		(installation) =>
			installation.installationId === effectiveChosenInstallationId
	);

	const updateInstallationCache = (
		data: CurrentLocalAgentInstallationsResponse
	) => {
		queryClient.setQueryData<CurrentLocalAgentInstallationsResponse>(
			queryKey,
			data
		);
	};
	const finishInstallationChange = (
		data: CurrentLocalAgentInstallationsResponse,
		installationName: string
	) => {
		updateInstallationCache(data);
		setChosenInstallationId(null);
		toast.success(`${input.displayName} now uses ${installationName}.`);
		input.onChanged().catch((error: unknown) => {
			console.error(
				"Local agent installation changed, but its catalog refresh failed.",
				error
			);
		});
	};
	const selectInstallation = async (installationId: string) => {
		setPendingInstallationId(installationId);
		setErrorMessage(null);
		setStatusMessage(null);
		try {
			try {
				const result = await selectPeopleComputerLocalAgentInstallation({
					deviceId: input.target.deviceId,
					runtimeLane: input.target.runtimeLane,
					agentId: input.agentId,
					installationId,
				});
				finishInstallationChange(
					{
						agentId: result.agentId,
						installations: result.installations,
						selectionStatus: result.selectionStatus,
						selectedInstallationId: result.selectedInstallationId,
					},
					chosenInstallation?.name ?? input.displayName
				);
				return;
			} catch (error) {
				if (!isLocalAgentControlStillRunningError(error)) {
					throw error;
				}
			}

			const reconciliation = await reconcileLocalAgentInstallationChange({
				target: input.target,
				agentId: input.agentId,
				installationId,
			});
			if (reconciliation.status === "updated") {
				finishInstallationChange(
					reconciliation.data,
					chosenInstallation?.name ?? input.displayName
				);
				return;
			}
			setStatusMessage(
				"Still switching. You can close this window and check again shortly."
			);
		} catch (error) {
			if (isLocalAgentInstallationWorkBlockedError(error)) {
				setChosenInstallationId(null);
				setErrorMessage(
					`${input.displayName} has work in progress. Wait until it finishes before changing installations.`
				);
				installationsQuery.refetch().catch((refetchError: unknown) => {
					console.error(
						"Failed to refresh local agent installations after a blocked change.",
						refetchError
					);
				});
			} else if (isLocalAgentInstallationChangeInProgressError(error)) {
				setChosenInstallationId(null);
				setErrorMessage(
					`${input.displayName}'s installation is already being changed. Check again shortly.`
				);
			} else {
				setErrorMessage(
					formatMutationError(
						error,
						`OpenMeld couldn't change the ${input.displayName} installation.`
					)
				);
			}
		} finally {
			setPendingInstallationId(null);
		}
	};
	const selectionStatus = installationsQuery.data?.selectionStatus;
	const selectionBlocked =
		selectionStatus === "blocked_by_work" ||
		selectionStatus === "operation_in_progress";
	const canConfirm = Boolean(
		chosenInstallation &&
			chosenInstallation.installationId !==
				currentInstallation?.installationId &&
			pendingInstallationId === null &&
			!selectionBlocked
	);
	const installations = installationsQuery.data?.installations ?? [];
	const selectedDisplay = chosenInstallation
		? formatLocalAgentInstallationLabel(chosenInstallation)
		: "Choose an installation";

	return (
		<section
			aria-labelledby={labelId}
			className="grid min-w-0 gap-3 border-border/60 border-b pb-4"
		>
			<div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-w-0">
					<h4 className="font-medium text-sm" id={labelId}>
						Installation
					</h4>
					<p className="mt-0.5 text-muted-foreground text-xs leading-5">
						Used for new {input.displayName} work on this computer.
					</p>
				</div>
				<div className="w-fit min-w-0 max-w-full sm:max-w-72">
					{renderLocalAgentInstallationField({
						currentInstallation,
						disabled:
							!input.canSelect ||
							pendingInstallationId !== null ||
							selectionBlocked,
						displayName: input.displayName,
						installations,
						isError: installationsQuery.isError,
						isPending: installationsQuery.isPending,
						onChoose: (installationId) => {
							setChosenInstallationId(installationId);
							setErrorMessage(null);
							setStatusMessage(null);
						},
						selectedDisplay,
						selectedInstallationId: effectiveChosenInstallationId,
					})}
				</div>
			</div>
			{selectionStatus === "blocked_by_work" ? (
				<output className="text-muted-foreground text-sm">
					{input.displayName} has work in progress. Wait until it finishes
					before changing installations.
				</output>
			) : null}
			{selectionStatus === "operation_in_progress" ? (
				<output className="text-muted-foreground text-sm">
					{input.displayName}'s installation is being changed. Check again
					shortly.
				</output>
			) : null}
			{chosenInstallation && canConfirm ? (
				<div className="flex min-w-0 flex-col gap-3 rounded-lg bg-muted/45 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-w-0">
						<p className="font-medium text-sm">
							Switch {input.displayName} to {chosenInstallation.name}?
						</p>
						<p className="mt-0.5 text-muted-foreground text-xs leading-5">
							New {input.displayName} work will use this installation.
						</p>
					</div>
					<div className="flex shrink-0 items-center gap-2">
						<Button
							disabled={pendingInstallationId !== null}
							onClick={() => {
								setChosenInstallationId(null);
								setErrorMessage(null);
							}}
							size="sm"
							type="button"
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={pendingInstallationId !== null}
							onClick={() => {
								selectInstallation(chosenInstallation.installationId).catch(
									(error: unknown) => {
										console.error(
											"Failed to select local agent installation.",
											error
										);
									}
								);
							}}
							size="sm"
							type="button"
						>
							{pendingInstallationId ? "Switching…" : "Switch installation"}
						</Button>
					</div>
				</div>
			) : null}
			{errorMessage ? (
				<p className="break-words text-destructive text-sm" role="alert">
					{errorMessage}
				</p>
			) : null}
			{statusMessage ? (
				<output className="break-words text-muted-foreground text-sm">
					{statusMessage}
				</output>
			) : null}
			{currentInstallation && input.canUpdate ? (
				<LocalAgentUpdateControl
					agentId={input.agentId}
					blocked={selectionBlocked || pendingInstallationId !== null}
					installationId={currentInstallation.installationId}
					onChanged={async () => {
						await installationsQuery.refetch();
						await input.onChanged();
					}}
					storageScope={input.target.storageScope}
					target={input.target}
				/>
			) : null}
		</section>
	);
}

function renderLocalAgentInstallationField(input: {
	currentInstallation: LocalAgentInstallationOption | null;
	disabled: boolean;
	displayName: string;
	installations: readonly LocalAgentInstallationOption[];
	isError: boolean;
	isPending: boolean;
	onChoose: (installationId: string) => void;
	selectedDisplay: string;
	selectedInstallationId: string | null;
}): ReactNode {
	if (input.isPending) {
		return (
			<p className="text-muted-foreground text-sm">Checking installations…</p>
		);
	}
	if (input.isError) {
		return (
			<p className="text-destructive text-sm">
				OpenMeld couldn't check installations. Make sure OpenMeld Service is
				connected, then try again.
			</p>
		);
	}
	if (input.installations.length === 0) {
		return (
			<p className="text-muted-foreground text-sm">
				No working installations were found. Run OpenMeld setup again after
				installing {input.displayName}.
			</p>
		);
	}
	if (input.installations.length === 1 && input.currentInstallation) {
		return (
			<p className="truncate text-sm">
				{formatLocalAgentInstallationLabel(input.currentInstallation)}
			</p>
		);
	}
	return (
		<Select
			disabled={input.disabled}
			onValueChange={input.onChoose}
			value={input.selectedInstallationId ?? ""}
		>
			<SelectTrigger
				aria-label={`${input.displayName} installation`}
				className="w-fit min-w-0 text-sm"
				displayValue={input.selectedDisplay}
				placeholder="Choose an installation"
			/>
			<SelectContent className="max-h-72" matchTriggerWidth>
				{input.installations.map((installation, index) => (
					<SelectItem
						index={index}
						key={installation.installationId}
						value={installation.installationId}
					>
						<span className="flex min-w-0 flex-col py-0.5">
							<span className="truncate font-medium">{installation.name}</span>
							<span className="truncate text-muted-foreground text-xs">
								{installation.details}
							</span>
						</span>
					</SelectItem>
				))}
			</SelectContent>
		</Select>
	);
}

function formatLocalAgentInstallationLabel(
	installation: LocalAgentInstallationOption
): string {
	const version = installation.details.split(" · ")[0]?.trim();
	return version ? `${installation.name} · ${version}` : installation.name;
}

function resolveSelectedLocalAgentInstallation(
	data: CurrentLocalAgentInstallationsResponse | undefined
): LocalAgentInstallationOption | null {
	if (!data) {
		return null;
	}
	return (
		data.installations.find(
			(installation) =>
				installation.installationId === data.selectedInstallationId
		) ??
		data.installations.find((installation) => installation.selected) ??
		null
	);
}

function isLocalAgentInstallationWorkBlockedError(error: unknown): boolean {
	return getErrorCode(error) === "agents.installation_change_blocked_by_work";
}

function isLocalAgentInstallationChangeInProgressError(
	error: unknown
): boolean {
	return getErrorCode(error) === "agents.installation_change_in_progress";
}

function getErrorCode(error: unknown): string | null {
	if (!(typeof error === "object" && error !== null && "code" in error)) {
		return null;
	}
	return typeof error.code === "string" ? error.code : null;
}

function LocalAgentInstallGuideLink() {
	return (
		<p className="text-muted-foreground text-xs leading-5">
			No agents installed yet?{" "}
			<Link
				className={cn(
					APP_MOBILE_TOUCH_TARGET_CLASS_NAME,
					"font-medium text-foreground max-lg:inline-flex max-lg:items-center"
				)}
				to={LOCAL_AGENTS_GUIDE_PATH}
			>
				See the install guide
			</Link>
			.
		</p>
	);
}

function applyLocalAgentEnabledOverride(input: {
	enabledOverrides: LocalAgentEnabledOverrides;
	entry: DeviceAgentCatalogEntry;
}): DeviceAgentCatalogEntry {
	const enabled = input.enabledOverrides[input.entry.agentId];
	if (typeof enabled !== "boolean") {
		return input.entry;
	}
	return {
		...input.entry,
		enabled,
	};
}

function removeLocalAgentEnabledOverride(
	enabledOverrides: LocalAgentEnabledOverrides,
	agentId: string
): LocalAgentEnabledOverrides {
	if (!(agentId in enabledOverrides)) {
		return enabledOverrides;
	}
	const next = { ...enabledOverrides };
	delete next[agentId];
	return next;
}

function LocalAgentDisableConfirmationDialog(input: {
	busy: boolean;
	confirmation: { agentId: string; displayName: string } | null;
	onCancel: () => void;
	onConfirm: (target: { agentId: string }) => void;
}) {
	const displayName = input.confirmation?.displayName ?? "this local agent";

	return (
		<Dialog
			onOpenChange={(open) => {
				if (!open) {
					input.onCancel();
				}
			}}
			open={input.confirmation !== null}
		>
			<DialogContent showCloseButton={false}>
				<DialogHeader>
					<DialogTitle>Disable {displayName}?</DialogTitle>
					<DialogDescription>
						OpenMeld will stop launching {displayName} on this computer. Agent
						Profiles that use {displayName} may not wake until you enable it
						again.
					</DialogDescription>
				</DialogHeader>
				<DialogFooter>
					<Button
						disabled={input.busy}
						onClick={input.onCancel}
						size="sm"
						type="button"
						variant="outline"
					>
						Cancel
					</Button>
					<Button
						disabled={input.busy || input.confirmation === null}
						onClick={() => {
							if (input.confirmation) {
								input.onConfirm({ agentId: input.confirmation.agentId });
							}
						}}
						size="sm"
						type="button"
						variant="destructive"
					>
						Disable {displayName}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

function isUsableLocalAgentCatalogEntry(
	entry: DeviceAgentCatalogEntry
): boolean {
	if (entry.lifecycleStatus === "suspended") {
		return entry.enabled === true;
	}
	return entry.enabled === true || entry.selectable;
}

function filterUsableLocalAgentCatalogEntries(
	entries: readonly DeviceAgentCatalogEntry[]
): readonly DeviceAgentCatalogEntry[] {
	const usableEntries: DeviceAgentCatalogEntry[] = [];
	for (const entry of entries) {
		if (isUsableLocalAgentCatalogEntry(entry)) {
			usableEntries.push(entry);
		}
	}
	return usableEntries;
}

function shouldShowLocalAgentInstallGuideLink(
	entries: readonly DeviceAgentCatalogEntry[]
): boolean {
	return entries.length === 0 || entries.every((entry) => !entry.detected);
}

type BuildLocalAgentCatalogRowInput = {
	usageScope?: LocalAgentConsumptionScope;
	storageScope: string;
	connectionStatus: LocalAgentCatalogRowSummaryStatus | null;
	accountEmailRevealed: boolean;
	canManageInstallations: boolean;
	canUpdateInstallations?: boolean;
	canRefreshCatalog: boolean;
	canSetEnabled: boolean;
	entry: DeviceAgentCatalogEntry;
	isCheckingAgents: boolean;
	muted: boolean;
	onCheckAgents: () => Promise<void>;
	onRefresh: () => Promise<unknown>;
	onRevealAccountEmail: (agentId: string) => void;
	onSetEnabled: (entry: DeviceAgentCatalogEntry, enabled: boolean) => void;
	pending: boolean;
	target: LocalRuntimeExecutionTarget | null;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
};

function buildLocalAgentCatalogRow(
	input: BuildLocalAgentCatalogRowInput
): SettingsLocalAgentRow {
	const enabled = input.entry.enabled === true;
	const display = resolveLocalAgentCatalogRowDisplay(input);
	const agentControllerInterface = resolveAgentControllerInterfaceForEntry({
		entry: input.entry,
		target: input.target,
	});
	// One card, one status. Launch facts come only from the Core catalog entry
	// and controller facts only from the interface snapshot, in this order:
	// 1. A completed negative launch result in the catalog (Choose installation,
	//    Can't start). Core never projects one from an expired or unfinished
	//    check, so these stay reserved for real launch failures.
	// 2. The interface snapshot: a check that has not completed recently is
	//    a neutral "Check delayed" with the last known details kept; then
	//    sign-in and controller health.
	// 3. The row's display status, then Ready or Off.
	const setupStatus = enabled
		? resolveLocalAgentSetupSummaryStatus(input.entry)
		: null;
	const canChangeInstallation = Boolean(
		input.canManageInstallations && input.entry.enabled
	);
	const switchDisabled =
		input.pending ||
		!input.canSetEnabled ||
		!canChangeLocalAgentEnabled({
			entry: input.entry,
			targetStatus: input.targetStatus,
		});
	const setupDescription = enabled
		? resolveLocalAgentSetupDescription({
				displayDescription: display.description,
				setupStatus,
			})
		: null;
	let description = enabled
		? resolveAgentControllerInterfaceDescription({
				displayDescription: display.description,
				snapshot: agentControllerInterface,
			})
		: display.description;
	if (setupDescription && !agentControllerInterface?.launch.failureReason) {
		description = setupDescription;
	}
	const controllerStatus =
		setupStatus || !enabled
			? null
			: resolveAgentControllerInterfaceSummaryStatus(agentControllerInterface);
	const summaryStatuses = [
		setupStatus,
		controllerStatus,
		display.status,
	].filter(
		(status): status is LocalAgentCatalogRowSummaryStatus => status !== null
	);
	if (summaryStatuses.length === 0) {
		summaryStatuses.push(
			enabled
				? { label: "Ready", tone: "ready" }
				: { label: "Off", tone: "muted" }
		);
	}
	const summaryAccessory = renderLocalAgentCatalogRowSummaryAccessory({
		displayName: input.entry.displayName,
		enabled,
		snapshot: agentControllerInterface,
	});

	return applyLocalAgentConnectionStatus(
		{
			advisory: summaryAccessory.advisory,
			badge: display.label ? (
				<Badge variant={display.badgeVariant}>{display.label}</Badge>
			) : null,
			control: (
				<Switch
					aria-label={`${input.entry.displayName} local agent`}
					checked={input.entry.enabled === true}
					disabled={switchDisabled}
					onCheckedChange={(enabled) => {
						input.onSetEnabled(input.entry, enabled);
					}}
				/>
			),
			checkedAtLabel: formatAgentControllerCheckedAtLabel(
				agentControllerInterface
			),
			description,
			detail: renderLocalAgentCatalogRowDetail({
				canChangeInstallation,
				rowInput: input,
				snapshot: agentControllerInterface,
			}),
			displayName: input.entry.displayName,
			id: input.entry.agentId,
			identityMuted:
				!enabled ||
				agentControllerInterface?.auth.status === "unauthenticated" ||
				agentControllerInterface?.status === "unavailable",
			logoAgentId: input.entry.agentId,
			muted:
				input.muted ||
				!enabled ||
				agentControllerInterface?.auth.status === "unauthenticated" ||
				agentControllerInterface?.status === "unavailable",
			summaryAccessory: summaryAccessory.usage,
			summarySupplement: renderLocalAgentConsumption(input, "preview"),
			summaryMeta:
				enabled && agentControllerInterface
					? renderAgentControllerInterfaceSummary({
							target: input.target
								? {
										deviceId: input.target.deviceId,
										runtimeLane: input.target.runtimeLane,
										storageScope: input.storageScope,
									}
								: null,
							agentId: input.entry.agentId,
							emailRevealed: input.accountEmailRevealed,
							onRevealEmail: input.onRevealAccountEmail,
							showInstallation: canChangeInstallation,
							snapshot: agentControllerInterface,
						})
					: null,
			summaryStatuses: summaryStatuses.length > 0 ? summaryStatuses : undefined,
		},
		input.connectionStatus,
		enabled
	);
}

function applyLocalAgentConnectionStatus(
	row: SettingsLocalAgentRow,
	status: LocalAgentCatalogRowSummaryStatus | null,
	enabled: boolean
): SettingsLocalAgentRow {
	if (!status) {
		return row;
	}
	return {
		...row,
		advisory: null,
		badge: null,
		identityMuted: true,
		muted: true,
		summaryAccessory: null,
		summaryMeta: null,
		summaryStatuses: enabled ? [status] : row.summaryStatuses,
		description:
			status.label === "Checking"
				? "Waiting for a current local agent report from this computer."
				: "Last reported information. Local agents will refresh when this computer is ready.",
	};
}

function renderLocalAgentCatalogRowSummaryAccessory(input: {
	displayName: string;
	enabled: boolean;
	snapshot: AgentControllerInterfaceSnapshot | null;
}): { advisory: ReactNode; usage: ReactNode } {
	if (!(input.enabled && input.snapshot)) {
		return { advisory: null, usage: null };
	}
	const versionAdvisory = getAgentControllerVersionAdvisoryPresentation(
		input.snapshot
	);
	return {
		advisory: versionAdvisory ? (
			<SettingsLocalAgentAdvisoryBadge
				detail={versionAdvisory.detail}
				label={versionAdvisory.label}
				tone={versionAdvisory.tone}
				updateCommand={versionAdvisory.updateCommand}
			/>
		) : null,
		usage: (
			<SettingsLocalAgentUsageSummary
				agentName={input.displayName}
				limits={input.snapshot.usageLimits}
			/>
		),
	};
}

function LocalAgentUpdateBanner(input: { command: string; detail: string }) {
	const [copyStatus, setCopyStatus] = useState<"idle" | "copied">("idle");
	const copyCommand = async () => {
		const didCopy = await copyCliEntryCommand(input.command);
		if (didCopy) {
			setCopyStatus("copied");
			toast.success("Update command copied.");
		}
	};
	return (
		<div className="flex flex-col gap-2.5">
			<p className="text-amber-600 text-xs leading-5 dark:text-amber-300">
				{input.detail}
			</p>
			<p className="text-muted-foreground text-xs leading-5">
				Copy this command. Then open a terminal on this computer, paste the
				command, and press Enter.
			</p>
			<div className="flex items-center justify-between gap-3">
				<ScrollArea className="min-w-0" orientation="horizontal">
					<code className="font-mono text-xs leading-5">{input.command}</code>
				</ScrollArea>
				<Button
					aria-label={
						copyStatus === "copied" ? "Command copied" : "Copy command"
					}
					className="shrink-0"
					onClick={() => {
						copyCommand().catch((error: unknown) => {
							console.error("Failed to copy update command.", error);
						});
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					{copyStatus === "copied" ? (
						<CheckIcon aria-hidden="true" weight="bold" />
					) : (
						<CopyIcon aria-hidden="true" />
					)}
					{copyStatus === "copied" ? "Copied" : "Copy command"}
				</Button>
			</div>
		</div>
	);
}

function AntigravitySignIn(
	input: Pick<
		BuildLocalAgentCatalogRowInput,
		"canRefreshCatalog" | "isCheckingAgents" | "onCheckAgents"
	>
) {
	return (
		<div className="flex flex-col items-start gap-2">
			<div className="w-full text-muted-foreground text-sm">
				<AgentControllerIssueDetail
					canCheckAgain
					canRefreshCatalog={input.canRefreshCatalog}
					isCheckingAgents={input.isCheckingAgents}
					message="Run this command in a terminal on this computer. Open the sign-in link it shows, then select Check again."
					onCheckAgents={input.onCheckAgents}
				/>
			</div>
			<code className="text-xs">openmeld agents login antigravity</code>
			<Button
				onClick={() => {
					copyCliEntryCommand("openmeld agents login antigravity")
						.then((copied) => {
							if (copied) {
								toast.success("Sign-in command copied.");
							}
						})
						.catch(() =>
							toast.error(
								"Could not copy the command. Select and copy it above."
							)
						);
				}}
				size="sm"
				variant="outline"
			>
				Copy sign-in command
			</Button>
		</div>
	);
}

function renderLocalAgentConsumption(
	input: BuildLocalAgentCatalogRowInput,
	view: "preview" | "detail"
) {
	const controller = resolveAgentControllerRefForCatalogEntry(input.entry);
	if (!(input.usageScope && controller)) {
		return null;
	}
	return view === "preview" ? (
		<LocalAgentConsumptionPreview
			{...input.usageScope}
			controller={controller}
		/>
	) : (
		<LocalAgentConsumptionDetails
			{...input.usageScope}
			controller={controller}
		/>
	);
}

function renderLocalAgentCatalogRowDetail(input: {
	canChangeInstallation: boolean;
	rowInput: BuildLocalAgentCatalogRowInput;
	snapshot: AgentControllerInterfaceSnapshot | null;
}): ReactNode {
	if (!input.snapshot) {
		return renderLocalAgentConsumption(input.rowInput, "detail");
	}
	const versionAdvisory = getAgentControllerVersionAdvisoryPresentation(
		input.snapshot
	);
	return (
		<div className="space-y-3">
			{input.snapshot.controllerId === "antigravity" &&
			input.snapshot.nativeInterface === "acp" &&
			input.snapshot.auth.status === "unauthenticated" ? (
				<AntigravitySignIn
					canRefreshCatalog={input.rowInput.canRefreshCatalog}
					isCheckingAgents={input.rowInput.isCheckingAgents}
					onCheckAgents={input.rowInput.onCheckAgents}
				/>
			) : null}
			{input.snapshot.controllerId === "antigravity" &&
			input.snapshot.nativeInterface === "local-cli" ? (
				<a
					className="text-sm underline underline-offset-4"
					href="https://www.antigravity.google/docs/ide/extensions/xcode"
					rel="noreferrer"
					target="_blank"
				>
					Install official Antigravity ACP
				</a>
			) : null}
			{versionAdvisory?.updateCommand ? (
				<LocalAgentUpdateBanner
					command={versionAdvisory.updateCommand}
					detail={versionAdvisory.detail}
				/>
			) : null}
			{(input.canChangeInstallation || input.rowInput.canUpdateInstallations) &&
			input.rowInput.target ? (
				<LocalAgentInstallationControl
					agentId={input.rowInput.entry.agentId}
					canSelect={input.canChangeInstallation}
					canUpdate={input.rowInput.canUpdateInstallations === true}
					displayName={input.rowInput.entry.displayName}
					onChanged={input.rowInput.onRefresh}
					target={{
						deviceId: input.rowInput.target.deviceId,
						runtimeLane: input.rowInput.target.runtimeLane,
						storageScope: input.rowInput.storageScope,
					}}
				/>
			) : null}
			<SettingsLocalAgentUsageLimits
				agentName={input.rowInput.entry.displayName}
				fillColumns
				limits={input.snapshot.usageLimits}
			/>
			{renderLocalAgentConsumption(input.rowInput, "detail")}
			<SettingsDetailList
				rows={createAgentControllerInterfaceDetailRows({
					agentId: input.rowInput.entry.agentId,
					canRefreshCatalog: input.rowInput.canRefreshCatalog,
					emailRevealed: input.rowInput.accountEmailRevealed,
					isCheckingAgents: input.rowInput.isCheckingAgents,
					onCheckAgents: input.rowInput.onCheckAgents,
					onRevealEmail: input.rowInput.onRevealAccountEmail,
					snapshot: input.snapshot,
					targetStatus: input.rowInput.target?.status ?? null,
				})}
			/>
		</div>
	);
}

function renderAgentControllerInterfaceSummary(input: {
	target: LocalAgentInstallationTarget | null;
	agentId: string;
	emailRevealed: boolean;
	onRevealEmail: (agentId: string) => void;
	showInstallation: boolean;
	snapshot: AgentControllerInterfaceSnapshot;
}): ReactNode {
	const summary = formatAgentControllerInterfaceSummary(input.snapshot);
	const installationSummary =
		input.showInstallation && input.target ? (
			<LocalAgentInstallationSummary
				agentId={input.agentId}
				target={input.target}
			/>
		) : null;
	const email = resolveAgentControllerAccountEmailText(input.snapshot);
	if (!email) {
		return (
			<>
				{summary}
				{installationSummary}
			</>
		);
	}
	const parts = splitTextAroundFirstMatch(summary, email);
	if (!parts) {
		return (
			<>
				{summary}
				{installationSummary}
			</>
		);
	}
	return (
		<>
			{parts.before}
			<AgentControllerAccountEmail
				agentId={input.agentId}
				email={email}
				location="summary"
				onReveal={input.onRevealEmail}
				revealed={input.emailRevealed}
			/>
			{parts.after}
			{installationSummary}
		</>
	);
}

function createAgentControllerInterfaceDetailRows(input: {
	agentId: string;
	canRefreshCatalog: boolean;
	emailRevealed: boolean;
	isCheckingAgents: boolean;
	onCheckAgents: () => Promise<void>;
	onRevealEmail: (agentId: string) => void;
	snapshot: AgentControllerInterfaceSnapshot;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
}): SettingsDetailListRow[] {
	const email = resolveAgentControllerAccountEmailText(input.snapshot);
	const hasIssueMessage = shouldRenderAgentControllerIssueRow(input.snapshot);
	const canCheckAgain = shouldOfferAgentControllerCheckAgain(input.snapshot);
	const rows = withoutCheckedAtDetailRows(
		createAgentControllerInterfaceDisplayRows(input.snapshot)
	).map((row) => {
		if (hasIssueMessage && row.label === "Message") {
			return {
				label: "Issue",
				value: (
					<AgentControllerIssueDetail
						canCheckAgain={canCheckAgain}
						canRefreshCatalog={input.canRefreshCatalog}
						isCheckingAgents={input.isCheckingAgents}
						message={row.value}
						onCheckAgents={input.onCheckAgents}
					/>
				),
			};
		}
		if (email && row.label === "Account" && row.value === email) {
			return {
				...row,
				value: (
					<AgentControllerAccountEmail
						agentId={input.agentId}
						email={email}
						location="detail"
						onReveal={input.onRevealEmail}
						revealed={input.emailRevealed}
					/>
				),
			};
		}
		return row;
	});
	if (input.snapshot.check?.status === "failed" && !hasIssueMessage) {
		const controllerRowIndex = rows.findIndex(
			(row) => row.label === "Controller"
		);
		rows.splice(controllerRowIndex >= 0 ? controllerRowIndex + 1 : 0, 0, {
			label: "Issue",
			value: (
				<AgentControllerIssueDetail
					canCheckAgain={canCheckAgain}
					canRefreshCatalog={input.canRefreshCatalog}
					isCheckingAgents={input.isCheckingAgents}
					message={`${input.snapshot.displayName} check is delayed. OpenMeld will retry automatically.`}
					onCheckAgents={input.onCheckAgents}
				/>
			),
		});
	}
	const launchCheck = rows.find((row) => row.label === "Launch check");
	if (
		launchCheck &&
		input.targetStatus === "stale" &&
		typeof launchCheck.value === "string"
	) {
		launchCheck.value = `Last check: ${launchCheck.value}`;
	}
	return placeLaunchCheckSecond(rows);
}

function withoutCheckedAtDetailRows(
	rows: readonly SettingsDetailListRow[]
): SettingsDetailListRow[] {
	return rows.filter(
		(row) =>
			row.label !== "Last checked" && row.label !== "Last successful check"
	);
}

function formatAgentControllerCheckedAtLabel(
	snapshot:
		| AgentControllerInterfaceSnapshot
		| OrganizationComputerLocalAgentDetails
		| null
		| undefined
): string | null {
	if (!snapshot) {
		return null;
	}
	const checkedAt =
		snapshot.check?.status === "failed" && snapshot.check.lastSucceededAt
			? snapshot.check.lastSucceededAt
			: snapshot.checkedAt;
	return formatCheckedAt(checkedAt);
}

function placeLaunchCheckSecond(
	rows: readonly SettingsDetailListRow[]
): SettingsDetailListRow[] {
	const launchCheckIndex = rows.findIndex(
		(row) => row.label === "Launch check"
	);
	if (launchCheckIndex <= 1) {
		return [...rows];
	}
	const orderedRows = [...rows];
	const [launchCheck] = orderedRows.splice(launchCheckIndex, 1);
	if (launchCheck) {
		orderedRows.splice(1, 0, launchCheck);
	}
	return orderedRows;
}

function AgentControllerIssueDetail(input: {
	canCheckAgain: boolean;
	canRefreshCatalog: boolean;
	isCheckingAgents: boolean;
	message: ReactNode;
	onCheckAgents: () => Promise<void>;
}) {
	return (
		<span className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<span className="min-w-0">{input.message}</span>
			{input.canCheckAgain && input.canRefreshCatalog ? (
				<Button
					className="w-fit shrink-0"
					disabled={input.isCheckingAgents}
					onClick={() => {
						input.onCheckAgents().catch((error: unknown) => {
							console.error("Failed to check local agents.", error);
						});
					}}
					size="sm"
					type="button"
					variant="outline"
				>
					<ArrowsClockwiseIcon aria-hidden="true" data-icon="inline-start" />
					{input.isCheckingAgents ? "Checking..." : "Check again"}
				</Button>
			) : null}
		</span>
	);
}

function shouldOfferAgentControllerCheckAgain(
	snapshot: AgentControllerInterfaceSnapshot
): boolean {
	return (
		snapshot.check?.status === "failed" ||
		snapshot.status === "warning" ||
		snapshot.status === "error"
	);
}

function shouldRenderAgentControllerIssueRow(
	snapshot: AgentControllerInterfaceSnapshot
): boolean {
	if (!snapshot.message && snapshot.launch.status !== "needs_repair") {
		return false;
	}
	return (
		snapshot.check?.status === "failed" ||
		snapshot.status === "warning" ||
		snapshot.status === "error" ||
		snapshot.status === "unavailable" ||
		snapshot.auth.status === "unauthenticated" ||
		snapshot.launch.status === "needs_choice" ||
		snapshot.launch.status === "needs_repair"
	);
}

function AgentControllerAccountEmail(input: {
	agentId: string;
	email: string;
	location: "detail" | "summary";
	onReveal: (agentId: string) => void;
	revealed: boolean;
}) {
	const prefersReducedMotion = useReducedMotion();
	const interactive = !input.revealed;
	const reveal = () => {
		if (input.revealed) {
			return;
		}
		input.onReveal(input.agentId);
	};
	const handleClick = (event: MouseEvent<HTMLSpanElement>) => {
		event.preventDefault();
		event.stopPropagation();
		reveal();
	};
	const handleKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
		if (event.key !== "Enter" && event.key !== " ") {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		reveal();
	};

	return (
		<LazyMotion features={domAnimation} strict>
			<TooltipHint
				content={interactive ? "Reveal signed-in account email" : undefined}
			>
				<m.span
					animate={{
						filter: input.revealed ? "blur(0px)" : "blur(3px)",
						opacity: input.revealed ? 1 : 0.62,
					}}
					aria-label={
						interactive ? "Reveal signed-in account email" : undefined
					}
					className={cn(
						"rounded-md align-baseline",
						interactive
							? "cursor-pointer select-none text-foreground/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
							: "text-current"
					)}
					data-revealed={input.revealed ? "true" : "false"}
					data-testid={`agent-controller-account-email-${input.agentId}-${input.location}`}
					initial={false}
					onClick={interactive ? handleClick : undefined}
					onKeyDown={interactive ? handleKeyDown : undefined}
					role={interactive ? "button" : undefined}
					tabIndex={interactive ? 0 : undefined}
					transition={
						prefersReducedMotion
							? { duration: 0 }
							: { duration: 0.18, ease: "easeOut" }
					}
				>
					{input.email}
				</m.span>
			</TooltipHint>
		</LazyMotion>
	);
}

function resolveAgentControllerAccountEmailText(
	snapshot: AgentControllerInterfaceSnapshot
): string | null {
	if (snapshot.auth.status !== "authenticated") {
		return null;
	}
	if (snapshot.auth.email) {
		return snapshot.auth.email;
	}
	const label = snapshot.auth.label;
	if (label?.includes("@")) {
		return label;
	}
	return null;
}

function splitTextAroundFirstMatch(
	value: string,
	match: string
): { after: string; before: string } | null {
	const startIndex = value.indexOf(match);
	if (startIndex < 0) {
		return null;
	}
	return {
		after: value.slice(startIndex + match.length),
		before: value.slice(0, startIndex),
	};
}

function resolveAgentControllerInterfaceForEntry(input: {
	entry: DeviceAgentCatalogEntry;
	target: LocalRuntimeExecutionTarget | null;
}): AgentControllerInterfaceSnapshot | null {
	const agentControllerRef = resolveAgentControllerRefForCatalogEntry(
		input.entry
	);
	if (!agentControllerRef) {
		return null;
	}
	return (
		input.target?.capabilities.find(
			(capability) => capability.agentControllerRef === agentControllerRef
		)?.agentControllerInterface ?? null
	);
}

function resolveAgentControllerRefForCatalogEntry(
	entry: DeviceAgentCatalogEntry
): string | null {
	if (entry.targetKind !== "builtin") {
		return null;
	}
	return `builtin:${entry.agentId}`;
}

function resolveLocalAgentSetupSummaryStatus(
	entry: DeviceAgentCatalogEntry
): LocalAgentCatalogRowSummaryStatus | null {
	if (!shouldShowLocalAgentSetupStatus(entry)) {
		return null;
	}
	if (entry.launchStatus === "needs_choice") {
		return { label: "Choose installation", tone: "warning" };
	}
	return { label: "Can’t start", tone: "danger" };
}

function resolveAgentControllerInterfaceSummaryStatus(
	snapshot: AgentControllerInterfaceSnapshot | null
): LocalAgentCatalogRowSummaryStatus | null {
	if (!snapshot) {
		return null;
	}
	if (snapshot.check?.status === "failed") {
		// A late or unfinished check is not a failure of the agent itself.
		return { label: "Check delayed", tone: "checking" };
	}
	if (snapshot.auth.status === "unauthenticated") {
		// Signing in is a routine account state, not a computer failure: keep it
		// quiet (muted row, no red) the same way a switched-off agent reads.
		return { label: "Not signed in", tone: "muted" };
	}
	if (
		snapshot.controllerId === "antigravity" &&
		snapshot.auth.status === "unknown" &&
		snapshot.check?.status === "succeeded"
	) {
		return { label: "Installed", tone: "muted" };
	}
	if (snapshot.status === "error") {
		// Launch failures are owned by the catalog entry (step 1 above).
		return { label: "Needs attention", tone: "danger" };
	}
	if (snapshot.status === "warning" || snapshot.status === "unavailable") {
		return snapshot.status === "unavailable"
			? { label: "Unavailable", tone: "warning" }
			: { label: "Needs attention", tone: "warning" };
	}
	return null;
}

function shouldShowLocalAgentSetupStatus(
	entry: DeviceAgentCatalogEntry
): boolean {
	if (
		entry.enabled !== true ||
		entry.lifecycleStatus === "suspended" ||
		!entry.detected
	) {
		return false;
	}
	return (
		entry.launchStatus === "needs_choice" ||
		entry.launchStatus === "needs_repair"
	);
}

function resolveLocalAgentSetupDescription(input: {
	displayDescription: string;
	setupStatus: LocalAgentCatalogRowSummaryStatus | null;
}): string | null {
	if (!input.setupStatus) {
		return null;
	}
	return input.displayDescription;
}

function canChangeLocalAgentEnabled(input: {
	entry: DeviceAgentCatalogEntry;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
}): boolean {
	if (input.targetStatus === "stale") {
		return false;
	}
	if (input.entry.targetKind !== "builtin") {
		return false;
	}
	return (
		input.entry.detected && (input.entry.enabled || input.entry.selectable)
	);
}

function resolveLocalAgentEnabledErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim()) {
		return error.message;
	}
	return "OpenMeld could not change this local agent.";
}

function compareLocalAgentCatalogEntries(
	left: DeviceAgentCatalogEntry,
	right: DeviceAgentCatalogEntry
): number {
	const displayOrder = compareAgentControllerRefsForDisplay(
		left.agentId,
		right.agentId
	);
	if (displayOrder !== 0) {
		return displayOrder;
	}
	const leftPriority = resolveLocalAgentCatalogEntrySortPriority(left);
	const rightPriority = resolveLocalAgentCatalogEntrySortPriority(right);
	if (leftPriority !== rightPriority) {
		return leftPriority - rightPriority;
	}
	return left.displayName.localeCompare(right.displayName);
}

function resolveLocalAgentCatalogEntrySortPriority(
	entry: DeviceAgentCatalogEntry
): number {
	if (entry.lifecycleStatus === "suspended" && entry.enabled) {
		return 3;
	}
	if (entry.selectable && entry.launchStatus === "ready") {
		return 0;
	}
	if (entry.launchStatus === "needs_choice") {
		return 1;
	}
	if (entry.launchStatus === "needs_repair") {
		return 2;
	}
	if (
		entry.detected &&
		(entry.selectableReason === "not_supported_yet" ||
			entry.selectableReason === "custom_coming_soon")
	) {
		return 3;
	}
	if (entry.detected) {
		return 4;
	}
	return 5;
}

function resolveLocalAgentCatalogRowDisplay(input: {
	entry: DeviceAgentCatalogEntry;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
}): {
	badgeVariant: "destructive" | "outline" | "secondary";
	description: string;
	label: string | null;
	status: LocalAgentCatalogRowSummaryStatus | null;
} {
	if (
		input.entry.enabled !== true &&
		input.entry.lifecycleStatus !== "suspended" &&
		input.entry.detected &&
		input.entry.selectable
	) {
		return {
			badgeVariant: "secondary",
			description: "Built-in local agent found on this computer.",
			label: null,
			status: null,
		};
	}
	const status: LocalAgentCatalogRowSummaryStatus | null =
		input.entry.lifecycleStatus === "suspended"
			? {
					label: "Suspended",
					tone: "warning",
				}
			: null;
	if (input.entry.lifecycleStatus === "suspended") {
		return {
			badgeVariant: "secondary",
			description: input.entry.enabled
				? "OpenMeld keeps this existing controller setting on this computer."
				: "This local agent is suspended.",
			label: null,
			status,
		};
	}
	const display = resolveLocalAgentCatalogAvailabilityDisplay(input);
	return { ...display, status };
}

function resolveLocalAgentCatalogAvailabilityDisplay(input: {
	entry: DeviceAgentCatalogEntry;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
}): {
	badgeVariant: "destructive" | "outline" | "secondary";
	description: string;
	label: string | null;
} {
	if (input.targetStatus === "stale" && input.entry.detected) {
		if (
			input.entry.selectableReason === "not_supported_yet" ||
			input.entry.selectableReason === "custom_coming_soon"
		) {
			return {
				badgeVariant: "outline",
				description:
					"Last check found this agent, but OpenMeld cannot run it yet.",
				label: "Coming soon",
			};
		}
		return {
			badgeVariant: "outline",
			description:
				"Last check found this local agent. Connect this computer to refresh its status.",
			label: null,
		};
	}

	if (input.entry.selectable && input.entry.launchStatus === "ready") {
		return {
			badgeVariant: "secondary",
			description: "Built-in local agent found on this computer.",
			label: null,
		};
	}

	if (
		!input.entry.detected ||
		input.entry.selectableReason === "not_detected"
	) {
		return {
			badgeVariant: "outline",
			description: "Not found on this computer yet.",
			label: "Not found",
		};
	}

	if (
		input.entry.selectableReason === "not_supported_yet" ||
		input.entry.selectableReason === "custom_coming_soon"
	) {
		return {
			badgeVariant: "outline",
			description: "Found on this computer, but OpenMeld cannot run it yet.",
			label: "Coming soon",
		};
	}

	if (input.entry.launchStatus === "needs_choice") {
		return {
			badgeVariant: "outline",
			description: `OpenMeld found more than one ${input.entry.displayName} installation. Choose which one to use.`,
			label: null,
		};
	}

	if (input.entry.launchStatus === "needs_repair") {
		return {
			badgeVariant: "destructive",
			description: `The selected ${input.entry.displayName} installation can’t start. Check the installation or choose another one.`,
			label: null,
		};
	}

	return {
		badgeVariant: "outline",
		description: "Detected, but unavailable to run from this computer.",
		label: "Unavailable",
	};
}

function resolveLocalAgentsNoticeClassName(
	tone: LocalAgentsCatalogNoticeModel["tone"]
): string {
	return resolveStatusToneSurfaceClassName(tone);
}

function resolveLocalAgentsNoticeTitleClassName(
	tone: LocalAgentsCatalogNoticeModel["tone"]
): string {
	return tone === "muted"
		? "text-foreground"
		: resolveStatusToneSoftTextClassName(tone);
}

function resolveLocalAgentsNoticeDotClassName(
	tone: LocalAgentsCatalogNoticeModel["tone"]
): string {
	return resolveStatusToneIndicatorClassName(tone);
}
