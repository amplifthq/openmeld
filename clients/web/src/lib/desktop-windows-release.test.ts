import {
	type DesktopReleasePlatform,
	desktopCandidateLocation,
	desktopCandidateManifestSchema,
	desktopCandidateUpdateArtifact,
	desktopPlatformUpdateFeedUrl,
	desktopPromotedReleaseKey,
	desktopUpdaterFeedSchemaForPlatform,
} from "@openmeld/schemas";
import { afterEach, expect, it, vi } from "vitest";
import { downloadDesktopPreview } from "../routes/desktop/download";
import { readAvailableDesktopRelease } from "./desktop-release";
import {
	desktopUpdateArtifactResponse,
	desktopUpdateFeedResponse,
} from "./desktop-update-response";

const bucket = vi.hoisted(() => ({ get: vi.fn(), head: vi.fn() }));
vi.mock("cloudflare:workers", () => ({
	env: { OPENMELD_DESKTOP_DOWNLOADS: bucket },
}));
const windowsPlatforms = ["windows-x64", "windows-arm64"] as const;
const platforms = ["macos-arm64", ...windowsPlatforms] as const;
const sha512 = `${"A".repeat(86)}==`;
const manifests = Object.fromEntries(
	platforms.map((platform, index) => [
		platform,
		desktopCandidateManifestSchema.parse({
			schemaVersion: 1,
			target: "production",
			platform,
			version: `0.1.${index + 3}`,
			releaseSha: "d".repeat(40),
			sha256: String.fromCharCode(97 + index).repeat(64),
			sizeBytes: 3,
			...(platform === "macos-arm64"
				? { zip: { sha256: "e".repeat(64), sha512, sizeBytes: 3 } }
				: { windows: { sha512, publisherName: "Fixture Publisher" } }),
		}),
	])
);
const objects = new Map<string, string>();
function object(text: string) {
	const response = new Response(text);
	if (!response.body) {
		throw new Error("Fixture must have a stream");
	}
	return {
		json: () => response.json(),
		body: response.body,
		size: new TextEncoder().encode(text).length,
		httpEtag: '"fixture-etag"',
	} satisfies Pick<R2ObjectBody, "json" | "body" | "size" | "httpEtag">;
}
function publish(platform: DesktopReleasePlatform) {
	const manifest = manifests[platform];
	if (!manifest) {
		throw new Error("Missing fixture manifest");
	}
	const location = desktopCandidateLocation(manifest);
	const update = desktopCandidateUpdateArtifact(manifest);
	if (!update) {
		throw new Error("Fixture requires update payload");
	}
	objects.set(
		desktopPromotedReleaseKey(platform),
		JSON.stringify({
			schemaVersion: 1,
			candidate: manifest.sha256,
			promotedAt: "2026-09-19T00:00:00.000Z",
		})
	);
	objects.set(location.manifestKey, JSON.stringify(manifest));
	objects.set(location.objectKey, "exe");
	objects.set(update.objectKey, "exe");
	bucket.get.mockImplementation(async (key: string) =>
		objects.has(key) ? object(objects.get(key) ?? "") : null
	);
	bucket.head.mockImplementation(async (key: string) =>
		objects.has(key)
			? ({
					size: new TextEncoder().encode(objects.get(key)).length,
					httpEtag: '"fixture-etag"',
				} satisfies Pick<R2Object, "size" | "httpEtag">)
			: null
	);
	return { manifest, location, update };
}
afterEach(() => {
	objects.clear();
	vi.resetAllMocks();
});

it.each(
	windowsPlatforms
)("uses one %s pointer for page, default download, feed and immutable update", async (platform) => {
	publish("macos-arm64");
	const { manifest, location, update } = publish(platform);
	const page = await readAvailableDesktopRelease(bucket, undefined, platform);
	expect(page).toMatchObject({
		platform,
		version: manifest.version,
		downloadPath: `/desktop/download?platform=${platform}`,
	});
	const download = await downloadDesktopPreview({
		includeBody: true,
		request: new Request(`https://openmeld.ai${page?.downloadPath}`),
	});
	expect(download.status).toBe(200);
	expect(download.headers.get("content-type")).toBe(
		"application/vnd.microsoft.portable-executable"
	);
	expect(download.headers.get("content-disposition")).toContain(
		location.artifactName
	);
	expect(await download.text()).toBe("exe");
	const response = await desktopUpdateFeedResponse(bucket, platform);
	expect(response.status).toBe(200);
	expect(response.headers.get("cache-control")).toBe("no-store");
	const feed = desktopUpdaterFeedSchemaForPlatform(platform).parse(
		await response.json()
	);
	expect(feed.version).toBe(manifest.version);
	expect(feed.path).toBe(update.path);
	expect(feed.files).toHaveLength(1);
	expect(desktopPlatformUpdateFeedUrl(platform)).toBe(
		`https://openmeld.ai/desktop/updates/${platform}`
	);
	for (const includeBody of [true, false]) {
		const payload = await desktopUpdateArtifactResponse(
			bucket,
			platform,
			manifest.sha256,
			includeBody
		);
		expect(payload.status).toBe(200);
		expect(payload.headers.get("content-length")).toBe("3");
		expect(payload.headers.get("cache-control")).toContain("immutable");
		expect(await payload.text()).toBe(includeBody ? "exe" : "");
	}
});

it.each(
	windowsPlatforms
)("never substitutes Mac when the %s channel is missing", async (platform) => {
	publish("macos-arm64");
	expect(
		await readAvailableDesktopRelease(bucket, undefined, platform)
	).toBeNull();
	expect((await desktopUpdateFeedResponse(bucket, platform)).status).toBe(404);
	expect(
		(
			await downloadDesktopPreview({
				includeBody: false,
				request: new Request(
					`https://openmeld.ai/desktop/download?platform=${platform}`
				),
			})
		).status
	).toBe(404);
	expect(
		bucket.get.mock.calls.every(
			([key]) => key === desktopPromotedReleaseKey(platform)
		)
	).toBe(true);
});

it("rejects a pointer targeting another architecture before exposing a feed", async () => {
	const { manifest } = publish("windows-arm64");
	objects.set(
		desktopPromotedReleaseKey("windows-x64"),
		JSON.stringify({
			schemaVersion: 1,
			candidate: manifest.sha256,
			promotedAt: "2026-09-19T00:00:00.000Z",
		})
	);
	expect((await desktopUpdateFeedResponse(bucket, "windows-x64")).status).toBe(
		503
	);
	expect(bucket.head).not.toHaveBeenCalled();
});

it("rejects cross-platform immutable paths and explicit download selectors without artifact reads", async () => {
	const { manifest } = publish("windows-arm64");
	expect(
		(
			await desktopUpdateArtifactResponse(
				bucket,
				"windows-x64",
				manifest.sha256,
				true
			)
		).status
	).toBe(404);
	expect(
		(
			await desktopUpdateArtifactResponse(
				bucket,
				"macos-arm64",
				manifest.sha256,
				true
			)
		).status
	).toBe(404);
	expect(
		(
			await downloadDesktopPreview({
				includeBody: true,
				request: new Request(
					`https://openmeld.ai/desktop/download?candidate=${manifest.sha256}&platform=windows-x64`
				),
			})
		).status
	).toBe(404);
	expect(
		bucket.get.mock.calls.every(([key]) => key.endsWith("/manifest.json"))
	).toBe(true);
});

it.each([
	null,
	"wrong-size",
])("does not offer an absent or partial Windows installer: %s", async (replacement) => {
	const { manifest, location } = publish("windows-x64");
	if (replacement === null) {
		objects.delete(location.objectKey);
	} else {
		objects.set(location.objectKey, replacement);
	}
	expect(
		await readAvailableDesktopRelease(bucket, undefined, "windows-x64")
	).toBeNull();
	expect((await desktopUpdateFeedResponse(bucket, "windows-x64")).status).toBe(
		503
	);
	expect(
		(
			await desktopUpdateArtifactResponse(
				bucket,
				"windows-x64",
				manifest.sha256,
				false
			)
		).status
	).toBe(replacement === null ? 404 : 503);
});

it.each([
	"../promoted",
	"",
	"windows-ia32",
	["windows-x64", "windows-arm64"],
])("rejects invalid platform selectors before storage: %o", async (value) => {
	const url = new URL("https://openmeld.ai/desktop/download");
	for (const platform of Array.isArray(value) ? value : [value]) {
		url.searchParams.append("platform", platform);
	}
	expect(
		(
			await downloadDesktopPreview({
				includeBody: false,
				request: new Request(url),
			})
		).status
	).toBe(400);
	expect(bucket.get).not.toHaveBeenCalled();
});

it("rejects external URLs, extra files, web-installer packages and wrong architecture in client update feeds", () => {
	const base = {
		version: "0.1.4",
		releaseDate: "2026-09-19T00:00:00.000Z",
		path: `/desktop/updates/${"a".repeat(64)}/windows-x64.exe`,
		sha512,
	};
	const feed = { ...base, files: [{ url: base.path, sha512, size: 3 }] };
	expect(
		desktopUpdaterFeedSchemaForPlatform("windows-x64").safeParse(feed).success
	).toBe(true);
	expect(
		desktopUpdaterFeedSchemaForPlatform("windows-arm64").safeParse(feed).success
	).toBe(false);
	expect(
		desktopUpdaterFeedSchemaForPlatform("macos-arm64").safeParse(feed).success
	).toBe(false);
	for (const extra of [
		{ files: [...feed.files, ...feed.files] },
		{ packages: { x64: {} } },
		{ path: "https://other.invalid/file.exe" },
	]) {
		expect(
			desktopUpdaterFeedSchemaForPlatform("windows-x64").safeParse({
				...feed,
				...extra,
			}).success
		).toBe(false);
	}
});
