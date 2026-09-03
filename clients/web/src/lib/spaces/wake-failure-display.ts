import {
	type AgentRecoveryActionId,
	resolvePublicAgentFailureRecovery,
} from "@openmeld/schemas";

export type WakeFailureDisplay =
	| {
			actionTarget: "agents" | "computer" | "cursor_account" | "prepare_setup";
			body: string;
			primaryActionId: AgentRecoveryActionId;
			primaryActionLabel: string;
	  }
	| {
			actionTarget: null;
			body: string;
	  };

export type WakeFailureTargetContext = {
	controllerDisplayName: string | null;
	isCurrentUserManageable: boolean | null;
	ownerDisplayName: string | null;
};

const MENTION_PREFIX_PATTERN = /^@+/u;
const POSSESSIVE_SUFFIX_PATTERN = /s$/iu;

export function resolveWakeFailureDisplay(input: {
	failureReasonCode: string | null | undefined;
	isPersonalContext?: boolean;
	targetContext?: WakeFailureTargetContext | null;
	targetLabel: string;
}): WakeFailureDisplay | null {
	const targetName = formatTargetName(input.targetLabel);
	const recovery = resolvePublicAgentFailureRecovery({
		errorCode: input.failureReasonCode,
		targetLabel: targetName,
	});
	if (!recovery) {
		return null;
	}

	if (
		recovery.kind === "local_service" &&
		input.targetContext?.isCurrentUserManageable !== true
	) {
		return {
			actionTarget: null,
			body: resolveNonCurrentOwnerLocalServiceFailureBody({
				targetContext: input.targetContext ?? null,
				targetName,
			}),
		};
	}

	if (recovery.recoveryTarget === null) {
		return {
			actionTarget: null,
			body: recovery.body,
		};
	}

	return {
		actionTarget: recovery.recoveryTarget,
		body: recovery.body,
		primaryActionId: recovery.primaryActionId,
		primaryActionLabel: recovery.primaryActionLabel,
	};
}

export function resolveHistoricalWakeFailureBody(input: {
	failureReasonCode: string | null | undefined;
	targetContext?: WakeFailureTargetContext | null;
	targetLabel: string;
}): string | null {
	const reasonCode = normalizeOptionalText(input.failureReasonCode);
	if (!reasonCode) {
		return null;
	}
	const targetName = formatTargetName(input.targetLabel);
	const recovery = resolvePublicAgentFailureRecovery({
		errorCode: reasonCode,
		includeUnknown: false,
		targetLabel: targetName,
	});
	if (!recovery) {
		return null;
	}

	if (reasonCode === "cursor.plan_upgrade_required") {
		return `${targetName} stopped this Wake because the Cursor plan had reached its usage limit.`;
	}
	if (reasonCode === "usage_exhausted") {
		return `${targetName} could not start this Wake because its Usage Limit had been reached.`;
	}
	if (
		reasonCode === "service.update_required" ||
		reasonCode === "service.drifted" ||
		reasonCode.startsWith("background_helper.update_required") ||
		reasonCode.startsWith("background_helper.installed_outdated")
	) {
		return `${targetName} could not complete this Wake because OpenMeld on its computer needed an update at the time.`;
	}
	if (reasonCode === "permission.denied.runtime") {
		return `${targetName} could not complete this Wake because the Agent Profile's permission settings blocked the requested action.`;
	}
	if (reasonCode === "openmeld.space_action.repair_failed") {
		return recovery.body;
	}

	switch (recovery.kind) {
		case "local_service":
			return resolveHistoricalLocalServiceFailureBody({
				targetContext: input.targetContext ?? null,
				targetName,
			});
		case "local_agent_connection":
		case "local_agent_prepare":
			return `${targetName} could not start this Wake because its local Agent setup was not ready at the time.`;
		case "account_access":
			return `${targetName} could not complete this Wake because its provider account or Agent settings blocked the request.`;
		case "system_retry":
			return `${targetName} could not complete this Wake because OpenMeld encountered a system problem.`;
		case "unknown":
			return null;
		default:
			return null;
	}
}

export function resolveWakeFailureTargetContext(input: {
	controllerDisplayName?: string | null;
	currentOwnerUserId: string | null | undefined;
	ownerDisplayName?: string | null;
	ownerUserId: string | null | undefined;
}): WakeFailureTargetContext {
	const currentOwnerUserId = normalizeOptionalText(input.currentOwnerUserId);
	const ownerUserId = normalizeOptionalText(input.ownerUserId);
	return {
		controllerDisplayName: normalizeOptionalText(input.controllerDisplayName),
		isCurrentUserManageable:
			currentOwnerUserId && ownerUserId
				? currentOwnerUserId === ownerUserId
				: null,
		ownerDisplayName: normalizeOptionalText(input.ownerDisplayName),
	};
}

function formatTargetName(value: string): string {
	const withoutMentionPrefix = value.trim().replace(MENTION_PREFIX_PATTERN, "");
	if (!withoutMentionPrefix) {
		return "This agent";
	}
	return `${withoutMentionPrefix.charAt(0).toUpperCase()}${withoutMentionPrefix.slice(1)}`;
}

function resolveNonCurrentOwnerLocalServiceFailureBody(input: {
	targetContext: WakeFailureTargetContext | null;
	targetName: string;
}): string {
	const ownerDisplayName = input.targetContext?.ownerDisplayName ?? null;
	const controllerDisplayName =
		input.targetContext?.controllerDisplayName ?? null;
	if (ownerDisplayName && controllerDisplayName) {
		return `${input.targetName} could not complete this Wake on ${controllerDisplayName}. Ask ${ownerDisplayName} to reconnect the computer and check the local agent, then wake the Agent again.`;
	}
	if (ownerDisplayName) {
		return `${input.targetName} could not complete this Wake on ${formatPossessiveName(ownerDisplayName)} computer. Ask ${ownerDisplayName} to reconnect the computer and check the local agent, then wake the Agent again.`;
	}
	return `${input.targetName} could not complete this Wake. Ask the Agent owner to reconnect the computer and check the local agent, then wake the Agent again.`;
}

function resolveHistoricalLocalServiceFailureBody(input: {
	targetContext: WakeFailureTargetContext | null;
	targetName: string;
}): string {
	const controllerDisplayName = input.targetContext?.controllerDisplayName;
	if (controllerDisplayName) {
		return `${input.targetName} could not complete this Wake because OpenMeld was not connected on ${controllerDisplayName} at the time.`;
	}
	const ownerDisplayName = input.targetContext?.ownerDisplayName;
	if (ownerDisplayName) {
		return `${input.targetName} could not complete this Wake because OpenMeld was not connected on ${formatPossessiveName(ownerDisplayName)} computer at the time.`;
	}
	return `${input.targetName} could not complete this Wake because its computer was not connected to OpenMeld at the time.`;
}

function normalizeOptionalText(
	value: string | null | undefined
): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function formatPossessiveName(value: string): string {
	return POSSESSIVE_SUFFIX_PATTERN.test(value) ? `${value}'` : `${value}'s`;
}
