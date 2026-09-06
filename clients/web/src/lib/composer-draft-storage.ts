import type { MessageMentionType } from "@openmeld/schemas/types";

const COMPOSER_DRAFT_STORAGE_KEY_PREFIX = "openmeld.composer-draft:";
const LEGACY_COMPOSER_DRAFT_STORAGE_KEY_PREFIX = `${COMPOSER_DRAFT_STORAGE_KEY_PREFIX}v1:`;
const COMPOSER_DRAFT_STORAGE_KEY_PREFIX_V2 = `${COMPOSER_DRAFT_STORAGE_KEY_PREFIX}v2:`;
const LEGACY_COMPOSER_DRAFT_VERSION = 1 as const;
const COMPOSER_DRAFT_VERSION = 2 as const;
const MESSAGE_MENTION_TYPES = new Set<MessageMentionType>([
	"mention",
	"reference",
	"wake",
]);

export type ComposerDraftAuthoredMention = {
	end: number;
	profileId: string;
	relation: MessageMentionType;
	start: number;
	text: string;
};

export type ComposerDraftContent = {
	authoredMentions: readonly ComposerDraftAuthoredMention[];
	replyToSignalId: string | null;
	text: string;
};

export type ComposerDraftRecord = ComposerDraftContent & {
	updatedAtMs: number;
	version: typeof COMPOSER_DRAFT_VERSION;
};

type StoredComposerDraftRecord =
	| ComposerDraftRecord
	| (ComposerDraftContent & {
			updatedAtMs: number;
			version: typeof LEGACY_COMPOSER_DRAFT_VERSION;
	  });

export type ComposerDraftScope =
	| {
			kind: "center_agent_pending";
			sessionId?: string;
			organizationId: string;
			ownerAccountId: string;
	  }
	| {
			kind: "center_agent_task";
			organizationId: string;
			ownerAccountId: string;
			taskId: string;
	  }
	| {
			kind: "space";
			ownerAccountId: string;
			profileId: string;
			spaceId: string;
	  }
	| {
			kind: "space_thread";
			ownerAccountId: string;
			profileId: string;
			spaceId: string;
			threadId: string;
	  };

export const EMPTY_COMPOSER_DRAFT_CONTENT: ComposerDraftContent = {
	authoredMentions: [],
	replyToSignalId: null,
	text: "",
};

export function createComposerDraftRecord(
	content: ComposerDraftContent,
	updatedAtMs = Date.now()
): ComposerDraftRecord {
	return {
		authoredMentions: [...content.authoredMentions],
		replyToSignalId: content.replyToSignalId,
		text: content.text,
		updatedAtMs,
		version: COMPOSER_DRAFT_VERSION,
	};
}

export function buildComposerDraftStorageKey(
	scope: ComposerDraftScope
): string {
	return buildComposerDraftStorageKeyWithPrefix(
		scope,
		COMPOSER_DRAFT_STORAGE_KEY_PREFIX_V2
	);
}

function buildLegacyComposerDraftStorageKey(scope: ComposerDraftScope): string {
	return buildComposerDraftStorageKeyWithPrefix(
		scope,
		LEGACY_COMPOSER_DRAFT_STORAGE_KEY_PREFIX
	);
}

function buildComposerDraftStorageKeyWithPrefix(
	scope: ComposerDraftScope,
	prefix: string
): string {
	const identity = (() => {
		switch (scope.kind) {
			case "center_agent_pending":
				return [
					scope.kind,
					normalizeScopePart(scope.ownerAccountId, "owner account id"),
					normalizeScopePart(scope.organizationId, "organization id"),
					...(scope.sessionId === undefined
						? []
						: ["session", normalizeScopePart(scope.sessionId, "session id")]),
				] as const;
			case "center_agent_task":
				return [
					scope.kind,
					normalizeScopePart(scope.ownerAccountId, "owner account id"),
					normalizeScopePart(scope.organizationId, "organization id"),
					normalizeScopePart(scope.taskId, "task id"),
				] as const;
			case "space":
				return [
					scope.kind,
					normalizeScopePart(scope.ownerAccountId, "owner account id"),
					normalizeScopePart(scope.profileId, "profile id"),
					normalizeScopePart(scope.spaceId, "space id"),
				] as const;
			case "space_thread":
				return [
					scope.kind,
					normalizeScopePart(scope.ownerAccountId, "owner account id"),
					normalizeScopePart(scope.profileId, "profile id"),
					normalizeScopePart(scope.spaceId, "space id"),
					normalizeScopePart(scope.threadId, "thread id"),
				] as const;
			default: {
				const unsupportedScope: never = scope;
				throw new Error(
					`Unsupported Composer draft scope: ${JSON.stringify(unsupportedScope)}`
				);
			}
		}
	})();

	return `${prefix}${JSON.stringify(identity)}`;
}

export function readComposerDraft(
	scope: ComposerDraftScope
): ComposerDraftRecord | null {
	if (typeof window === "undefined") {
		return null;
	}

	const currentDraft = readStoredComposerDraft(
		buildComposerDraftStorageKey(scope),
		COMPOSER_DRAFT_VERSION
	);
	const legacyDraft = readStoredComposerDraft(
		buildLegacyComposerDraftStorageKey(scope),
		LEGACY_COMPOSER_DRAFT_VERSION
	);
	const newestDraft =
		legacyDraft &&
		(!currentDraft || legacyDraft.updatedAtMs > currentDraft.updatedAtMs)
			? legacyDraft
			: currentDraft;
	if (!newestDraft) {
		return null;
	}
	if (newestDraft.version === COMPOSER_DRAFT_VERSION) {
		return newestDraft;
	}

	const migratedDraft = createComposerDraftRecord(
		newestDraft,
		newestDraft.updatedAtMs
	);
	writeComposerDraft(scope, migratedDraft);
	return migratedDraft;
}

export function writeComposerDraft(
	scope: ComposerDraftScope,
	record: ComposerDraftRecord
): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	if (isComposerDraftEmpty(record)) {
		return removeComposerDraft(scope);
	}

	const storageKey = buildComposerDraftStorageKey(scope);
	try {
		window.localStorage.setItem(storageKey, JSON.stringify(record));
		return true;
	} catch (error) {
		reportComposerDraftStorageFailure({
			error,
			operation: "write",
			storageKey,
		});
		return false;
	}
}

export function removeComposerDraft(scope: ComposerDraftScope): boolean {
	if (typeof window === "undefined") {
		return false;
	}

	const removalResults = [
		buildComposerDraftStorageKey(scope),
		buildLegacyComposerDraftStorageKey(scope),
	].map(removeComposerDraftStorageKey);
	return removalResults.every(Boolean);
}

export function clearAllComposerDrafts(): void {
	if (typeof window === "undefined") {
		return;
	}

	try {
		const draftKeys: string[] = [];
		for (let index = 0; index < window.localStorage.length; index += 1) {
			const storageKey = window.localStorage.key(index);
			if (storageKey?.startsWith(COMPOSER_DRAFT_STORAGE_KEY_PREFIX)) {
				draftKeys.push(storageKey);
			}
		}
		for (const storageKey of draftKeys) {
			window.localStorage.removeItem(storageKey);
		}
	} catch (error) {
		reportComposerDraftStorageFailure({
			error,
			operation: "clear",
			storageKey: COMPOSER_DRAFT_STORAGE_KEY_PREFIX,
		});
	}
}

export function isComposerDraftEmpty(draft: ComposerDraftContent): boolean {
	return (
		draft.text.length === 0 &&
		draft.authoredMentions.length === 0 &&
		draft.replyToSignalId === null
	);
}

function readStoredComposerDraft(
	storageKey: string,
	expectedVersion: StoredComposerDraftRecord["version"]
): StoredComposerDraftRecord | null {
	let rawValue: string | null;
	try {
		rawValue = window.localStorage.getItem(storageKey);
	} catch (error) {
		reportComposerDraftStorageFailure({ error, operation: "read", storageKey });
		return null;
	}
	if (rawValue === null) {
		return null;
	}

	try {
		const record = parseComposerDraftRecord(
			JSON.parse(rawValue) as unknown,
			expectedVersion
		);
		if (record === null) {
			console.warn("Ignoring invalid Composer draft storage entry.", {
				storageKey,
			});
			removeComposerDraftStorageKey(storageKey);
		}
		return record;
	} catch (error) {
		console.warn("Ignoring invalid Composer draft storage entry.", {
			errorName: resolveErrorName(error),
			storageKey,
		});
		removeComposerDraftStorageKey(storageKey);
		return null;
	}
}

function parseComposerDraftRecord(
	value: unknown,
	expectedVersion: StoredComposerDraftRecord["version"]
): StoredComposerDraftRecord | null {
	if (typeof value !== "object" || value === null) {
		return null;
	}
	const record = value as Partial<StoredComposerDraftRecord>;
	if (
		record.version !== expectedVersion ||
		typeof record.text !== "string" ||
		!Number.isSafeInteger(record.updatedAtMs) ||
		(record.updatedAtMs ?? -1) < 0 ||
		!(
			record.replyToSignalId === null ||
			typeof record.replyToSignalId === "string"
		) ||
		!Array.isArray(record.authoredMentions)
	) {
		return null;
	}
	if (
		typeof record.replyToSignalId === "string" &&
		record.replyToSignalId.trim().length === 0
	) {
		return null;
	}

	const authoredMentions = record.authoredMentions.filter(
		(mention): mention is ComposerDraftAuthoredMention =>
			isComposerDraftAuthoredMention(mention, record.text ?? "")
	);
	if (authoredMentions.length !== record.authoredMentions.length) {
		return null;
	}
	return {
		authoredMentions,
		replyToSignalId: record.replyToSignalId ?? null,
		text: record.text,
		updatedAtMs: record.updatedAtMs as number,
		version: expectedVersion,
	};
}

function isComposerDraftAuthoredMention(
	value: unknown,
	text: string
): value is ComposerDraftAuthoredMention {
	if (typeof value !== "object" || value === null) {
		return false;
	}
	const mention = value as Partial<ComposerDraftAuthoredMention>;
	return (
		typeof mention.profileId === "string" &&
		mention.profileId.trim().length > 0 &&
		typeof mention.text === "string" &&
		mention.text.length > 0 &&
		typeof mention.relation === "string" &&
		MESSAGE_MENTION_TYPES.has(mention.relation as MessageMentionType) &&
		Number.isSafeInteger(mention.start) &&
		Number.isSafeInteger(mention.end) &&
		(mention.start ?? -1) >= 0 &&
		(mention.end ?? 0) > (mention.start ?? -1) &&
		text.slice(mention.start, mention.end) === mention.text
	);
}

function normalizeScopePart(value: string, label: string): string {
	const normalized = value.trim();
	if (!normalized) {
		throw new Error(`Composer draft ${label} must not be empty.`);
	}
	return normalized;
}

function removeComposerDraftStorageKey(storageKey: string): boolean {
	try {
		window.localStorage.removeItem(storageKey);
		return true;
	} catch (error) {
		reportComposerDraftStorageFailure({
			error,
			operation: "remove",
			storageKey,
		});
		return false;
	}
}

function reportComposerDraftStorageFailure(input: {
	error: unknown;
	operation: "clear" | "read" | "remove" | "write";
	storageKey: string;
}): void {
	console.warn("Composer draft storage is unavailable in this browser.", {
		errorName: resolveErrorName(input.error),
		event: "web.openmeld.composer_draft.storage_failed",
		operation: input.operation,
		storageKey: input.storageKey,
	});
}

function resolveErrorName(error: unknown): string {
	if (error instanceof Error && error.name.trim()) {
		return error.name;
	}
	return "UnknownError";
}
