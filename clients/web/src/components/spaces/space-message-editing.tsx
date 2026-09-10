import type {
	SpaceMessageMutationBody,
	SpaceMessageMutationResponse,
} from "@openmeld/schemas/types";
import { Button } from "@openmeld/ui/components/button";
import {
	Dialog,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@openmeld/ui/components/dialog";
import { DialogContent } from "@openmeld/ui/fluid/dialog";
import { useQueryClient } from "@tanstack/react-query";
import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import {
	applySavedMessage,
	type MessageEditDraft,
	previewMessageMutation,
	projectMessageMutations,
} from "#/lib/spaces/message-mutation-presentation";
import type { SpaceTimelineItem } from "#/lib/spaces/timeline";
import { writeSpaceHistoryEnvelopesToCache } from "#/query/spaces/history";
import {
	SpaceComposerEditor,
	type SpaceComposerEditorHandle,
} from "./space-composer-editor";

type Message = SpaceMessageMutationResponse["message"];
type EditingContext = {
	selfProfileId: string;
	edit: SpaceTimelineItem | null;
	draft: MessageEditDraft | null;
	changes: ReadonlyMap<string, SpaceTimelineItem>;
	beginEdit: (item: SpaceTimelineItem) => void;
	cancel: () => void;
	recall: (item: SpaceTimelineItem) => void;
	restore: (item: SpaceTimelineItem) => void;
	save: (
		item: SpaceTimelineItem,
		text: string,
		fileIds: string[],
		attachmentIds: string[]
	) => Promise<void>;
	busy: boolean;
	error: string | null;
};
const MessageEditingContext = createContext<EditingContext | null>(null);
export const useSpaceMessageEditing = () => useContext(MessageEditingContext);

export function useOptimisticSpaceMessages(
	items: readonly SpaceTimelineItem[]
) {
	const editing = useSpaceMessageEditing();
	const changes = editing?.changes;
	return useMemo(
		() => (changes ? projectMessageMutations(items, changes) : items),
		[items, changes]
	);
}

export function SpaceMessageEditingScope(input: {
	selfProfileId: string;
	readOnly?: boolean;
	hasDraft: boolean;
	draftKey: string;
	threadRootSignalId?: string;
	onRestore: (
		message: Message,
		canReplaceDraft: () => boolean
	) => Promise<void>;
	children: ReactNode;
}) {
	const [edit, setEdit] = useState<SpaceTimelineItem | null>(null);
	const [draft, setDraft] = useState<MessageEditDraft | null>(null);
	const [changes, setChanges] = useState<
		ReadonlyMap<string, SpaceTimelineItem>
	>(new Map());
	const [recalling, setRecalling] = useState<SpaceTimelineItem | null>(null);
	const [restoring, setRestoring] = useState<SpaceTimelineItem | null>(null);
	const [busy, setBusy] = useState(false);
	const inFlight = useRef(false);
	const latestDraftKey = useRef(input.draftKey);
	latestDraftKey.current = input.draftKey;
	const [error, setError] = useState<string | null>(null);
	const client = useQueryClient();
	const api = useMemo(
		() => createUnscopedWebSpaceApi({ openMeldProfileId: input.selfProfileId }),
		[input.selfProfileId]
	);

	async function run(operation: () => Promise<void>) {
		if (inFlight.current) {
			return;
		}
		inFlight.current = true;
		setBusy(true);
		setError(null);
		try {
			await operation();
		} catch (failure) {
			const message =
				failure instanceof Error
					? failure.message
					: "Unable to save. Try again.";
			setError(
				message.includes("request could not reach")
					? "Couldn’t connect. Check your connection and try again."
					: message
			);
		} finally {
			inFlight.current = false;
			setBusy(false);
		}
	}
	async function refresh(message: Message) {
		if (!input.threadRootSignalId || message.id === input.threadRootSignalId) {
			writeSpaceHistoryEnvelopesToCache({
				envelopes: [message],
				queryClient: client,
				spaceId: message.spaceId,
				openMeldProfileId: input.selfProfileId,
			});
		}
		await client.invalidateQueries({
			predicate: (query) => query.queryKey.includes(message.spaceId),
		});
	}
	async function restore(item: SpaceTimelineItem) {
		const draftKey = latestDraftKey.current;
		await run(async () => {
			const result = await api.mutateMessage({
				spaceId: item.spaceId,
				signalId: item.id,
				body: { action: "restore_draft" },
			});
			await input.onRestore(
				result.message,
				() => latestDraftKey.current === draftKey
			);
			setRestoring(null);
		});
	}
	async function mutate(
		item: SpaceTimelineItem,
		body: Exclude<SpaceMessageMutationBody, { action: "restore_draft" }>,
		retryDraft: MessageEditDraft | null
	) {
		await run(async () => {
			const preview = previewMessageMutation(item, body, Date.now());
			setChanges((previous) => new Map(previous).set(item.id, preview));
			setEdit(null);
			setRecalling(null);
			let message: Message;
			try {
				message = (
					await api.mutateMessage({
						spaceId: item.spaceId,
						signalId: item.id,
						body,
					})
				).message;
			} catch (failure) {
				setChanges((previous) => {
					const next = new Map(previous);
					next.delete(item.id);
					return next;
				});
				if (body.action === "edit") {
					setDraft(retryDraft);
					setEdit(item);
				} else {
					setRecalling(item);
				}
				throw failure;
			}
			setChanges((previous) =>
				new Map(previous).set(item.id, applySavedMessage(preview, message))
			);
			await refresh(message);
		});
	}
	const value: EditingContext = {
		selfProfileId: input.readOnly ? "" : input.selfProfileId,
		edit,
		draft,
		changes,
		busy,
		error,
		beginEdit: (item) => {
			if (edit && edit.id !== item.id) {
				setError("Finish or cancel your current edit first.");
				return;
			}
			if (!busy) {
				setError(null);
				setDraft(null);
				setEdit(item);
			}
		},
		cancel: () => {
			if (!busy) {
				setEdit(null);
				setError(null);
			}
		},
		recall: (item) => {
			setError(null);
			setRecalling(item);
		},
		restore: (item) => {
			setError(null);
			if (input.hasDraft) {
				setRestoring(item);
			} else {
				restore(item);
			}
		},
		save: async (item, text, fileIds, attachmentIds) => {
			const retryDraft = { text, fileIds, attachmentIds };
			if (!(text.trim() || fileIds.length || attachmentIds.length)) {
				setDraft(retryDraft);
				setRecalling(item);
				return;
			}
			if (
				text.trim() === item.text &&
				fileIds.length === (item.files?.length ?? 0) &&
				attachmentIds.length === item.attachments.length
			) {
				setEdit(null);
				return;
			}
			await mutate(
				item,
				{
					action: "edit",
					expectedRevision: item.messageRevision ?? 0,
					text,
					retainedFileIds: fileIds,
					retainedAttachmentIds: attachmentIds,
				},
				retryDraft
			);
		},
	};
	const confirmLabel = recalling ? "Recall message" : "Replace draft";
	return (
		<MessageEditingContext.Provider value={value}>
			{input.children}
			<Dialog
				onOpenChange={(open) => {
					if (!(open || busy)) {
						setRecalling(null);
						setRestoring(null);
					}
				}}
				open={Boolean(recalling || restoring)}
			>
				<DialogContent>
					<DialogHeader>
						<DialogTitle>
							{recalling ? "Recall this message?" : "Replace your draft?"}
						</DialogTitle>
						<DialogDescription>
							{recalling
								? "This will remove the message for everyone in this Space."
								: "You already have a draft. Replace it with the recalled message to edit again."}
						</DialogDescription>
					</DialogHeader>
					{recalling?.wakeTargetProfileIds.length ? (
						<p className="text-muted-foreground text-sm">
							Recalling a message does not stop its Agent tasks. Use Stop to
							stop work that is still running.
						</p>
					) : null}
					{error ? (
						<p className="text-destructive text-sm" role="alert">
							{error}
						</p>
					) : null}
					<DialogFooter>
						<Button
							disabled={busy}
							onClick={() => {
								setRecalling(null);
								setRestoring(null);
							}}
							variant="ghost"
						>
							Cancel
						</Button>
						<Button
							disabled={busy}
							onClick={() => {
								if (restoring) {
									restore(restoring);
									return;
								}
								if (!recalling) {
									return;
								}
								const item = recalling;
								mutate(
									item,
									{
										action: "recall",
										expectedRevision: item.messageRevision ?? 0,
									},
									draft
								);
							}}
							variant={recalling ? "destructive" : "default"}
						>
							{busy ? "Saving…" : confirmLabel}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
			{error && !edit && !recalling && !restoring ? (
				<p className="px-4 text-destructive text-sm" role="alert">
					{error}
				</p>
			) : null}
		</MessageEditingContext.Provider>
	);
}

export function SpaceInlineMessageEditor({
	item,
	bodySize,
}: {
	item: SpaceTimelineItem;
	bodySize: { width: number; height: number } | null;
}) {
	const editing = useSpaceMessageEditing();
	const composerRef = useRef<SpaceComposerEditorHandle | null>(null);
	useEffect(() => {
		composerRef.current?.focus();
	}, []);
	const [text, setText] = useState(editing?.draft?.text ?? item.text);
	const [fileIds, setFileIds] = useState(
		editing?.draft?.fileIds ?? (item.files ?? []).map((file) => file.fileId)
	);
	const [attachmentIds, setAttachmentIds] = useState(
		editing?.draft?.attachmentIds ?? item.attachments.map((file) => file.id)
	);
	if (!editing) {
		return null;
	}
	return (
		<div
			className="min-w-48 max-w-full text-left"
			data-slot="message-inline-editor"
			style={{ width: bodySize?.width }}
		>
			<div style={{ minHeight: bodySize?.height }}>
				<SpaceComposerEditor
					addressingTargets={[]}
					ariaLabel="Edit message"
					authoredMentions={[]}
					composerRef={composerRef}
					disabled={editing.busy}
					inline
					mentionPickerItems={[]}
					onCancel={editing.cancel}
					onChange={(change) => setText(change.text)}
					onSend={() => {
						editing.save(item, text, fileIds, attachmentIds);
					}}
					placeholder="Edit message…"
					text={text}
				/>
				<div className="flex flex-wrap gap-1">
					{(item.files ?? [])
						.filter((file) => fileIds.includes(file.fileId))
						.map((file) => (
							<Button
								aria-label={`Remove ${file.name}`}
								disabled={editing.busy}
								key={file.fileId}
								onClick={() =>
									setFileIds((ids) => ids.filter((id) => id !== file.fileId))
								}
								size="sm"
								variant="ghost"
							>
								{file.name} ×
							</Button>
						))}
					{item.attachments
						.filter((file) => attachmentIds.includes(file.id))
						.map((file) => (
							<Button
								disabled={editing.busy}
								key={file.id}
								onClick={() =>
									setAttachmentIds((ids) => ids.filter((id) => id !== file.id))
								}
								size="sm"
								variant="ghost"
							>
								Remove {file.fileName ?? "image"}
							</Button>
						))}
				</div>
			</div>
			<div className="mt-0.5 flex h-7 justify-end gap-1">
				<Button
					disabled={editing.busy}
					onClick={editing.cancel}
					size="sm"
					variant="ghost"
				>
					Cancel
				</Button>
				<Button
					disabled={editing.busy}
					onClick={() => {
						editing.save(item, text, fileIds, attachmentIds);
					}}
					size="sm"
				>
					{editing.busy ? "Saving…" : "Save changes"}
				</Button>
			</div>
			{editing.error ? (
				<p className="mt-2 text-destructive text-sm" role="alert">
					{editing.error}
				</p>
			) : null}
		</div>
	);
}
