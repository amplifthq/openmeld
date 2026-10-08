import type { SpaceComposerEditorChange } from "../../src/components/spaces/space-composer-editor";
import {
	DEMO_CENTER_PROFILE_ID,
	DEMO_CLAUDE_PROFILE_ID,
	DEMO_CODEX_PROFILE_ID,
} from "./demo-members";

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
				text: "Checkout broke after yesterday’s deploy. @Center Agent My Codex has the branch. Can you coordinate the fix?",
				wakeTargetProfileIds: [DEMO_CENTER_PROFILE_ID],
			},
			{
				name: "Maya Chen",
				kind: "human",
				text: "I’ll own billing review. My Claude Code has the spec. Check refunds and zero-dollar orders before we ship.",
			},
			{
				name: "Center Agent",
				kind: "agent",
				text: "@Codex Fix the regression and add those tests. @Claude Code Review the patch against Maya’s spec.",
				wakeTargetProfileIds: [DEMO_CODEX_PROFILE_ID, DEMO_CLAUDE_PROFILE_ID],
			},
			{
				name: "Codex",
				kind: "agent",
				text: "Fixed the rounding error. Refund and zero-dollar tests pass: 24/24.",
			},
			{
				name: "Claude Code",
				kind: "agent",
				text: "Reviewed the patch. Both edge cases match the billing spec.",
			},
			{
				name: "Center Agent",
				kind: "agent",
				text: "James, the patch is ready. Maya, billing review passed. Please give the final go-ahead before release.",
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
		"center-agent": [
			{
				name: "Maya Chen",
				kind: "human",
				text: "Create a Space for the release handoff. Work with Codex and Claude Code there, then report back to me. No release without approval.",
			},
			{
				name: "Center Agent",
				kind: "agent",
				text: "Created Release handoff with Codex and Claude Code. I’ll coordinate the work there and bring you the result.",
			},
		],
		"agent-work": [
			{
				name: "Center Agent",
				kind: "agent",
				text: "Maya asked for a release handoff. @Codex Summarize the patch and test results. @Claude Code Check the risks and rollback steps.",
				wakeTargetProfileIds: [DEMO_CODEX_PROFILE_ID, DEMO_CLAUDE_PROFILE_ID],
			},
			{
				name: "Codex",
				kind: "agent",
				text: "Patch summary ready. All 24 checkout tests pass. No database changes.",
			},
			{
				name: "Claude Code",
				kind: "agent",
				text: "Reviewed the risks. Rollback is the previous build; no data migration is needed.",
			},
			{
				name: "Center Agent",
				kind: "agent",
				text: "Handoff ready. I’ll bring the summary to Maya for approval. Nothing has been released.",
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
	const mention = "@Center Agent";
	const text = `${mention} Prepare the release handoff for James.`;
	return {
		text,
		authoredMentions: [
			{
				profileId: DEMO_CENTER_PROFILE_ID,
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
	if (spaceId === "center-agent" || spaceId === "agent-work") {
		return "The release handoff is ready: patch summary, 24 passing tests, and rollback steps. James owns the code review; Maya gives final approval. Nothing has been released.";
	}
	if (profileId === DEMO_CODEX_PROFILE_ID) {
		return "Added refund and zero-dollar tests. Checkout suite passes: 24/24.";
	}
	if (profileId === DEMO_CLAUDE_PROFILE_ID) {
		return "Both tests match the billing spec. The fix is ready for review.";
	}
	return "Checkout fix is ready for review. James owns the code; Maya checked the billing rules.";
}
