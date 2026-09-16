import { describe, expect, it, vi } from "vitest";
import {
	buildAbsoluteDesktopUrl,
	buildDesktopDownloadHeaders,
	buildDesktopReleaseOrigin,
	buildDesktopUpdateManifest,
	DESKTOP_RELEASE_MANIFEST_R2_OBJECT_KEY,
	parseDesktopPreviewReleaseManifest,
	readAvailableDesktopRelease,
	readDesktopPreviewReleaseManifest,
} from "./desktop-release";

describe("desktop release metadata", () => {
	it.each([
		null,
		151_512_850,
		151_512_849,
	])("checks the selected candidate artifact and never reads the default channel: %s", async (size) => {
		const id =
			"620faf604490b33d9f32ce3c4e5c6857e4a64dd4b5529e06d23a36e2b44255fa";
		const manifest = {
			schemaVersion: 1,
			target: "production",
			platform: "macos-arm64",
			version: "0.1.0-preview.0",
			releaseSha: "c1c13deed77ad26b20c86fa2978de14b05b919d6",
			sha256: id,
			sizeBytes: 151_512_850,
		};
		const store = {
			get: vi.fn(
				async () =>
					({ json: () => Response.json(manifest).json() }) satisfies Pick<
						R2ObjectBody,
						"json"
					>
			),
			head: vi.fn(async () =>
				size === null ? null : ({ size } satisfies Pick<R2Object, "size">)
			),
		};
		const result = readAvailableDesktopRelease(store, id);
		if (size === 151_512_849) {
			await expect(result).rejects.toThrow("size mismatch");
		} else {
			await expect(result).resolves.toEqual(
				size === null
					? null
					: {
							version: manifest.version,
							sizeBytes: size,
							downloadPath: `/desktop/download?candidate=${id}`,
							message: null,
						}
			);
		}
		expect(store.get).toHaveBeenCalledExactlyOnceWith(
			`desktop/candidates/${id}/manifest.json`
		);
		expect(store.head).toHaveBeenCalledExactlyOnceWith(
			`desktop/candidates/${id}/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64.dmg`
		);
	});
	it("does not fall back when a selected candidate is missing", async () => {
		const store = { get: vi.fn(async () => null), head: vi.fn() };
		await expect(
			readAvailableDesktopRelease(store, "a".repeat(64))
		).resolves.toBeNull();
		expect(store.get).toHaveBeenCalledExactlyOnceWith(
			`desktop/candidates/${"a".repeat(64)}/manifest.json`
		);
		expect(store.head).not.toHaveBeenCalled();
	});
	it("builds production-safe absolute URLs from the request origin", () => {
		expect(
			buildAbsoluteDesktopUrl({
				origin: "https://openmeld.invalid",
				pathname: "/desktop/download",
			})
		).toBe("https://openmeld.invalid/desktop/download");
		expect(
			buildDesktopReleaseOrigin("https://openmeld.invalid/desktop/update.json")
		).toBe("https://openmeld.invalid");
	});

	it("publishes the unsigned Apple silicon artifact in the update manifest", () => {
		const releaseManifest = parseDesktopPreviewReleaseManifest({
			latestVersion: "0.1.0-preview.1",
			minimumSupportedVersion: "0.1.0-preview.0",
			message: null,
			macosArm64: {
				artifactName:
					"OpenMeld-Desktop-0.1.0-preview.1-macos-arm64-unsigned.dmg",
				objectKey:
					"desktop/OpenMeld-Desktop-0.1.0-preview.1-macos-arm64-unsigned.dmg",
				version: "0.1.0-preview.1",
				sha256: "abc123",
				sizeBytes: 42,
			},
		});
		const manifest = buildDesktopUpdateManifest({
			origin: "https://openmeld.invalid",
			releaseManifest,
		});

		expect(manifest.latestVersion).toBe("0.1.0-preview.1");
		expect(manifest.minimumSupportedVersion).toBe("0.1.0-preview.0");
		expect(manifest.downloadPageUrl).toBe("https://openmeld.invalid/desktop");
		expect(manifest.macosArm64).toEqual({
			url: "https://openmeld.invalid/desktop/download",
			version: "0.1.0-preview.1",
			sha256: "abc123",
			sizeBytes: 42,
		});
		expect(releaseManifest.macosArm64.objectKey).toBe(
			"desktop/OpenMeld-Desktop-0.1.0-preview.1-macos-arm64-unsigned.dmg"
		);
	});

	it("reads the Desktop release manifest from the stable R2 projection key", async () => {
		const store = {
			get: vi.fn(async (key: string) =>
				key === DESKTOP_RELEASE_MANIFEST_R2_OBJECT_KEY
					? {
							json: async () => ({
								latestVersion: "0.1.0-preview.2",
								macosArm64: {
									artifactName:
										"OpenMeld-Desktop-0.1.0-preview.2-macos-arm64-unsigned.dmg",
									objectKey:
										"desktop/OpenMeld-Desktop-0.1.0-preview.2-macos-arm64-unsigned.dmg",
									version: "0.1.0-preview.2",
								},
							}),
						}
					: null
			),
		};

		await expect(
			readDesktopPreviewReleaseManifest({ store })
		).resolves.toMatchObject({
			latestVersion: "0.1.0-preview.2",
			minimumSupportedVersion: "0.1.0-preview.2",
			macosArm64: {
				objectKey:
					"desktop/OpenMeld-Desktop-0.1.0-preview.2-macos-arm64-unsigned.dmg",
				sha256: null,
				sizeBytes: null,
			},
		});
		expect(store.get).toHaveBeenCalledWith(
			DESKTOP_RELEASE_MANIFEST_R2_OBJECT_KEY
		);
	});

	it.each([
		null,
		{ size: 0 },
		{ size: 123 },
	])("offers a download only when its artifact exists and is nonempty: %j", async (artifact) => {
		const release = {
			latestVersion: "1.0.0",
			macosArm64: {
				version: "1.0.0",
				artifactName: "OpenMeld.dmg",
				objectKey: "desktop/OpenMeld.dmg",
			},
		};
		// R2 head's documented contract is object metadata or null.
		const store = {
			get: async () => ({ json: async () => release }),
			head: async (key: string) =>
				key === "desktop/OpenMeld.dmg" ? artifact : null,
		};
		const result = await readAvailableDesktopRelease(store);
		expect(result).toEqual(
			artifact?.size
				? {
						version: "1.0.0",
						sizeBytes: null,
						message: null,
						downloadPath: "/desktop/download",
					}
				: null
		);
	});

	it("keeps absent releases unavailable and rejects corrupt release metadata", async () => {
		await expect(readAvailableDesktopRelease(undefined)).resolves.toBeNull();
		await expect(
			readAvailableDesktopRelease({
				get: async () => null,
				head: async () => null,
			})
		).resolves.toBeNull();
		await expect(
			readAvailableDesktopRelease({
				get: async () => ({ json: async () => ({}) }),
				head: async () => ({ size: 123 }),
			})
		).rejects.toThrow("Invalid OpenMeld Desktop preview release manifest");
	});

	it("sets download headers for the DMG stream", () => {
		const headers = buildDesktopDownloadHeaders({
			artifactName: "OpenMeld-Desktop-0.1.0-preview.1-macos-arm64-unsigned.dmg",
			etag: '"etag-value"',
			sizeBytes: 123,
		});

		expect(headers.get("content-type")).toBe("application/x-apple-diskimage");
		expect(headers.get("content-length")).toBe("123");
		expect(headers.get("etag")).toBe('"etag-value"');
		expect(headers.get("content-disposition")).toContain(
			"OpenMeld-Desktop-0.1.0-preview.1-macos-arm64-unsigned.dmg"
		);
	});
});
