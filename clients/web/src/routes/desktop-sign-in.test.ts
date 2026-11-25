import { describe, expect, it, vi } from "vitest";
import { Route } from "./desktop-sign-in";

vi.mock("#/lib/auth-session", () => ({
	getSession: vi.fn(),
}));

const validateSearch = Route.options.validateSearch as (
	search: Record<string, unknown>
) => Record<string, string>;

const desktopRequest = {
	client_id: "openmeld-desktop",
	state: "test-state",
	code_challenge: "test-challenge",
};

describe("Desktop sign-in search", () => {
	it.each([
		["omitted (Better Auth 1.7)", {}],
		["explicit S256", { code_challenge_method: "S256" }],
	])("accepts %s without changing the PKCE request", (_label, method) => {
		expect(validateSearch({ ...desktopRequest, ...method })).toEqual({
			...desktopRequest,
			code_challenge_method: "S256",
		});
	});

	it.each(
		["plain", "s256", "unsupported", "", null, 256, ["S256"]].map((method) => ({
			method,
		}))
	)("rejects an explicit unsupported method: %j", ({ method }) => {
		expect(
			validateSearch({
				...desktopRequest,
				code_challenge_method: method,
			}).code_challenge_method
		).toBe("");
	});

	it.each([
		"client_id",
		"state",
		"code_challenge",
	])("does not fill in a missing %s when the method is omitted", (field) => {
		const search: Record<string, unknown> = { ...desktopRequest };
		delete search[field];
		expect(validateSearch(search)[field]).toBe("");
	});
});
