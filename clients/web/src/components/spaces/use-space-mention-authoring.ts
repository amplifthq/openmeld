import type { MessageMentionType } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
	buildRecentMentionRankByProfileId,
	buildSpaceMemberDirectory,
	buildSpaceMentionProfileIndex,
	createSpaceTargetCatalog,
	isSpaceComposerSubmissionError,
	listSpaceMentionSuggestions,
	type PreparedSpaceComposerSubmission,
	prepareSpaceComposerSubmission,
	prepareSpaceFileOnlySubmission,
	resolveNextRecentMentionProfileIdsForQueuedText,
	type SpaceComposerAuthoredMentionInTextOrder,
	type SpaceMemberDirectory,
	type SpaceMemberDirectoryEntry,
	type SpaceMentionSuggestion,
	type SpaceSendTargetAllowedRelations,
	type SpaceSendTargetWakeAvailability,
} from "@openmeld/space";
import type { KeyboardEvent } from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useComposerDraft } from "#/hooks/use-composer-draft";
import {
	type ComposerDraftRecord,
	type ComposerDraftScope,
	EMPTY_COMPOSER_DRAFT_CONTENT,
} from "#/lib/composer-draft-storage";
import { buildSpaceMemberDirectoryForStatusOrder } from "#/lib/spaces/presentation";
import {
	readSpaceRecentMentionProfileIds,
	writeSpaceRecentMentionProfileIds,
} from "#/lib/spaces/recent-mention-storage";
import type {
	SpaceComposerEditorChange,
	SpaceComposerInputRef,
} from "./space-composer-editor";
import { SPACE_MEMBERS_LOAD_ERROR_MESSAGE } from "./space-members-error-copy";

const AUTHORED_MENTION_CONTINUATION_PATTERN = /[('’A-Za-z0-9_-]/u;

async function onComposerKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>,
	onSend: () => Promise<void>
): Promise<void> {
	if (event.nativeEvent.isComposing) {
		return;
	}
	if (!shouldSendFromComposerKeyDown(event)) {
		return;
	}
	event.preventDefault();
	await onSend();
}

export type SpaceComposerSelection = {
	end: number;
	start: number;
};

export type SpaceMentionPickerItem = {
	memberEntry: SpaceMemberDirectoryEntry;
	kind: "target";
	suggestion: SpaceMentionSuggestion;
};

export type SpaceReplyToSignalInput = {
	signalId: string;
	wakeTargetProfileId?: string | null;
};

export type SpaceComposerAddressingTarget = {
	allowedRelations: SpaceSendTargetAllowedRelations;
	profileId: string;
	profileName: string;
	relation: MessageMentionType;
	wakeAvailability: SpaceSendTargetWakeAvailability;
};

type SpaceComposerAddressingMention = Pick<
	SpaceComposerAuthoredMentionInTextOrder,
	"profileId" | "relation"
> &
	Partial<Pick<SpaceComposerAuthoredMentionInTextOrder, "text">>;

type TrackedComposerAuthoredMention =
	SpaceComposerAuthoredMentionInTextOrder & {
		end: number;
		start: number;
	};

export function useSpaceMentionAuthoring(input: {
	composerDraftMigrationScopes?: readonly ComposerDraftScope[];
	composerDraftScope: ComposerDraftScope | null;
	openMeldProfileId: string;
	initialComposerDraft?: ComposerDraftRecord | null;
	isMembersLoading: boolean;
	membersErrorMessage: string | null;
	spaceId: string;
	snapshot: SpaceMembersSnapshot | null;
}) {
	const textareaRef: SpaceComposerInputRef = useRef(null);
	const pendingSelectionRef = useRef<SpaceComposerSelection | null>(null);
	const composerDraft = useComposerDraft({
		initialDraft: input.initialComposerDraft,
		migrateFromScopes: input.composerDraftMigrationScopes,
		scope: input.composerDraftScope,
	});
	const composerText = composerDraft.content.text;
	const authoredMentions = composerDraft.content.authoredMentions;
	const replyTo = composerDraft.content.replyToSignalId
		? { signalId: composerDraft.content.replyToSignalId }
		: null;
	const currentComposerTextRef = useRef(composerText);
	const composerHasDraft =
		composerText.length > 0 || authoredMentions.length > 0 || replyTo !== null;
	const currentComposerHasDraftRef = useRef(composerHasDraft);
	useLayoutEffect(() => {
		currentComposerTextRef.current = composerText;
		currentComposerHasDraftRef.current = composerHasDraft;
	}, [composerHasDraft, composerText]);
	const [composerSelection, setComposerSelection] =
		useState<SpaceComposerSelection>({
			end: 0,
			start: 0,
		});
	const [recentMentionProfileIds, setRecentMentionProfileIds] = useState<
		string[]
	>([]);
	const addressingMentions = useMemo(
		() =>
			resolveSpaceComposerAddressingMentions({
				authoredMentions,
				snapshot: input.snapshot,
				text: composerText,
			}),
		[authoredMentions, composerText, input.snapshot]
	);
	const addressingTargets = useMemo(
		() =>
			buildSpaceComposerAddressingTargets({
				mentions: addressingMentions,
				snapshot: input.snapshot,
			}),
		[addressingMentions, input.snapshot]
	);
	const mentionPickerItems = useMemo(
		() =>
			input.snapshot
				? buildSpaceMentionTargetItems({
						query: "",
						recentProfileIds: recentMentionProfileIds,
						snapshot: input.snapshot,
					})
				: [],
		[input.snapshot, recentMentionProfileIds]
	);

	useEffect(() => {
		const snapshot = input.snapshot;
		if (!snapshot) {
			return;
		}
		const restoredAuthoredMentions = normalizeRestoredHumanMentionRelations({
			mentions: authoredMentions,
			snapshot,
		});
		if (restoredAuthoredMentions === authoredMentions) {
			return;
		}

		composerDraft.setContent((currentDraft) => {
			const nextAuthoredMentions = normalizeRestoredHumanMentionRelations({
				mentions: currentDraft.authoredMentions,
				snapshot,
			});
			if (nextAuthoredMentions === currentDraft.authoredMentions) {
				return currentDraft;
			}
			return {
				...currentDraft,
				authoredMentions: nextAuthoredMentions,
			};
		});
	}, [authoredMentions, composerDraft.setContent, input.snapshot]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing conversation identity must reset ephemeral picker and selection state even though the key is not rendered.
	useEffect(() => {
		const nextComposerText = currentComposerTextRef.current;
		setComposerSelection({
			end: nextComposerText.length,
			start: nextComposerText.length,
		});
	}, [composerDraft.storageKey]);

	useEffect(() => {
		setRecentMentionProfileIds(
			readSpaceRecentMentionProfileIds({
				openMeldProfileId: input.openMeldProfileId,
				spaceId: input.spaceId,
				snapshot: null,
			})
		);
	}, [input.openMeldProfileId, input.spaceId]);

	useEffect(() => {
		if (!input.snapshot) {
			return;
		}

		setRecentMentionProfileIds((currentRecentMentionProfileIds) => {
			const nextRecentMentionProfileIds = readSpaceRecentMentionProfileIds({
				openMeldProfileId: input.openMeldProfileId,
				spaceId: input.spaceId,
				snapshot: input.snapshot,
			});
			if (
				currentRecentMentionProfileIds.length ===
					nextRecentMentionProfileIds.length &&
				currentRecentMentionProfileIds.every(
					(profileId, index) => profileId === nextRecentMentionProfileIds[index]
				)
			) {
				return currentRecentMentionProfileIds;
			}

			writeSpaceRecentMentionProfileIds({
				openMeldProfileId: input.openMeldProfileId,
				profileIds: nextRecentMentionProfileIds,
				spaceId: input.spaceId,
				snapshot: input.snapshot,
			});
			return nextRecentMentionProfileIds;
		});
	}, [input.openMeldProfileId, input.snapshot, input.spaceId]);

	useLayoutEffect(() => {
		const pendingSelection = pendingSelectionRef.current;
		if (!pendingSelection) {
			return;
		}

		const composerInput = textareaRef.current;
		if (!composerInput) {
			return;
		}

		pendingSelectionRef.current = null;
		if ("selectTextRange" in composerInput) {
			composerInput.selectTextRange(pendingSelection);
			return;
		}
		composerInput.focus();
		composerInput.setSelectionRange(
			pendingSelection.start,
			pendingSelection.end
		);
	});

	return {
		addressingTargets,
		authoredMentions,
		composerSelection,
		hasAuthoredMentions: authoredMentions.length > 0,
		composerText,
		mentionPickerItems,
		replyTo,
		onComposerChange: (value: string, selection: SpaceComposerSelection) => {
			composerDraft.setContent((currentDraft) => ({
				...currentDraft,
				authoredMentions: reconcileTrackedAuthoredMentions({
					mentions: currentDraft.authoredMentions,
					nextText: value,
					previousText: currentDraft.text,
				}),
				text: value,
			}));
			setComposerSelection(selection);
		},
		onComposerEditorChange: (change: SpaceComposerEditorChange) => {
			composerDraft.setContent((currentDraft) => ({
				...currentDraft,
				authoredMentions: change.authoredMentions,
				text: change.text,
			}));
			setComposerSelection(change.selection);
		},
		onComposerSelectionChange: (selection: SpaceComposerSelection) => {
			setComposerSelection(selection);
		},
		onMentionButtonClick: () => {
			if (
				textareaRef.current &&
				"insertMentionTrigger" in textareaRef.current
			) {
				textareaRef.current.insertMentionTrigger();
				return;
			}
			const nextText = `${composerText.slice(0, composerSelection.start)}@${composerText.slice(composerSelection.end)}`;
			const nextCaretPosition = composerSelection.start + 1;
			composerDraft.setContent((currentDraft) => ({
				...currentDraft,
				authoredMentions: reconcileTrackedAuthoredMentions({
					mentions: currentDraft.authoredMentions,
					nextText,
					previousText: currentDraft.text,
				}),
				text: nextText,
			}));
			setComposerSelection({
				end: nextCaretPosition,
				start: nextCaretPosition,
			});
			pendingSelectionRef.current = {
				end: nextCaretPosition,
				start: nextCaretPosition,
			};
		},
		onClearReplyTo: () => {
			composerDraft.setContent((currentDraft) => ({
				...currentDraft,
				replyToSignalId: null,
			}));
		},
		onReplyToSignal: (replyInput: SpaceReplyToSignalInput) => {
			const replyWakeMention = resolveReplyWakeMention({
				snapshot: input.snapshot,
				wakeTargetProfileId: replyInput.wakeTargetProfileId ?? null,
			});
			const nextText = resolveReplyComposerText({
				currentText: composerText,
				wakeMentionText: replyWakeMention?.text ?? null,
			});
			composerDraft.setContent((currentDraft) => {
				const nextMentions = replyWakeMention
					? trackAuthoredMentionsInText({
							mentions: [
								replyWakeMention,
								...currentDraft.authoredMentions.map(toAuthoredMentionInput),
							],
							text: nextText,
						})
					: currentDraft.authoredMentions;
				return {
					...currentDraft,
					authoredMentions: nextMentions,
					replyToSignalId: replyInput.signalId,
					text: nextText,
				};
			});
			if (nextText !== composerText) {
				setComposerSelection({
					end: nextText.length,
					start: nextText.length,
				});
			}
			pendingSelectionRef.current = {
				end: nextText.length,
				start: nextText.length,
			};
		},
		prepareSubmission: (missingSnapshotMessage: string) =>
			prepareSpaceComposerSubmission({
				authoredMentionsInTextOrder: authoredMentions.map(
					toAuthoredMentionInput
				),
				missingSnapshotMessage,
				replyTo,
				snapshot: input.snapshot,
				text: composerText,
			}),
		prepareFileOnlySubmission: () =>
			prepareSpaceFileOnlySubmission({ replyTo }),
		preparePlainTextSubmission: (
			text: string,
			missingSnapshotMessage: string
		) =>
			prepareSpaceComposerSubmission({
				authoredMentionsInTextOrder: [],
				missingSnapshotMessage,
				replyTo: null,
				snapshot: input.snapshot,
				text,
			}),
		recordPendingSubmission: () => {
			resetComposerState();
		},
		restoreFailedSubmission: (
			preparedSubmission: PreparedSpaceComposerSubmission
		) => {
			if (currentComposerHasDraftRef.current) {
				return false;
			}
			const nextCaretPosition = preparedSubmission.text.length;
			composerDraft.setContent({
				authoredMentions: trackAuthoredMentionsInText({
					mentions: preparedSubmission.authoredMentionsInTextOrder,
					text: preparedSubmission.text,
				}),
				replyToSignalId: preparedSubmission.replyTo?.signalId ?? null,
				text: preparedSubmission.text,
			});
			setComposerSelection({
				end: nextCaretPosition,
				start: nextCaretPosition,
			});
			pendingSelectionRef.current = {
				end: nextCaretPosition,
				start: nextCaretPosition,
			};
			return true;
		},
		recordSuccessfulSubmission: (
			preparedSubmission: PreparedSpaceComposerSubmission
		) => {
			if (input.snapshot) {
				const nextRecentMentionProfileIds =
					resolveNextRecentMentionProfileIdsForQueuedText({
						canonicalMentionsInTextOrder:
							preparedSubmission.canonicalMentionsInTextOrder,
						currentRecentProfileIds: recentMentionProfileIds,
						mentionProfileIndex: buildSpaceMentionProfileIndex(input.snapshot),
						structuredMentionProfileIdsInTextOrder:
							preparedSubmission.resolvedStructuredTargets
								.profileIdsInTextOrder,
						submittedText: preparedSubmission.text,
					});

				if (nextRecentMentionProfileIds) {
					setRecentMentionProfileIds(nextRecentMentionProfileIds);
					writeSpaceRecentMentionProfileIds({
						openMeldProfileId: input.openMeldProfileId,
						profileIds: nextRecentMentionProfileIds,
						spaceId: input.spaceId,
						snapshot: input.snapshot,
					});
				}
			}
		},
		textareaRef,
		onComposerKeyDown,
	};

	function resetComposerState() {
		composerDraft.setContent(EMPTY_COMPOSER_DRAFT_CONTENT);
		setComposerSelection({ end: 0, start: 0 });
	}
}

export function buildSpaceMentionTargetItems(input: {
	query: string;
	recentProfileIds?: readonly string[] | null;
	snapshot: SpaceMembersSnapshot;
}): readonly Extract<SpaceMentionPickerItem, { kind: "target" }>[] {
	const directory = buildSpaceMemberDirectoryForStatusOrder(
		buildSpaceMemberDirectory(input.snapshot)
	);
	const entryByProfileId = buildMemberDirectoryEntryByProfileId(directory);
	const orderRankByProfileId =
		buildMemberDirectoryOrderRankByProfileId(directory);
	const recentRankByProfileId = buildRecentMentionRankByProfileId(
		input.recentProfileIds
	);

	return listSpaceMentionSuggestions({
		query: input.query,
		recentProfileIds: input.recentProfileIds,
		snapshot: input.snapshot,
	})
		.filter(
			(suggestion) =>
				resolveDefaultSpaceComposerMentionRelation(suggestion) !== null
		)
		.map((suggestion, suggestionIndex) => {
			const memberEntry = entryByProfileId.get(suggestion.profileId);
			if (!memberEntry) {
				throw new Error(
					`Mention suggestion is missing from the Space member directory: ${suggestion.profileId}`
				);
			}
			return {
				item: {
					kind: "target" as const,
					memberEntry,
					suggestion,
				},
				suggestionIndex,
			};
		})
		.sort((left, right) => {
			// Keep agents grouped before humans so this flat array matches the
			// popover's sectioned rendering (Agents section first, Humans second).
			// The popover derives each row's absolute index from
			// `agentItems.length`, which only equals the row's real array index
			// when every agent precedes every human. A recently mentioned human
			// would otherwise float above agents via `recentRank` below and desync
			// the highlighted row from the item that Enter/click actually selects.
			const leftKindRank = left.item.suggestion.profileKind === "agent" ? 0 : 1;
			const rightKindRank =
				right.item.suggestion.profileKind === "agent" ? 0 : 1;
			if (leftKindRank !== rightKindRank) {
				return leftKindRank - rightKindRank;
			}

			const leftRank =
				recentRankByProfileId.get(left.item.suggestion.profileId) ??
				Number.MAX_SAFE_INTEGER;
			const rightRank =
				recentRankByProfileId.get(right.item.suggestion.profileId) ??
				Number.MAX_SAFE_INTEGER;
			if (leftRank !== rightRank) {
				return leftRank - rightRank;
			}

			const leftStatusRank =
				orderRankByProfileId.get(left.item.suggestion.profileId) ??
				Number.MAX_SAFE_INTEGER;
			const rightStatusRank =
				orderRankByProfileId.get(right.item.suggestion.profileId) ??
				Number.MAX_SAFE_INTEGER;
			if (leftStatusRank !== rightStatusRank) {
				return leftStatusRank - rightStatusRank;
			}

			return left.suggestionIndex - right.suggestionIndex;
		})
		.map(({ item }) => item);
}

export function resolveDefaultSpaceComposerMentionRelation(
	suggestion: SpaceMentionSuggestion
): MessageMentionType | null {
	if (suggestion.profileKind === "agent" && suggestion.allowedRelations.wake) {
		return "wake";
	}

	if (
		suggestion.profileKind === "human" &&
		suggestion.allowedRelations.mention
	) {
		return "mention";
	}

	return null;
}

function normalizeRestoredHumanMentionRelations(input: {
	mentions: readonly TrackedComposerAuthoredMention[];
	snapshot: SpaceMembersSnapshot;
}): readonly TrackedComposerAuthoredMention[] {
	const catalog = createSpaceTargetCatalog(input.snapshot);
	let changed = false;
	const mentions = input.mentions.map((mention) => {
		if (mention.relation !== "reference") {
			return mention;
		}
		const target = catalog.byProfileId.get(mention.profileId);
		if (
			!target?.allowedRelations.mention ||
			target.allowedRelations.reference
		) {
			return mention;
		}
		changed = true;
		return { ...mention, relation: "mention" as const };
	});
	return changed ? mentions : input.mentions;
}

export function buildSpaceComposerAddressingTargets(input: {
	mentions: readonly SpaceComposerAddressingMention[];
	snapshot: SpaceMembersSnapshot | null;
}): readonly SpaceComposerAddressingTarget[] {
	if (!input.snapshot) {
		return [];
	}

	const catalog = createSpaceTargetCatalog(input.snapshot);
	const targetByProfileId = new Map<string, SpaceComposerAddressingTarget>();
	for (const mention of input.mentions) {
		if (targetByProfileId.has(mention.profileId)) {
			continue;
		}
		const target = catalog.byProfileId.get(mention.profileId);
		if (!target?.allowedRelations[mention.relation]) {
			continue;
		}
		targetByProfileId.set(mention.profileId, {
			allowedRelations: target.allowedRelations,
			profileId: target.profileId,
			profileName: target.profileName,
			relation: mention.relation,
			wakeAvailability: target.wakeAvailability,
		});
	}
	return [...targetByProfileId.values()];
}

export function resolveSpaceComposerAddressingMentions(input: {
	authoredMentions: readonly SpaceComposerAuthoredMentionInTextOrder[];
	snapshot: SpaceMembersSnapshot | null;
	text: string;
}): readonly SpaceComposerAddressingMention[] {
	if (!input.snapshot) {
		return input.authoredMentions;
	}

	try {
		const preparedSubmission = prepareSpaceComposerSubmission({
			authoredMentionsInTextOrder: input.authoredMentions,
			missingSnapshotMessage: SPACE_MEMBERS_LOAD_ERROR_MESSAGE,
			snapshot: input.snapshot,
			text: input.text,
		});
		const activationProfileIds = new Set(
			preparedSubmission.messageEnvelope?.activationTargets ?? []
		);
		const referenceProfileIds = new Set(
			preparedSubmission.messageEnvelope?.referenceTargets ?? []
		);
		const mentionProfileIds = new Set(
			preparedSubmission.messageEnvelope?.mentionTargets ?? []
		);

		return preparedSubmission.resolvedStructuredTargets.profileIdsInTextOrder.flatMap(
			(profileId): SpaceComposerAddressingMention[] => {
				if (activationProfileIds.has(profileId)) {
					return [{ profileId, relation: "wake" }];
				}
				if (referenceProfileIds.has(profileId)) {
					return [{ profileId, relation: "reference" }];
				}
				if (mentionProfileIds.has(profileId)) {
					return [{ profileId, relation: "mention" }];
				}
				return [];
			}
		);
	} catch (error) {
		if (!isSpaceComposerSubmissionError(error)) {
			throw error;
		}
		return input.authoredMentions;
	}
}

function toAuthoredMentionInput(
	mention: TrackedComposerAuthoredMention
): SpaceComposerAuthoredMentionInTextOrder {
	return {
		profileId: mention.profileId,
		relation: mention.relation,
		start: mention.start,
		text: mention.text,
	};
}

function trackAuthoredMentionsInText(input: {
	mentions: readonly SpaceComposerAuthoredMentionInTextOrder[];
	text: string;
}): TrackedComposerAuthoredMention[] {
	const trackedMentions: TrackedComposerAuthoredMention[] = [];
	let searchStart = 0;

	for (const mention of input.mentions) {
		const mentionText = mention.text.trim();
		if (mentionText.length === 0) {
			continue;
		}

		const start = input.text.indexOf(mentionText, searchStart);
		if (start === -1) {
			continue;
		}

		const trackedMention = {
			...mention,
			text: mentionText,
			start,
			end: start + mentionText.length,
		};
		if (isTrackedAuthoredMentionValid(input.text, trackedMention)) {
			trackedMentions.push(trackedMention);
		}
		searchStart = trackedMention.end;
	}

	return trackedMentions;
}

function reconcileTrackedAuthoredMentions(input: {
	mentions: readonly TrackedComposerAuthoredMention[];
	nextText: string;
	previousText: string;
}): TrackedComposerAuthoredMention[] {
	const edit = resolveSingleTextEdit({
		nextText: input.nextText,
		previousText: input.previousText,
	});

	return input.mentions
		.map((mention): TrackedComposerAuthoredMention | null => {
			if (mention.end <= edit.previousStart) {
				return mention;
			}

			if (mention.start >= edit.previousEnd) {
				return {
					...mention,
					end: mention.end + edit.delta,
					start: mention.start + edit.delta,
				};
			}

			return null;
		})
		.filter((mention): mention is TrackedComposerAuthoredMention => {
			if (!mention) {
				return false;
			}

			return isTrackedAuthoredMentionValid(input.nextText, mention);
		});
}

function resolveSingleTextEdit(input: {
	nextText: string;
	previousText: string;
}): {
	delta: number;
	previousEnd: number;
	previousStart: number;
} {
	let prefixLength = 0;
	while (
		prefixLength < input.previousText.length &&
		prefixLength < input.nextText.length &&
		input.previousText[prefixLength] === input.nextText[prefixLength]
	) {
		prefixLength += 1;
	}

	let suffixLength = 0;
	while (
		suffixLength < input.previousText.length - prefixLength &&
		suffixLength < input.nextText.length - prefixLength &&
		input.previousText.at(-1 - suffixLength) ===
			input.nextText.at(-1 - suffixLength)
	) {
		suffixLength += 1;
	}

	const previousEnd = input.previousText.length - suffixLength;
	const nextEnd = input.nextText.length - suffixLength;
	return {
		delta: nextEnd - prefixLength - (previousEnd - prefixLength),
		previousEnd,
		previousStart: prefixLength,
	};
}

function isTrackedAuthoredMentionValid(
	text: string,
	mention: TrackedComposerAuthoredMention
): boolean {
	if (text.slice(mention.start, mention.end) !== mention.text) {
		return false;
	}

	const nextCharacter = text[mention.end] ?? "";
	if (nextCharacter.length === 0) {
		return true;
	}

	return !AUTHORED_MENTION_CONTINUATION_PATTERN.test(nextCharacter);
}

function buildMemberDirectoryEntryByProfileId(
	directory: SpaceMemberDirectory
): ReadonlyMap<string, SpaceMemberDirectoryEntry> {
	return new Map(
		directory.sections.flatMap((section) =>
			section.entries.map((entry) => [entry.profileId, entry])
		)
	);
}

function buildMemberDirectoryOrderRankByProfileId(
	directory: SpaceMemberDirectory
): ReadonlyMap<string, number> {
	return new Map(
		directory.sections
			.flatMap((section) => section.entries)
			.map((entry, index) => [entry.profileId, index])
	);
}

function resolveReplyComposerText(input: {
	currentText: string;
	wakeMentionText: string | null;
}): string {
	if (
		!input.wakeMentionText ||
		input.currentText.includes(input.wakeMentionText)
	) {
		return input.currentText;
	}

	const currentText = input.currentText.trimStart();
	return currentText.length > 0
		? `${input.wakeMentionText} ${currentText}`
		: `${input.wakeMentionText} `;
}

function resolveReplyWakeMention(input: {
	snapshot: SpaceMembersSnapshot | null;
	wakeTargetProfileId: string | null;
}): SpaceComposerAuthoredMentionInTextOrder | null {
	if (!(input.snapshot && input.wakeTargetProfileId)) {
		return null;
	}

	const target = createSpaceTargetCatalog(input.snapshot).byProfileId.get(
		input.wakeTargetProfileId
	);
	if (target?.profileKind !== "agent" || !target.allowedRelations.wake) {
		return null;
	}

	return {
		profileId: target.profileId,
		relation: "wake",
		text: `@${target.primaryMentionLabel}`,
	};
}

function shouldSendFromComposerKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>
): boolean {
	return (event.metaKey || event.ctrlKey) && event.key === "Enter";
}
