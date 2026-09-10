import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import type { SpaceComposerFile } from "#/lib/spaces/composer-attachment";
import type { ComposerFileDraft } from "#/lib/spaces/composer-file-drafts";
import { useSpaceComposerFiles } from "./use-space-composer-attachments";

type SpaceApi = ReturnType<typeof createUnscopedWebSpaceApi>;
const api = vi.hoisted(() => ({
	stageComposerUpload: vi.fn<SpaceApi["stageComposerUpload"]>(),
	publishComposerUpload: vi.fn<SpaceApi["publishComposerUpload"]>(),
	discardComposerUpload: vi.fn<SpaceApi["discardComposerUpload"]>(),
}));
vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => api,
}));
const drafts = vi.hoisted(() => new Map<string, ComposerFileDraft>());
vi.mock("#/lib/spaces/composer-file-drafts", () => ({
	saveComposerFileDraft: (draft: ComposerFileDraft) => {
		drafts.set(draft.id, draft);
		return Promise.resolve();
	},
	saveComposerFileDraftUpload: (
		id: string,
		upload: ComposerFileDraft["upload"]
	) => {
		const draft = drafts.get(id);
		if (draft) {
			drafts.set(id, { ...draft, upload });
		}
		return Promise.resolve();
	},
	removeComposerFileDraft: (id: string) => {
		drafts.delete(id);
		return Promise.resolve();
	},
	readComposerFileDrafts: async (scope: string) =>
		[...drafts.values()].filter((draft) => draft.scope === scope),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	drafts.clear();
});

function setup() {
	api.publishComposerUpload.mockResolvedValue(createPublishedFile());
	api.stageComposerUpload.mockImplementation(async (input) => ({
		id: input.uploadId,
		name: input.name,
		mimeType: input.mimeType,
		sizeBytes: 5,
		expiresAt: "2099-09-10T00:00:00.000Z",
	}));
	return renderHook(
		({ spaceId, draftScope }) =>
			useSpaceComposerFiles({
				organizationSlug: "test",
				profileId: "human-1",
				spaceId,
				draftScope,
			}),
		{
			initialProps: {
				spaceId: "space-1",
				draftScope: undefined as string | undefined,
			},
		}
	);
}

it("keeps each conversation's attachments and pending upload when navigating away", async () => {
	const hook = setup();
	await act(async () =>
		hook.result.current.addFiles([new File(["ready"], "ready.txt")])
	);
	let resolveUpload!: (
		upload: Awaited<ReturnType<SpaceApi["stageComposerUpload"]>>
	) => void;
	api.stageComposerUpload.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
	);
	let uploading!: Promise<void>;
	act(() => {
		uploading = hook.result.current.addFiles([
			new File(["pending"], "pending.txt"),
		]);
	});
	await waitFor(() => expect(resolveUpload).toBeDefined());
	const originalIds = hook.result.current.files.map((file) => file.localId);
	hook.rerender({ spaceId: "space-2", draftScope: undefined });
	expect(hook.result.current.files).toEqual([]);
	await act(async () =>
		hook.result.current.addFiles([new File(["other"], "other.txt")])
	);
	await act(async () => {
		resolveUpload({
			id: "pending-upload",
			name: "pending.txt",
			mimeType: "text/plain",
			sizeBytes: 7,
			expiresAt: "2099-09-10T00:00:00.000Z",
		});
		await uploading;
	});
	expect(hook.result.current.files.map((file) => file.fileName)).toEqual([
		"other.txt",
	]);
	hook.rerender({ spaceId: "space-1", draftScope: undefined });
	expect(hook.result.current.files.map((file) => file.localId)).toEqual(
		originalIds
	);
	expect(
		hook.result.current.files.every((file) => file.status === "ready")
	).toBe(true);
	expect(api.discardComposerUpload).not.toHaveBeenCalled();
	expect(api.stageComposerUpload).toHaveBeenCalledTimes(3);
	// A send started in A still publishes to A after navigating to B.
	const originalController = hook.result.current;
	let batch!: readonly SpaceComposerFile[];
	act(() => {
		batch = originalController.beginSubmission();
	});
	hook.rerender({ spaceId: "space-2", draftScope: undefined });
	await act(async () => {
		const published = await originalController.publishReadyFiles(batch);
		originalController.consumePublishedFiles(published.publishedLocalIds);
		originalController.finishSubmission(batch);
	});
	expect(
		api.publishComposerUpload.mock.calls.every(
			([input]) => input.spaceId === "space-1"
		)
	).toBe(true);
	expect(hook.result.current.files.map((file) => file.fileName)).toEqual([
		"other.txt",
	]);
	hook.rerender({ spaceId: "space-1", draftScope: undefined });
	expect(hook.result.current.files).toEqual([]);
});

it("restores uploaded drafts after remount, isolates threads, and remembers removal", async () => {
	let hook = setup();
	await act(async () =>
		hook.result.current.addFiles([new File(["space"], "space.txt")])
	);
	hook.rerender({ spaceId: "space-1", draftScope: "thread:one" });
	expect(hook.result.current.files).toEqual([]);
	await act(async () =>
		hook.result.current.addFiles([new File(["thread"], "thread.txt")])
	);
	hook.unmount();
	hook = setup();
	await waitFor(() =>
		expect(hook.result.current.files[0]?.fileName).toBe("space.txt")
	);
	expect(hook.result.current.files[0]?.status).toBe("ready");
	hook.rerender({ spaceId: "space-1", draftScope: "thread:one" });
	await waitFor(() =>
		expect(hook.result.current.files[0]?.fileName).toBe("thread.txt")
	);
	expect(api.stageComposerUpload).toHaveBeenCalledTimes(2);
	const attachment = hook.result.current.files[0];
	if (!attachment) {
		throw new Error("Missing restored attachment");
	}
	act(() => hook.result.current.removeFile(attachment.localId));
	hook.unmount();
	hook = setup();
	hook.rerender({ spaceId: "space-1", draftScope: "thread:one" });
	await act(async () => undefined);
	expect(hook.result.current.files).toEqual([]);
	expect(api.discardComposerUpload).toHaveBeenCalledTimes(1);
});

describe("composer attachment submission", () => {
	it("rejects oversized files before upload while keeping other attachments", async () => {
		const hook = setup();
		const oversized = new File(["too large"], "large.pdf");
		Object.defineProperty(oversized, "size", { value: 251 * 1024 * 1024 });
		await act(async () =>
			hook.result.current.addFiles([
				oversized,
				new File(["small"], "small.txt"),
			])
		);
		expect(api.stageComposerUpload).toHaveBeenCalledTimes(1);
		expect(api.stageComposerUpload).toHaveBeenCalledWith(
			expect.objectContaining({ name: "small.txt" })
		);
		expect(hook.result.current.files[0]).toMatchObject({
			status: "failed",
			errorMessage: expect.stringContaining("250 MiB upload limit"),
		});
		expect(hook.result.current.files[0]?.errorMessage).toContain(
			"paste a link"
		);
		expect(hook.result.current.files[1]?.status).toBe("ready");
	});

	it("publishes only the captured batch even when another file is added before publication", async () => {
		const hook = setup();
		let submitted: readonly SpaceComposerFile[] = [];
		await act(async () =>
			hook.result.current.addFiles([new File(["first"], "first.txt")])
		);
		const uploadId = hook.result.current.files[0]?.upload?.id;
		act(() => {
			submitted = hook.result.current.beginSubmission();
		});
		await act(async () =>
			hook.result.current.addFiles([new File(["next!"], "next.txt")])
		);

		await act(async () => {
			await hook.result.current.publishReadyFiles(submitted);
		});
		expect(api.publishComposerUpload).toHaveBeenCalledTimes(1);
		expect(api.publishComposerUpload).toHaveBeenCalledWith(
			expect.objectContaining({ uploadId })
		);
		expect(hook.result.current.files.map((file) => file.fileName)).toEqual([
			"next.txt",
		]);
	});
	it("moves attachments out of the composer immediately without discarding uploads", async () => {
		const hook = setup();
		let submitted: readonly SpaceComposerFile[] = [];
		await act(async () =>
			hook.result.current.addFiles([new File(["first"], "first.txt")])
		);
		act(() => {
			submitted = hook.result.current.beginSubmission();
		});
		expect(submitted).toHaveLength(1);
		expect(hook.result.current.files).toEqual([]);
		expect(api.discardComposerUpload).not.toHaveBeenCalled();
	});

	it("preserves the next draft when the submitted attachments are accepted", async () => {
		const hook = setup();
		let submitted: readonly SpaceComposerFile[] = [];
		await act(async () =>
			hook.result.current.addFiles([new File(["first"], "first.txt")])
		);
		const submittedIds = hook.result.current.files.map((file) => file.localId);
		act(() => {
			submitted = hook.result.current.beginSubmission();
		});
		await act(async () =>
			hook.result.current.addFiles([new File(["next!"], "next.txt")])
		);
		act(() => {
			hook.result.current.consumePublishedFiles(submittedIds);
			hook.result.current.finishSubmission(submitted);
		});
		expect(hook.result.current.files.map((file) => file.fileName)).toEqual([
			"next.txt",
		]);
		expect(api.discardComposerUpload).not.toHaveBeenCalled();
	});

	it("returns rejected attachments without removing the next draft", async () => {
		const hook = setup();
		let submitted: readonly SpaceComposerFile[] = [];
		await act(async () =>
			hook.result.current.addFiles([new File(["first"], "first.txt")])
		);
		act(() => {
			submitted = hook.result.current.beginSubmission();
		});
		await act(async () =>
			hook.result.current.addFiles([new File(["next!"], "next.txt")])
		);
		act(() => hook.result.current.finishSubmission(submitted));
		expect(hook.result.current.files.map((file) => file.fileName)).toEqual([
			"first.txt",
			"next.txt",
		]);
	});
});

it("keeps a second submitted batch hidden when the first completes", async () => {
	const hook = setup();
	await act(async () =>
		hook.result.current.addFiles([new File(["a"], "a.txt")])
	);
	let first: readonly SpaceComposerFile[] = [];
	act(() => {
		first = hook.result.current.beginSubmission();
	});
	await act(async () =>
		hook.result.current.addFiles([new File(["b"], "b.txt")])
	);
	let second: readonly SpaceComposerFile[] = [];
	act(() => {
		second = hook.result.current.beginSubmission();
	});
	act(() => {
		hook.result.current.consumePublishedFiles(
			first.map((file) => file.localId)
		);
		hook.result.current.finishSubmission(first);
	});
	expect(hook.result.current.files).toEqual([]);
	expect(first[0]?.fileName).toBe("a.txt");
	expect(second[0]?.fileName).toBe("b.txt");
});

it("captures an uploading image and protects it when the next draft is cleared", async () => {
	const hook = setup();
	let resolveUpload!: (
		upload: Awaited<ReturnType<SpaceApi["stageComposerUpload"]>>
	) => void;
	api.stageComposerUpload.mockImplementationOnce(
		() =>
			new Promise((resolve) => {
				resolveUpload = resolve;
			})
	);
	let uploadTask: Promise<void> = Promise.resolve();
	act(() => {
		uploadTask = hook.result.current.addFiles([
			new File(["image"], "image.txt"),
		]);
	});
	let submitted: readonly SpaceComposerFile[] = [];
	act(() => {
		submitted = hook.result.current.beginSubmission();
	});
	expect(submitted[0]?.status).toBe("uploading");
	expect(hook.result.current.files).toEqual([]);
	act(() => hook.result.current.clearFiles());
	await waitFor(() => expect(api.stageComposerUpload).toHaveBeenCalled());
	await act(async () => {
		resolveUpload({
			id: "upload-image",
			name: "image.txt",
			mimeType: "text/plain",
			sizeBytes: 5,
			expiresAt: "2026-09-10T00:00:00.000Z",
		});
		await uploadTask;
	});
	expect(api.discardComposerUpload).not.toHaveBeenCalled();
});

it("rejects a batch if one attachment cannot be published instead of dropping it", async () => {
	const hook = setup();
	await act(async () =>
		hook.result.current.addFiles([
			new File(["a"], "a.txt"),
			new File(["b"], "b.txt"),
		])
	);
	let submitted: readonly SpaceComposerFile[] = [];
	act(() => {
		submitted = hook.result.current.beginSubmission();
	});
	api.publishComposerUpload.mockRejectedValueOnce(
		new Error("Permission denied")
	);
	await act(async () => {
		await expect(
			hook.result.current.publishReadyFiles(submitted)
		).rejects.toThrow("Your message wasn't sent");
	});
	expect(hook.result.current.files).toEqual([]);
});

function createPublishedFile(): Awaited<
	ReturnType<SpaceApi["publishComposerUpload"]>
> {
	const actor = {
		displayName: "Mira",
		ownerUserId: "owner-1",
		profileId: "human-1",
		profileKind: "human" as const,
	};

	return {
		id: "file-1",
		kind: "file",
		name: "first.txt",
		path: "/first.txt",
		spaceId: "space-1",
		parentId: null,
		createdAt: "2026-09-09T00:00:00.000Z",
		createdBy: actor,
		updatedAt: "2026-09-09T00:00:00.000Z",
		updatedBy: actor,
		trashedAt: null,
		trashedBy: null,
		latestRevision: {
			id: "revision-1",
			fileId: "file-1",
			revision: 1,
			mimeType: "text/plain",
			sizeBytes: 5,
			createdAt: "2026-09-09T00:00:00.000Z",
			createdBy: actor,
		},
	};
}
