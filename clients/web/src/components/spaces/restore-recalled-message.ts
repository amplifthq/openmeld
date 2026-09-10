import type { SpaceMessageMutationResponse } from "@openmeld/schemas/types";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import {
	buildSpaceTimelineItems,
	type SpaceTimelineItem,
} from "#/lib/spaces/timeline";
import { buildWebSpaceAttachmentDownloadPath } from "#/lib/spaces/web-space-attachment-path";
import type {
	SpaceComposerEditorChange,
	SpaceComposerInputRef,
} from "./space-composer-editor";
import type { SpaceMentionPickerItem } from "./use-space-mention-authoring";

export async function readRecalledReplyTarget(
	message: SpaceMessageMutationResponse["message"],
	selfProfileId: string,
	items: readonly SpaceTimelineItem[]
) {
	const replyId =
		message.data.replyTo?.signalId ??
		message.data.messageEnvelope?.replyToSignalId;
	if (!replyId) {
		return null;
	}
	const loaded = items.find((item) => item.id === replyId);
	if (loaded) {
		return loaded;
	}
	const api = createUnscopedWebSpaceApi({ openMeldProfileId: selfProfileId });
	const result = await api.listSignalEnvelopes({
		spaceId: message.spaceId,
		query: { aroundSignalId: replyId, beforeCount: 0, afterCount: 0 },
	});
	const target = buildSpaceTimelineItems({
		envelopes: result.envelopes,
		membersSnapshot: null,
	}).find((item) => item.id === replyId);
	if (!target) {
		throw new Error(
			"The original reply target is no longer available. Your draft has been kept."
		);
	}
	return target;
}

export async function restoreRecalledMessage(input: {
	message: SpaceMessageMutationResponse["message"];
	selfProfileId: string;
	orgSlug?: string;
	composerFiles: readonly SpaceComposerFile[];
	composerMentionPickerItems?: readonly SpaceMentionPickerItem[];
	onComposerEditorChange: (change: SpaceComposerEditorChange) => void;
	onAddComposerFiles: (files: readonly File[]) => Promise<void>;
	onRemoveComposerFile: (localId: string) => void;
	textareaRef: SpaceComposerInputRef;
	canReplaceDraft: () => boolean;
}) {
	const { message } = input;
	const api = createUnscopedWebSpaceApi({
		openMeldProfileId: input.selfProfileId,
	});
	const files = await Promise.all(
		(message.data.files ?? []).map(async (file) => {
			const content = await api.downloadFileContent({
				spaceId: message.spaceId,
				fileId: file.fileId,
				revision: file.revision,
			});
			return new File([content.bytes], file.name, { type: content.mimeType });
		})
	);
	for (const attachment of message.data.attachments ?? []) {
		const response = await fetch(
			buildWebSpaceAttachmentDownloadPath({
				attachmentId: attachment.id,
				spaceId: message.spaceId,
				organizationSlug: input.orgSlug,
			})
		);
		if (!response.ok) {
			throw new Error(
				"An attachment is no longer available. Your current draft has been kept."
			);
		}
		files.push(
			new File([await response.blob()], attachment.fileName ?? "image.png", {
				type: attachment.mimeType,
			})
		);
	}
	const { text, authoredMentions } = restoreMessageMentions(
		message,
		input.composerMentionPickerItems
	);
	if (!input.canReplaceDraft()) {
		throw new Error(
			"Your draft changed while the message was loading. Try Edit again when you are ready."
		);
	}
	for (const file of input.composerFiles) {
		input.onRemoveComposerFile(file.localId);
	}
	input.onComposerEditorChange({
		restoredFromSignalId: message.id,
		text,
		authoredMentions,
		selection: { start: text.length, end: text.length },
	});
	if (files.length) {
		await input.onAddComposerFiles(files);
	}
	input.textareaRef.current?.focus();
}

function restoreMessageMentions(
	message: SpaceMessageMutationResponse["message"],
	items: readonly SpaceMentionPickerItem[] | undefined
) {
	let text = message.data.text;
	const authoredMentions: ComposerDraftAuthoredMention[] = [];
	for (const [relation, ids] of [
		["wake", message.data.messageEnvelope?.activationTargets ?? []],
		["reference", message.data.messageEnvelope?.referenceTargets ?? []],
		["mention", message.data.messageEnvelope?.mentionTargets ?? []],
	] as const) {
		for (const profileId of ids) {
			const target = items?.find(
				(item) => item.memberEntry.profileId === profileId
			);
			if (!target) {
				throw new Error(
					"A mentioned person or Agent is no longer available. Your current draft has been kept."
				);
			}
			const mentionText = `@${target.memberEntry.profileName}`;
			let start = text.indexOf(mentionText);
			if (start < 0) {
				start = text.length + (text ? 1 : 0);
				text = `${text}${text ? " " : ""}${mentionText}`;
			}
			authoredMentions.push({
				start,
				end: start + mentionText.length,
				text: mentionText,
				profileId,
				relation,
			});
		}
	}
	return { text, authoredMentions };
}
