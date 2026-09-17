import "fake-indexeddb/auto";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { forceCloseDatabase, IDBFactory } from "fake-indexeddb";
import { afterEach, expect, it, vi } from "vitest";
import type { createUnscopedWebSpaceApi } from "#/lib/spaces/api";
import {
	readComposerFileDrafts,
	removeComposerFileDraft,
} from "#/lib/spaces/composer-file-drafts";
import { useSpaceComposerFiles } from "./use-space-composer-attachments";

type SpaceApi = ReturnType<typeof createUnscopedWebSpaceApi>;
const api = vi.hoisted(() => ({
	discardComposerUpload: vi.fn<SpaceApi["discardComposerUpload"]>(),
	publishComposerUpload: vi.fn<SpaceApi["publishComposerUpload"]>(),
	stageComposerUpload: vi.fn<SpaceApi["stageComposerUpload"]>(),
}));

vi.mock("#/lib/spaces/api", () => ({
	createUnscopedWebSpaceApi: () => api,
}));

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: new IDBFactory(),
	});
});

it("keeps the production controller usable after its real IndexedDB handle closes", async () => {
	const factory = new IDBFactory();
	Object.defineProperty(globalThis, "indexedDB", {
		configurable: true,
		value: factory,
	});
	let cachedDatabase: IDBDatabase | undefined;
	const originalOpen = factory.open.bind(factory);
	const open = vi.spyOn(factory, "open").mockImplementation((...args) => {
		const request = originalOpen(...args);
		request.addEventListener("success", () => {
			cachedDatabase = request.result;
		});
		return request;
	});
	api.stageComposerUpload.mockImplementation(async (input) => ({
		expiresAt: "2099-09-10T00:00:00.000Z",
		id: input.uploadId,
		mimeType: input.mimeType,
		name: input.name,
		sizeBytes: 3,
	}));

	const controller = renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "integration",
			profileId: "human-integration",
			spaceId: "space-integration",
		})
	);
	await act(async () => {
		await controller.result.current.addFiles([
			new File(["one"], "one.txt", { type: "text/plain" }),
		]);
	});
	expect(cachedDatabase).toBeDefined();
	forceCloseDatabase(cachedDatabase as unknown as typeof IDBDatabase);

	await act(async () => {
		await controller.result.current.addFiles([
			new File(["two"], "two.txt", { type: "text/plain" }),
		]);
	});
	expect(controller.result.current.files.map((file) => file.fileName)).toEqual([
		"one.txt",
		"two.txt",
	]);
	await expect(
		readComposerFileDrafts("integration:human-integration:space-integration")
	).resolves.toHaveLength(2);

	const removedId = controller.result.current.files[0]?.localId;
	if (!removedId) {
		throw new Error("Expected a restored attachment identity.");
	}
	act(() => controller.result.current.removeFile(removedId));
	await waitFor(async () => {
		await expect(
			readComposerFileDrafts("integration:human-integration:space-integration")
		).resolves.toHaveLength(1);
	});
	await removeComposerFileDraft(
		controller.result.current.files[0]?.localId ?? ""
	);
	expect(open.mock.calls.length).toBeGreaterThanOrEqual(2);
});
