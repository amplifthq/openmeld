import type { SpaceApi } from "@openmeld/api-client";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSpaceFileMedia } from "./space-file-media-resource";
import { spaceFileContentQueryOptions } from "./space-files";

const clients: QueryClient[] = [];
beforeEach(() => {
	vi.stubGlobal(
		"URL",
		class extends URL {
			static createObjectURL = vi.fn(() => "blob:downloaded-image");
			static revokeObjectURL = vi.fn();
		}
	);
});
afterEach(() => {
	for (const client of clients.splice(0)) {
		client.clear();
	}
	vi.unstubAllGlobals();
});

describe("spaceFileContentQueryOptions", () => {
	it("reuses one authorized download across message and file previews", async () => {
		const downloadFileContent = vi.fn().mockResolvedValue({
			bytes: new ArrayBuffer(1),
			mimeType: "image/png",
			revision: 3,
		});
		const api = {
			downloadFileContent,
		} as Pick<SpaceApi, "downloadFileContent">;
		const queryClient = new QueryClient();
		clients.push(queryClient);
		const options = spaceFileContentQueryOptions({
			api,
			fileId: "file-1",
			revision: 3,
			spaceId: "space-1",
		});

		await queryClient.fetchQuery(options);
		await queryClient.fetchQuery(options);

		expect(downloadFileContent).toHaveBeenCalledTimes(1);
		expect(downloadFileContent).toHaveBeenCalledWith(
			expect.objectContaining({
				fileId: "file-1",
				revision: 3,
				spaceId: "space-1",
			})
		);
	});

	it.each([
		["PDF", "application/pdf"],
		[
			"Word",
			"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		],
		[
			"PowerPoint",
			"application/vnd.openxmlformats-officedocument.presentationml.presentation",
		],
		[
			"Excel",
			"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		],
	])("revokes a %s preview URL when access to its file is removed", async (_, mimeType) => {
		const client = new QueryClient();
		clients.push(client);
		const options = spaceFileContentQueryOptions({
			api: {
				downloadFileContent: vi.fn().mockResolvedValue({
					bytes: new ArrayBuffer(4),
					mimeType,
					revision: 2,
				}),
			} as Pick<SpaceApi, "downloadFileContent">,
			fileId: "file-pdf",
			revision: 2,
			spaceId: "space-1",
		});
		const content = await client.fetchQuery(options);
		expect(content.mediaPreview?.getSnapshot()).toBe("blob:downloaded-image");

		clearSpaceFileMedia(client, "space-1", "file-pdf");
		expect(content.mediaPreview?.getSnapshot()).toBeNull();
		expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:downloaded-image");
	});
});
