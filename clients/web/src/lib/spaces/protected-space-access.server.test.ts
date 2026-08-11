import { describe, expect, it } from "vitest";
import {
	createExpiredProtectedSpaceAccessCookieHeader,
	createProtectedSpaceAccessCookieName,
	encodeProtectedSpaceAccessCookieValue,
	resolveProtectedSpaceAccessFromCookieHeader,
	shouldClearProtectedSpaceAccessFromErrorBody,
} from "./protected-space-access.server";

describe("protected space access helper", () => {
	it("round-trips an encrypted cookie for the matching space", async () => {
		const cookieValue = await encodeProtectedSpaceAccessCookieValue({
			spaceId: "space-123",
			password: "  secret-pass  ",
			secret: "secret-value",
		});

		const result = await resolveProtectedSpaceAccessFromCookieHeader({
			spaceId: "space-123",
			cookieHeader: `${createProtectedSpaceAccessCookieName("space-123")}=${cookieValue}`,
			secret: "secret-value",
		});

		expect(result).toEqual({
			status: "available",
			password: "secret-pass",
			cookieName: "openmeld_space_access_space-123",
		});
	});

	it("treats a mismatched or malformed cookie as invalid", async () => {
		const cookieValue = await encodeProtectedSpaceAccessCookieValue({
			spaceId: "space-abc",
			password: "secret-pass",
			secret: "secret-value",
		});

		await expect(
			resolveProtectedSpaceAccessFromCookieHeader({
				spaceId: "space-123",
				cookieHeader: `${createProtectedSpaceAccessCookieName("space-123")}=${cookieValue}`,
				secret: "secret-value",
			})
		).resolves.toEqual({
			status: "invalid",
			cookieName: "openmeld_space_access_space-123",
		});
	});

	it("builds an expiring cookie header for the matching space", () => {
		expect(
			createExpiredProtectedSpaceAccessCookieHeader({
				spaceId: "space-123",
				webAppUrl: "https://openmeld.test",
			})
		).toContain("openmeld_space_access_space-123=");
	});

	it("detects password-related gateway errors that should clear the cookie", () => {
		expect(
			shouldClearProtectedSpaceAccessFromErrorBody(
				JSON.stringify({
					error: {
						code: "space.password_required",
					},
				})
			)
		).toBe(true);
		expect(
			shouldClearProtectedSpaceAccessFromErrorBody(
				JSON.stringify({
					error: {
						code: "space.password_invalid",
					},
				})
			)
		).toBe(true);
		expect(
			shouldClearProtectedSpaceAccessFromErrorBody(
				JSON.stringify({
					error: {
						code: "space.not_found",
					},
				})
			)
		).toBe(false);
	});
});
