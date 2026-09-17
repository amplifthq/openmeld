import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { hasClientRestartBlocker } from "#/client-version-recovery";
import {
	readComposerFileDraftCleanup,
	readComposerFileDrafts,
	readComposerFileDraftsByIds,
	removeComposerFileDraft,
	retryComposerFileDraftCleanup,
	saveComposerFileDraft,
	saveComposerFileDraftUpload,
} from "./composer-file-drafts";

it("recovers every draft operation after the cached database handle closes", async () => {
	let capturedDatabase: IDBDatabase | undefined;
	const originalOpen = IDBFactory.prototype.open;
	const open = vi.spyOn(IDBFactory.prototype, "open");
	open.mockImplementationOnce(function openAndCapture(
		this: IDBFactory,
		...args: Parameters<IDBFactory["open"]>
	) {
		const request = originalOpen.call(this, ...args);
		request.addEventListener("success", () => {
			capturedDatabase = request.result;
		});
		return request;
	});
	const first = {
		id: "closed-handle-first",
		scope: "closed-handle-scope",
		file: new File(["first"], "first.txt"),
		publishMutationId: "publish-first",
	};
	await saveComposerFileDraft(first);
	expect(capturedDatabase).toBeDefined();
	capturedDatabase?.close();

	const second = {
		id: "closed-handle-second",
		scope: first.scope,
		file: new File(["second"], "second.txt"),
		publishMutationId: "publish-second",
	};
	await saveComposerFileDraft(second);
	await saveComposerFileDraftUpload(second.id, {
		id: "upload-second",
		name: second.file.name,
		mimeType: "text/plain",
		sizeBytes: second.file.size,
		expiresAt: "2099-09-10T00:00:00.000Z",
	});
	expect(await readComposerFileDrafts(first.scope)).toMatchObject([
		{ id: first.id },
		{ id: second.id, upload: { id: "upload-second" } },
	]);
	expect(await readComposerFileDraftsByIds([second.id])).toMatchObject([
		{ id: second.id },
	]);
	await removeComposerFileDraft(first.id);
	await removeComposerFileDraft(second.id);
	expect(await readComposerFileDrafts(first.scope)).toEqual([]);
	expect(open).toHaveBeenCalledTimes(2);
	open.mockRestore();
});

it("blocks restart until attachment data is durable, including after a failed transaction", async () => {
	const input = {
		id: "restart-file",
		scope: "restart-scope",
		file: new File(["draft"], "draft.txt"),
		publishMutationId: "publish-file",
	};
	const write = saveComposerFileDraft(input);
	expect(hasClientRestartBlocker()).toBe(true);
	await write;
	expect(hasClientRestartBlocker()).toBe(false);
	expect(await readComposerFileDrafts(input.scope)).toMatchObject([
		{ id: input.id, publishMutationId: input.publishMutationId },
	]);
	const failure = vi
		.spyOn(IDBDatabase.prototype, "transaction")
		.mockImplementationOnce(() => {
			throw new Error("Disk unavailable");
		});
	await expect(saveComposerFileDraft(input)).rejects.toMatchObject({
		cause: expect.objectContaining({ message: "Disk unavailable" }),
	});
	failure.mockRestore();
	expect(hasClientRestartBlocker()).toBe(true);
	await removeComposerFileDraft(input.id);
	expect(hasClientRestartBlocker()).toBe(false);
});

it("persists staged upload metadata without resurrecting a removed draft", async () => {
	const upload = {
		id: "upload-one",
		name: "draft.txt",
		mimeType: "text/plain",
		sizeBytes: 5,
		expiresAt: "2099-09-10T00:00:00.000Z",
	};
	await saveComposerFileDraft({
		id: "draft-one",
		scope: "org:human:space",
		file: new File(["draft"], "draft.txt"),
		publishMutationId: "publish-one",
	});
	await saveComposerFileDraftUpload("draft-one", upload);
	await saveComposerFileDraft({
		id: "a-later-file",
		scope: "org:human:space",
		file: new File(["later"], "later.txt"),
		publishMutationId: "publish-later",
	});
	expect(await readComposerFileDrafts("org:human:other")).toEqual([]);
	expect(await readComposerFileDrafts("org:human:space")).toMatchObject([
		{ id: "draft-one", publishMutationId: "publish-one", upload },
		{ id: "a-later-file" },
	]);
	await removeComposerFileDraft("draft-one");
	await saveComposerFileDraftUpload("draft-one", upload);
	expect(await readComposerFileDrafts("org:human:space")).toMatchObject([
		{ id: "a-later-file" },
	]);
	await removeComposerFileDraft("a-later-file");
});

it("keeps an in-flight send's attachment identity across a scope handoff", async () => {
	const draft = {
		id: "handoff-file",
		file: new File(["draft"], "handoff.txt"),
		publishMutationId: "handoff-publication",
	};
	await saveComposerFileDraft({ ...draft, scope: "account:pending-chat" });
	await saveComposerFileDraft({ ...draft, scope: "org:human:ready-chat" });
	expect(await readComposerFileDrafts("account:pending-chat")).toEqual([]);
	expect(await readComposerFileDraftsByIds([draft.id])).toMatchObject([
		{
			id: draft.id,
			scope: "org:human:ready-chat",
			publishMutationId: draft.publishMutationId,
		},
	]);
	await removeComposerFileDraft(draft.id);
	expect(await readComposerFileDraftsByIds([draft.id])).toEqual([]);
});

it("serializes a same-file save before removal and never restores the retired draft", async () => {
	const draft = {
		id: "ordered-removal",
		file: new File(["ordered"], "ordered.txt"),
		publishMutationId: "ordered-publication",
		scope: "ordered-scope",
	};
	const saving = saveComposerFileDraft(draft);
	const removing = removeComposerFileDraft(draft.id, {
		fileName: draft.file.name,
		reason: "removed",
		scope: draft.scope,
	});
	await Promise.all([saving, removing]);
	expect(await readComposerFileDrafts(draft.scope)).toEqual([]);
	expect(await readComposerFileDraftsByIds([draft.id])).toEqual([]);
	expect(readComposerFileDraftCleanup(draft.scope)).toEqual([]);
});

it("keeps failed cleanup scoped and retryable after the owner remounts", async () => {
	const draft = {
		id: "cleanup-retry",
		file: new File(["cleanup"], "cleanup.txt"),
		publishMutationId: "cleanup-publication",
		scope: "cleanup-scope",
	};
	await saveComposerFileDraft(draft);
	const failure = vi
		.spyOn(IDBDatabase.prototype, "transaction")
		.mockImplementationOnce(() => {
			throw new DOMException("Storage unavailable", "UnknownError");
		});
	await expect(
		removeComposerFileDraft(draft.id, {
			fileName: draft.file.name,
			reason: "removed",
			scope: draft.scope,
		})
	).rejects.toMatchObject({ phase: "transaction" });
	failure.mockRestore();
	expect(readComposerFileDraftCleanup("another-scope")).toEqual([]);
	expect(readComposerFileDraftCleanup(draft.scope)).toMatchObject([
		{
			fileName: draft.file.name,
			id: draft.id,
			reason: "removed",
			status: "failed",
		},
	]);
	expect(hasClientRestartBlocker()).toBe(true);
	await retryComposerFileDraftCleanup(draft.id);
	expect(readComposerFileDraftCleanup(draft.scope)).toEqual([]);
	expect(hasClientRestartBlocker()).toBe(false);
	expect(await readComposerFileDrafts(draft.scope)).toEqual([]);
});

it("does not treat a missing upload metadata target as successful persistence", async () => {
	await expect(
		saveComposerFileDraftUpload("missing-upload-draft", {
			id: "missing-upload",
			name: "missing.txt",
			mimeType: "text/plain",
			sizeBytes: 7,
			expiresAt: "2099-09-10T00:00:00.000Z",
		})
	).rejects.toThrow("no longer exists");
	expect(hasClientRestartBlocker()).toBe(true);
	await removeComposerFileDraft("missing-upload-draft");
	expect(hasClientRestartBlocker()).toBe(false);
});
