import { describe, expect, it } from "vitest";
import { Route } from "./desktop";

describe("Desktop download page selection", () => {
	it.each([
		"../update.json",
		"",
		"A".repeat(64),
		["a".repeat(64), "a".repeat(64)],
	])("rejects invalid or repeated candidates: %j", (candidate) => {
		const validate = Route.options.validateSearch;
		if (typeof validate !== "function") {
			throw new Error("Search validator missing");
		}
		expect(() => validate({ candidate })).toThrow();
	});
	it("keeps the selected candidate in loader dependencies", () => {
		const candidate = "a".repeat(64);
		expect(
			Route.options.loaderDeps?.({ search: { candidate } } as never)
		).toEqual({ candidate });
	});
});
