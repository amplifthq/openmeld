import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { Route } from "./desktop";

describe("Desktop download route", () => {
	it("stays unavailable while Desktop distribution is paused", () => {
		let thrown: unknown;
		try {
			Route.options.beforeLoad?.({} as never);
		} catch (error) {
			thrown = error;
		}

		expect(isNotFound(thrown)).toBe(true);
	});
});
