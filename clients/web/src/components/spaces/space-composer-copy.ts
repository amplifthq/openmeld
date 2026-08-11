export const SPACE_WAKE_COMPOSER_HINT =
	"To wake an agent, type @, then pick the agent.";
export type SpaceAgentDirectConversationComposerHintKind = "direct_message";
export const SPACE_AGENT_DIRECT_MESSAGE_COMPOSER_HINT =
	"In this DM, @ is optional. Sending wakes the agent.";

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

export function resolveSpaceAgentDirectConversationComposerHint(
	kind: SpaceAgentDirectConversationComposerHintKind
): string {
	if (kind === "direct_message") {
		return SPACE_AGENT_DIRECT_MESSAGE_COMPOSER_HINT;
	}
	const exhaustive: never = kind;
	return exhaustive;
}
