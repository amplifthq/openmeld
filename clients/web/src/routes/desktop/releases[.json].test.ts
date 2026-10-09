import {
	desktopCandidateLocation,
	desktopCandidateManifestSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { getDesktopDownloads } from "#/lib/desktop-downloads";

const id = "a".repeat(64);
const candidate = desktopCandidateManifestSchema.parse({
	schemaVersion: 1,
	target: "production",
	platform: "macos-arm64",
	version: "0.1.25",
	releaseSha: "b".repeat(40),
	sha256: id,
	sizeBytes: 123,
});
const location = desktopCandidateLocation(candidate);
const call = (
	query: string,
	store: Parameters<typeof getDesktopDownloads>[1]
) =>
	getDesktopDownloads(
		new Request(`https://app.openmeld.ai/desktop/releases.json${query}`),
		store
	);

describe("public Desktop download metadata", () => {
	it.each([
		"?candidate=",
		`?candidate=${id}&candidate=${id}`,
		"?platform=linux",
		"?platform=windows-x64&platform=macos-arm64",
	])("rejects invalid selectors before reading storage: %s", async (query) => {
		const store = { get: vi.fn(), head: vi.fn() };
		expect((await call(query, store)).status).toBe(400);
		expect(store.get).not.toHaveBeenCalled();
	});
	it.each([
		123,
		null,
		122,
	])("never replaces a selected candidate with the default: size=%s", async (size) => {
		const store = {
			get: vi.fn(async (key: string) =>
				key === location.manifestKey ? { json: async () => candidate } : null
			),
			head: vi.fn(async () => (size === null ? null : { size })),
		};
		const response = await call(`?candidate=${id}`, store);
		if (size === 122) {
			expect(response.status).toBe(503);
		} else {
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({
				releases:
					size === null
						? []
						: [
								{
									platform: "macos-arm64",
									version: "0.1.25",
									sizeBytes: 123,
									downloadPath: location.downloadPath,
									message: null,
								},
							],
			});
		}
		expect(store.get).toHaveBeenCalledExactlyOnceWith(location.manifestKey);
	});
	it("does not substitute a candidate for a different platform", async () => {
		const store = {
			get: vi.fn(async () => ({ json: async () => candidate })),
			head: vi.fn(async () => ({ size: 123 })),
		};
		expect(
			await (await call(`?candidate=${id}&platform=windows-x64`, store)).json()
		).toEqual({ releases: [] });
	});
});
