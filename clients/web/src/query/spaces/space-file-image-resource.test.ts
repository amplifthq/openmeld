import {
	OpenMeldApiClientHttpError,
	type SpaceApi,
	type SpaceFileContent,
} from "@openmeld/api-client";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CachedSpaceFileContent,
	clearSpaceFileImage,
	clearSpaceFileImageResources,
	type SpaceFileImageResource,
	spaceFileImageResources,
} from "./space-file-image-resource";
import {
	resolveSpaceFileImagePresentationKey,
	seedPublishedSpaceFileImage,
	spaceFileContentQueryOptions,
	spaceFileQueryKeys,
} from "./space-files";

const clients: QueryClient[] = [];
let createUrl = vi.fn<(blob: Blob) => string>();
let revokeUrl = vi.fn<(url: string) => void>();
beforeEach(() => {
	let sequence = 0;
	createUrl = vi.fn(() => `blob:image-${++sequence}`);
	revokeUrl = vi.fn();
	vi.stubGlobal(
		"URL",
		class extends URL {
			static createObjectURL = createUrl;
			static revokeObjectURL = revokeUrl;
		}
	);
});
afterEach(() => {
	for (const client of clients.splice(0)) {
		clearSpaceFileImageResources(client);
		client.clear();
	}
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

function createClient() {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	clients.push(client);
	return client;
}

function options(
	api: Pick<SpaceApi, "downloadFileContent">,
	fileId = "file-1",
	revision = 1,
	spaceId = "space-1"
) {
	return {
		...spaceFileContentQueryOptions({ api, fileId, revision, spaceId }),
		retry: false,
	};
}

describe("Space image display ownership", () => {
	it("enforces the idle byte budget while a mounted original remains owned", async () => {
		const client = createClient();
		const releases: Array<() => void> = [];
		const resources: SpaceFileImageResource[] = [];
		for (let index = 0; index < 3; index += 1) {
			const bytes = new Blob(["small fixture"], { type: "image/png" });
			// Exercise accounting without allocating hundreds of MiB in a unit test.
			Object.defineProperty(bytes, "size", { value: 80 * 1024 * 1024 });
			const resource = spaceFileImageResources(client).create(
				bytes,
				"space-1",
				`large-${index}`
			);
			resources.push(resource);
			if (index === 0) {
				releases.push(
					resource.subscribe(() => {
						/* Visible original. */
					})
				);
			}
			client.setQueryData<CachedSpaceFileContent>(
				spaceFileQueryKeys.content("space-1", `large-${index}`, 1),
				{ bytes, mimeType: "image/png", revision: 1, imagePreview: resource }
			);
			resource.release();
		}
		await Promise.resolve();
		expect(client.getQueryCache().getAll()).toHaveLength(2);
		expect(resources[0]?.getSnapshot()).not.toBeNull();
		for (const release of releases) {
			release();
		}
		await Promise.resolve();
		expect(client.getQueryCache().getAll()).toHaveLength(1);
	});

	it("revokes one deleted file across revisions without discarding another file's image", async () => {
		const client = createClient();
		const downloadFileContent = vi
			.fn<SpaceApi["downloadFileContent"]>()
			.mockImplementation(async (input) => ({
				bytes: new ArrayBuffer(1),
				mimeType: "image/png",
				revision: input.revision ?? 1,
			}));
		const first = await client.fetchQuery(options({ downloadFileContent }));
		const secondRevision = await client.fetchQuery(
			options({ downloadFileContent }, "file-1", 2)
		);
		const sibling = await client.fetchQuery(
			options({ downloadFileContent }, "file-2")
		);
		clearSpaceFileImage(client, "space-1", "file-1");
		expect(first.imagePreview?.getSnapshot()).toBeNull();
		expect(secondRevision.imagePreview?.getSnapshot()).toBeNull();
		expect(sibling.imagePreview?.getSnapshot()).not.toBeNull();
		expect(client.getQueryCache().getAll()).toHaveLength(1);
	});

	it("preserves explicit cold authorization errors and revokes warm originals when the server denies access", async () => {
		const client = createClient();
		const failure = new OpenMeldApiClientHttpError({
			code: "upstream_error",
			message: "Forbidden",
			status: 403,
			rawBody: "",
			upstreamCode: "space_file.forbidden",
		});
		const downloadFileContent = vi
			.fn<SpaceApi["downloadFileContent"]>()
			.mockRejectedValue(failure);
		await expect(
			client.fetchQuery(options({ downloadFileContent }))
		).rejects.toBe(failure);
		expect(
			client.getQueryState(spaceFileQueryKeys.content("space-1", "file-1", 1))
				?.status
		).toBe("error");
		downloadFileContent.mockResolvedValueOnce({
			bytes: new ArrayBuffer(1),
			mimeType: "image/png",
			revision: 1,
		});
		const cached = await client.fetchQuery(options({ downloadFileContent }));
		const release = cached.imagePreview?.subscribe(() => {
			/* Visible viewer. */
		});
		await expect(
			client.fetchQuery({ ...options({ downloadFileContent }), staleTime: 0 })
		).rejects.toBeDefined();
		expect(cached.imagePreview?.getSnapshot()).toBeNull();
		expect(
			client.getQueryData(spaceFileQueryKeys.content("space-1", "file-1", 1))
		).toBeUndefined();
		release?.();
	});

	it("hands the same URL and original bytes from composer to canonical cache and all viewers", async () => {
		const client = createClient();
		const original = new File(["original bytes"], "photo.png", {
			type: "image/png",
		});
		const resource = spaceFileImageResources(client).create(
			original,
			"space-1",
			"composer-file:chosen"
		);
		const url = resource.getSnapshot();
		const stopThumbnail = resource.subscribe(vi.fn());
		const stopViewer = resource.subscribe(vi.fn());
		seedPublishedSpaceFileImage({
			queryClient: client,
			bytes: original,
			spaceId: "space-1",
			fileId: "file-1",
			revision: 1,
			mimeType: original.type,
			sizeBytes: original.size,
			localId: resource.identity,
			previewUrl: url,
		});
		const downloadFileContent = vi.fn<SpaceApi["downloadFileContent"]>();
		const cached = await client.fetchQuery(options({ downloadFileContent }));
		expect(cached.bytes).toBe(original);
		expect(cached.imagePreview).toBe(resource);
		expect(downloadFileContent).not.toHaveBeenCalled();
		expect(
			resolveSpaceFileImagePresentationKey(client, "space-1", {
				fileId: "composer-file:chosen",
				revision: 1,
				isLocal: true,
			})
		).toBe(
			resolveSpaceFileImagePresentationKey(client, "space-1", {
				fileId: "file-1",
				revision: 1,
			})
		);
		resource.release();
		resource.release(); // Composer cleanup is idempotent.
		expect(resource.getSnapshot()).toBe(url);
		client.removeQueries({
			queryKey: spaceFileQueryKeys.content("space-1", "file-1", 1),
		});
		stopThumbnail();
		expect(resource.getSnapshot()).toBe(url);
		stopViewer();
		expect(resource.getSnapshot()).toBeNull();
		expect(createUrl).toHaveBeenCalledTimes(1);
		expect(revokeUrl).toHaveBeenCalledExactlyOnceWith(url);
	});

	it("does not alias different files, revisions, or Spaces", async () => {
		const client = createClient();
		const downloadFileContent = vi
			.fn<SpaceApi["downloadFileContent"]>()
			.mockImplementation(async (input) => ({
				bytes: new ArrayBuffer(1),
				mimeType: "image/png",
				revision: input.revision ?? 1,
			}));
		const first = await client.fetchQuery(options({ downloadFileContent }));
		const second = await client.fetchQuery(
			options({ downloadFileContent }, "file-1", 2)
		);
		const otherSpace = await client.fetchQuery(
			options({ downloadFileContent }, "file-1", 1, "space-2")
		);
		expect(
			new Set([
				first.imagePreview,
				second.imagePreview,
				otherSpace.imagePreview,
			]).size
		).toBe(3);
		expect(createUrl).toHaveBeenCalledTimes(3);
		client.clear();
		expect(revokeUrl).toHaveBeenCalledTimes(3);
	});

	it("revokes a visible private image synchronously on access loss", async () => {
		const client = createClient();
		const downloadFileContent = vi
			.fn<SpaceApi["downloadFileContent"]>()
			.mockResolvedValue({
				bytes: new ArrayBuffer(1),
				mimeType: "image/png",
				revision: 1,
			});
		const { imagePreview } = await client.fetchQuery(
			options({ downloadFileContent })
		);
		if (!imagePreview) {
			throw new Error("Expected an image resource.");
		}
		const changed = vi.fn();
		const release = imagePreview.subscribe(changed);
		clearSpaceFileImageResources(client, "space-1");
		expect(imagePreview.getSnapshot()).toBeNull();
		expect(changed).toHaveBeenCalledTimes(1);
		expect(
			client.getQueryData(spaceFileQueryKeys.content("space-1", "file-1", 1))
		).toBeUndefined();
		release();
		expect(revokeUrl).toHaveBeenCalledTimes(1);
	});

	it("rejects a late download after sign-out without admitting pixels or bytes", async () => {
		const client = createClient();
		let resolve: (content: SpaceFileContent) => void = () => {
			throw new Error("Download was not started.");
		};
		const downloadFileContent = vi
			.fn<SpaceApi["downloadFileContent"]>()
			.mockImplementation(
				() =>
					new Promise((done) => {
						resolve = done;
					})
			);
		const pending = client.fetchQuery(options({ downloadFileContent }));
		const rejected = expect(pending).rejects.toBeDefined();
		clearSpaceFileImageResources(client);
		resolve({ bytes: new ArrayBuffer(1), mimeType: "image/png", revision: 1 });
		await rejected;
		await Promise.resolve();
		expect(client.getQueryCache().getAll()).toHaveLength(0);
		expect(createUrl).not.toHaveBeenCalled();
	});

	it("releases an unobserved cached original at its finite GC deadline", async () => {
		vi.useFakeTimers();
		const client = createClient();
		const downloadFileContent = vi
			.fn<SpaceApi["downloadFileContent"]>()
			.mockResolvedValue({
				bytes: new ArrayBuffer(1),
				mimeType: "image/png",
				revision: 1,
			});
		const { imagePreview } = await client.fetchQuery(
			options({ downloadFileContent })
		);
		await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 1);
		expect(client.getQueryCache().getAll()).toHaveLength(0);
		expect(imagePreview?.getSnapshot()).toBeNull();
		expect(revokeUrl).toHaveBeenCalledTimes(1);
	});

	it("bounds idle original entries without evicting mounted consumers", async () => {
		const client = createClient();
		const downloadFileContent = vi
			.fn<SpaceApi["downloadFileContent"]>()
			.mockResolvedValue({
				bytes: new ArrayBuffer(1),
				mimeType: "image/png",
				revision: 1,
			});
		for (let index = 0; index < 34; index += 1) {
			await client.fetchQuery(
				options({ downloadFileContent }, `file-${index}`)
			);
		}
		const observer = new QueryObserver(
			client,
			options({ downloadFileContent }, "file-33")
		);
		const stop = observer.subscribe(() => {
			/* Keep one image mounted. */
		});
		stop();
		await Promise.resolve();
		expect(client.getQueryCache().getAll()).toHaveLength(32);
		expect(revokeUrl).toHaveBeenCalledTimes(2);
	});
});
