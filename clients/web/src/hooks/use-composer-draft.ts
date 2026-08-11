import type { SetStateAction } from "react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	buildComposerDraftStorageKey,
	type ComposerDraftContent,
	type ComposerDraftRecord,
	type ComposerDraftScope,
	createComposerDraftRecord,
	EMPTY_COMPOSER_DRAFT_CONTENT,
	readComposerDraft,
	removeComposerDraft,
	writeComposerDraft,
} from "#/lib/composer-draft-storage";

type ComposerDraftState = {
	draft: ComposerDraftRecord;
	restorationIdentity: string;
	storageKey: string | null;
};

type ComposerDraftInputSnapshot = {
	initialDraft: ComposerDraftRecord | null;
	migrateFromScopes?: readonly ComposerDraftScope[];
	scope: ComposerDraftScope | null;
};

export function useComposerDraft(input: {
	initialDraft?: ComposerDraftRecord | null;
	migrateFromScopes?: readonly ComposerDraftScope[];
	scope: ComposerDraftScope | null;
}) {
	const storageKey = input.scope
		? buildComposerDraftStorageKey(input.scope)
		: null;
	const initialDraft = input.initialDraft ?? null;
	const initialUpdatedAtMs = initialDraft?.updatedAtMs ?? -1;
	const migrationStorageKeys = (input.migrateFromScopes ?? []).map(
		buildComposerDraftStorageKey
	);
	const restorationIdentity = JSON.stringify([
		initialUpdatedAtMs,
		migrationStorageKeys,
		storageKey,
	]);
	const [state, setState] = useState<ComposerDraftState>(() => ({
		draft:
			initialDraft ??
			createComposerDraftRecord(EMPTY_COMPOSER_DRAFT_CONTENT, 0),
		restorationIdentity,
		storageKey,
	}));
	const latestInputRef = useRef({
		initialDraft,
		migrateFromScopes: input.migrateFromScopes,
		scope: input.scope,
	});

	useLayoutEffect(() => {
		latestInputRef.current = {
			initialDraft,
			migrateFromScopes: input.migrateFromScopes,
			scope: input.scope,
		};
	}, [initialDraft, input.migrateFromScopes, input.scope]);

	useLayoutEffect(() => {
		setState((current) =>
			restoreComposerDraftState({
				current,
				input: latestInputRef.current,
				restorationIdentity,
				storageKey,
			})
		);
	}, [restorationIdentity, storageKey]);

	const setDraft = useCallback(
		(update: SetStateAction<ComposerDraftContent>) => {
			setState((current) => {
				const updatesCurrentScope = current.storageKey === storageKey;
				let boundDraft = current.draft;
				if (!updatesCurrentScope) {
					boundDraft = input.scope
						? (readComposerDraft(input.scope) ??
							createComposerDraftRecord(EMPTY_COMPOSER_DRAFT_CONTENT, 0))
						: createComposerDraftRecord(EMPTY_COMPOSER_DRAFT_CONTENT, 0);
				}
				const currentContent = toComposerDraftContent(boundDraft);
				const nextContent =
					typeof update === "function" ? update(currentContent) : update;
				const nextRecord = createComposerDraftRecord(
					nextContent,
					Math.max(Date.now(), boundDraft.updatedAtMs + 1)
				);
				if (input.scope) {
					writeComposerDraft(input.scope, nextRecord);
				}
				if (!updatesCurrentScope) {
					return current;
				}
				return { draft: nextRecord, restorationIdentity, storageKey };
			});
		},
		[input.scope, restorationIdentity, storageKey]
	);

	const content = useMemo(
		() => toComposerDraftContent(state.draft),
		[state.draft]
	);

	return {
		content,
		record: state.draft,
		setContent: setDraft,
		storageKey,
	};
}

function restoreComposerDraftState(input: {
	current: ComposerDraftState;
	input: ComposerDraftInputSnapshot;
	restorationIdentity: string;
	storageKey: string | null;
}): ComposerDraftState {
	const storedDraft = input.input.scope
		? readComposerDraft(input.input.scope)
		: null;
	const migrationDrafts = (input.input.migrateFromScopes ?? [])
		.map(readComposerDraft)
		.filter((draft): draft is ComposerDraftRecord => draft !== null);
	const nextDraft = selectNewestComposerDraft({
		initialDraft: input.input.initialDraft,
		provisionalDraft:
			input.current.storageKey === null && input.storageKey !== null
				? input.current.draft
				: null,
		storedDrafts: [storedDraft, ...migrationDrafts],
	});
	if (
		persistCanonicalComposerDraft(input.input.scope, storedDraft, nextDraft)
	) {
		for (const migrationScope of input.input.migrateFromScopes ?? []) {
			removeComposerDraft(migrationScope);
		}
	}
	if (
		input.current.restorationIdentity === input.restorationIdentity &&
		input.current.storageKey === input.storageKey &&
		areComposerDraftRecordsEqual(input.current.draft, nextDraft)
	) {
		return input.current;
	}
	return {
		draft: nextDraft,
		restorationIdentity: input.restorationIdentity,
		storageKey: input.storageKey,
	};
}

function persistCanonicalComposerDraft(
	scope: ComposerDraftScope | null,
	storedDraft: ComposerDraftRecord | null,
	nextDraft: ComposerDraftRecord
): boolean {
	if (scope === null) {
		return false;
	}
	return (
		(storedDraft !== null &&
			areComposerDraftRecordsEqual(storedDraft, nextDraft)) ||
		writeComposerDraft(scope, nextDraft)
	);
}

function selectNewestComposerDraft(input: {
	initialDraft: ComposerDraftRecord | null;
	provisionalDraft: ComposerDraftRecord | null;
	storedDrafts: readonly (ComposerDraftRecord | null)[];
}): ComposerDraftRecord {
	let newestDraft = selectNewerComposerDraft(
		input.initialDraft,
		input.provisionalDraft
	);
	for (const storedDraft of input.storedDrafts) {
		if (
			storedDraft &&
			storedDraft.updatedAtMs > (newestDraft?.updatedAtMs ?? -1)
		) {
			newestDraft = storedDraft;
		}
	}
	return (
		newestDraft ?? createComposerDraftRecord(EMPTY_COMPOSER_DRAFT_CONTENT, 0)
	);
}

function selectNewerComposerDraft(
	left: ComposerDraftRecord | null,
	right: ComposerDraftRecord | null
): ComposerDraftRecord | null {
	if (!left) {
		return right;
	}
	if (!right) {
		return left;
	}
	return right.updatedAtMs > left.updatedAtMs ? right : left;
}

function toComposerDraftContent(
	record: ComposerDraftRecord
): ComposerDraftContent {
	return {
		authoredMentions: record.authoredMentions,
		replyToSignalId: record.replyToSignalId,
		text: record.text,
	};
}

function areComposerDraftRecordsEqual(
	left: ComposerDraftRecord,
	right: ComposerDraftRecord
): boolean {
	return (
		left.updatedAtMs === right.updatedAtMs &&
		left.text === right.text &&
		left.replyToSignalId === right.replyToSignalId &&
		left.authoredMentions.length === right.authoredMentions.length &&
		left.authoredMentions.every((mention, index) => {
			const other = right.authoredMentions[index];
			return (
				other !== undefined &&
				mention.end === other.end &&
				mention.profileId === other.profileId &&
				mention.relation === other.relation &&
				mention.start === other.start &&
				mention.text === other.text
			);
		})
	);
}
