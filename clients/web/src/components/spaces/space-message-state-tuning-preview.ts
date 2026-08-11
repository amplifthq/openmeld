import type { SpaceMemberDirectoryEntry } from "@openmeld/space";
import { useEffect, useMemo, useState } from "react";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";

export const SPACE_MESSAGE_STATE_TUNING_PREVIEW_QUERY = "message-state-preview";
export const SPACE_MESSAGE_STATE_TUNING_PREVIEW_VALUE = "all";

const PREVIEW_RUN_GAP_MS = 6 * 60 * 1000;
const PREVIEW_GROUP_GAP_MS = 60 * 1000;
const PREVIEW_LONG_REPLY_PARAGRAPH =
	"This intentionally long preview reply exercises local message collapsing while preserving realistic paragraph rhythm, wrapping, punctuation, and inline emphasis for detailed spacing adjustments.";

const RICH_PREVIEW_ANSWER = `## Launch checklist

Here is the **final, ordinary Agent answer** rendered through the real Markdown message component.

### 1. Access and permissions

- Confirm each teammate has the correct role.
- Remove temporary access that is no longer needed.
- Record the owner in \`launch-owner.md\`.

> A launch is ready only when the responsible person and the expected result are both clear.

### 2. Agent readiness

1. Confirm the Agent is online.
2. Run one harmless test task.
3. Verify the answer appears in this conversation.

| Check | Expected result |
| --- | --- |
| Connection | Online |
| Test task | Completed |
| Conversation | Reply visible |

For additional context, open the [OpenMeld website](https://openmeld.ai).`;

export function useSpaceMessageStateTuningPreviewItems(input: {
	centerAgentProfileId: string | null;
	profileEntriesById: ReadonlyMap<string, SpaceMemberDirectoryEntry>;
	selfProfileId: string;
	spaceId?: string;
}): readonly SpaceTimelineItem[] | null {
	const [enabled, setEnabled] = useState(false);
	useEffect(() => {
		if (!import.meta.env.DEV) {
			return;
		}
		const searchParams = new URLSearchParams(window.location.search);
		setEnabled(
			searchParams.get(SPACE_MESSAGE_STATE_TUNING_PREVIEW_QUERY) ===
				SPACE_MESSAGE_STATE_TUNING_PREVIEW_VALUE
		);
	}, []);

	return useMemo(() => {
		if (!(enabled && input.spaceId)) {
			return null;
		}
		const previewAgent = input.centerAgentProfileId
			? input.profileEntriesById.get(input.centerAgentProfileId)
			: [...input.profileEntriesById.values()].find(
					(entry) => entry.profileKind === "agent"
				);
		if (!previewAgent || previewAgent.profileKind !== "agent") {
			return null;
		}
		const previewHuman =
			input.profileEntriesById.get(input.selfProfileId) ??
			[...input.profileEntriesById.values()].find(
				(entry) => entry.profileKind === "human"
			);
		if (!previewHuman || previewHuman.profileKind !== "human") {
			return null;
		}
		return buildSpaceMessageStateTuningPreviewItems({
			agent: previewAgent,
			human: previewHuman,
			spaceId: input.spaceId,
		});
	}, [
		enabled,
		input.centerAgentProfileId,
		input.profileEntriesById,
		input.selfProfileId,
		input.spaceId,
	]);
}

export function resolveSpaceMessageStateTuningTimelineItems(input: {
	baseItems: readonly SpaceTimelineItem[];
	optimisticItem: SpaceTimelineItem | null;
	previewItems: readonly SpaceTimelineItem[] | null;
}): readonly SpaceTimelineItem[] {
	if (input.previewItems) {
		return input.previewItems;
	}
	return input.optimisticItem
		? [...input.baseItems, input.optimisticItem]
		: input.baseItems;
}

export function resolveSpaceMessageStateTuningVisibility(input: {
	isCenterAgentDirectMessage: boolean;
	previewItems: readonly SpaceTimelineItem[] | null;
	showCenterAgentStarterActions: boolean;
}) {
	if (input.previewItems) {
		return {
			isCenterAgentDirectMessage: false,
			showCenterAgentStarterActions: false,
		};
	}
	return {
		isCenterAgentDirectMessage: input.isCenterAgentDirectMessage,
		showCenterAgentStarterActions: input.showCenterAgentStarterActions,
	};
}

export function buildSpaceMessageStateTuningPreviewItems(input: {
	agent: SpaceMemberDirectoryEntry;
	human: SpaceMemberDirectoryEntry;
	spaceId: string;
}): readonly SpaceTimelineItem[] {
	const startedAtMs = Date.now() - PREVIEW_RUN_GAP_MS * 18;
	const atRun = (run: number) => startedAtMs + PREVIEW_RUN_GAP_MS * run;
	const humanItem = (run: number, id: string, text: string) =>
		buildPreviewTimelineItem({
			createdAtMs: atRun(run),
			entry: input.human,
			id,
			spaceId: input.spaceId,
			text,
		});
	const agentItem = (run: number, id: string, text: string) =>
		buildPreviewTimelineItem({
			createdAtMs: atRun(run),
			entry: input.agent,
			id,
			spaceId: input.spaceId,
			text,
		});
	const richAnswerId = "dev:message-state-preview:agent-rich-answer";

	return [
		humanItem(
			0,
			"dev:message-state-preview:user-short",
			"Can you give me a concise launch checklist for the new workspace?"
		),
		agentItem(
			1,
			"dev:message-state-preview:agent-normal-answer",
			"Absolutely. I’ll keep it practical and focus on the steps that need a clear owner before launch."
		),
		humanItem(
			2,
			"dev:message-state-preview:user-multiline",
			"Please cover these three areas:\n\n1. Access and permissions\n2. Agent readiness\n3. The final launch check\n\nA short explanation under each item would help."
		),
		{
			...agentItem(3, richAnswerId, RICH_PREVIEW_ANSWER),
			navigationAction: {
				label: "Open this Project",
				target: { kind: "project", projectId: "project_preview" },
				url: "http://localhost:3000/o/preview/projects/project_preview",
			},
		},
		{
			...humanItem(
				4,
				"dev:message-state-preview:user-reply",
				"The structure looks right. Could you make the readiness check more specific?"
			),
			newMessagesDuringComposition: 3,
			replyPreviewText:
				"Start with access, confirm the Agent is ready, and finish with one real launch check.",
			replyToProfileName: input.agent.profileName,
			replyToSignalId: richAnswerId,
		},
		agentItem(
			5,
			"dev:message-state-preview:agent-grouped-first",
			"For readiness, verify that the Agent is online, connected to the intended workspace, and able to complete one harmless test task."
		),
		{
			...agentItem(
				5,
				"dev:message-state-preview:agent-grouped-second",
				"Then confirm that the result appears in this conversation without requiring a manual refresh."
			),
			createdAtMs: atRun(5) + PREVIEW_GROUP_GAP_MS,
		},
		agentItem(7, "dev:message-state-preview:blank", ""),
		{
			...agentItem(8, "dev:message-state-preview:sending", ""),
			deliveryState: "pending",
			optimisticAgentReplyState: "sending",
		},
		{
			...agentItem(9, "dev:message-state-preview:working", ""),
			deliveryState: "pending",
			optimisticAgentReplyState: "working",
		},
		{
			...agentItem(
				10,
				"dev:message-state-preview:streaming",
				"This answer is appearing progressively while the Agent is still writing."
			),
			agentStreamState: {
				reasonCode: null,
				sequence: 1,
				status: "streaming",
				streamId: "dev:message-state-preview:streaming",
				toolParts: [],
			},
		},
		{
			...agentItem(
				11,
				"dev:message-state-preview:thinking",
				"I’m turning the request into a clear sequence and checking that each step has an observable result."
			),
			agentStreamState: {
				reasonCode: null,
				sequence: 2,
				status: "streaming",
				streamId: "dev:message-state-preview:thinking",
				thinking:
					"Reviewing the conversation structure, checking the latest workspace settings, and organizing the response.",
				toolParts: [],
			},
		},
		{
			...agentItem(12, "dev:message-state-preview:tool-activity", ""),
			agentStreamState: {
				reasonCode: null,
				sequence: 3,
				status: "streaming",
				streamId: "dev:message-state-preview:tool-activity",
				toolParts: [
					{
						state: "input-available",
						toolCallId: "dev:message-state-preview:tool-call",
						toolName: "agent_read_files",
						type: "tool",
						work: { key: "source.read", v: 1 },
					},
				],
			},
		},
		{
			...humanItem(
				13,
				"dev:message-state-preview:user-delayed",
				"This message is intentionally delayed so the sending status stays visible for spacing adjustments."
			),
			deliveryState: "pending",
		},
		{
			...agentItem(
				14,
				"dev:message-state-preview:failed",
				"I couldn’t finish this reply because the Agent connection ended unexpectedly."
			),
			agentStreamState: {
				reasonCode: "dev_preview_failure",
				sequence: 4,
				status: "failed",
				streamId: "dev:message-state-preview:failed",
			},
		},
		{
			...agentItem(
				15,
				"dev:message-state-preview:stopped",
				"The reply stopped before the remaining steps were completed."
			),
			agentStreamState: {
				reasonCode: "agent_stopped",
				sequence: 5,
				status: "stopped",
				streamId: "dev:message-state-preview:stopped",
			},
		},
		{
			...agentItem(
				16,
				"dev:message-state-preview:publish-failed",
				"The Agent completed the answer, but OpenMeld could not post it to the conversation."
			),
			agentStreamState: {
				reasonCode: "publication_failed",
				sequence: 6,
				status: "completed_but_publish_failed",
				streamId: "dev:message-state-preview:publish-failed",
			},
		},
		agentItem(
			17,
			"dev:message-state-preview:long-answer",
			`${Array.from({ length: 32 }, () => PREVIEW_LONG_REPLY_PARAGRAPH).join(" ")}\n\n[Response truncated by OpenMeld]`
		),
	];
}

function buildPreviewTimelineItem(input: {
	createdAtMs: number;
	entry: SpaceMemberDirectoryEntry;
	id: string;
	spaceId: string;
	text: string;
}): SpaceTimelineItem {
	return {
		actorAgentControllerRef: input.entry.agentControllerRef,
		actorAvatarImageUrl: input.entry.avatarUrl,
		actorControllerDisplay: input.entry.controllerDisplayName,
		actorName: input.entry.profileName,
		actorOwnerDisplay: input.entry.ownerDisplay,
		actorOwnerName: input.entry.ownerName,
		actorOwnerUserId: input.entry.ownerUserId,
		actorProfileId: input.entry.profileId,
		actorProfileKind: input.entry.profileKind,
		actorProfileName: input.entry.profileName,
		actorRuntimeDeviceDisplayName: input.entry.runtimeDeviceDisplayName,
		agentControllerConversationId: input.entry.agentControllerConversationId,
		agentWorkspace: input.entry.workingDirectory,
		attachments: [],
		clientMessageId: null,
		createdAtMs: input.createdAtMs,
		deliveryState: "sent",
		id: input.id,
		...(input.entry.profileKind === "agent" ? { isAgentFinalReply: true } : {}),
		newMessagesDuringComposition: null,
		replyPreviewText: null,
		replyToProfileName: null,
		replyToSignalId: null,
		signalType: "signal.text",
		spaceId: input.spaceId,
		systemNoticeType: null,
		text: input.text,
		transientActivityPurpose: null,
		wakeClientMessageId: null,
		wakeSourceSignalId: null,
		wakeTargetProfileIds: [],
	};
}
