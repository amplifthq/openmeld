import { isAgentProfileLocalReadinessRefreshReasonCode } from "@openmeld/agent-profile";
import {
	type AgentWakeAvailability,
	type AgentWakeAvailabilityCategory,
	buildAgentControllerRef,
	DUPLICATE_REPLY_CONVERSATION_CONTEXT,
	resolveAgentWakeAvailabilityDisplayCategory,
} from "@openmeld/agent-runtime";
import {
	canonicalizeAgentControllerRef,
	compareAgentControllerRefsForDisplay,
	formatLocalSetupActionLabel,
} from "@openmeld/schemas";
import type {
	AuthProfileView,
	GetAgentExecutionReadinessResponse,
	LocalRuntimeExecutionTarget,
} from "@openmeld/schemas/types";
import {
	resolveStatusToneStrongTextClassName,
	resolveStatusToneSurfaceClassName,
	resolveStatusToneTintClassName,
	type StatusTone,
} from "@openmeld/ui/lib/status-tone";
import type { useLocalAgentRecoveryController } from "#/components/agents/use-local-agent-recovery-controller";
import { isAgentExecutionSelfHealingReadiness } from "#/lib/spaces/agent-route-status";
import { compareAgentListRecency } from "./agent-list-model";
import { normalizeOptionalText } from "./agents-page-formatters";

type AgentsPageController = ReturnType<typeof useLocalAgentRecoveryController>;
type DeviceAgentCatalog = LocalRuntimeExecutionTarget["localAgentCatalog"];
type DeviceAgentCatalogEntry = DeviceAgentCatalog["entries"][number];

export const AGENT_PROFILE_AUTO_REFRESH_MAX_DELAY_MS = 30_000;

export type AgentProfileRepairAction = {
	agentDisplayName: string;
	agentControllerRef: string;
};
export type AgentProfileSetupAction = {
	href: string;
	label: string;
};
export type AgentProfileVisualTone = StatusTone;
export type AgentProfilesReadinessSummaryCounts = {
	available: number;
	checking: number;
	offline: number;
	unavailable: number;
};
export type AgentProfileAvailabilityFilter =
	| "all"
	| AgentWakeAvailabilityCategory;
export type AgentProfileAvailabilityFilterCounts = Record<
	AgentProfileAvailabilityFilter,
	number
>;
export type AgentProfileAvailabilityFilterState =
	AgentWakeAvailabilityCategory | null;

export function resolveAgentProfileAutoRefreshDelayMs(attempt: number): number {
	const exponent = Math.max(0, attempt - 1);
	return Math.min(
		AGENT_PROFILE_AUTO_REFRESH_MAX_DELAY_MS,
		2000 * 2 ** exponent
	);
}

export function buildDuplicateConversationProfileNamesByProfileId(input: {
	profiles: readonly AuthProfileView[];
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
}): Map<string, readonly string[]> {
	const profilesByConversationId = new Map<string, AuthProfileView[]>();
	for (const profile of input.profiles) {
		const readiness = input.readinessByProfileId.get(profile.openMeldProfileId);
		if (!readiness) {
			continue;
		}
		if (
			!hasAgentExecutionReason(
				readiness.agentExecutionReadiness,
				(reasonCode) =>
					reasonCode ===
					"agent_profile_binding.controller_conversation_conflict"
			)
		) {
			continue;
		}
		const conversationId = normalizeOptionalText(
			readiness.agentExecutionReadiness.facts.providerConversation
				.agentControllerConversationId
		);
		if (!conversationId) {
			continue;
		}
		const profiles = profilesByConversationId.get(conversationId) ?? [];
		profiles.push(profile);
		profilesByConversationId.set(conversationId, profiles);
	}

	const profileNamesByProfileId = new Map<string, readonly string[]>();
	for (const profiles of profilesByConversationId.values()) {
		if (profiles.length < 2) {
			continue;
		}
		for (const profile of profiles) {
			profileNamesByProfileId.set(
				profile.openMeldProfileId,
				profiles
					.filter(
						(candidate) =>
							candidate.openMeldProfileId !== profile.openMeldProfileId
					)
					.map((candidate) => candidate.profileName)
			);
		}
	}
	return profileNamesByProfileId;
}

export function resolveAgentExecutionRuntimeDeviceLabel(
	readiness: GetAgentExecutionReadinessResponse,
	showDisplayProjectionRefreshing: boolean
): string {
	if (showDisplayProjectionRefreshing) {
		return "Updating this computer";
	}
	if (
		hasAgentExecutionReason(
			readiness.agentExecutionReadiness,
			(reasonCode) => reasonCode === "service.update_required"
		)
	) {
		return formatLocalSetupActionLabel("update_service");
	}
	if (
		hasAgentExecutionReason(
			readiness.agentExecutionReadiness,
			(reasonCode) =>
				reasonCode === "agent_profile_binding.controller_conversation_conflict"
		)
	) {
		return DUPLICATE_REPLY_CONVERSATION_CONTEXT;
	}
	const deviceLabel = readiness.runtimeDeviceDisplayName ?? null;
	if (deviceLabel) {
		return deviceLabel;
	}
	if (readiness.agentExecutionReadiness.facts.binding.routable) {
		return "Connected computer";
	}
	return "No reply computer selected";
}

export function sortAgentProfilesForDisplay(input: {
	profiles: readonly AuthProfileView[];
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
}): readonly AuthProfileView[] {
	return [...input.profiles].sort((left, right) => {
		return (
			compareAgentListRecency(left, right) ||
			left.profileName.localeCompare(right.profileName, undefined, {
				sensitivity: "base",
			}) ||
			left.openMeldProfileId.localeCompare(right.openMeldProfileId)
		);
	});
}

export function hasSpecificLocalAgentBinding(input: {
	profileId: string;
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
}): boolean {
	const binding = input.readinessByProfileId.get(input.profileId)
		?.agentExecutionReadiness.facts.binding;
	return binding?.source === "binding_truth" && binding.routable;
}

export function buildAgentProfileRepairActionKey(
	action: AgentProfileRepairAction
): string {
	return (
		canonicalizeAgentControllerRef(action.agentControllerRef) ??
		action.agentControllerRef
	);
}

export function prioritizeAgentExecutionDetailRows(input: {
	rows: readonly { label: string; value: string }[];
	state: GetAgentExecutionReadinessResponse["agentExecutionReadiness"]["displayState"];
}): readonly { label: string; value: string }[] {
	if (input.state === "not_ready") {
		return sortRowsByLabel(input.rows, [
			"Wake route",
			"Local agent capability",
			"Connection",
			"Reply route",
			"Wake",
		]);
	}
	if (input.state === "blocked") {
		return sortRowsByLabel(input.rows, [
			"Wake route",
			"Connection",
			"Wake",
			"Local agent capability",
			"Reply route",
		]);
	}
	return input.rows;
}

export function createAgentWakeRouteRegistrationDetailRow(input: {
	registration: GetAgentExecutionReadinessResponse["agentWakeRouteRegistration"];
	runtimeDeviceDisplayName: string | null;
}): { label: string; value: string } {
	const sourceLabel = input.runtimeDeviceDisplayName ?? "connected computer";
	const reportedAtLabel = formatWakeRouteRegistrationReportedAt(
		input.registration.reportedAtMs
	);
	const sourceSuffix = reportedAtLabel
		? ` on ${sourceLabel} at ${reportedAtLabel}`
		: ` on ${sourceLabel}`;

	switch (input.registration.status) {
		case "registered":
			return {
				label: "Wake route",
				value: `Registered${sourceSuffix}.`,
			};
		case "pending":
			return {
				label: "Wake route",
				value:
					"Waiting for OpenMeld Service to report this agent's Wake route.",
			};
		case "skipped":
			return {
				label: "Wake route",
				value: `Skipped${sourceSuffix}: ${formatWakeRouteRegistrationReason(
					input.registration.reasonCode
				)}.`,
			};
		case "rejected":
			return {
				label: "Wake route",
				value: `Rejected${sourceSuffix}: ${formatWakeRouteRegistrationReason(
					input.registration.reasonCode
				)}.`,
			};
		case "expired":
			return {
				label: "Wake route",
				value: `Last reported${sourceSuffix}, but the Wake lease expired.`,
			};
		case "unavailable":
			return {
				label: "Wake route",
				value: `Unavailable: ${formatWakeRouteRegistrationReason(
					input.registration.reasonCode
				)}.`,
			};
		default: {
			const exhaustive: never = input.registration.status;
			return {
				label: "Wake route",
				value: exhaustive,
			};
		}
	}
}

export function formatWakeRouteRegistrationReportedAt(
	reportedAtMs: number | null
) {
	if (reportedAtMs === null) {
		return null;
	}
	return new Date(reportedAtMs).toLocaleTimeString([], {
		hour: "numeric",
		minute: "2-digit",
	});
}

export function formatWakeRouteRegistrationReason(
	reasonCode: string | null
): string {
	switch (reasonCode) {
		case "projection.missing":
			return "local runtime projection is missing";
		case "controller.registry.disabled":
			return "local controller is disabled";
		case "controller.launch.needs_repair":
			return "local controller launch needs repair";
		case "runtime.adapter.unsupported":
			return "local runtime adapter is unsupported";
		case "profile.binding.unbound":
			return "no local agent is connected";
		case "controller.binding.disabled":
			return "local agent binding is disabled";
		case "controller.binding.incomplete":
			return "local agent binding is incomplete";
		case "profile.status.inactive":
			return "agent profile is inactive";
		case "workspace.missing":
			return "workspace is missing";
		case "workspace.invalid":
			return "workspace is invalid";
		case "daemon.session.reject_conflict":
			return "another OpenMeld Service session owns this route";
		case "daemon.profile.offline":
			return "OpenMeld Service is offline for this route";
		case "daemon.runtime_contract.missing":
		case "daemon.runtime_contract.mismatch":
			return "OpenMeld Service needs an update";
		case "wake_route.registration_pending":
			return "registration report is still pending";
		case "wake_route.registration_expired":
			return "registration lease expired";
		case "lookup_failed":
			return "Core could not check the route";
		case "not_requested":
			return "route registration was not requested";
		default:
			return reasonCode ?? "no route registration reason was reported";
	}
}

export function sortRowsByLabel(
	rows: readonly { label: string; value: string }[],
	labelOrder: readonly string[]
): readonly { label: string; value: string }[] {
	const orderByLabel = new Map(
		labelOrder.map((label, index) => [label, index] as const)
	);
	return [...rows].sort((left, right) => {
		const leftIndex = orderByLabel.get(left.label) ?? Number.MAX_SAFE_INTEGER;
		const rightIndex = orderByLabel.get(right.label) ?? Number.MAX_SAFE_INTEGER;
		return leftIndex - rightIndex;
	});
}

export function summarizeAgentProfileReadiness(input: {
	profiles: readonly AuthProfileView[];
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
}): AgentProfilesReadinessSummaryCounts {
	const summary: AgentProfilesReadinessSummaryCounts = {
		available: 0,
		checking: 0,
		offline: 0,
		unavailable: 0,
	};

	for (const profile of input.profiles) {
		const profileId = profile.openMeldProfileId;
		const readiness = input.readinessByProfileId.get(profileId) ?? null;
		if (readiness === null) {
			continue;
		}
		const displayedAvailability = resolveDisplayedAgentWakeAvailability({
			readiness,
		});
		const state = resolveAgentWakeAvailabilityDisplayCategory(
			displayedAvailability
		);
		switch (state) {
			case "available":
				summary.available += 1;
				break;
			case "checking":
				summary.checking += 1;
				break;
			case "offline":
				summary.offline += 1;
				break;
			case "unavailable":
				summary.unavailable += 1;
				break;
			default:
				summary.unavailable += 1;
				break;
		}
	}

	return summary;
}

export function summarizeAgentProfileAvailabilityFilters(input: {
	errorByProfileId?: ReadonlyMap<string, string>;
	pendingProfileIds?: ReadonlySet<string>;
	profiles: readonly AuthProfileView[];
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
}): AgentProfileAvailabilityFilterCounts {
	const summary: AgentProfileAvailabilityFilterCounts = {
		all: input.profiles.length,
		available: 0,
		checking: 0,
		offline: 0,
		unavailable: 0,
	};

	for (const profile of input.profiles) {
		const state = resolveAgentProfileAvailabilityFilterState({
			errorByProfileId: input.errorByProfileId,
			pendingProfileIds: input.pendingProfileIds,
			profileId: profile.openMeldProfileId,
			readinessByProfileId: input.readinessByProfileId,
		});
		if (state === null) {
			continue;
		}
		summary[state] += 1;
	}

	return summary;
}

export function resolveAgentProfileAvailabilityFilterState(input: {
	errorByProfileId?: ReadonlyMap<string, string>;
	pendingProfileIds?: ReadonlySet<string>;
	profileId: string;
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
}): AgentProfileAvailabilityFilterState {
	const readiness = input.readinessByProfileId.get(input.profileId) ?? null;
	if (readiness === null) {
		return null;
	}

	if (
		input.pendingProfileIds?.has(input.profileId) ||
		input.errorByProfileId?.has(input.profileId)
	) {
		return "checking";
	}

	const displayedAvailability = resolveDisplayedAgentWakeAvailability({
		readiness,
	});
	return resolveAgentWakeAvailabilityDisplayCategory(displayedAvailability);
}

export function resolveDisplayedAgentWakeAvailability(input: {
	readiness: GetAgentExecutionReadinessResponse;
}): AgentWakeAvailability {
	return input.readiness.agentWakeAvailability;
}

export function resolveAgentProfileRowWakeAvailability(input: {
	readiness: GetAgentExecutionReadinessResponse;
}): AgentWakeAvailability {
	return resolveDisplayedAgentWakeAvailability({
		readiness: input.readiness,
	});
}

export function formatAgentWakeAvailabilityCheckedAt(
	generatedAt: string | null,
	nowMs = Date.now()
): string | null {
	if (!generatedAt) {
		return null;
	}
	const generatedAtMs = Date.parse(generatedAt);
	if (!Number.isFinite(generatedAtMs)) {
		return null;
	}
	const elapsedSeconds = Math.max(
		0,
		Math.floor((nowMs - generatedAtMs) / 1000)
	);
	if (elapsedSeconds < 60) {
		return "checked just now";
	}
	const elapsedMinutes = Math.floor(elapsedSeconds / 60);
	if (elapsedMinutes < 60) {
		return `checked ${elapsedMinutes} ${elapsedMinutes === 1 ? "minute" : "minutes"} ago`;
	}
	const elapsedHours = Math.floor(elapsedMinutes / 60);
	if (elapsedHours < 24) {
		return `checked ${elapsedHours} ${elapsedHours === 1 ? "hour" : "hours"} ago`;
	}
	const elapsedDays = Math.floor(elapsedHours / 24);
	return `checked ${elapsedDays} ${elapsedDays === 1 ? "day" : "days"} ago`;
}

export function canManuallyRefreshAgentProfileConnection(input: {
	autoRefreshExhausted: boolean;
	currentLocalRuntimeCanReply: boolean | null;
	readiness: GetAgentExecutionReadinessResponse;
}): boolean {
	return (
		input.currentLocalRuntimeCanReply === true &&
		input.autoRefreshExhausted &&
		(isAgentExecutionRefreshableExpiredWakeRoute(input.readiness) ||
			hasLocalAgentReadinessRefreshReason(input.readiness))
	);
}

function hasLocalAgentReadinessRefreshReason(
	readiness: GetAgentExecutionReadinessResponse
): boolean {
	return hasAgentExecutionReason(
		readiness.agentExecutionReadiness,
		(reasonCode) =>
			reasonCode === "runtime.projection_missing" ||
			isAgentProfileLocalReadinessRefreshReasonCode(reasonCode)
	);
}

export function isAgentExecutionRefreshableExpiredWakeRoute(
	readiness: GetAgentExecutionReadinessResponse | null
): boolean {
	if (readiness === null) {
		return false;
	}
	return (
		readiness.agentExecutionReadiness.primaryAction === "check_status" &&
		readiness.agentExecutionReadiness.facts.localService.refreshable &&
		readiness.agentWakeRouteRegistration.status === "expired" &&
		readiness.agentWakeRouteRegistration.reasonCode ===
			"wake_route.registration_expired" &&
		readiness.agentWakeAvailability.status === "offline_for_wake"
	);
}

export function resolveAgentProfileLocalAgentEntry(input: {
	entries: readonly DeviceAgentCatalogEntry[];
	readiness: GetAgentExecutionReadinessResponse;
}): DeviceAgentCatalogEntry | null {
	const agentControllerRef = canonicalizeAgentControllerRef(
		input.readiness.agentControllerRef
	);
	if (!agentControllerRef) {
		return null;
	}
	return (
		findMatchingLocalAgentForController({
			agentControllerRef,
			entries: input.entries,
		}) ?? null
	);
}

export function resolveAgentProfileIconAgentId(input: {
	localAgentEntry: DeviceAgentCatalogEntry | null;
	readiness: GetAgentExecutionReadinessResponse;
}): string | null {
	if (input.localAgentEntry) {
		return input.localAgentEntry.agentId;
	}
	return canonicalizeAgentControllerRef(input.readiness.agentControllerRef);
}

export function resolveAgentProfileRowSummary(input: {
	displaySummary: string;
	agentWakeAvailability: AgentWakeAvailability;
}): string {
	return input.agentWakeAvailability.summary || input.displaySummary;
}

export function resolveFocusedAgentProfileClassName(
	isFocusedProfile: boolean
): string {
	return resolveAgentsPageFocusedSurfaceClassName(isFocusedProfile);
}

export function resolveAgentsPageFocusedSurfaceClassName(
	isFocused: boolean
): string {
	return isFocused ? "agent-profile-row-highlight scroll-mt-24" : "";
}

export function resolveAgentProfileRowClassName(
	tone: AgentProfileVisualTone
): string {
	return resolveStatusToneSurfaceClassName(tone, "subtle");
}

export function resolveAgentProfileFallbackIconClassName(
	tone: AgentProfileVisualTone
): string {
	return resolveStatusToneStrongTextClassName(tone);
}

export function resolveAgentProfileSummaryPillClassName(
	tone: AgentProfileVisualTone
): string {
	return resolveStatusToneTintClassName(tone);
}

export function resolveAutoRefreshingAgentProfileIds(input: {
	profiles: readonly AuthProfileView[];
	readinessByProfileId: ReadonlyMap<string, GetAgentExecutionReadinessResponse>;
	currentLocalRuntimeCanReply: boolean | null;
}): readonly string[] {
	return input.profiles
		.filter((profile) => {
			const readiness =
				input.readinessByProfileId.get(profile.openMeldProfileId) ?? null;
			if (input.currentLocalRuntimeCanReply === true) {
				return isAgentExecutionAutoRefreshPending(readiness);
			}
			return isAgentExecutionRefreshableExpiredWakeRoute(readiness);
		})
		.map((profile) => profile.openMeldProfileId);
}

export function isAgentExecutionAutoRefreshPending(
	readiness: GetAgentExecutionReadinessResponse | null
): boolean {
	if (readiness === null) {
		return true;
	}
	return (
		isAgentExecutionSelfHealing(readiness) ||
		isAgentExecutionDisplayProjectionRefreshing(readiness) ||
		isAgentExecutionRefreshableExpiredWakeRoute(readiness)
	);
}

export function isAgentExecutionSelfHealing(
	readiness: GetAgentExecutionReadinessResponse | null
): boolean {
	if (
		readiness === null ||
		readiness.agentExecutionReadiness.displayState === "ready"
	) {
		return false;
	}

	return isAgentExecutionSelfHealingReadiness(
		readiness.agentExecutionReadiness
	);
}

export function isAgentExecutionDisplayProjectionRefreshing(
	readiness: GetAgentExecutionReadinessResponse | null
): boolean {
	if (readiness === null || readiness.runtimeDeviceDisplayName !== null) {
		return false;
	}

	const projection = readiness.agentExecutionReadiness;
	if (projection.displayState === "ready") {
		return false;
	}

	return (
		projection.primaryAction === "check_status" &&
		projection.facts.binding.routable &&
		projection.facts.localService.reachable &&
		projection.facts.service.executionCompatible &&
		projection.facts.route.online &&
		projection.facts.runtime.ready &&
		!projection.facts.providerAccount.blocked
	);
}

export function isCurrentRuntimeServiceProjectionRefreshing(input: {
	currentLocalRuntimeCanReply: boolean | null;
	readiness: GetAgentExecutionReadinessResponse | null;
}): boolean {
	if (input.currentLocalRuntimeCanReply !== true || input.readiness === null) {
		return false;
	}

	const projection = input.readiness.agentExecutionReadiness;
	return (
		projection.displayState !== "ready" &&
		projection.primaryAction === "connect_service"
	);
}

export function resolveAgentProfileAvailabilityTone(
	state: AgentWakeAvailabilityCategory
): AgentProfileVisualTone {
	switch (state) {
		case "available":
			return "ready";
		case "checking":
			return "checking";
		case "offline":
		case "unavailable":
			return "muted";
		default:
			return "muted";
	}
}

export function resolveAgentProfileRepairActions(input: {
	isCurrentComputer: boolean;
	localAgentCatalogEntries: readonly DeviceAgentCatalogEntry[];
	readiness: GetAgentExecutionReadinessResponse | null;
}): readonly AgentProfileRepairAction[] {
	if (!input.isCurrentComputer) {
		return [];
	}
	if (input.readiness === null) {
		return [];
	}

	const readiness = input.readiness.agentExecutionReadiness;
	const actionPlan = input.readiness.primaryActionPlan;
	if (
		readiness.displayState === "ready" ||
		readiness.facts.binding.source !== "missing" ||
		actionPlan.action !== "reconnect_binding"
	) {
		return [];
	}

	if (actionPlan.target.kind === "choose_local_agent") {
		return createAgentProfileConnectActionsFromLocalAgents(
			input.localAgentCatalogEntries
		);
	}

	const canonicalAgentControllerRef = canonicalizeAgentControllerRef(
		actionPlan.target.agentControllerRef
	);
	if (!canonicalAgentControllerRef) {
		return [];
	}

	const localAgent = findMatchingLocalAgentForController({
		agentControllerRef: canonicalAgentControllerRef,
		entries: input.localAgentCatalogEntries,
	});
	if (!localAgent) {
		return [];
	}

	const repairAction = createAgentProfileRepairActionFromLocalAgent({
		localAgent,
	});

	return repairAction ? [repairAction] : [];
}

function createAgentProfileConnectActionsFromLocalAgents(
	entries: readonly DeviceAgentCatalogEntry[]
): readonly AgentProfileRepairAction[] {
	return entries
		.filter(isRunnableLocalAgentEntry)
		.map((entry) =>
			createAgentProfileRepairActionFromLocalAgent({
				localAgent: entry,
			})
		)
		.filter((action): action is AgentProfileRepairAction => action !== null)
		.sort((left, right) =>
			compareAgentControllerRefsForDisplay(
				left.agentControllerRef,
				right.agentControllerRef
			)
		);
}

export function resolveAgentProfileSetupAction(input: {
	autoRefreshExhausted: boolean;
	currentLocalRuntimeCanReply: boolean | null;
	localAgentDisplayName?: string | null;
	readiness: GetAgentExecutionReadinessResponse | null;
	serviceUpdatePath: string;
	setupPath: string;
}): AgentProfileSetupAction | null {
	const readiness = input.readiness?.agentExecutionReadiness ?? null;
	const primaryAction = input.readiness?.primaryActionPlan.action ?? "none";
	if (!readiness || readiness.displayState === "ready") {
		return null;
	}
	if (
		isCurrentRuntimeServiceProjectionRefreshing({
			currentLocalRuntimeCanReply: input.currentLocalRuntimeCanReply,
			readiness: input.readiness,
		}) &&
		!input.autoRefreshExhausted
	) {
		return null;
	}
	if (primaryAction === "update_service") {
		return {
			href: input.serviceUpdatePath,
			label: "Update",
		};
	}
	if (primaryAction === "connect_service") {
		return {
			href: input.setupPath,
			label:
				resolveAgentExecutionServiceActionLabel(readiness) ===
				formatLocalSetupActionLabel("connect_service")
					? "Connect computer"
					: "Reconnect computer",
		};
	}
	if (primaryAction === "run_prepare") {
		return {
			href: input.setupPath,
			label: "Connect local agent",
		};
	}
	if (input.readiness?.agentWakeAvailability.phase === "checking_route") {
		return null;
	}
	return null;
}

export function formatAgentProfileExecutionComputerDetail(
	runtimeDeviceName: string
): string {
	switch (runtimeDeviceName) {
		case "Connected computer":
			return "Runs on a connected computer";
		case "No reply computer selected":
			return "No reply computer selected";
		default:
			return `Runs on ${runtimeDeviceName}`;
	}
}

export function replaceSetIfChanged(
	current: ReadonlySet<string>,
	nextItems: readonly string[]
): ReadonlySet<string> {
	if (
		current.size === nextItems.length &&
		nextItems.every((item) => current.has(item))
	) {
		return current;
	}
	return new Set(nextItems);
}

export function resolveAgentExecutionServiceActionLabel(
	readiness: GetAgentExecutionReadinessResponse["agentExecutionReadiness"]
): string {
	if (
		hasAgentExecutionReason(
			readiness,
			(reasonCode) => reasonCode === "service.not_installed"
		)
	) {
		return formatLocalSetupActionLabel("connect_service");
	}
	return formatLocalSetupActionLabel("reconnect_service");
}

export function hasAgentExecutionReason(
	readiness: GetAgentExecutionReadinessResponse["agentExecutionReadiness"],
	predicate: (reasonCode: string) => boolean
): boolean {
	const reasonCodes = [
		...readiness.reasonCodes,
		...readiness.facts.binding.reasonCodes,
		...readiness.facts.localService.reasonCodes,
		...readiness.facts.runtime.reasonCodes,
		...readiness.facts.route.reasonCodes,
		...readiness.facts.claim.reasonCodes,
		...readiness.facts.providerAccount.reasonCodes,
	];
	return reasonCodes.some(predicate);
}

export function createAgentProfileRepairActionFromLocalAgent(input: {
	localAgent: DeviceAgentCatalogEntry;
}): AgentProfileRepairAction | null {
	const localAgentControllerRef = buildAgentControllerRef({
		kind: input.localAgent.targetKind,
		id: input.localAgent.agentId,
	});

	return {
		agentDisplayName: input.localAgent.displayName,
		agentControllerRef: localAgentControllerRef,
	};
}

export function isRunnableLocalAgentEntry(
	entry: DeviceAgentCatalogEntry
): boolean {
	return entry.selectable && entry.launchStatus === "ready";
}

export function resolveCurrentLocalAgentCatalogEntries(
	recovery: AgentsPageController
): readonly DeviceAgentCatalogEntry[] {
	return recovery.selectedExecutionTarget?.localAgentCatalog.entries ?? [];
}

export function findMatchingLocalAgentForController(input: {
	agentControllerRef: string;
	entries: readonly DeviceAgentCatalogEntry[];
}): DeviceAgentCatalogEntry | null {
	return (
		input.entries.find((entry) => {
			if (!isRunnableLocalAgentEntry(entry)) {
				return false;
			}
			const entryAgentControllerRef = buildAgentControllerRef({
				kind: entry.targetKind,
				id: entry.agentId,
			});
			return entryAgentControllerRef === input.agentControllerRef;
		}) ?? null
	);
}
