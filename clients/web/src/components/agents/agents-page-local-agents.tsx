import {
	createAgentControllerInterfaceDisplayRows,
	formatAgentControllerInterfaceSummary,
	getAgentControllerVersionAdvisoryPresentation,
	resolveAgentControllerInterfaceDescription,
	shouldExpandAgentControllerInterface,
} from "@openmeld/agent-runtime";
import { formatLocalSetupActionLabel } from "@openmeld/schemas";
import type {
	AgentControllerInterfaceSnapshot,
	LocalRuntimeComputer,
	LocalRuntimeExecutionTarget,
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
	type SettingsLocalAgentRow,
	SettingsLocalAgentRows,
} from "@openmeld/ui/components/settings-computers";
import {
	SettingsDetailList,
	type SettingsDetailListRow,
} from "@openmeld/ui/components/settings-detail-list";
import { Switch } from "@openmeld/ui/components/switch";
import {
	resolveStatusToneIndicatorClassName,
	resolveStatusToneSoftTextClassName,
	resolveStatusToneSurfaceClassName,
} from "@openmeld/ui/lib/status-tone";
import { cn } from "@openmeld/ui/lib/utils";
import {
	ArrowsClockwiseIcon,
	RobotIcon,
	WrenchIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "framer-motion";
import {
	type KeyboardEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useRef,
	useState,
} from "react";
import { toast } from "sonner";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { buildConnectComputerPath } from "#/lib/connect/connect-route";
import { LOCAL_AGENTS_GUIDE_PATH } from "#/lib/local-agent-install-guides";
import { useCurrentOrganizationSlug } from "#/lib/organizations/organization-context";
import { resolveCurrentExecutionTarget } from "./agents-page-computer";
import {
	formatMutationError,
	isLocalAgentCheckStillRunningError,
} from "./agents-page-formatters";
import { resolveCurrentLocalRuntimeServiceActionLabel } from "./agents-page-openmeld-service";

type AgentsPageController = ReturnType<typeof useLocalAgentRecoveryController>;
type DeviceAgentCatalogEntry =
	LocalRuntimeExecutionTarget["localAgentCatalog"]["entries"][number];
type LocalAgentCatalogRowSummaryStatus = NonNullable<
	SettingsLocalAgentRow["summaryStatus"]
>;
type LocalAgentEnabledOverrides = Record<string, boolean>;
const SLOW_LOCAL_AGENT_CHECK_RECONCILE_INTERVAL_MS = 750;
const SLOW_LOCAL_AGENT_CHECK_RECONCILE_TIMEOUT_MS = 12_000;

export function LocalAgentsCard(input: {
	computer: LocalRuntimeComputer;
	isCurrentComputer: boolean;
	recovery: AgentsPageController;
	replyReadiness: ComputerReplyReadiness | null;
}) {
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
	const cardDescription = input.isCurrentComputer
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
		const previousCheckedAtMs = readLatestLocalAgentCheckedAtMs(
			recoveryRef.current.selectedExecutionTarget
		);
		setIsCheckingAgents(true);
		try {
			await input.recovery.refreshLocalAgentCatalog();
			toast.success("Local agent check complete.");
		} catch (error) {
			if (isLocalAgentCheckStillRunningError(error)) {
				// The probe outran the request budget but keeps running on the OpenMeld
				// Service. Reconcile from the canonical catalog instead of reporting a
				// transport timeout as a failed check, and stay in the checking state
				// until that read settles so the result - not the timeout - is shown.
				try {
					const reconciliation = await reconcileLocalAgentsAfterSlowCheck({
						getRecovery: () => recoveryRef.current,
						previousCheckedAtMs,
					});
					if (reconciliation === "timed_out") {
						toast.error(
							"OpenMeld is still checking local agents. Check again in a moment."
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
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<RobotIcon className="h-5 w-5" />
					Local agents
				</CardTitle>
				<CardDescription>{cardDescription}</CardDescription>
				{setupAction || localAgentsAction ? (
					<CardAction>
						<div className="flex items-center gap-2">
							{setupAction}
							{localAgentsAction}
						</div>
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent className="flex flex-col gap-4">
				{catalogState.notice ? (
					<LocalAgentsCatalogNotice notice={catalogState.notice} />
				) : null}
				<LocalAgentCatalogList
					canRefreshCatalog={canRefreshCatalog}
					canSetEnabled={catalogState.canSetEnabled}
					entries={catalogState.entries}
					isCheckingAgents={isCheckingAgents}
					muted={catalogState.rowsMuted}
					onCheckAgents={checkLocalAgents}
					onSetEnabled={input.recovery.setLocalAgentEnabled}
					showInstallGuideLink={shouldShowLocalAgentInstallGuideLink(
						catalogState.entries
					)}
					target={catalogState.target}
					targetStatus={catalogState.targetStatus}
				/>
			</CardContent>
		</Card>
	);
}

function reconcileLocalAgentsAfterSlowCheck(input: {
	getRecovery: () => AgentsPageController;
	previousCheckedAtMs: number | null;
}): Promise<"updated" | "timed_out"> {
	const deadlineMs = Date.now() + SLOW_LOCAL_AGENT_CHECK_RECONCILE_TIMEOUT_MS;
	return pollForLocalAgentCheck({ ...input, deadlineMs });
}

async function pollForLocalAgentCheck(input: {
	deadlineMs: number;
	getRecovery: () => AgentsPageController;
	previousCheckedAtMs: number | null;
}): Promise<"updated" | "timed_out"> {
	await input.getRecovery().refreshAll();
	if (
		isLocalAgentCheckNewer({
			currentCheckedAtMs: readLatestLocalAgentCheckedAtMs(
				input.getRecovery().selectedExecutionTarget
			),
			previousCheckedAtMs: input.previousCheckedAtMs,
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

function readLatestLocalAgentCheckedAtMs(
	target: LocalRuntimeExecutionTarget | null
): number | null {
	let latestCheckedAtMs: number | null = null;
	for (const capability of target?.capabilities ?? []) {
		const checkedAt = capability.agentControllerInterface?.checkedAt;
		if (!checkedAt) {
			continue;
		}
		const checkedAtMs = Date.parse(checkedAt);
		if (
			Number.isFinite(checkedAtMs) &&
			(latestCheckedAtMs === null || checkedAtMs > latestCheckedAtMs)
		) {
			latestCheckedAtMs = checkedAtMs;
		}
	}
	return latestCheckedAtMs;
}

function isLocalAgentCheckNewer(input: {
	currentCheckedAtMs: number | null;
	previousCheckedAtMs: number | null;
}): boolean {
	if (input.currentCheckedAtMs === null) {
		return false;
	}
	return (
		input.previousCheckedAtMs === null ||
		input.currentCheckedAtMs > input.previousCheckedAtMs
	);
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
	canRefreshCatalog: boolean;
	canSetEnabled: boolean;
	entries: readonly DeviceAgentCatalogEntry[];
	notice: LocalAgentsCatalogNoticeModel | null;
	primaryActionLabel: string | null;
	rowsMuted: boolean;
	target: LocalRuntimeExecutionTarget | null;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
};

export function resolveLocalAgentsCatalogState(input: {
	computer: LocalRuntimeComputer;
	isCurrentComputer: boolean;
	recovery: AgentsPageController;
	replyReadiness: ComputerReplyReadiness | null;
}): LocalAgentsCatalogState {
	const target = resolveLocalAgentsCatalogTarget(input);
	const serviceDependency = resolveLocalAgentsServiceDependency(
		input.replyReadiness
	);
	const usesCatalogRowsForLocalAgentSetup =
		input.isCurrentComputer && usesLocalAgentCatalogRowsForSetup(target);
	const notice = resolveLocalAgentsCatalogNotice({
		isCurrentComputer: input.isCurrentComputer,
		replyReadiness: input.replyReadiness,
		serviceDependency,
		target,
		usesCatalogRowsForLocalAgentSetup,
	});
	const resolvedPrimaryActionLabel =
		input.isCurrentComputer && input.replyReadiness
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

	return {
		canRefreshCatalog:
			input.isCurrentComputer &&
			!serviceDependency &&
			target?.localAgentControl.refreshCatalog === true,
		canSetEnabled:
			input.isCurrentComputer &&
			!serviceDependency &&
			target?.localAgentControl.setEnabled === true,
		entries: target?.localAgentCatalog.entries ?? [],
		notice,
		primaryActionLabel,
		rowsMuted:
			serviceDependency !== null && input.replyReadiness?.status !== "checking",
		target,
		targetStatus: target?.status ?? null,
	};
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
	isCurrentComputer: boolean;
	recovery: AgentsPageController;
}): LocalRuntimeExecutionTarget | null {
	if (input.isCurrentComputer && input.recovery.selectedExecutionTarget) {
		return input.recovery.selectedExecutionTarget;
	}
	return resolveCurrentExecutionTarget(input.computer);
}

function resolveLocalAgentsCatalogNotice(input: {
	isCurrentComputer: boolean;
	replyReadiness: ComputerReplyReadiness | null;
	serviceDependency: LocalAgentsServiceDependency;
	target: LocalRuntimeExecutionTarget | null;
	usesCatalogRowsForLocalAgentSetup: boolean;
}): LocalAgentsCatalogNoticeModel | null {
	if (!input.isCurrentComputer) {
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
			description:
				"Local agents will refresh after OpenMeld Service is reconnected.",
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

	if (
		input.replyReadiness.reasonCode === "execution_target.stale" ||
		input.target?.status === "stale"
	) {
		return {
			description:
				"Reconnect OpenMeld Service before this local agent list is current.",
			title: "Reconnect OpenMeld Service",
			tone: "warning",
		};
	}

	if (input.target === null) {
		return {
			description:
				"Connect OpenMeld Service to detect local agents on this computer.",
			title: "Connect OpenMeld Service",
			tone: "warning",
		};
	}

	if (input.usesCatalogRowsForLocalAgentSetup) {
		return null;
	}

	return {
		description:
			"Connect a local agent so OpenMeld can refresh the local agents on this computer.",
		title: formatLocalSetupActionLabel("connect_local_agent"),
		tone: "warning",
	};
}

type LocalAgentsServiceDependency = "not_connected" | "update_required" | null;

function resolveLocalAgentsServiceDependency(
	replyReadiness: ComputerReplyReadiness | null
): LocalAgentsServiceDependency {
	if (!replyReadiness) {
		return null;
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
						"h-2 w-2 shrink-0 rounded-full",
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
	canRefreshCatalog: boolean;
	canSetEnabled: boolean;
	entries: readonly DeviceAgentCatalogEntry[];
	isCheckingAgents: boolean;
	muted: boolean;
	onCheckAgents: () => Promise<void>;
	onSetEnabled: (input: { agentId: string; enabled: boolean }) => Promise<void>;
	showInstallGuideLink: boolean;
	target: LocalRuntimeExecutionTarget | null;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
}) {
	const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const [enabledOverrides, setEnabledOverrides] =
		useState<LocalAgentEnabledOverrides>({});
	const [revealedAccountEmailAgentIds, setRevealedAccountEmailAgentIds] =
		useState<ReadonlySet<string>>(() => new Set());
	const [disableConfirmation, setDisableConfirmation] = useState<{
		agentId: string;
		displayName: string;
	} | null>(null);
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
		setEnabledOverrides((current) => ({
			...current,
			[target.agentId]: target.enabled,
		}));
		try {
			await input.onSetEnabled(target);
		} catch (error) {
			setErrorMessage(resolveLocalAgentEnabledErrorMessage(error));
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
		return (
			<div
				className="flex items-start gap-3 rounded-md border border-border px-3 py-3"
				data-testid="local-agent-catalog-empty"
			>
				<span className="grid h-8 w-8 shrink-0 place-items-center rounded-sm border border-border bg-muted/20 text-muted-foreground">
					<RobotIcon aria-hidden="true" className="h-4 w-4" />
				</span>
				<div className="min-w-0 space-y-1">
					<p className="font-medium text-sm">
						No supported local agents reported yet
					</p>
					<p className="text-muted-foreground text-xs leading-5">
						Connect OpenMeld Service to check which supported local agents are
						installed on this computer.
					</p>
					{input.showInstallGuideLink ? <LocalAgentInstallGuideLink /> : null}
				</div>
			</div>
		);
	}

	return (
		<>
			{input.showInstallGuideLink ? <LocalAgentInstallGuideLink /> : null}
			<div className="grid gap-3" data-testid="local-agent-catalog-list">
				{/* Local agent search is intentionally hidden while the supported agent list is short. */}
				<div
					className="max-h-[28rem] overflow-y-auto pr-1"
					data-testid="local-agent-catalog-scroll-area"
				>
					<div data-testid="local-agent-catalog-rows">
						<SettingsLocalAgentRows
							rows={visibleEntries.map((entry) => {
								const effectiveEntry = applyLocalAgentEnabledOverride({
									enabledOverrides,
									entry,
								});
								return buildLocalAgentCatalogRow({
									accountEmailRevealed: revealedAccountEmailAgentIds.has(
										entry.agentId
									),
									canRefreshCatalog: input.canRefreshCatalog,
									canSetEnabled: input.canSetEnabled,
									entry: effectiveEntry,
									isCheckingAgents: input.isCheckingAgents,
									muted: input.muted,
									onCheckAgents: input.onCheckAgents,
									onRevealAccountEmail: revealAccountEmail,
									onSetEnabled: requestSetEnabled,
									pending: pendingAgentId === entry.agentId,
									target: input.target,
									targetStatus: input.targetStatus,
								});
							})}
						/>
					</div>
				</div>
				{errorMessage ? (
					<p className="text-destructive text-sm leading-5">{errorMessage}</p>
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

function LocalAgentInstallGuideLink() {
	return (
		<p className="text-muted-foreground text-xs leading-5">
			No agent CLIs installed yet?{" "}
			<Link
				className="font-medium text-foreground"
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

function buildLocalAgentCatalogRow(input: {
	accountEmailRevealed: boolean;
	canRefreshCatalog: boolean;
	canSetEnabled: boolean;
	entry: DeviceAgentCatalogEntry;
	isCheckingAgents: boolean;
	muted: boolean;
	onCheckAgents: () => Promise<void>;
	onRevealAccountEmail: (agentId: string) => void;
	onSetEnabled: (entry: DeviceAgentCatalogEntry, enabled: boolean) => void;
	pending: boolean;
	target: LocalRuntimeExecutionTarget | null;
	targetStatus: LocalRuntimeExecutionTarget["status"] | null;
}): SettingsLocalAgentRow {
	const display = resolveLocalAgentCatalogRowDisplay(input);
	const agentControllerInterface = resolveAgentControllerInterfaceForEntry({
		entry: input.entry,
		target: input.target,
	});
	const setupStatus = resolveLocalAgentSetupSummaryStatus(input.entry);
	const versionAdvisory = getAgentControllerVersionAdvisoryPresentation(
		agentControllerInterface
	);
	const switchDisabled =
		input.pending ||
		!input.canSetEnabled ||
		!canChangeLocalAgentEnabled({
			entry: input.entry,
			targetStatus: input.targetStatus,
		});
	const setupDescription = resolveLocalAgentSetupDescription({
		displayDescription: display.description,
		entry: input.entry,
		setupStatus,
	});
	let description = resolveAgentControllerInterfaceDescription({
		displayDescription: display.description,
		snapshot: agentControllerInterface,
	});
	if (setupDescription) {
		description = setupDescription;
	}
	const controllerStatus = setupStatus
		? null
		: resolveAgentControllerInterfaceSummaryStatus(agentControllerInterface);
	const summaryStatuses = [
		setupStatus,
		controllerStatus,
		display.status,
	].filter(
		(status): status is LocalAgentCatalogRowSummaryStatus => status !== null
	);
	const summaryAccessory = versionAdvisory ? (
		<SettingsLocalAgentAdvisoryBadge
			detail={versionAdvisory.detail}
			key="version-advisory"
			label={versionAdvisory.label}
			tone={versionAdvisory.tone}
			updateCommand={versionAdvisory.updateCommand}
		/>
	) : null;

	return {
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
		defaultExpanded: shouldExpandAgentControllerInterface(
			agentControllerInterface
		),
		description,
		detail: agentControllerInterface ? (
			<SettingsDetailList
				rows={createAgentControllerInterfaceDetailRows({
					agentId: input.entry.agentId,
					canRefreshCatalog: input.canRefreshCatalog,
					emailRevealed: input.accountEmailRevealed,
					isCheckingAgents: input.isCheckingAgents,
					onCheckAgents: input.onCheckAgents,
					onRevealEmail: input.onRevealAccountEmail,
					snapshot: agentControllerInterface,
				})}
			/>
		) : null,
		displayName: input.entry.displayName,
		id: input.entry.agentId,
		logoAgentId: input.entry.agentId,
		muted: input.muted,
		summaryAccessory,
		summaryMeta: agentControllerInterface
			? renderAgentControllerInterfaceSummary({
					agentId: input.entry.agentId,
					emailRevealed: input.accountEmailRevealed,
					onRevealEmail: input.onRevealAccountEmail,
					snapshot: agentControllerInterface,
				})
			: null,
		summaryStatuses: summaryStatuses.length > 0 ? summaryStatuses : undefined,
	};
}

function renderAgentControllerInterfaceSummary(input: {
	agentId: string;
	emailRevealed: boolean;
	onRevealEmail: (agentId: string) => void;
	snapshot: AgentControllerInterfaceSnapshot;
}): ReactNode {
	const summary = formatAgentControllerInterfaceSummary(input.snapshot);
	const email = resolveAgentControllerAccountEmailText(input.snapshot);
	if (!email) {
		return summary;
	}
	const parts = splitTextAroundFirstMatch(summary, email);
	if (!parts) {
		return summary;
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
}): SettingsDetailListRow[] {
	const email = resolveAgentControllerAccountEmailText(input.snapshot);
	const hasIssueMessage = shouldRenderAgentControllerIssueRow(input.snapshot);
	return createAgentControllerInterfaceDisplayRows(input.snapshot).map(
		(row) => {
			if (hasIssueMessage && row.label === "Message") {
				return {
					label: "Issue",
					value: (
						<AgentControllerIssueDetail
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
		}
	);
}

function AgentControllerIssueDetail(input: {
	canRefreshCatalog: boolean;
	isCheckingAgents: boolean;
	message: string;
	onCheckAgents: () => Promise<void>;
}) {
	return (
		<span className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<span className="min-w-0">{input.message}</span>
			{input.canRefreshCatalog ? (
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

function shouldRenderAgentControllerIssueRow(
	snapshot: AgentControllerInterfaceSnapshot
): boolean {
	if (!snapshot.message) {
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
		<motion.span
			animate={{
				filter: input.revealed ? "blur(0px)" : "blur(3px)",
				opacity: input.revealed ? 1 : 0.62,
			}}
			aria-label={interactive ? "Reveal signed-in account email" : undefined}
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
			title={interactive ? "Reveal signed-in account email" : undefined}
			transition={
				prefersReducedMotion
					? { duration: 0 }
					: { duration: 0.18, ease: "easeOut" }
			}
		>
			{input.email}
		</motion.span>
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
	if (
		entry.selectable &&
		entry.launchStatus === "ready" &&
		entry.enabled !== true
	) {
		return { label: "Turn on", tone: "warning" };
	}
	if (entry.launchStatus === "needs_choice") {
		return { label: "Choose setup", tone: "warning" };
	}
	return { label: "Needs repair", tone: "danger" };
}

function resolveAgentControllerInterfaceSummaryStatus(
	snapshot: AgentControllerInterfaceSnapshot | null
): LocalAgentCatalogRowSummaryStatus | null {
	if (!snapshot) {
		return null;
	}
	if (snapshot.check?.status === "failed") {
		return { label: "Couldn't check", tone: "warning" };
	}
	if (snapshot.auth.status === "unauthenticated") {
		return { label: "Sign in required", tone: "danger" };
	}
	if (snapshot.status === "error") {
		return { label: "Needs repair", tone: "danger" };
	}
	if (snapshot.status === "warning" || snapshot.status === "unavailable") {
		return { label: "Needs attention", tone: "warning" };
	}
	return null;
}

function shouldShowLocalAgentSetupStatus(
	entry: DeviceAgentCatalogEntry
): boolean {
	if (entry.lifecycleStatus === "suspended" || !entry.detected) {
		return false;
	}
	if (
		entry.selectable &&
		entry.launchStatus === "ready" &&
		entry.enabled !== true
	) {
		return true;
	}
	return (
		(entry.enabled === true || entry.selectable) &&
		(entry.launchStatus === "needs_choice" ||
			entry.launchStatus === "needs_repair")
	);
}

function resolveLocalAgentSetupDescription(input: {
	displayDescription: string;
	entry: DeviceAgentCatalogEntry;
	setupStatus: LocalAgentCatalogRowSummaryStatus | null;
}): string | null {
	if (!input.setupStatus) {
		return null;
	}
	if (
		input.entry.selectable &&
		input.entry.launchStatus === "ready" &&
		input.entry.enabled !== true
	) {
		return `Turn on ${input.entry.displayName} to let OpenMeld launch it on this computer.`;
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
				"Last check found this local agent. Connect OpenMeld Service to refresh its status.",
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
			description: "Detected, but setup needs one more choice.",
			label: null,
		};
	}

	if (input.entry.launchStatus === "needs_repair") {
		return {
			badgeVariant: "destructive",
			description: `OpenMeld found ${input.entry.displayName}, but couldn't confirm a working launch command.`,
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
