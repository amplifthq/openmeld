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
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import {
	type SpaceMemberDirectoryDisplay,
	spaceMemberDirectoryDisplayQueryOptions,
} from "#/query/spaces/member-directory-display";
import { createSpaceComposerDeviceWait } from "./space-composer-device-wait";
import type {
	SpaceComposerEditorChange,
	SpaceComposerInputRef,
} from "./space-composer-editor";
import { SPACE_MEMBERS_LOAD_ERROR_MESSAGE } from "./space-members-error-copy";

const AUTHORED_MENTION_CONTINUATION_PATTERN = /[('’A-Za-z0-9_-]/u;

export type SpaceComposerSelection = {
	end: number;
	start: number;
};

export type SpaceMentionPickerItem = {
	agentMember?: SpaceMembersSnapshot["agents"][number];
	memberEntry: SpaceMemberDirectoryEntry;
	kind: "target";
	suggestion: SpaceMentionSuggestion;
};

export type SpaceReplyToSignalInput = {
	signalId: string;
	wakeTargetProfileId?: string | null;
};

export type SpaceComposerAddressingTarget = {
	agentWakeAvailability?: import("@openmeld/schemas/types").SpaceMemberAgentSnapshot["agentWakeAvailability"];
	deviceWaitTarget?: import("@openmeld/schemas/types").WakeDeviceWaitTarget;
	runtimeDeviceDisplayName?: string | null;
	allowedRelations: SpaceSendTargetAllowedRelations;
	primaryMentionLabel: string;
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

export type UseSpaceMentionAuthoringInput = {
	threadWakeContinuationProfileId?: string | null;
	composerDraftMigrationScopes?: readonly ComposerDraftScope[];
	composerDraftScope: ComposerDraftScope | null;
	openMeldProfileId: string;
	initialComposerDraft?: ComposerDraftRecord | null;
	isMembersLoading: boolean;
	membersErrorMessage: string | null;
	spaceId: string;
	snapshot: SpaceMembersSnapshot | null;
};

export function useSpaceMentionAuthoring(input: UseSpaceMentionAuthoringInput) {
	const textareaRef: SpaceComposerInputRef = useRef(null);
	const pendingSelectionRef = useRef<SpaceComposerSelection | null>(null);
	const composerDraft = useComposerDraft({
		initialDraft: input.initialComposerDraft,
		migrateFromScopes: input.composerDraftMigrationScopes,
		scope: input.composerDraftScope,
	});
	const composerText = composerDraft.content.text;
	const authoredMentions = composerDraft.content.authoredMentions;
	useEffect(() => {
		if (
			input.composerDraftScope?.kind !== "space_thread" ||
			input.threadWakeContinuationProfileId === undefined
		) {
			return;
		}
		const previousId = composerDraft.content.threadWakeContinuationProfileId;
		const previousMention = authoredMentions.find(
			(mention) => mention.profileId === previousId
		);
		if (
			previousId === null ||
			(composerText.trim() && composerText.trim() !== previousMention?.text)
		) {
			return;
		}
		if (previousId === input.threadWakeContinuationProfileId) {
			return;
		}
		if (input.threadWakeContinuationProfileId === null) {
			if (previousId) {
				composerDraft.setContent((draft) => ({
					...draft,
					text: "",
					authoredMentions: [],
					threadWakeContinuationProfileId: undefined,
				}));
			}
			return;
		}
		const mention = resolveReplyWakeMention({
			allowUnavailable: true,
			snapshot: input.snapshot,
			wakeTargetProfileId: input.threadWakeContinuationProfileId,
		});
		if (!mention) {
			return;
		}
		const text = `${mention.text} `;
		composerDraft.setContent((draft) => ({
			...draft,
			text,
			authoredMentions: trackAuthoredMentionsInText({
				mentions: [mention],
				text,
			}),
			threadWakeContinuationProfileId: input.threadWakeContinuationProfileId,
		}));
	}, [
		input.composerDraftScope?.kind,
		input.threadWakeContinuationProfileId,
		input.snapshot,
		composerDraft.content.threadWakeContinuationProfileId,
		composerDraft.setContent,
		composerText,
		authoredMentions,
	]);
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
	const queryClient = useQueryClient();
	const directoryOptions = useMemo(
		() =>
			spaceMemberDirectoryDisplayQueryOptions(
				input.spaceId,
				input.openMeldProfileId
			),
		[input.spaceId, input.openMeldProfileId]
	);
	const directoryQuery = useQuery(directoryOptions);
	const freshMentionPickerItems = useMemo(
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
		if (!input.snapshot) {
			return;
		}
		queryClient.setQueryData(directoryOptions.queryKey, {
			version: 1,
			members: freshMentionPickerItems.map(({ suggestion, memberEntry }) => ({
				profileId: suggestion.profileId,
				profileName: suggestion.profileName,
				profileKind: suggestion.profileKind,
				primaryMentionLabel: suggestion.primaryMentionLabel,
				avatarUrl: memberEntry.avatarUrl,
				agentControllerRef: memberEntry.agentControllerRef,
			})),
		});
	}, [
		input.snapshot,
		freshMentionPickerItems,
		queryClient,
		directoryOptions.queryKey,
	]);
	const mentionPickerItems = useMemo(
		() =>
			input.snapshot
				? freshMentionPickerItems
				: (directoryQuery.data?.members ?? []).map(toCachedMentionPickerItem),
		[input.snapshot, freshMentionPickerItems, directoryQuery.data]
	);
	const addressingTargets = useMemo(() => {
		if (input.snapshot) {
			return buildSpaceComposerAddressingTargets({
				mentions: addressingMentions,
				snapshot: input.snapshot,
			});
		}
		return authoredMentions.flatMap((mention) => {
			const item = mentionPickerItems.find(
				(candidate) => candidate.suggestion.profileId === mention.profileId
			);
			return item ? [{ ...item.suggestion, relation: mention.relation }] : [];
		});
	}, [
		input.snapshot,
		addressingMentions,
		authoredMentions,
		mentionPickerItems,
	]);

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

	// biome-ignore lint/correctness/useExhaustiveDependencies: Changing conversation identity must discard a pending selection from the previous editor even though the key is not rendered.
	useEffect(() => {
		pendingSelectionRef.current = null;
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
		composerInput.selectTextRange(pendingSelection);
	});

	return {
		addressingTargets,
		authoredMentions,
		hasAuthoredMentions: authoredMentions.length > 0,
		composerText,
		mentionPickerItems,
		replyTo,
		onComposerEditorChange: (change: SpaceComposerEditorChange) => {
			composerDraft.setContent((currentDraft) => {
				const automaticId = currentDraft.threadWakeContinuationProfileId;
				const automaticMention = change.authoredMentions.find(
					(mention) =>
						mention.profileId === automaticId && mention.relation === "wake"
				);
				const explicitWake = change.authoredMentions.some(
					(mention) =>
						mention.relation === "wake" && mention.profileId !== automaticId
				);
				const text =
					automaticMention && explicitWake
						? change.text.slice(0, automaticMention.start) +
							change.text.slice(automaticMention.end)
						: change.text;
				const mentions =
					automaticMention && explicitWake
						? trackAuthoredMentionsInText({
								mentions: change.authoredMentions.filter(
									(mention) => mention !== automaticMention
								),
								text,
							})
						: change.authoredMentions;
				return {
					...currentDraft,
					authoredMentions: mentions,
					...(input.composerDraftScope?.kind === "space_thread"
						? {
								threadWakeContinuationProfileId:
									automaticMention && !explicitWake ? automaticId : null,
							}
						: {}),
					restoredFromSignalId:
						change.restoredFromSignalId ??
						(change.text.trim()
							? currentDraft.restoredFromSignalId
							: undefined),
					text,
				};
			});
		},
		onMentionButtonClick: () => {
			textareaRef.current?.insertMentionTrigger();
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
			pendingSelectionRef.current = {
				end: nextText.length,
				start: nextText.length,
			};
		},
		composeExpiredDeviceWait: (request: {
			sourceSignalId: string;
			targetProfileId: string;
		}) => {
			if (currentComposerHasDraftRef.current) {
				throw new Error(
					"Send or clear your current draft before starting this task again."
				);
			}
			const target = input.snapshot
				? createSpaceTargetCatalog(input.snapshot).byProfileId.get(
						request.targetProfileId
					)
				: undefined;
			if (target?.profileKind !== "agent") {
				throw new Error(
					"This Agent is no longer available in the Space. Choose an Agent to send a new task."
				);
			}
			const mention: SpaceComposerAuthoredMentionInTextOrder = {
				profileId: target.profileId,
				relation: "wake",
				text: `@${target.profileName}`,
			};
			const text = `${mention.text} Please carry out the request in the referenced message.`;
			composerDraft.setContent({
				authoredMentions: trackAuthoredMentionsInText({
					mentions: [mention],
					text,
				}),
				replyToSignalId: request.sourceSignalId,
				text,
			});
			currentComposerHasDraftRef.current = true;
			pendingSelectionRef.current = { start: text.length, end: text.length };
			textareaRef.current?.focus();
		},
		prepareSubmission: (
			missingSnapshotMessage: string
		): PreparedSpaceComposerSubmission & { restoredFromSignalId?: string } => ({
			...(composerDraft.content.threadWakeContinuationProfileId
				? { threadWakeContinuation: true as const }
				: {}),
			restoredFromSignalId: composerDraft.content.restoredFromSignalId,
			...prepareSpaceComposerSubmission({
				authoredMentionsInTextOrder: authoredMentions.map(
					toAuthoredMentionInput
				),
				missingSnapshotMessage,
				replyTo,
				snapshot: input.snapshot,
				text: composerText,
			}),
		}),
		prepareFileOnlySubmission: (): PreparedSpaceComposerSubmission & {
			restoredFromSignalId?: string;
		} => ({
			restoredFromSignalId: composerDraft.content.restoredFromSignalId,
			...prepareSpaceFileOnlySubmission({ replyTo }),
		}),
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
			currentComposerHasDraftRef.current = false;
			resetComposerState();
		},
		restoreFailedSubmission: (
			preparedSubmission: PreparedSpaceComposerSubmission & {
				restoredFromSignalId?: string;
			}
		) => {
			if (currentComposerHasDraftRef.current) {
				return false;
			}
			currentComposerHasDraftRef.current = true;
			const nextCaretPosition = preparedSubmission.text.length;
			composerDraft.setContent({
				threadWakeContinuationProfileId:
					preparedSubmission.threadWakeContinuation
						? preparedSubmission.messageEnvelope?.activationTargets[0]
						: undefined,
				restoredFromSignalId: preparedSubmission.restoredFromSignalId,
				authoredMentions: trackAuthoredMentionsInText({
					mentions: preparedSubmission.authoredMentionsInTextOrder,
					text: preparedSubmission.text,
				}),
				replyToSignalId: preparedSubmission.replyTo?.signalId ?? null,
				text: preparedSubmission.text,
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
						mentionsInTextOrder: preparedSubmission.mentionsInTextOrder,
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
		mentionEmptyMessage: resolveMentionEmptyMessage(input),
		textareaRef,
	};

	function resetComposerState() {
		composerDraft.setContent(EMPTY_COMPOSER_DRAFT_CONTENT);
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
					agentMember: input.snapshot.agents.find(
						(agent) => agent.profileId === suggestion.profileId
					),
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
	suggestion: SpaceMentionSuggestion,
	agentMember?: SpaceMentionPickerItem["agentMember"]
): MessageMentionType | null {
	if (suggestion.profileKind === "agent") {
		if (
			suggestion.allowedRelations.wake &&
			(suggestion.wakeAvailability.status === "ready" ||
				Boolean(agentMember && createSpaceComposerDeviceWait(agentMember)) ||
				suggestion.wakeAvailability.status === "preparing" ||
				suggestion.wakeAvailability.reasonCodes.length === 0)
		) {
			return "wake";
		}
		if (suggestion.allowedRelations.reference) {
			return "reference";
		}
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
		const member = input.snapshot.agents.find(
			(candidate) => candidate.profileId === target.profileId
		);
		targetByProfileId.set(mention.profileId, {
			agentWakeAvailability: member?.agentWakeAvailability,
			deviceWaitTarget: member?.deviceWaitTarget,
			runtimeDeviceDisplayName: target.runtimeDeviceDisplayName,
			allowedRelations: target.allowedRelations,
			primaryMentionLabel: target.primaryMentionLabel,
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
	allowUnavailable?: boolean;
	snapshot: SpaceMembersSnapshot | null;
	wakeTargetProfileId: string | null;
}): SpaceComposerAuthoredMentionInTextOrder | null {
	if (!(input.snapshot && input.wakeTargetProfileId)) {
		return null;
	}

	const target = createSpaceTargetCatalog(input.snapshot).byProfileId.get(
		input.wakeTargetProfileId
	);
	if (
		target?.profileKind !== "agent" ||
		!(input.allowUnavailable || target.allowedRelations.wake)
	) {
		return null;
	}

	return {
		profileId: target.profileId,
		relation: "wake",
		text: `@${target.profileName}`,
	};
}

function toCachedMentionPickerItem(
	member: SpaceMemberDirectoryDisplay["members"][number]
): SpaceMentionPickerItem {
	const agent = member.profileKind === "agent";
	return {
		kind: "target",
		suggestion: {
			...member,
			allowedRelations: { mention: !agent, reference: agent, wake: agent },
			controllerDisplay: null,
			description: "Checking current membership…",
			exactMentionLabels: [member.primaryMentionLabel],
			labelSource: "profile_name",
			liveNow: false,
			ownerDisplay: null,
			wakeAvailability: {
				status: "blocked",
				reasonCodes: [],
				reasonText: "Checking whether this agent can reply.",
			},
		},
		memberEntry: {
			...member,
			id: member.profileId,
			mentionLabel: member.primaryMentionLabel,
			searchText: member.profileName,
			addedByDisplayName: null,
			addedByProfileId: null,
			agentControllerConversationId: null,
			agentControllerPermissionMode: null,
			controllerDisplayName: null,
			availabilityAction: null,
			availabilityBadgeLabel: null,
			availabilityCategory: null,
			availabilityIsRefreshing: agent,
			availabilityPhase: null,
			availabilityReasonCode: null,
			availabilitySummary: null,
			availabilityTooltip: null,
			lastSeenLabel: null,
			liveNow: false,
			manualParticipationOnly: false,
			modelSelection: null,
			ownerDisplay: null,
			ownerName: null,
			ownerUserId: null,
			presenceLabel: null,
			presenceStatus: null,
			runtimeDeviceDisplayName: null,
			workingDirectory: null,
		},
	};
}

function resolveMentionEmptyMessage(input: UseSpaceMentionAuthoringInput) {
	if (input.snapshot) {
		return "No matching members";
	}
	if (input.membersErrorMessage) {
		return "Couldn’t load members. Try again shortly.";
	}
	return "Loading members…";
}
