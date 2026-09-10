import type {
	SpaceMessageMutationBody,
	SpaceMessageMutationResponse,
} from "@openmeld/schemas/types";
import type { SpaceTimelineItem } from "./timeline";

export type MessageEditDraft = {
	text: string;
	fileIds: string[];
	attachmentIds: string[];
};

export function previewMessageMutation(
	item: SpaceTimelineItem,
	body: Exclude<SpaceMessageMutationBody, { action: "restore_draft" }>,
	now: number
): SpaceTimelineItem {
	if (body.action === "recall") {
		return {
			...item,
			text: `${item.actorName} recalled a message.`,
			recalledAt: now,
			messageRevision: body.expectedRevision + 1,
			files: [],
			attachments: [],
			replyToSignalId: null,
			replyPreviewText: null,
			replyToProfileName: null,
			wakeTargetProfileIds: [],
			referenceTargetProfileIds: [],
			mentionTargetProfileIds: [],
		};
	}
	return {
		...item,
		text: body.text.trim(),
		editedAt: now,
		messageRevision: body.expectedRevision + 1,
		files: item.files?.filter(
			(file) => body.retainedFileIds?.includes(file.fileId) ?? true
		),
		attachments: item.attachments.filter(
			(file) => body.retainedAttachmentIds?.includes(file.id) ?? true
		),
	};
}

export function applySavedMessage(
	item: SpaceTimelineItem,
	message: SpaceMessageMutationResponse["message"]
): SpaceTimelineItem {
	return {
		...item,
		text: message.data.text,
		messageRevision: message.data.meta?.messageRevision ?? 0,
		editedAt: message.data.meta?.editedAt,
		recalledAt: message.data.meta?.recalledAt,
		repostedAt: message.data.meta?.repostedAt,
		files: message.data.files?.map((file) => ({
			...file,
			localPreviewUrl: null,
		})),
		attachments: (message.data.attachments ?? []).map((file) => ({
			...file,
			localPreviewUrl: null,
		})),
	};
}

export function projectMessageMutations(
	items: readonly SpaceTimelineItem[],
	changes: ReadonlyMap<string, SpaceTimelineItem>
): readonly SpaceTimelineItem[] {
	if (changes.size === 0) {
		return items;
	}
	return items.map((item) => {
		if (item.repostedAt) {
			return item;
		}
		const pending = changes.get(item.id);
		return pending &&
			(item.messageRevision ?? 0) < (pending.messageRevision ?? 0)
			? pending
			: item;
	});
}
