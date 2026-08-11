import { describe, expect, it } from "vitest";
import {
	getAuthErrorMessage,
	isFreshSessionRequiredError,
} from "./auth-errors";

describe("auth error messages", () => {
	it("recognizes Better Auth fresh-session failures by code", () => {
		const error = {
			code: "SESSION_NOT_FRESH",
			message: "Session is not fresh",
		};

		expect(isFreshSessionRequiredError(error)).toBe(true);
		expect(getAuthErrorMessage(error)).toBe("Sign in again to continue.");
	});

	it("recognizes Better Auth fresh-session failures by message", () => {
		const error = new Error("Session is not fresh");

		expect(isFreshSessionRequiredError(error)).toBe(true);
		expect(getAuthErrorMessage(error)).toBe("Sign in again to continue.");
	});
});
