import { describe, expect, it } from "vitest";
import { isDevtoolsEnabled } from "./devtools-policy";

describe("TanStack devtools policy", () => {
	it("fails closed outside development mode", () => {
		expect(
			isDevtoolsEnabled({
				isDevelopment: false,
				search: "?devtools=1",
			})
		).toBe(false);
	});

	it("stays disabled by default in development", () => {
		expect(
			isDevtoolsEnabled({
				isDevelopment: true,
				search: "",
			})
		).toBe(false);
	});

	it("enables devtools only for the explicit opt-in query flag", () => {
		expect(
			isDevtoolsEnabled({
				isDevelopment: true,
				search: "?devtools=1",
			})
		).toBe(true);
		expect(
			isDevtoolsEnabled({
				isDevelopment: true,
				search: "?devtools=true",
			})
		).toBe(false);
	});
});
