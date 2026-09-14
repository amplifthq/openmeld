import { isNotFound } from "@tanstack/react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "./desktop";

describe("Desktop download route", () => {
	afterEach(() => vi.unstubAllEnvs());
	it("stays unavailable while Desktop distribution is paused", () => {
		vi.stubEnv("DEV", false);
		let thrown: unknown;
		try {
			Route.options.beforeLoad?.({} as never);
		} catch (error) {
			thrown = error;
		}

		expect(isNotFound(thrown)).toBe(true);
	});

	it("allows local development review", () => {
		vi.stubEnv("DEV", true);
		expect(() => Route.options.beforeLoad?.({} as never)).not.toThrow();
	});
});
