import type { MessageEnvelope } from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import { PaperclipIcon, XIcon } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComposerDraftAuthoredMention } from "#/lib/composer-draft-storage";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import { isSpaceComposerFileInProgress } from "#/lib/spaces/composer-attachment";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import {
	SpaceComposerFileTray,
	useSpaceComposerFileInput,
} from "./space-composer-attachments";
import {
	SpaceComposerEditor,
	type SpaceComposerEditorChange,
	type SpaceComposerEditorHandle,
} from "./space-composer-editor";
import {
	SpaceMessageAttachmentGrid,
	SpaceMessageFileList,
} from "./space-message-body";
import { useSpaceMessageEditing } from "./space-message-editing";
import { useSpaceComposerFiles } from "./use-space-composer-attachments";
import type { SpaceMentionPickerItem } from "./use-space-mention-authoring";

export function restoreInlineMessageMentions(
	item: SpaceTimelineItem,
	items: readonly SpaceMentionPickerItem[]
) {
	const mentions: ComposerDraftAuthoredMention[] = [];
	for (const [relation, ids] of [
		["wake", item.wakeTargetProfileIds],
		["reference", item.referenceTargetProfileIds ?? []],
		["mention", item.mentionTargetProfileIds ?? []],
	] as const) {
		for (const profileId of ids) {
			const target = items.find(
				(entry) => entry.suggestion.profileId === profileId
			);
			if (!target) {
				continue;
			}
			const text = `@${target.suggestion.profileName}`;
			const start = item.text.indexOf(text);
			if (start >= 0) {
				mentions.push({
					profileId,
					relation,
					text,
					start,
					end: start + text.length,
				});
			}
		}
	}
	return mentions;
}

export function SpaceInlineMessageEditor(input: {
	collapsedHeight?: number;
	collapseControl?: ReactNode;
	item: SpaceTimelineItem;
	bodySize: { width: number; height: number } | null;
}) {
	const editing = useSpaceMessageEditing();
	if (!editing) {
		return null;
	}
	return <InlineEditor {...input} editing={editing} />;
}

function editedEnvelope(
	item: SpaceTimelineItem,
	draft: SpaceComposerEditorChange
): MessageEnvelope | undefined {
	const ids = (relation: ComposerDraftAuthoredMention["relation"]) => [
		...new Set(
			draft.authoredMentions
				.filter((mention) => mention.relation === relation)
				.map((mention) => mention.profileId)
		),
	];
	const activationTargets =
		item.wakeTargetProfileIds.length > 0
			? [...item.wakeTargetProfileIds]
			: ids("wake");
	const hasAddressing =
		draft.authoredMentions.length > 0 ||
		item.wakeTargetProfileIds.length > 0 ||
		(item.referenceTargetProfileIds?.length ?? 0) > 0 ||
		(item.mentionTargetProfileIds?.length ?? 0) > 0;
	return draft.text.trim() && hasAddressing
		? {
				text: draft.text.trim(),
				activationTargets,
				referenceTargets: ids("reference").filter(
					(id) => !activationTargets.includes(id)
				),
				mentionTargets: ids("mention"),
			}
		: undefined;
}

function InlineEditor({
	collapsedHeight,
	collapseControl,
	item,
	bodySize,
	editing,
}: {
	item: SpaceTimelineItem;
	collapsedHeight?: number;
	collapseControl?: ReactNode;
	bodySize: { width: number; height: number } | null;
	editing: NonNullable<ReturnType<typeof useSpaceMessageEditing>>;
}) {
	const editorRef = useRef<SpaceComposerEditorHandle | null>(null);
	const containerRef = useRef<HTMLDivElement | null>(null);
	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const saving = useRef(false);
	const [error, setError] = useState<string | null>(null);
	const [uploading, setUploading] = useState(false);
	const [draft, setDraft] = useState<SpaceComposerEditorChange>(() => ({
		text: editing.draft?.text ?? item.text,
		authoredMentions:
			editing.draft?.authoredMentions ??
			restoreInlineMessageMentions(item, editing.mentionPickerItems),
		selection: { start: 0, end: 0 },
	}));
	const [fileIds, setFileIds] = useState(
		editing.draft?.fileIds ?? (item.files ?? []).map((file) => file.fileId)
	);
	const [attachmentIds, setAttachmentIds] = useState(
		editing.draft?.attachmentIds ?? item.attachments.map((file) => file.id)
	);
	const files = useSpaceComposerFiles({
		draftScope: `edit:${item.id}`,
		organizationSlug: editing.orgSlug,
		profileId: editing.selfProfileId,
		spaceId: item.spaceId,
	});
	const hasPreviousWake = item.wakeTargetProfileIds.length > 0;
	const pickerItems = useMemo(() => {
		return editing.mentionPickerItems.map((entry) =>
			hasPreviousWake
				? {
						...entry,
						suggestion: {
							...entry.suggestion,
							allowedRelations: {
								...entry.suggestion.allowedRelations,
								wake: false,
							},
						},
					}
				: entry
		);
	}, [editing.mentionPickerItems, hasPreviousWake]);
	const addressingTargets = draft.authoredMentions.flatMap((mention) => {
		const entry = pickerItems.find(
			(target) => target.suggestion.profileId === mention.profileId
		);
		return entry ? [{ ...entry.suggestion, relation: mention.relation }] : [];
	});
	const newWake =
		!hasPreviousWake &&
		draft.authoredMentions.some((mention) => mention.relation === "wake");
	const busy = editing.busy || uploading;
	const saveLabel = newWake ? "Save & wake" : "Save changes";
	const fileInput = useSpaceComposerFileInput({
		disabled: busy,
		onAddFiles: async (selected) => {
			if (
				selected.length +
					fileIds.length +
					attachmentIds.length +
					files.files.length >
				10
			) {
				setError("You can attach up to ten files.");
				return;
			}
			await files.addFiles(selected);
		},
	});
	const api = useMemo(
		() =>
			createUnscopedWebSpaceApi({ openMeldProfileId: editing.selfProfileId }),
		[editing.selfProfileId]
	);
	useEffect(() => {
		// Entering edit must not jump a long message to its last line.
		const editable = containerRef.current?.querySelector<HTMLElement>(
			'[contenteditable="true"]'
		);
		editable?.focus({ preventScroll: true });
	}, []);

	async function save() {
		if (saving.current || busy) {
			return;
		}
		saving.current = true;
		setUploading(true);
		setError(null);
		try {
			const blocked = addressingTargets.find(
				(target) =>
					newWake &&
					target.relation === "wake" &&
					target.wakeAvailability.status !== "ready"
			);
			if (blocked) {
				throw new Error(
					`${blocked.profileName} isn't available to wake. Choose Reference or try again when the Agent is ready.`
				);
			}
			const originalMentions = restoreInlineMessageMentions(
				item,
				editing.mentionPickerItems
			);
			if (
				draft.text.trim() &&
				originalMentions.some(
					(mention) =>
						mention.relation === "wake" &&
						!draft.authoredMentions.some(
							(current) => current.profileId === mention.profileId
						)
				)
			) {
				throw new Error(
					"Keep the original Wake token. Type @ to add it back, or cancel this edit."
				);
			}
			const published = await files.publishReadyFiles(files.files);
			const messageEnvelope = editedEnvelope(item, draft);
			const accepted = await editing.save(
				item,
				draft.text,
				fileIds,
				attachmentIds,
				{ messageEnvelope, addedFiles: published.messageFiles },
				draft.authoredMentions
			);
			if (accepted) {
				files.consumePublishedFiles(published.publishedLocalIds);
			}
		} catch (failure) {
			setError(
				failure instanceof Error
					? failure.message
					: "Unable to save. Try again."
			);
		} finally {
			saving.current = false;
			setUploading(false);
		}
	}

	return (
		<div
			className="min-w-0 max-w-full text-left"
			data-slot="message-inline-editor"
			ref={containerRef}
			style={{ width: bodySize?.width, overflowWrap: "anywhere" }}
		>
			<div className="flex flex-col gap-2">
				<div
					style={{
						maxHeight: collapsedHeight,
						overflow: collapsedHeight ? "hidden" : undefined,
					}}
				>
					<SpaceComposerEditor
						addressingTargets={addressingTargets}
						ariaLabel="Edit message"
						authoredMentions={draft.authoredMentions}
						composerRef={editorRef}
						disabled={busy}
						inline
						lockedWakeProfileIds={item.wakeTargetProfileIds}
						mentionPickerItems={pickerItems}
						onCancel={() => {
							files.clearFiles();
							editing.cancel();
						}}
						onChange={(change) =>
							setDraft({
								...change,
								authoredMentions: change.authoredMentions.map((mention) =>
									item.wakeTargetProfileIds.includes(mention.profileId)
										? { ...mention, relation: "wake" }
										: mention
								),
							})
						}
						onDragLeave={fileInput.handleDragLeave}
						onDragOver={fileInput.handleDragOver}
						onDrop={fileInput.handleDrop}
						onPaste={fileInput.handlePaste}
						onSend={save}
						placeholder="Edit message…"
						text={draft.text}
					/>
				</div>
				{collapseControl}
				<SpaceMessageAttachmentGrid
					attachments={item.attachments.filter((file) =>
						attachmentIds.includes(file.id)
					)}
					organizationSlug={editing.orgSlug}
					spaceId={item.spaceId}
				/>
				<SpaceMessageFileList
					api={api}
					files={(item.files ?? []).filter((file) =>
						fileIds.includes(file.fileId)
					)}
					spaceId={item.spaceId}
				/>
				{item.editedAt ? (
					<span className="text-muted-foreground text-xs">(edited)</span>
				) : null}
				<SpaceComposerFileTray
					disabled={busy}
					files={files.files}
					onRemove={files.removeFile}
				/>
			</div>
			{editing.actionContainer
				? createPortal(
						<>
							<div className="mt-1 flex flex-wrap items-center justify-end gap-1">
								<input
									aria-label="Add files to edited message"
									className="sr-only"
									multiple
									onChange={(event) => {
										fileInput.addFiles(Array.from(event.target.files ?? []));
										event.target.value = "";
									}}
									ref={fileInputRef}
									type="file"
								/>
								<Button
									aria-label="Add files"
									disabled={busy}
									onClick={() => fileInputRef.current?.click()}
									size="icon-sm"
									variant="ghost"
								>
									<PaperclipIcon />
								</Button>
								{(item.files ?? [])
									.filter((file) => fileIds.includes(file.fileId))
									.map((file) => (
										<Button
											disabled={busy}
											key={file.fileId}
											onClick={() =>
												setFileIds((ids) =>
													ids.filter((id) => id !== file.fileId)
												)
											}
											size="sm"
											variant="ghost"
										>
											Remove {file.name}
											<XIcon />
										</Button>
									))}
								{item.attachments
									.filter((file) => attachmentIds.includes(file.id))
									.map((file) => (
										<Button
											disabled={busy}
											key={file.id}
											onClick={() =>
												setAttachmentIds((ids) =>
													ids.filter((id) => id !== file.id)
												)
											}
											size="sm"
											variant="ghost"
										>
											Remove {file.fileName ?? "image"}
											<XIcon />
										</Button>
									))}
								<div className="flex shrink-0 gap-1">
									<Button
										disabled={busy}
										onClick={() => {
											files.clearFiles();
											editing.cancel();
										}}
										size="sm"
										variant="ghost"
									>
										Cancel
									</Button>
									<Button
										disabled={
											busy || files.files.some(isSpaceComposerFileInProgress)
										}
										onClick={save}
										size="sm"
									>
										{busy ? "Saving…" : saveLabel}
									</Button>
								</div>
							</div>
							{error || editing.error ? (
								<p className="mt-2 text-destructive text-sm" role="alert">
									{error ?? editing.error}
								</p>
							) : null}
						</>,
						editing.actionContainer
					)
				: null}
		</div>
	);
}
