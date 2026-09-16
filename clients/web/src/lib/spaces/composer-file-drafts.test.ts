import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { hasClientRestartBlocker } from "#/client-version-recovery";
import {
	readComposerFileDrafts,
	readComposerFileDraftsByIds,
	removeComposerFileDraft,
	saveComposerFileDraft,
	saveComposerFileDraftUpload,
} from "./composer-file-drafts";

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
	await expect(saveComposerFileDraft(input)).rejects.toThrow(
		"Disk unavailable"
	);
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
