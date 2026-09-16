import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadDesktopPreview } from "./download";

const store = vi.hoisted(() => ({ get: vi.fn(), head: vi.fn() }));
vi.mock("cloudflare:workers", () => ({
	env: { OPENMELD_DESKTOP_DOWNLOADS: store },
}));
const id = "a".repeat(64);
const manifest = {
	schemaVersion: 1,
	target: "production",
	platform: "macos-arm64",
	version: "0.1.0-preview.0",
	releaseSha: "b".repeat(40),
	sha256: id,
	sizeBytes: 3,
};
const metadataKey = `desktop/candidates/${id}/manifest.json`;
const artifactKey = `desktop/candidates/${id}/OpenMeld-Desktop-0.1.0-preview.0-macos-arm64.dmg`;
const call = (query: string, includeBody = true) =>
	downloadDesktopPreview({
		request: new Request(`https://openmeld.ai/desktop/download${query}`),
		includeBody,
	});
function object(body: string) {
	const response = new Response(body);
	if (!response.body) {
		throw new Error("Fixture response body is required.");
	}
	return {
		body: response.body,
		json: () => response.json(),
		size: new TextEncoder().encode(body).length,
		httpEtag: '"etag"',
	} satisfies Pick<R2ObjectBody, "body" | "json" | "size" | "httpEtag">;
}

describe("immutable Desktop candidate download", () => {
	afterEach(() => vi.resetAllMocks());
	it.each([
		"?candidate=",
		"?candidate=../update.json",
		`?candidate=${id.toUpperCase()}`,
		`?candidate=${id}&candidate=${id}`,
	])("rejects invalid selectors before any storage access: %s", async (query) => {
		expect((await call(query)).status).toBe(400);
		expect(store.get).not.toHaveBeenCalled();
	});
	it.each([
		true,
		false,
	])("serves the selected candidate without reading the default channel, body=%s", async (includeBody) => {
		store.get.mockImplementation((key) => {
			if (key === metadataKey) {
				return Promise.resolve(object(JSON.stringify(manifest)));
			}
			return Promise.resolve(key === artifactKey ? object("dmg") : null);
		});
		store.head.mockResolvedValue({ size: 3, httpEtag: '"etag"' } satisfies Pick<
			R2Object,
			"size" | "httpEtag"
		>);
		const response = await call(`?candidate=${id}`, includeBody);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe(includeBody ? "dmg" : "");
		expect(response.headers.get("content-length")).toBe("3");
		expect(response.headers.get("content-disposition")).toBe(
			'attachment; filename="OpenMeld-Desktop-0.1.0-preview.0-macos-arm64.dmg"'
		);
		expect(response.headers.get("cache-control")).toContain("immutable");
		expect(store.get.mock.calls.map((args) => args[0])).toEqual(
			includeBody ? [metadataKey, artifactKey] : [metadataKey]
		);
	});
	it.each([
		null,
		{ ...manifest, sha256: "c".repeat(64) },
		{ ...manifest, objectKey: "desktop/update.json" },
		{ ...manifest, target: "disposable" },
		{ ...manifest, version: "../private" },
	])("fails closed for absent or invalid metadata", async (value) => {
		store.get.mockResolvedValue(value ? object(JSON.stringify(value)) : null);
		const response = await call(`?candidate=${id}`);
		expect(response.status).toBe(value ? 500 : 404);
		expect(store.get).toHaveBeenCalledTimes(1);
	});
	it("rejects an artifact with a different size and never falls back", async () => {
		store.get.mockImplementation(async (key) =>
			key === metadataKey ? object(JSON.stringify(manifest)) : object("wrong")
		);
		expect((await call(`?candidate=${id}`)).status).toBe(500);
		expect(store.get.mock.calls.map((args) => args[0])).toEqual([
			metadataKey,
			artifactKey,
		]);
	});
	it("retains the default manifest path when no candidate is selected", async () => {
		store.get.mockResolvedValue(null);
		expect((await call("")).status).toBe(404);
		expect(store.get).toHaveBeenCalledWith("desktop/update.json");
	});
});
