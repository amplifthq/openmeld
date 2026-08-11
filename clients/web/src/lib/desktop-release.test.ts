import { describe, expect, it, vi } from "vitest";
import {
	buildAbsoluteDesktopUrl,
	buildDesktopDownloadHeaders,
	buildDesktopReleaseOrigin,
	buildDesktopUpdateManifest,
	DESKTOP_RELEASE_MANIFEST_R2_OBJECT_KEY,
	parseDesktopPreviewReleaseManifest,
	readDesktopPreviewReleaseManifest,
} from "./desktop-release";

describe("desktop release metadata", () => {
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
