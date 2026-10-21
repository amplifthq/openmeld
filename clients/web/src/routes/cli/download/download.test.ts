import { beforeEach, expect, it, vi } from "vitest";
import { downloadCliBinaryArtifact } from "./$artifact";

const store = vi.hoisted(() => ({ get: vi.fn(), head: vi.fn() }));
vi.mock("cloudflare:workers", () => ({
	env: { OPENMELD_DESKTOP_DOWNLOADS: store },
	waitUntil: vi.fn(),
}));
beforeEach(() => vi.resetAllMocks());

const artifactName = "openmeld-cli-darwin-arm64-0.2.14";

it("serves a HEAD request from metadata without fetching the binary", async () => {
	const metadata = { httpEtag: '"release"', size: 68_899_792 } satisfies Pick<
		R2Object,
		"httpEtag" | "size"
	>;
	store.head.mockResolvedValue(metadata);
	const response = await downloadCliBinaryArtifact({
		artifactName,
		channel: "stable",
		includeBody: false,
	});
	expect(response.status).toBe(200);
	expect(await response.text()).toBe("");
	expect(response.headers.get("Content-Length")).toBe("68899792");
	expect(response.headers.get("ETag")).toBe('"release"');
	expect(store.head).toHaveBeenCalledOnce();
	expect(store.get).not.toHaveBeenCalled();
});

it("preserves binary GET content and rejects invalid names before storage", async () => {
	const body = new Response("binary").body;
	if (!body) {
		throw new Error("Fixture response body is required.");
	}
	store.get.mockResolvedValue({
		body,
		httpEtag: '"release"',
		size: 6,
	} satisfies Pick<R2ObjectBody, "body" | "httpEtag" | "size">);
	const response = await downloadCliBinaryArtifact({
		artifactName,
		channel: "stable",
		includeBody: true,
	});
	expect(await response.text()).toBe("binary");
	expect(response.headers.get("Cache-Control")).toContain("immutable");
	expect(store.head).not.toHaveBeenCalled();
	store.get.mockClear();
	const invalid = await downloadCliBinaryArtifact({
		artifactName: "../../private",
		channel: "stable",
		includeBody: true,
	});
	expect(invalid.status).toBe(400);
	expect(store.get).not.toHaveBeenCalled();
});
