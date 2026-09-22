import { describe, expect, it } from "vitest";
import {
	classifySignInError,
	isSocialOAuthCallbackError,
	resolveSocialOAuthErrorCallbackURL,
} from "./auth-sign-in-error";

describe("classifySignInError", () => {
	it("returns no presentation for an ordinary sign-in landing", () => {
		expect(classifySignInError(undefined)).toEqual({ kind: "none" });
		expect(classifySignInError(null)).toEqual({ kind: "none" });
		expect(classifySignInError("")).toEqual({ kind: "none" });
	});

	it.each([
		"state_mismatch",
		"state_not_found",
		"state_invalid",
	])("treats an unverifiable OAuth callback state (%s) as an abandoned sign-in, not a crash", (code) => {
		expect(classifySignInError(code)).toEqual({ kind: "abandoned" });
	});

	it("treats an explicit provider denial as an abandoned sign-in", () => {
		expect(classifySignInError("access_denied")).toEqual({
			kind: "abandoned",
		});
	});

	it("surfaces a real integration failure instead of hiding it", () => {
		expect(classifySignInError("oauth_provider_not_found")).toEqual({
			kind: "failed",
			message:
				"We couldn't finish signing you in. Try again, or contact support if this continues. (oauth_provider_not_found)",
		});
	});

	it("fails toward a visible message for an unrecognized code", () => {
		const result = classifySignInError("something_new_from_a_newer_provider");
		expect(result.kind).toBe("failed");
	});
});

describe("social OAuth error landing", () => {
	it.each([
		"http://localhost:3000/sign-up",
		"http://localhost:3000/sign-up?redirect=%2Fo%2Facme",
		"http://localhost:3000/magic-link",
		"http://localhost:3000/magic-link?redirect=%2F",
		"http://localhost:3000/login?redirect=%2F",
	])("returns %s to /login so only login classifies the error", (pageUrl) => {
		expect(resolveSocialOAuthErrorCallbackURL(pageUrl)).toBe(
			"http://localhost:3000/login"
		);
	});

	it("keeps a magic-link verification error out of the social OAuth set", () => {
		expect(isSocialOAuthCallbackError("INVALID_TOKEN")).toBe(false);
		expect(isSocialOAuthCallbackError("access_denied")).toBe(true);
	});
});
