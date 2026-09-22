import { describe, expect, it } from "vitest";
import { magicLinkRouteShowsVerification } from "./magic-link";

describe("magic-link route verification entry", () => {
	it("does not treat a social OAuth access_denied as a magic-link verification failure", () => {
		expect(magicLinkRouteShowsVerification({ error: "access_denied" })).toBe(
			false
		);
	});

	it.each([
		"state_mismatch",
		"oauth_provider_not_found",
	])("does not consume social OAuth error %s", (error) => {
		expect(magicLinkRouteShowsVerification({ error })).toBe(false);
	});

	it("still starts verification for a magic-link token or verification error", () => {
		expect(magicLinkRouteShowsVerification({ token: "token-123" })).toBe(true);
		expect(magicLinkRouteShowsVerification({ error: "INVALID_TOKEN" })).toBe(
			true
		);
	});
});
