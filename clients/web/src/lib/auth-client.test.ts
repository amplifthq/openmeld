import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/env", () => ({
	env: { VITE_BETTER_AUTH_URL: "http://auth.localhost:28290" },
}));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.resetModules();
});

describe("shared auth client initialization", () => {
	it.each([
		["openmeld-desktop://app", "http://auth.localhost:28290"],
		["https://web.example", "https://web.example"],
	])("initializes from %s without issuing an auth request", async (origin, expected) => {
		vi.stubGlobal("window", { location: { origin } });
		const fetch = vi.fn();
		vi.stubGlobal("fetch", fetch);
		const client = await import("./auth-client");
		expect(client.resolveDefaultOpenMeldAuthBaseUrl()).toBe(expected);
		expect(client.openMeldAuthClient).toBeDefined();
		expect(fetch).not.toHaveBeenCalled();
	});
});
