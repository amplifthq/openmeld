import { beforeEach, describe, expect, it } from "vitest";
import {
	resetBrowserQueryClientForTests,
	resolveAppQueryClient,
} from "./query-client";

describe("app query client", () => {
	beforeEach(() => {
		resetBrowserQueryClientForTests();
	});

	it("creates a fresh query client for each server request", () => {
		const firstQueryClient = resolveAppQueryClient({ isServer: true });
		const secondQueryClient = resolveAppQueryClient({ isServer: true });

		expect(firstQueryClient).not.toBe(secondQueryClient);
	});

	it("reuses one stable browser query client", () => {
		const firstQueryClient = resolveAppQueryClient({ isServer: false });
		const secondQueryClient = resolveAppQueryClient({ isServer: false });

		expect(firstQueryClient).toBe(secondQueryClient);
	});
});
