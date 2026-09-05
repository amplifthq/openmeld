export const SPACE_WAKE_COMPOSER_HINT =
	"To wake an agent, type @, then pick the agent.";
export const SPACE_COMPOSER_ACCESSIBLE_NAME = "Message this space";
export type SpaceAgentDirectConversationComposerHintKind = "direct_message";

export type SpaceComposerConversationKind =
	| "space"
	| "human_direct_message"
	| "agent_direct_message"
	| "center_agent_direct_message";

export type SpaceComposerPlacement = "conversation" | "thread";

export type SpaceComposerPlaceholderContext =
	| SpaceComposerConversationKind
	| "thread";

export type SpaceComposerPolicy = {
	accessibleName: string;
	placeholder: string;
	sendButtonLabel: "Send message" | "Send reply" | "Sending…";
	sendButtonTooltip: "Send message" | "Send reply" | "Sending…";
	showMentionButton: boolean;
	wakeTextHint: string | null;
};

export function resolveSpaceComposerConversationKind(input: {
	isAgentDirectMessage: boolean;
	isCenterAgentDirectMessage: boolean;
	isDirectMessage: boolean;
}): SpaceComposerConversationKind {
	if (input.isCenterAgentDirectMessage) {
		return "center_agent_direct_message";
	}
	if (input.isAgentDirectMessage) {
		return "agent_direct_message";
	}
	if (input.isDirectMessage) {
		return "human_direct_message";
	}
	return "space";
}

export function resolveSpaceComposerPolicy(input: {
	canSendMessage: boolean;
	conversationKind: SpaceComposerConversationKind;
	hasAuthoredMentions?: boolean;
	placement: SpaceComposerPlacement;
	readOnlyPlaceholder?: string;
	targetName?: string | null;
	text: string;
	isSendingMessage?: boolean;
}): SpaceComposerPolicy {
	const placeholderContext =
		input.placement === "thread" ? "thread" : input.conversationKind;
	const agentDirectConversation =
		input.conversationKind === "agent_direct_message" ||
		input.conversationKind === "center_agent_direct_message";
	const sendButtonLabel = resolveSpaceComposerSendButtonLabel({
		isSendingMessage: input.isSendingMessage === true,
		placement: input.placement,
	});

	return {
		accessibleName: resolveSpaceComposerAccessibleName({
			context: placeholderContext,
			targetName: input.targetName,
		}),
		placeholder: resolveSpaceComposerPlaceholder({
			canSendMessage: input.canSendMessage,
			context: placeholderContext,
			readOnlyPlaceholder: input.readOnlyPlaceholder,
			targetName: input.targetName,
		}),
		sendButtonLabel,
		sendButtonTooltip: input.isSendingMessage
			? "Sending…"
			: resolveSpaceComposerSendButtonLabel({
					isSendingMessage: false,
					placement: input.placement,
				}),
		showMentionButton: !agentDirectConversation,
		wakeTextHint: agentDirectConversation
			? null
			: resolveSpaceComposerWakeTextHint(input.text, {
					hasAuthoredMentions: input.hasAuthoredMentions,
				}),
	};
}

function resolveSpaceComposerSendButtonLabel(input: {
	isSendingMessage: boolean;
	placement: SpaceComposerPlacement;
}): SpaceComposerPolicy["sendButtonLabel"] {
	if (input.placement === "thread") {
		return "Send reply";
	}
	return input.isSendingMessage ? "Sending…" : "Send message";
}

export function resolveSpaceComposerPlaceholder(input: {
	canSendMessage: boolean;
	context: SpaceComposerPlaceholderContext;
	readOnlyPlaceholder?: string;
	targetName?: string | null;
}): string {
	if (input.readOnlyPlaceholder) {
		return input.readOnlyPlaceholder;
	}
	if (!input.canSendMessage) {
		return "Posting is unavailable in this space right now";
	}
	if (input.context === "thread") {
		return "Reply in thread…";
	}
	if (input.context === "center_agent_direct_message") {
		return "Tell Center Agent what you need…";
	}
	if (input.context === "human_direct_message") {
		return `Message ${input.targetName?.trim() || "this person"}…`;
	}
	if (input.context === "agent_direct_message") {
		return `Message ${input.targetName?.trim() || "this agent"}…`;
	}
	return SPACE_WAKE_COMPOSER_HINT;
}

export function resolveSpaceComposerAccessibleName(input: {
	context: SpaceComposerPlaceholderContext;
	targetName?: string | null;
}): string {
	if (input.context === "thread") {
		return "Reply in thread";
	}
	if (input.context === "center_agent_direct_message") {
		return "Message Center Agent";
	}
	if (input.context === "human_direct_message") {
		return `Message ${input.targetName?.trim() || "this person"}`;
	}
	if (input.context === "agent_direct_message") {
		return `Message ${input.targetName?.trim() || "this agent"}`;
	}
	return SPACE_COMPOSER_ACCESSIBLE_NAME;
}

const RAW_WAKE_TEXT_HINT =
	"This will send a normal message. To wake an agent, use the @ menu and pick the agent.";
const rawWakeTextPattern = /(^|\s)@[^\n@]{1,96}\s+wake\b/iu;
const canonicalWakeMentionPattern = /(^|\s)@[^\n@]{1,96}\(wake\)/iu;

export function resolveSpaceComposerWakeTextHint(
	composerText: string,
	input: { hasAuthoredMentions?: boolean } = {}
): string | null {
	const text = composerText.trim();
	if (
		text.length === 0 ||
		input.hasAuthoredMentions === true ||
		canonicalWakeMentionPattern.test(text)
	) {
		return null;
	}
	return rawWakeTextPattern.test(text) ? RAW_WAKE_TEXT_HINT : null;
}
