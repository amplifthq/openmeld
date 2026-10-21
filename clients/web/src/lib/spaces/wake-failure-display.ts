import {
	type AgentRecoveryActionId,
	type PublicAgentFailureRecoveryTarget,
	resolvePublicAgentFailureRecovery,
} from "@openmeld/schemas";

export type WakeFailureDisplay =
	| {
			actionTarget: PublicAgentFailureRecoveryTarget;
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

export function isQuotaWakeFailure(reason: string | null | undefined): boolean {
	return (
		reason === "usage_exhausted" ||
		reason === "provider_account.capacity_exhausted" ||
		reason === "cursor.plan_upgrade_required"
	);
}

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

	if (
		recovery.recoveryTarget !== null &&
		recovery.primaryActionId === "change_model" &&
		input.targetContext?.isCurrentUserManageable === false
	) {
		return {
			actionTarget: null,
			body: "Ask this agent's owner to change its model.",
		};
	}

	if (recovery.recoveryTarget === null) {
		return {
			actionTarget: null,
			body: recovery.body,
		};
	}
	if (
		recovery.recoveryTarget === "session_folder" &&
		input.targetContext?.isCurrentUserManageable !== true
	) {
		// Only the owner chooses folders; anyone else starts a new chat, whose
		// new Session uses the Agent's current folder.
		return {
			actionTarget: null,
			body: `${targetName} couldn’t continue this chat in its earlier folder. Start a new chat to continue.`,
		};
	}
	if (
		recovery.recoveryTarget === "working_folder" &&
		input.targetContext?.isCurrentUserManageable !== true
	) {
		return {
			actionTarget: null,
			body: `${recovery.body} Ask this agent’s owner to review its working folder.`,
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
	targetLabel: string;
}): string {
	const reasonCode = normalizeOptionalText(
		input.failureReasonCode
	)?.toLowerCase();
	const targetName = formatTargetName(input.targetLabel);

	if (reasonCode === "wake.device_wait.expired") {
		return "Wait expired. Task did not run.";
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
		reasonCode?.startsWith("background_helper.update_required") ||
		reasonCode?.startsWith("background_helper.installed_outdated")
	) {
		return `${targetName} could not complete this Wake because OpenMeld on its computer needed an update at the time.`;
	}
	if (reasonCode === "permission.denied.runtime") {
		return `${targetName} could not complete this Wake because the Agent Profile's permission settings blocked the requested action.`;
	}
	if (reasonCode === "agent_profile.organization_mismatch") {
		return `${targetName} could not start this Wake because its Agent Profile belonged to a different workspace.`;
	}
	if (
		reasonCode?.endsWith("provider.unavailable") ||
		reasonCode?.endsWith("provider.bad_gateway") ||
		reasonCode?.endsWith("model.provider_unavailable")
	) {
		return `${targetName} could not complete this Wake because its selected model was unavailable.`;
	}
	if (reasonCode === "openmeld.space_action.repair_failed") {
		return `OpenMeld could not confirm a Space response from ${targetName}, even after automatic recovery.`;
	}
	if (reasonCode === "service.not_running") {
		return `${targetName} could not complete this Wake because its computer was not connected to OpenMeld at the time.`;
	}
	if (
		reasonCode === "agent_profile_binding.missing" ||
		reasonCode === "controller.runtime.missing"
	) {
		return `${targetName} could not start this Wake.`;
	}

	return `${targetName} could not complete this Wake.`;
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

function normalizeOptionalText(
	value: string | null | undefined
): string | null {
	const normalized = String(value ?? "").trim();
	return normalized.length > 0 ? normalized : null;
}

function formatPossessiveName(value: string): string {
	return POSSESSIVE_SUFFIX_PATTERN.test(value) ? `${value}'` : `${value}'s`;
}
