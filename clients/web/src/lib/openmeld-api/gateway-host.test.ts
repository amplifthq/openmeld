import { afterEach, describe, expect, it, vi } from "vitest";
import {
	resetBrowserQueryClientForTests,
	resolveAppQueryClient,
} from "#/integrations/tanstack-query/query-client";
import { getWebGatewayHost } from "./gateway-host";

afterEach(() => {
	resolveAppQueryClient().clear();
	resetBrowserQueryClientForTests();
	vi.unstubAllGlobals();
});

describe("client endpoint metadata", () => {
	it("shares concurrent and warm reads, then reads fresh metadata after cache invalidation", async () => {
		// Each transport read needs its own Response body.
		const fetchMock = vi.fn(async () =>
			Response.json({ gatewayHost: "gateway.example.com" })
		);
		vi.stubGlobal("fetch", fetchMock);
		expect(
			await Promise.all([getWebGatewayHost(), getWebGatewayHost()])
		).toEqual(["gateway.example.com", "gateway.example.com"]);
		expect(await getWebGatewayHost()).toBe("gateway.example.com");
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await resolveAppQueryClient().invalidateQueries({
			queryKey: ["client-environment"],
		});
		expect(await getWebGatewayHost()).toBe("gateway.example.com");
		expect(fetchMock).toHaveBeenCalledTimes(2);
	});
});
