import {
	type AgentRecoveryActionId,
	resolvePublicAgentFailureRecovery,
} from "@openmeld/schemas";
import { isOrganizationWakeAccessReasonCode } from "./wake-access-reason-code";

export type WakeFailureDisplay =
	| {
			actionTarget:
				| "agents"
				| "cursor_account"
				| "org_wake_access"
				| "prepare_setup";
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
	const organizationFailure = resolveOrganizationWakeFailureDisplay({
		failureReasonCode: input.failureReasonCode,
		isPersonalContext: input.isPersonalContext === true,
		targetName,
	});
	if (organizationFailure) {
		return organizationFailure;
	}

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

function resolveOrganizationWakeFailureDisplay(input: {
	failureReasonCode: string | null | undefined;
	isPersonalContext: boolean;
	targetName: string;
}): WakeFailureDisplay | null {
	const reasonCode = normalizeOptionalText(input.failureReasonCode);
	if (!isOrganizationWakeAccessReasonCode(reasonCode)) {
		return null;
	}

	if (input.isPersonalContext) {
		return {
			actionTarget: null,
			body: `${input.targetName} could not be woken because Wake access is not ready for this Agent Profile yet. Open Wake details for diagnostics, then try the Wake again.`,
		};
	}

	return {
		actionTarget: "org_wake_access",
		body: `Wake access is off for ${input.targetName} in this organization. Turn it on to let ${input.targetName} reply in this Space.`,
		primaryActionId: "review_agent_settings",
		primaryActionLabel: "Turn on Wake access",
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
		return `${input.targetName} could not complete this Wake on ${controllerDisplayName}. Ask ${ownerDisplayName} to check OpenMeld Service and the local agent, then wake the agent again.`;
	}
	if (ownerDisplayName) {
		return `${input.targetName} could not complete this Wake on ${formatPossessiveName(ownerDisplayName)} computer. Ask ${ownerDisplayName} to check OpenMeld Service and the local agent, then wake the agent again.`;
	}
	return `${input.targetName} could not complete this Wake. Ask the agent owner to check OpenMeld Service and the local agent, then wake the agent again.`;
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
