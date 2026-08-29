import type { MessageMentionType } from "@openmeld/schemas";
import type { SpaceMembersSnapshot } from "@openmeld/schemas/types";
import {
	buildRecentMentionRankByProfileId,
	buildSpaceMemberDirectory,
	buildSpaceMentionProfileIndex,
	closeMentionPickerState,
	createSpaceTargetCatalog,
	extractMentionAuthoringPrefix,
	isTargetPickerState,
	listSpaceMentionSuggestions,
	type MentionPickerState,
	openTargetPickerState,
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
import type { Dispatch, KeyboardEvent, SetStateAction } from "react";
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
import { SPACE_MEMBERS_LOAD_ERROR_MESSAGE } from "./space-members-error-copy";

const AUTHORED_MENTION_CONTINUATION_PATTERN = /[('’A-Za-z0-9_-]/u;

export type SpaceComposerSelection = {
	end: number;
	start: number;
};

export type SpaceMentionPickerItem = {
	memberEntry: SpaceMemberDirectoryEntry;
	kind: "target";
	suggestion: SpaceMentionSuggestion;
};

export type SpaceMentionPopoverState =
	| {
			kind: "closed";
	  }
	| {
			kind: "empty";
			query: string;
			message: string;
	  }
	| {
			kind: "loading";
			query: string;
			message: string;
	  }
	| {
			query: string;
			message: string;
			kind: "unavailable";
	  }
	| {
			highlightedIndex: number;
			items: readonly SpaceMentionPickerItem[];
			kind: "target_picker";
			query: string;
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
	const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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
	const [mentionPickerState, setMentionPickerState] =
		useState<MentionPickerState>(closeMentionPickerState);
	const [highlightedIndex, setHighlightedIndex] = useState(-1);
	const [activePrefixRange, setActivePrefixRange] = useState<{
		end: number;
		start: number;
		text: string;
	} | null>(null);
	const [dismissedMentionStarts, setDismissedMentionStarts] = useState<
		number[]
	>([]);
	const addressingSummary = useMemo(
		() => buildSpaceComposerAddressingSummary(authoredMentions),
		[authoredMentions]
	);
	const addressingTargets = useMemo(
		() =>
			buildSpaceComposerAddressingTargets({
				mentions: authoredMentions,
				snapshot: input.snapshot,
			}),
		[authoredMentions, input.snapshot]
	);

	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing conversation identity must reset ephemeral picker and selection state even though the key is not rendered.
	useEffect(() => {
		const nextComposerText = currentComposerTextRef.current;
		setComposerSelection({
			end: nextComposerText.length,
			start: nextComposerText.length,
		});
		setMentionPickerState(closeMentionPickerState());
		setHighlightedIndex(-1);
		setActivePrefixRange(null);
		setDismissedMentionStarts([]);
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

		const textarea = textareaRef.current;
		if (!textarea) {
			return;
		}

		pendingSelectionRef.current = null;
		textarea.focus();
		textarea.setSelectionRange(pendingSelection.start, pendingSelection.end);
	});

	useEffect(() => {
		if (composerSelection.start !== composerSelection.end) {
			setActivePrefixRange(null);
			setMentionPickerState(closeMentionPickerState());
			return;
		}

		const textBeforeCursor = composerText.slice(0, composerSelection.start);
		const prefix = extractMentionAuthoringPrefix(textBeforeCursor);
		if (!prefix) {
			setActivePrefixRange(null);
			setMentionPickerState(closeMentionPickerState());
			return;
		}

		const prefixRange = {
			end: composerSelection.start,
			start: composerSelection.start - prefix.length,
			text: prefix,
		};
		if (
			isMentionAuthoringPrefixOwnedByAuthoredMention({
				mentions: authoredMentions,
				prefixRange,
			})
		) {
			setActivePrefixRange(null);
			setMentionPickerState(closeMentionPickerState());
			return;
		}

		setActivePrefixRange(prefixRange);
		if (dismissedMentionStarts.includes(prefixRange.start)) {
			setMentionPickerState(closeMentionPickerState());
			return;
		}

		setMentionPickerState((currentState) => {
			return openTargetPickerState({
				query: prefix,
				selectedProfileId:
					getSelectedProfileIdFromMentionPickerState(currentState),
			});
		});
	}, [
		authoredMentions,
		composerSelection,
		composerText,
		dismissedMentionStarts,
	]);

	const mentionPopoverState = useMemo<SpaceMentionPopoverState>(() => {
		if (mentionPickerState.kind === "closed") {
			return { kind: "closed" };
		}

		if (!input.snapshot) {
			if (input.isMembersLoading) {
				return {
					kind: "loading",
					message: "Loading current space members…",
					query: mentionPickerState.query,
				};
			}

			return {
				kind: "unavailable",
				message: input.membersErrorMessage ?? SPACE_MEMBERS_LOAD_ERROR_MESSAGE,
				query: mentionPickerState.query,
			};
		}

		if (!isTargetPickerState(mentionPickerState)) {
			return { kind: "closed" };
		}

		const targetItems = buildSpaceMentionTargetItems({
			query: mentionPickerState.query,
			recentProfileIds: recentMentionProfileIds,
			snapshot: input.snapshot,
		});
		if (targetItems.length === 0) {
			return {
				kind: "empty",
				message: "No matching members in this space.",
				query: mentionPickerState.query,
			};
		}

		const fallbackIndex =
			mentionPickerState.selectedProfileId === null
				? 0
				: Math.max(
						0,
						targetItems.findIndex(
							(item) =>
								item.suggestion.profileId ===
								mentionPickerState.selectedProfileId
						)
					);

		return {
			highlightedIndex: clampHighlightedIndex({
				fallbackIndex,
				highlightedIndex,
				itemCount: targetItems.length,
			}),
			items: targetItems,
			kind: "target_picker",
			query: mentionPickerState.query,
		};
	}, [
		highlightedIndex,
		input.isMembersLoading,
		input.membersErrorMessage,
		input.snapshot,
		mentionPickerState,
		recentMentionProfileIds,
	]);

	useEffect(() => {
		if (mentionPopoverState.kind === "target_picker") {
			setHighlightedIndex(mentionPopoverState.highlightedIndex);
			return;
		}

		setHighlightedIndex(-1);
	}, [mentionPopoverState]);

	const closeMentionPopover = () => {
		if (activePrefixRange) {
			setDismissedMentionStarts((currentStarts) =>
				currentStarts.includes(activePrefixRange.start)
					? currentStarts
					: [...currentStarts, activePrefixRange.start]
			);
		}
		setMentionPickerState(closeMentionPickerState());
		setHighlightedIndex(-1);
	};

	const onMentionItemSelect = (
		index: number,
		relation?: MessageMentionType
	) => {
		selectMentionItem(index, relation);
	};

	const onMentionPopoverClose = () => {
		closeMentionPopover();
	};

	const onComposerKeyDown = async (
		event: KeyboardEvent<HTMLTextAreaElement>,
		onSend: () => Promise<void>
	) => {
		if (event.nativeEvent.isComposing) {
			return;
		}

		if (
			handleMentionPickerKeyboardInput({
				event,
				highlightedIndex,
				mentionPopoverState,
				onClose: closeMentionPopover,
				onMoveHighlight: setHighlightedIndex,
				onSelectItem: selectMentionItem,
			})
		) {
			return;
		}

		if (!shouldSendFromComposerKeyDown(event)) {
			return;
		}

		event.preventDefault();
		await onSend();
	};

	return {
		addressingSummary,
		addressingTargets,
		composerSelection,
		hasAuthoredMentions: authoredMentions.length > 0,
		composerText,
		mentionPopoverState,
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
			setDismissedMentionStarts((currentStarts) =>
				reconcileDismissedMentionStarts({
					starts: currentStarts,
					nextText: value,
					previousText: composerText,
				})
			);
			setComposerSelection(selection);
		},
		onComposerSelectionChange: (selection: SpaceComposerSelection) => {
			setComposerSelection(selection);
		},
		onMentionItemHover: (index: number) => {
			setHighlightedIndex(index);
		},
		onMentionItemSelect,
		onMentionRelationChange: (
			profileId: string,
			relation: MessageMentionType
		) => {
			if (!input.snapshot) {
				return;
			}
			const target = createSpaceTargetCatalog(input.snapshot).byProfileId.get(
				profileId
			);
			if (!target?.allowedRelations[relation]) {
				return;
			}
			composerDraft.setContent((currentDraft) => ({
				...currentDraft,
				authoredMentions: currentDraft.authoredMentions.map((mention) =>
					mention.profileId === profileId
						? {
								...mention,
								relation,
							}
						: mention
				),
			}));
		},
		onMentionPopoverClose,
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
			setMentionPickerState(closeMentionPickerState());
			setHighlightedIndex(-1);
			setActivePrefixRange(null);
			setDismissedMentionStarts([]);
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
			setMentionPickerState(closeMentionPickerState());
			setHighlightedIndex(-1);
			setActivePrefixRange(null);
			setDismissedMentionStarts([]);
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
		setMentionPickerState(closeMentionPickerState());
		setHighlightedIndex(-1);
		setActivePrefixRange(null);
		setDismissedMentionStarts([]);
	}

	function selectMentionItem(index: number, relation?: MessageMentionType) {
		if (mentionPopoverState.kind !== "target_picker") {
			return;
		}

		const selectedItem = mentionPopoverState.items[index];
		if (!selectedItem) {
			return;
		}

		if (!activePrefixRange) {
			return;
		}

		const selectedRelation =
			relation ??
			resolveDefaultSpaceComposerMentionRelation(selectedItem.suggestion);
		if (
			!(
				selectedRelation &&
				selectedItem.suggestion.allowedRelations[selectedRelation]
			)
		) {
			return;
		}

		const mentionText = `@${selectedItem.suggestion.primaryMentionLabel}`;
		const nextText = `${composerText.slice(0, activePrefixRange.start)}${mentionText} ${composerText.slice(activePrefixRange.end)}`;
		const nextCaretPosition = activePrefixRange.start + mentionText.length + 1;

		pendingSelectionRef.current = {
			end: nextCaretPosition,
			start: nextCaretPosition,
		};
		composerDraft.setContent((currentDraft) => {
			const retainedMentions = reconcileTrackedAuthoredMentions({
				mentions: currentDraft.authoredMentions,
				nextText,
				previousText: currentDraft.text,
			});
			const mentionInputs = retainedMentions.map(toAuthoredMentionInput);
			if (
				!retainedMentions.some(
					(mention) => mention.profileId === selectedItem.suggestion.profileId
				)
			) {
				mentionInputs.push({
					profileId: selectedItem.suggestion.profileId,
					relation: selectedRelation,
					text: mentionText,
				});
			}
			return {
				...currentDraft,
				authoredMentions: trackAuthoredMentionsInText({
					mentions: mentionInputs,
					text: nextText,
				}),
				text: nextText,
			};
		});
		setDismissedMentionStarts((currentStarts) =>
			reconcileDismissedMentionStarts({
				starts: currentStarts,
				nextText,
				previousText: composerText,
			})
		);
		setComposerSelection({
			end: nextCaretPosition,
			start: nextCaretPosition,
		});
		setMentionPickerState(closeMentionPickerState());
		setHighlightedIndex(-1);
		setActivePrefixRange(null);
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
		suggestion.allowedRelations.reference
	) {
		return "reference";
	}

	return null;
}

export function buildSpaceComposerAddressingSummary(
	mentions: readonly SpaceComposerAuthoredMentionInTextOrder[]
): string | null {
	const relationByProfileId = new Map<string, MessageMentionType>();
	for (const mention of mentions) {
		relationByProfileId.set(mention.profileId, mention.relation);
	}
	if (relationByProfileId.size < 2) {
		return null;
	}

	const relationCounts: Record<MessageMentionType, number> = {
		reference: 0,
		wake: 0,
	};
	for (const relation of relationByProfileId.values()) {
		relationCounts[relation] += 1;
	}

	const agentLabel = relationCounts.wake === 1 ? "agent" : "agents";
	const segments = [
		`Waking ${String(relationCounts.wake)} ${agentLabel}`,
		`Referencing ${String(relationCounts.reference)}`,
	];
	return segments.join(" · ");
}

export function buildSpaceComposerAddressingTargets(input: {
	mentions: readonly SpaceComposerAuthoredMentionInTextOrder[];
	snapshot: SpaceMembersSnapshot | null;
}): readonly SpaceComposerAddressingTarget[] {
	if (!input.snapshot) {
		return [];
	}

	const catalog = createSpaceTargetCatalog(input.snapshot);
	const targetByProfileId = new Map<string, SpaceComposerAddressingTarget>();
	for (const mention of input.mentions) {
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

function isMentionAuthoringPrefixOwnedByAuthoredMention(input: {
	mentions: readonly TrackedComposerAuthoredMention[];
	prefixRange: { end: number; start: number };
}): boolean {
	return input.mentions.some(
		(mention) =>
			input.prefixRange.start === mention.start &&
			input.prefixRange.end >= mention.start
	);
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

function reconcileDismissedMentionStarts(input: {
	starts: readonly number[];
	nextText: string;
	previousText: string;
}): number[] {
	const edit = resolveSingleTextEdit({
		nextText: input.nextText,
		previousText: input.previousText,
	});

	return input.starts
		.map((start): number | null => {
			if (start < edit.previousStart) {
				return start;
			}

			if (start >= edit.previousEnd) {
				return start + edit.delta;
			}

			return null;
		})
		.filter(
			(start): start is number =>
				start !== null && input.nextText[start] === "@"
		);
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

function clampHighlightedIndex(input: {
	fallbackIndex: number;
	highlightedIndex: number;
	itemCount: number;
}) {
	if (input.itemCount <= 0) {
		return -1;
	}

	if (input.highlightedIndex >= 0 && input.highlightedIndex < input.itemCount) {
		return input.highlightedIndex;
	}

	return Math.min(Math.max(input.fallbackIndex, 0), input.itemCount - 1);
}

function moveHighlightedIndex(input: {
	direction: -1 | 1;
	highlightedIndex: number;
	itemCount: number;
}) {
	if (input.itemCount <= 0) {
		return -1;
	}

	if (input.highlightedIndex < 0 || input.highlightedIndex >= input.itemCount) {
		return input.direction === 1 ? 0 : input.itemCount - 1;
	}

	return (
		(input.highlightedIndex + input.direction + input.itemCount) %
		input.itemCount
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

function getSelectedProfileIdFromMentionPickerState(
	state: MentionPickerState
): string | null {
	if (isTargetPickerState(state)) {
		return state.selectedProfileId;
	}

	return null;
}

function handleMentionPickerKeyboardInput(input: {
	event: KeyboardEvent<HTMLTextAreaElement>;
	highlightedIndex: number;
	mentionPopoverState: SpaceMentionPopoverState;
	onClose: () => void;
	onMoveHighlight: Dispatch<SetStateAction<number>>;
	onSelectItem: (index: number) => void;
}): boolean {
	if (input.mentionPopoverState.kind !== "target_picker") {
		return false;
	}

	const openMentionPopoverState = input.mentionPopoverState;

	if (input.event.key === "ArrowDown" || input.event.key === "ArrowUp") {
		input.event.preventDefault();
		input.onMoveHighlight((current) =>
			moveHighlightedIndex({
				direction: input.event.key === "ArrowDown" ? 1 : -1,
				highlightedIndex:
					current >= 0 ? current : openMentionPopoverState.highlightedIndex,
				itemCount: openMentionPopoverState.items.length,
			})
		);
		return true;
	}

	if (input.event.key === "Enter") {
		input.event.preventDefault();
		input.onSelectItem(input.highlightedIndex);
		return true;
	}

	if (input.event.key === "Escape") {
		input.event.preventDefault();
		input.onClose();
		return true;
	}

	return false;
}

function shouldSendFromComposerKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>
): boolean {
	return (event.metaKey || event.ctrlKey) && event.key === "Enter";
}
