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
