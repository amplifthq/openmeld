import type { SpaceApi } from "@openmeld/api-client";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { spaceFileContentQueryOptions } from "./space-files";

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
});
