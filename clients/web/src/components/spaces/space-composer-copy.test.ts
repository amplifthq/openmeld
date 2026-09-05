import { describe, expect, it } from "vitest";
import {
	resolveSpaceComposerConversationKind,
	resolveSpaceComposerPolicy,
} from "./space-composer-copy";

describe("resolveSpaceComposerConversationKind", () => {
	it("keeps ordinary spaces distinct from direct messages", () => {
		expect(
			resolveSpaceComposerConversationKind({
				isAgentDirectMessage: false,
				isCenterAgentDirectMessage: false,
				isDirectMessage: false,
			})
		).toBe("space");
	});

	it("gives Center Agent conversations precedence over generic DMs", () => {
		expect(
			resolveSpaceComposerConversationKind({
				isAgentDirectMessage: true,
				isCenterAgentDirectMessage: true,
				isDirectMessage: true,
			})
		).toBe("center_agent_direct_message");
	});
});

describe("resolveSpaceComposerPolicy", () => {
	it.each([
		{
			accessibleName: "Message this space",
			conversationKind: "space" as const,
			placeholder: "To wake an agent, type @, then pick the agent.",
			showMentionButton: true,
			targetName: null,
		},
		{
			accessibleName: "Message Alice",
			conversationKind: "human_direct_message" as const,
			placeholder: "Message Alice…",
			showMentionButton: true,
			targetName: "Alice",
		},
		{
			accessibleName: "Message Atlas",
			conversationKind: "agent_direct_message" as const,
			placeholder: "Message Atlas…",
			showMentionButton: false,
			targetName: "Atlas",
		},
		{
			accessibleName: "Message Center Agent",
			conversationKind: "center_agent_direct_message" as const,
			placeholder: "Tell Center Agent what you need…",
			showMentionButton: false,
			targetName: "Center Agent",
		},
	])("keeps the $conversationKind conversation contract together", ({
		accessibleName,
		conversationKind,
		placeholder,
		showMentionButton,
		targetName,
	}) => {
		const policy = resolveSpaceComposerPolicy({
			canSendMessage: true,
			conversationKind,
			placement: "conversation",
			targetName,
			text: "",
		});

		expect(policy).toMatchObject({
			accessibleName,
			placeholder,
			sendButtonLabel: "Send message",
			showMentionButton,
		});
	});

	it("uses one thread policy without leaking the parent conversation copy", () => {
		expect(
			resolveSpaceComposerPolicy({
				canSendMessage: true,
				conversationKind: "agent_direct_message",
				isSendingMessage: true,
				placement: "thread",
				targetName: "Atlas",
				text: "",
			})
		).toEqual({
			accessibleName: "Reply in thread",
			placeholder: "Reply in thread…",
			sendButtonLabel: "Send reply",
			sendButtonTooltip: "Sending…",
			showMentionButton: false,
			wakeTextHint: null,
		});
	});
});
