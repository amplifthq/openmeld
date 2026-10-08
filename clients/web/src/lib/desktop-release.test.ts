import {
	DESKTOP_PROMOTED_RELEASE_KEY,
	desktopCandidateManifestSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { getDesktopDownloads } from "./desktop-downloads";
import {
	buildDesktopUpdateManifest,
	buildDesktopUpdaterFeed,
	readAvailableDesktopRelease,
	readDesktopPreviewReleaseManifest,
	readPromotedDesktopRelease,
} from "./desktop-release";

const id = "a".repeat(64);
const candidate = desktopCandidateManifestSchema.parse({
	schemaVersion: 1,
	target: "production",
	platform: "macos-arm64",
	version: "0.1.1",
	releaseSha: "b".repeat(40),
	sha256: id,
	sizeBytes: 123,
	zip: {
		sha256: "c".repeat(64),
		sha512: `${"A".repeat(86)}==`,
		sizeBytes: 456,
	},
});
function storeWith(metadata: unknown = candidate, size: number | null = 123) {
	return {
		get: vi.fn((key: string) => {
			if (key === DESKTOP_PROMOTED_RELEASE_KEY) {
				return Promise.resolve({
					json: async () => ({
						schemaVersion: 1,
						candidate: id,
						promotedAt: "2026-01-01T00:00:00Z",
					}),
				});
			}
			if (key === `desktop/candidates/${id}/manifest.json`) {
				return Promise.resolve({ json: async () => metadata });
			}
			return Promise.resolve(null);
		}),
		head: vi.fn(async () => (size === null ? null : { size })),
	};
}
describe("Desktop promoted release", () => {
	it("projects the same release into the public page, legacy JSON and updater feed", async () => {
		const store = storeWith();
		const page = await readAvailableDesktopRelease(store);
		const catalogResponse = await getDesktopDownloads(
			new Request("https://app.openmeld.ai/desktop/releases.json"),
			store
		);
		const catalog = await catalogResponse.json();
		expect(catalog).toEqual({ releases: [page] });
		const release = await readDesktopPreviewReleaseManifest({ store });
		const promoted = await readPromotedDesktopRelease(store);
		if (!(release && promoted)) {
			throw new Error("Missing fixture release");
		}
		const legacy = buildDesktopUpdateManifest({
			origin: "https://openmeld.ai",
			releaseManifest: release,
		});
		const feed = JSON.parse(buildDesktopUpdaterFeed(promoted));
		expect([page?.version, legacy.latestVersion, feed.version]).toEqual([
			"0.1.1",
			"0.1.1",
			"0.1.1",
		]);
		expect(legacy.macosArm64.sha256).toBe(id);
		expect(feed.files).toEqual([
			{
				url: `/desktop/updates/${id}/desktop.zip`,
				sha512: candidate.zip?.sha512,
				size: 456,
			},
		]);
		expect(
			store.get.mock.calls.some(([key]) => key === "desktop/update.json")
		).toBe(false);
	});
	it.each([
		null,
		122,
		123,
	])("uses the selected candidate without a default fallback: %s", async (size) => {
		const store = storeWith(candidate, size);
		if (size === 122) {
			await expect(readAvailableDesktopRelease(store, id)).rejects.toThrow(
				"size mismatch"
			);
		} else {
			expect(
				(await readAvailableDesktopRelease(store, id))?.version ?? null
			).toBe(size === null ? null : "0.1.1");
		}
		expect(store.get).toHaveBeenCalledExactlyOnceWith(
			`desktop/candidates/${id}/manifest.json`
		);
	});
	it.each([
		"",
		"../promoted.json",
		"A".repeat(64),
	])("rejects malformed candidate selectors: %s", async (value) => {
		const store = storeWith();
		await expect(readAvailableDesktopRelease(store, value)).rejects.toThrow();
		expect(store.get).not.toHaveBeenCalled();
	});
	it("does not fall back when a selected candidate is absent", async () => {
		const store = storeWith();
		expect(await readAvailableDesktopRelease(store, "d".repeat(64))).toBeNull();
		expect(store.get).toHaveBeenCalledExactlyOnceWith(
			`desktop/candidates/${"d".repeat(64)}/manifest.json`
		);
	});
	it.each([
		{ ...candidate, zip: undefined },
		{ ...candidate, sha256: "d".repeat(64) },
		{},
	])("rejects incomplete or corrupt promoted candidates", async (metadata) => {
		await expect(
			readPromotedDesktopRelease(storeWith(metadata))
		).rejects.toThrow();
	});
	it("keeps an absent or incomplete default download unavailable", async () => {
		expect(await readAvailableDesktopRelease(undefined)).toBeNull();
		expect(
			await readAvailableDesktopRelease({
				get: async () => null,
				head: async () => null,
			})
		).toBeNull();
		expect(
			await readAvailableDesktopRelease(storeWith(candidate, 122))
		).toBeNull();
	});
});
