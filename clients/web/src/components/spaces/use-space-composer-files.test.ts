import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { createOrganizationScopedWebSpaceApi } from "#/lib/spaces/api";
import { useSpaceComposerFiles } from "./use-space-composer-attachments";

type SpaceApi = ReturnType<typeof createOrganizationScopedWebSpaceApi>;
const api = vi.hoisted(() => ({
	stageComposerUpload: vi.fn<SpaceApi["stageComposerUpload"]>(),
	publishComposerUpload: vi.fn<SpaceApi["publishComposerUpload"]>(),
	discardComposerUpload: vi.fn<SpaceApi["discardComposerUpload"]>(),
}));
vi.mock("#/lib/spaces/api", () => ({
	createOrganizationScopedWebSpaceApi: () => api,
}));

afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

function setup() {
	api.stageComposerUpload.mockImplementation(async (input) => ({
		id: input.uploadId,
		name: input.name,
		mimeType: input.mimeType,
		sizeBytes: 5,
		expiresAt: "2026-09-10T00:00:00.000Z",
	}));
	return renderHook(() =>
		useSpaceComposerFiles({
			organizationSlug: "test",
			profileId: "human-1",
			spaceId: "space-1",
		})
	);
}

describe("composer attachment submission", () => {
	it("publishes only the captured batch even when another file is added before publication", async () => {
		const hook = setup();
		await act(async () =>
			hook.result.current.addFiles([new File(["first"], "first.txt")])
		);
		const uploadId = hook.result.current.files[0]?.upload?.id;
		act(() => {
			hook.result.current.beginSubmission();
		});
		await act(async () =>
			hook.result.current.addFiles([new File(["next!"], "next.txt")])
		);
		const actor = {
			displayName: "Mira",
			ownerUserId: "owner-1",
			profileId: "human-1",
			profileKind: "human" as const,
		};
		api.publishComposerUpload.mockResolvedValue({
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
		});
		await act(async () => {
			await hook.result.current.publishReadyFiles();
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
		await act(async () =>
			hook.result.current.addFiles([new File(["first"], "first.txt")])
		);
		act(() => {
			hook.result.current.beginSubmission();
		});
		expect(hook.result.current.files).toEqual([]);
		expect(api.discardComposerUpload).not.toHaveBeenCalled();
	});

	it("preserves the next draft when the submitted attachments are accepted", async () => {
		const hook = setup();
		await act(async () =>
			hook.result.current.addFiles([new File(["first"], "first.txt")])
		);
		const submittedIds = hook.result.current.files.map((file) => file.localId);
		act(() => {
			hook.result.current.beginSubmission();
		});
		await act(async () =>
			hook.result.current.addFiles([new File(["next!"], "next.txt")])
		);
		act(() => {
			hook.result.current.consumePublishedFiles(submittedIds);
			hook.result.current.finishSubmission();
		});
		expect(hook.result.current.files.map((file) => file.fileName)).toEqual([
			"next.txt",
		]);
		expect(api.discardComposerUpload).not.toHaveBeenCalled();
	});

	it("returns rejected attachments without removing the next draft", async () => {
		const hook = setup();
		await act(async () =>
			hook.result.current.addFiles([new File(["first"], "first.txt")])
		);
		act(() => {
			hook.result.current.beginSubmission();
		});
		await act(async () =>
			hook.result.current.addFiles([new File(["next!"], "next.txt")])
		);
		act(() => hook.result.current.finishSubmission());
		expect(hook.result.current.files.map((file) => file.fileName)).toEqual([
			"first.txt",
			"next.txt",
		]);
	});
});
