import { env, waitUntil } from "cloudflare:workers";

/** Only public CLI release responses belong here. Never use for Space data. */
export async function serveCliDownload(
	request: Request,
	channel: "stable" | "windows-preview",
	load: () => Promise<Response>
): Promise<Response> {
	const ip = request.headers.get("CF-Connecting-IP");
	if (ip) {
		const allowed = await env.OPENMELD_CLI_DOWNLOAD_RATE_LIMITER.limit({
			key: `${env.OPENMELD_WORKER_ENVIRONMENT}:cli:${ip}`,
		});
		if (!allowed.success) {
			return new Response("Too many requests. Try again in one minute.", {
				status: 429,
				headers: { "Retry-After": "60", "Cache-Control": "no-store" },
			});
		}
	}
	const url = new URL(request.url);
	// Unknown query parameters cannot manufacture cache misses.
	url.search = channel === "windows-preview" ? "?channel=windows-preview" : "";
	const key = new Request(url, { method: "GET" });
	const cache = await caches.open("openmeld-cli-releases");
	const cached = await cache.match(key);
	if (cached) {
		return request.method === "HEAD" ? new Response(null, cached) : cached;
	}
	const response = await load();
	// A HEAD miss must not populate a bodyless GET entry.
	if (request.method === "GET" && response.status === 200) {
		waitUntil(
			cache.put(key, response.clone()).catch((error: unknown) => {
				console.warn("CLI download cache write failed.", error);
			})
		);
	}
	return response;
}
