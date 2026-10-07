import { expect, it, vi } from "vitest";
import response from "./fixtures/production-latest.json";
import { readProductionChangelog } from "./read-latest-changelog.server";

// Captured from the anonymous production endpoint on 2026-10-07.
it("reads production anonymously and returns only the menu projection", async () => {
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValue(Response.json(response));
	const result = await readProductionChangelog(fetchImpl);
	expect(fetchImpl).toHaveBeenCalledTimes(1);
	const [url, init] = fetchImpl.mock.calls[0];
	expect(String(url)).toBe("https://gateway.openmeld.ai/v1/changelog?limit=3");
	expect(new Headers(init?.headers).has("authorization")).toBe(false);
	expect(new Headers(init?.headers).has("cookie")).toBe(false);
	expect(init?.signal).toBeInstanceOf(AbortSignal);
	expect(result).toEqual(
		response.entries.map(({ id, title, publishedAt }) => ({
			id,
			title,
			publishedAt,
		}))
	);
});

it("reports an unavailable production source instead of substituting local data", async () => {
	const fetchImpl = vi
		.fn<typeof fetch>()
		.mockResolvedValue(new Response("Unavailable", { status: 503 }));
	await expect(readProductionChangelog(fetchImpl)).rejects.toThrow();
	expect(fetchImpl).toHaveBeenCalledTimes(1);
});
