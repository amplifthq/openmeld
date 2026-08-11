import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import {
	buildCliBinaryDownloadHeaders,
	buildCliBinaryManifestHeaders,
	CLI_BINARY_MANIFEST_R2_OBJECT_KEY,
	parseCliBinaryManifest,
	readCliBinaryManifest,
	resolveCliBinaryArtifactObjectKey,
} from "./cli-binary-release";

const CLI_BINARY_MANIFEST_FIXTURE_PATH = join(
	process.cwd(),
	"..",
	"openmeld-cli",
	"tests",
	"fixtures",
	"cli-binary-manifest.stable.json"
);

describe("CLI binary release metadata", () => {
	it("parses the captured stable CLI binary manifest", async () => {
		const manifest = parseCliBinaryManifest(
			JSON.parse(await readFile(CLI_BINARY_MANIFEST_FIXTURE_PATH, "utf8"))
		);

		expect(manifest).toEqual({
			schemaVersion: 1,
			channels: {
				stable: {
					version: "0.2.14",
					minRequiredCliVersion: "0.2.14",
					platforms: {
						"darwin-arm64": {
							url: "https://openmeld.ai/cli/download/openmeld-cli-darwin-arm64-0.2.14",
							sha256:
								"95381a4f7a425eff7a79c05c446052c91eadd410af69249f912f60347918ebb0",
							sizeBytes: 68_899_792,
						},
					},
				},
			},
		});
	});

	it("preserves a complete gzip transport while keeping the raw binary contract", async () => {
		const raw = JSON.parse(
			await readFile(CLI_BINARY_MANIFEST_FIXTURE_PATH, "utf8")
		);
		const release = raw.channels.stable.platforms["darwin-arm64"];
		Object.assign(release, {
			archiveFormat: "gzip",
			archiveUrl: `${release.url}.gz`,
			archiveSha256: "a".repeat(64),
			archiveSizeBytes: 25_721_096,
		});

		expect(
			parseCliBinaryManifest(raw).channels.stable.platforms["darwin-arm64"]
		).toMatchObject({
			archiveFormat: "gzip",
			archiveUrl: `${release.url}.gz`,
			archiveSha256: "a".repeat(64),
			archiveSizeBytes: 25_721_096,
		});
	});

	it("preserves signing identity and exact-base deltas for current clients", async () => {
		const raw = JSON.parse(
			await readFile(CLI_BINARY_MANIFEST_FIXTURE_PATH, "utf8")
		);
		const release = raw.channels.stable.platforms["darwin-arm64"];
		Object.assign(release, {
			codeIdentifier: "sh.openmeld.cli",
			deltas: [
				{
					fromSha256: "b".repeat(64),
					fromSizeBytes: 68_000_000,
					fromVersion: "0.2.13",
					patchCompression: "gzip",
					patchFormat: "block-ranges-v1",
					patchPayloadSizeBytes: 4_000_000,
					patchSha256: "c".repeat(64),
					patchSizeBytes: 990_000,
					patchUrl: `${release.url}-delta-from-0.2.13.gz`,
				},
			],
			teamIdentifier: "38FFHDPA3B",
		});

		expect(
			parseCliBinaryManifest(raw).channels.stable.platforms["darwin-arm64"]
		).toMatchObject({
			codeIdentifier: "sh.openmeld.cli",
			deltas: [{ fromVersion: "0.2.13", patchSizeBytes: 990_000 }],
			teamIdentifier: "38FFHDPA3B",
		});
	});

	it("rejects a partial gzip transport instead of silently falling back", async () => {
		const raw = JSON.parse(
			await readFile(CLI_BINARY_MANIFEST_FIXTURE_PATH, "utf8")
		);
		raw.channels.stable.platforms["darwin-arm64"].archiveFormat = "gzip";

		expect(() => parseCliBinaryManifest(raw)).toThrow(
			"compressed transport fields must be provided together"
		);
	});

	it("reads the CLI binary manifest from the stable R2 projection key", async () => {
		const manifestRaw = await readFile(
			CLI_BINARY_MANIFEST_FIXTURE_PATH,
			"utf8"
		);
		const store = {
			get: vi.fn(async (key: string) =>
				key === CLI_BINARY_MANIFEST_R2_OBJECT_KEY
					? { json: async () => JSON.parse(manifestRaw) }
					: null
			),
		};

		await expect(readCliBinaryManifest({ store })).resolves.toMatchObject({
			channels: { stable: { version: "0.2.14" } },
		});
		expect(store.get).toHaveBeenCalledWith(CLI_BINARY_MANIFEST_R2_OBJECT_KEY);
	});

	it("resolves only valid CLI binary artifact names under the cli prefix", () => {
		expect(
			resolveCliBinaryArtifactObjectKey("openmeld-cli-darwin-arm64-0.2.8")
		).toBe("cli/openmeld-cli-darwin-arm64-0.2.8");
		expect(
			resolveCliBinaryArtifactObjectKey("openmeld-cli-darwin-arm64-0.2.8.gz")
		).toBe("cli/openmeld-cli-darwin-arm64-0.2.8.gz");
		expect(
			resolveCliBinaryArtifactObjectKey(
				"openmeld-cli-darwin-arm64-0.2.8-delta-from-0.2.7.gz"
			)
		).toBe("cli/openmeld-cli-darwin-arm64-0.2.8-delta-from-0.2.7.gz");
		expect(resolveCliBinaryArtifactObjectKey("../manifest.json")).toBeNull();
		expect(
			resolveCliBinaryArtifactObjectKey("openmeld-cli-darwin-arm64")
		).toBeNull();
	});

	it("sets cache and content headers for manifest and binary downloads", () => {
		const manifestHeaders = buildCliBinaryManifestHeaders({
			etag: '"manifest-etag"',
		});
		expect(manifestHeaders.get("content-type")).toBe(
			"application/json; charset=utf-8"
		);
		expect(manifestHeaders.get("cache-control")).toBe(
			"public, max-age=60, s-maxage=60"
		);
		expect(manifestHeaders.get("etag")).toBe('"manifest-etag"');

		const downloadHeaders = buildCliBinaryDownloadHeaders({
			artifactName: "openmeld-cli-darwin-arm64-0.2.8",
			etag: '"artifact-etag"',
			sizeBytes: 42,
		});
		expect(downloadHeaders.get("content-type")).toBe(
			"application/octet-stream"
		);
		expect(downloadHeaders.get("cache-control")).toBe(
			"public, max-age=31536000, immutable"
		);
		expect(downloadHeaders.get("content-length")).toBe("42");
		expect(downloadHeaders.get("content-disposition")).toContain(
			"openmeld-cli-darwin-arm64-0.2.8"
		);

		const archiveHeaders = buildCliBinaryDownloadHeaders({
			artifactName: "openmeld-cli-darwin-arm64-0.2.8.gz",
		});
		expect(archiveHeaders.get("content-type")).toBe("application/gzip");
	});
});
