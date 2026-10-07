import type { SpaceComposerEditorChange } from "../../src/components/spaces/space-composer-editor";
import { DEMO_CLAUDE_PROFILE_ID, DEMO_CODEX_PROFILE_ID } from "./demo-members";

export const DEMO_PRIMARY_SPACE_NAME = "Checkout fix";

type DemoSampleMessage = {
	name: string;
	kind: "human" | "agent";
	text: string;
	wakeTargetProfileIds?: readonly string[];
};

export const demoSampleMessages: Record<string, readonly DemoSampleMessage[]> =
	{
		release: [
			{
				name: "James Lee",
				kind: "human",
				text: "Checkout broke after yesterday’s deploy. My Codex has the branch.",
			},
			{
				name: "Maya Chen",
				kind: "human",
				text: "@Codex Find the regression in James’s branch.",
				wakeTargetProfileIds: [DEMO_CODEX_PROFILE_ID],
			},
			{
				name: "Codex",
				kind: "agent",
				text: "Fixed a rounding bug. @Claude Code Check it against the billing spec.",
				wakeTargetProfileIds: [DEMO_CLAUDE_PROFILE_ID],
			},
			{
				name: "Claude Code",
				kind: "agent",
				text: "Matches the spec. Add tests for refunds and zero-dollar orders.",
			},
		],
		research: [
			{
				name: "James Lee",
				kind: "human",
				text: "What keeps coming up in our customer interviews?",
			},
			{
				name: "Center Agent",
				kind: "agent",
				text: "Three themes: easier setup, clearer handoffs, and files kept with the work.",
			},
		],
		website: [
			{
				name: "Maya Chen",
				kind: "human",
				text: "Review the website brief before we start the next draft.",
			},
			{
				name: "Center Agent",
				kind: "agent",
				text: "The brief is ready. Maya owns the final review.",
			},
		],
	};

export function buildDemoConversationDraft(
	spaceId: string
): SpaceComposerEditorChange {
	if (spaceId !== "release") {
		return {
			text: "",
			authoredMentions: [],
			selection: { start: 0, end: 0 },
		};
	}
	const mention = "@Codex";
	const text = `${mention} Add those two tests and run the suite.`;
	return {
		text,
		authoredMentions: [
			{
				profileId: DEMO_CODEX_PROFILE_ID,
				relation: "wake",
				start: 0,
				end: mention.length,
				text: mention,
			},
		],
		selection: { start: text.length, end: text.length },
	};
}

export function demoTemplateReply(profileId: string, spaceId: string) {
	if (spaceId === "research") {
		return "Reviewed six interviews. Setup and handoffs came up most. Examples are in the summary.";
	}
	if (spaceId === "website") {
		return "Checked the brief. The copy is ready for Maya’s review.";
	}
	if (profileId === DEMO_CODEX_PROFILE_ID) {
		return "Added refund and zero-dollar tests. Checkout suite passes: 24/24.";
	}
	if (profileId === DEMO_CLAUDE_PROFILE_ID) {
		return "Both tests match the billing spec. The fix is ready for review.";
	}
	return "Checkout fix is ready for review. James owns the code; Maya checked the billing rules.";
}
