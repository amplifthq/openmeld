import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { serveCliDownload } from "./cli-download-cache.server";

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

function cacheFixture() {
	const entries = new Map<string, Response>();
	const match = vi.fn(async (key: Request) => entries.get(key.url)?.clone());
	const put = vi.fn((key: Request, response: Response) => {
		entries.set(key.url, response);
		return Promise.resolve();
	});
	vi.stubGlobal("caches", { open: () => Promise.resolve({ match, put }) });
	return { entries, match, put };
}

it("reuses public cached bodies across query noise, and keeps channels separate", async () => {
	const { put } = cacheFixture();
	const load = vi.fn(
		async () =>
			new Response("binary", {
				headers: { "Cache-Control": "public, max-age=60", ETag: '"release"' },
			})
	);
	const first = await serveCliDownload(
		new Request("https://app.test/cli/manifest.json?noise=1"),
		"stable",
		load
	);
	expect(await first.text()).toBe("binary");
	const second = await serveCliDownload(
		new Request("https://app.test/cli/manifest.json?noise=2"),
		"stable",
		load
	);
	expect(await second.text()).toBe("binary");
	expect(second.headers.get("etag")).toBe('"release"');
	expect(load).toHaveBeenCalledOnce();
	const head = await serveCliDownload(
		new Request("https://app.test/cli/manifest.json", { method: "HEAD" }),
		"stable",
		load
	);
	expect(await head.text()).toBe("");
	expect(load).toHaveBeenCalledOnce();
	await serveCliDownload(
		new Request("https://app.test/cli/manifest.json?channel=windows-preview"),
		"windows-preview",
		load
	);
	expect(load).toHaveBeenCalledTimes(2);
	expect(put).toHaveBeenCalledTimes(2);
});

it("does not cache missing releases or bodyless HEAD misses", async () => {
	const { put } = cacheFixture();
	for (const [method, status] of [
		["GET", 404],
		["GET", 503],
		["HEAD", 200],
	] as const) {
		await serveCliDownload(
			new Request("https://app.test/cli/download/file", { method }),
			"stable",
			async () => new Response(null, { status })
		);
	}
	expect(put).not.toHaveBeenCalled();
});

it("blocks abusive downloads before touching cache or storage", async () => {
	const { match } = cacheFixture();
	vi.spyOn(env.OPENMELD_CLI_DOWNLOAD_RATE_LIMITER, "limit").mockResolvedValue({
		success: false,
	});
	const load = vi.fn();
	const response = await serveCliDownload(
		new Request("https://app.test/cli/manifest.json", {
			headers: { "CF-Connecting-IP": "192.0.2.1" },
		}),
		"stable",
		load
	);
	expect(response.status).toBe(429);
	expect(response.headers.get("retry-after")).toBe("60");
	expect(load).not.toHaveBeenCalled();
	expect(match).not.toHaveBeenCalled();
});
