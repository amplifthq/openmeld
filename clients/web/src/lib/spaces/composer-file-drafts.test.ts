import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import {
	readComposerFileDrafts,
	removeComposerFileDraft,
	saveComposerFileDraft,
	saveComposerFileDraftUpload,
} from "./composer-file-drafts";

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
