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
const draftListeners = vi.hoisted(() => new Set<(scope: string) => void>());
const draftReadGates = vi.hoisted(
	() => new Map<string, Promise<ComposerFileDraft[]>>()
);
const storageFailures = vi.hoisted(() => ({
	draft: null as Error | null,
	upload: null as Error | null,
}));
vi.mock("#/lib/spaces/composer-file-drafts", () => ({
	isComposerFileDraftRetired: () => false,
	readComposerFileDraftCleanup: () => [],
	retryComposerFileDraftCleanup: () => Promise.resolve(),
	subscribeComposerFileDrafts: (listener: (scope: string) => void) => {
		draftListeners.add(listener);
		return () => draftListeners.delete(listener);
	},
	saveComposerFileDraft: (draft: ComposerFileDraft) => {
		if (storageFailures.draft) {
			return Promise.reject(storageFailures.draft);
		}
		drafts.set(draft.id, draft);
		for (const listener of draftListeners) {
			listener(draft.scope);
		}
		return Promise.resolve();
	},
	saveComposerFileDraftUpload: (
		id: string,
		upload: ComposerFileDraft["upload"]
	) => {
		if (storageFailures.upload) {
			return Promise.reject(storageFailures.upload);
		}
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
		draftReadGates.get(scope) ??
		[...drafts.values()].filter((draft) => draft.scope === scope),
	readComposerFileDraftsByIds: async (ids: string[]) =>
		[...drafts.values()].filter((draft) => ids.includes(draft.id)),
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
	drafts.clear();
	draftReadGates.clear();
	storageFailures.draft = null;
	storageFailures.upload = null;
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

it("hands local new-chat drafts to the Space upload owner once with their original identities", async () => {
	setup();
	const local = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "acme",
			profileId: "human",
			spaceId: "new-chat",
			deferUpload: true,
		})
	);
	await act(async () => {
		await local.result.current.addFiles([
			new File(["brief"], "brief.txt", { type: "text/plain" }),
		]);
	});
	expect(api.stageComposerUpload).not.toHaveBeenCalled();
	const saved = await local.result.current.readFileDrafts();
	local.unmount();
	const destination = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "acme",
			profileId: "human",
			spaceId: "created-space",
		})
	);
	await act(async () => {
		await destination.result.current.addFiles(
			saved.map((draft) => draft.file),
			saved
		);
	});
	await act(async () => {
		await destination.result.current.addFiles(
			saved.map((draft) => draft.file),
			saved
		);
	});
	expect(api.stageComposerUpload).toHaveBeenCalledTimes(1);
	expect(destination.result.current.files).toHaveLength(1);
	expect(destination.result.current.files[0].localId).toBe(saved[0].id);
	expect(destination.result.current.files[0].publishMutationId).toBe(
		saved[0].publishMutationId
	);
});

it.each([
	false,
	true,
])("adopts a loading draft into the ready composer, including a late save: %s", async (lateSave) => {
	setup();
	const local = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "acme",
			profileId: "",
			spaceId: "chat",
			storageKey: "account:pending-chat",
			deferUpload: true,
		})
	);
	const add = () =>
		local.result.current.addFiles([
			new File(["brief"], "brief.txt", { type: "text/plain" }),
		]);
	if (!lateSave) {
		await act(add);
	}
	const destination = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "acme",
			profileId: "human",
			spaceId: "chat",
			restoreFromScopes: ["account:pending-chat"],
		})
	);
	if (lateSave) {
		await act(add);
	}
	await waitFor(() => expect(destination.result.current.files).toHaveLength(1));
	expect(destination.result.current.files[0].localId).toBe(
		local.result.current.files[0].localId
	);
	await waitFor(() => expect(api.stageComposerUpload).toHaveBeenCalledTimes(1));
	// A send started by the loading route must still read the same attachment
	// after the ready composer has taken over its storage scope.
	const handoff = await local.result.current.readFileDrafts();
	expect(handoff.map((draft) => draft.id)).toEqual([
		destination.result.current.files[0].localId,
	]);
	act(() =>
		destination.result.current.removeFile(
			destination.result.current.files[0].localId
		)
	);
	expect(destination.result.current.files).toHaveLength(0);
});

it.each([
	"remove",
	"consume",
	"clear",
	"keep",
] as const)("does not undo %s when an older restoration finishes, and still adopts new files", async (action) => {
	setup();
	const hook = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "acme",
			profileId: "human",
			spaceId: "chat",
			restoreFromScopes: ["loading-chat"],
		})
	);
	await act(async () =>
		hook.result.current.addFiles([new File(["first"], "first.txt")])
	);
	const firstId = hook.result.current.files[0].localId;
	let release!: (drafts: ComposerFileDraft[]) => void;
	draftReadGates.set(
		"loading-chat",
		new Promise((resolve) => {
			release = resolve;
		})
	);
	act(() => {
		for (const listener of draftListeners) {
			listener("loading-chat");
		}
	});
	act(() => {
		if (action === "remove") {
			hook.result.current.removeFile(firstId);
		}
		if (action === "clear") {
			hook.result.current.clearFiles();
		}
		if (action === "consume") {
			const submitted = hook.result.current.beginSubmission();
			hook.result.current.consumePublishedFiles([firstId]);
			hook.result.current.finishSubmission(submitted);
		}
	});
	expect(hook.result.current.files).toHaveLength(action === "keep" ? 1 : 0);
	// A different file saved by the loading owner must still be adopted.
	const loading = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "acme",
			profileId: "human",
			spaceId: "chat",
			storageKey: "loading-chat",
			deferUpload: true,
		})
	);
	draftReadGates.delete("loading-chat");
	await act(async () =>
		loading.result.current.addFiles([new File(["second"], "second.txt")])
	);
	await act(async () => release([]));
	expect(hook.result.current.files.map((file) => file.fileName)).toEqual(
		action === "keep" ? ["first.txt", "second.txt"] : ["second.txt"]
	);
});

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
	it("retains a staged descriptor until metadata persistence succeeds without staging twice", async () => {
		const hook = setup();
		storageFailures.upload = new Error("IndexedDB unavailable");
		await act(async () =>
			hook.result.current.addFiles([
				new File(["image"], "image.bin", {
					type: "application/octet-stream",
				}),
			])
		);
		const failed = hook.result.current.files[0];
		expect(failed).toMatchObject({
			failurePhase: "persist-upload",
			status: "failed",
			upload: { name: "image.bin" },
		});
		expect(api.stageComposerUpload).toHaveBeenCalledTimes(1);

		let submitted: readonly SpaceComposerFile[] = [];
		act(() => {
			submitted = hook.result.current.beginSubmission();
		});
		await expect(
			hook.result.current.publishReadyFiles(submitted)
		).rejects.toThrow("wasn't sent");
		expect(api.publishComposerUpload).not.toHaveBeenCalled();
		expect(api.stageComposerUpload).toHaveBeenCalledTimes(1);
		act(() => hook.result.current.finishSubmission(submitted));

		storageFailures.upload = null;
		await act(async () => {
			await Promise.all([
				hook.result.current.retryFile(failed.localId),
				hook.result.current.retryFile(failed.localId),
			]);
		});
		expect(api.stageComposerUpload).toHaveBeenCalledTimes(1);
		expect(hook.result.current.files[0]).toMatchObject({
			failurePhase: null,
			localId: failed.localId,
			publishMutationId: failed.publishMutationId,
			status: "ready",
			upload: failed.upload,
		});

		act(() => {
			submitted = hook.result.current.beginSubmission();
		});
		await act(async () => {
			await hook.result.current.publishReadyFiles(submitted);
		});
		expect(api.publishComposerUpload).toHaveBeenCalledTimes(1);
	});

	it("retries local draft persistence with the same selection identity", async () => {
		const hook = setup();
		storageFailures.draft = new Error("IndexedDB unavailable");
		await act(async () =>
			hook.result.current.addFiles([new File(["draft"], "draft.txt")])
		);
		const failed = hook.result.current.files[0];
		expect(failed).toMatchObject({
			errorMessage: "Couldn't save this attachment on this device. Try again.",
			failurePhase: "persist-draft",
			status: "failed",
			upload: null,
		});
		expect(api.stageComposerUpload).not.toHaveBeenCalled();
		storageFailures.draft = null;
		await act(async () => hook.result.current.retryFile(failed.localId));
		expect(hook.result.current.files[0]).toMatchObject({
			failurePhase: null,
			localId: failed.localId,
			publishMutationId: failed.publishMutationId,
			status: "ready",
		});
		expect(api.stageComposerUpload).toHaveBeenCalledTimes(1);
	});

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
