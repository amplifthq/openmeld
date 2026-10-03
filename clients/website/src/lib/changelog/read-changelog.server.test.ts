import { afterEach, describe, expect, it, vi } from "vitest";
import { readChangelogFromGateway } from "./read-changelog.server";

const RESPONSE = {
	entries: [],
	hasMore: false,
	latestPublishedAt: null,
	schemaVersion: 1 as const,
	source: {
		kind: "github" as const,
		path: "changelog/index.json",
		ref: "main",
		repository: "amplifthq/openmeld",
	},
	totalMatching: 0,
};

describe("Web Changelog server reader", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("reads the public Gateway contract without browser credentials", async () => {
		const fetchImpl = vi.fn<typeof fetch>(async () => Response.json(RESPONSE));

		await expect(
			readChangelogFromGateway({
				fetchImpl,
				gatewayUrl: "https://gateway.openmeld.test",
				query: {
					areas: ["web", "center-agent"],
					kinds: ["new", "fixed"],
					limit: 10,
					offset: 20,
					since: "2026-08-01",
				},
			})
		).resolves.toEqual(RESPONSE);
		expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(
			"https://gateway.openmeld.test/v1/changelog?area=web&area=center-agent&kind=new&kind=fixed&limit=10&offset=20&since=2026-08-01",
			expect.objectContaining({
				method: "GET",
			})
		);
		const requestInit = fetchImpl.mock.calls[0]?.[1];
		expect(requestInit).not.toHaveProperty("credentials");
	});

	it("preserves the Cloudflare fetch receiver when no test transport is supplied", async () => {
		const hostFetch = vi.fn(function (this: unknown) {
			if (this !== globalThis) {
				throw new TypeError("Illegal invocation");
			}
			return Promise.resolve(Response.json(RESPONSE));
		});
		vi.stubGlobal("fetch", hostFetch);

		await expect(
			readChangelogFromGateway({
				gatewayUrl: "https://gateway.openmeld.test",
				query: { limit: 10 },
			})
		).resolves.toEqual(RESPONSE);
		expect(hostFetch).toHaveBeenCalledExactlyOnceWith(
			"https://gateway.openmeld.test/v1/changelog?limit=10",
			expect.objectContaining({ method: "GET" })
		);
	});
});
