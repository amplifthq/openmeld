import { beforeEach, describe, expect, it, vi } from "vitest";

const requestJsonMock = vi.fn();

vi.mock("#/lib/openmeld-api/client", () => ({
	createWebOpenMeldApiFoundation: () => ({
		requestJson: requestJsonMock,
		requestResponse: vi.fn(),
		requestText: vi.fn(),
	}),
}));

import {
	readSpaceCursorLastSeenTs,
	writeSpaceCursorLastSeenTs,
} from "./cursor";

beforeEach(() => {
	requestJsonMock.mockReset();
});

describe("readSpaceCursorLastSeenTs", () => {
	it("returns the server lastSeenTs", async () => {
		requestJsonMock.mockResolvedValue({ lastSeenTs: 1234 });
		await expect(
			readSpaceCursorLastSeenTs({
				spaceId: "space-1",
				openMeldProfileId: "p-1",
			})
		).resolves.toBe(1234);
		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "GET",
				url: "/v1/spaces/space-1/cursors/p-1",
			})
		);
	});

	it("returns null when the cursor has no lastSeenTs", async () => {
		requestJsonMock.mockResolvedValue({ lastSeenTs: null });
		await expect(
			readSpaceCursorLastSeenTs({
				spaceId: "space-1",
				openMeldProfileId: "p-1",
			})
		).resolves.toBeNull();
	});

	it("returns null (resilient) when the request fails", async () => {
		requestJsonMock.mockRejectedValue(new Error("network"));
		await expect(
			readSpaceCursorLastSeenTs({
				spaceId: "space-1",
				openMeldProfileId: "p-1",
			})
		).resolves.toBeNull();
	});
});

describe("writeSpaceCursorLastSeenTs", () => {
	it("PATCHes the lastSeenTs body", async () => {
		requestJsonMock.mockResolvedValue({ lastSeenTs: 5000 });
		await writeSpaceCursorLastSeenTs({
			spaceId: "space-1",
			openMeldProfileId: "p-1",
			lastSeenTs: 5000,
		});
		expect(requestJsonMock).toHaveBeenCalledWith(
			expect.objectContaining({
				method: "PATCH",
				url: "/v1/spaces/space-1/cursors/p-1",
				body: JSON.stringify({ lastSeenTs: 5000 }),
			})
		);
	});

	it("never throws when the write fails", async () => {
		requestJsonMock.mockRejectedValue(new Error("network"));
		await expect(
			writeSpaceCursorLastSeenTs({
				spaceId: "space-1",
				openMeldProfileId: "p-1",
				lastSeenTs: 5000,
			})
		).resolves.toBeUndefined();
	});
});
