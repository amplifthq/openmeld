import { describe, expect, it } from "vitest";
import {
	buildLoginRedirectUrl,
	isSessionExpiredError,
	SESSION_EXPIRED_CTA_LABEL,
	SESSION_EXPIRED_MESSAGE,
	toSessionExpiredState,
} from "./session-expired";

describe("session expired errors", () => {
	it("recognizes every Web 401 shape as the same expired-session state", () => {
		const examples = [
			{ status: 401, message: "Unauthorized" },
			{
				code: "auth.unauthenticated",
				message: "authentication required",
				status: 401,
			},
			{
				code: "gateway.http_error",
				message: "authentication required",
				status: 401,
				upstreamCode: "auth.unauthenticated",
			},
			new Error(SESSION_EXPIRED_MESSAGE),
			new Error("authentication required"),
		];

		for (const error of examples) {
			expect(isSessionExpiredError(error)).toBe(true);
			expect(
				toSessionExpiredState(error, "/o/acme/connect?session=fresh")
			).toEqual({
				ctaLabel: SESSION_EXPIRED_CTA_LABEL,
				href: "/login?redirect=%2Fo%2Facme%2Fconnect%3Fsession%3Dfresh",
				message: SESSION_EXPIRED_MESSAGE,
			});
		}
	});

	it("does not treat unrelated failures as session expired", () => {
		expect(
			isSessionExpiredError({ status: 500, message: "Backend blew up" })
		).toBe(false);
		expect(isSessionExpiredError(new Error("network timeout"))).toBe(false);
		expect(
			isSessionExpiredError({ code: "space.password_required", status: 403 })
		).toBe(false);
		expect(
			isSessionExpiredError({ code: "space.password_required", status: 401 })
		).toBe(false);
	});

	it("builds a login redirect from only a safe internal path", () => {
		expect(buildLoginRedirectUrl("/o/acme/spaces/space-123?tab=chat")).toBe(
			"/login?redirect=%2Fo%2Facme%2Fspaces%2Fspace-123%3Ftab%3Dchat"
		);
		// Untrusted targets fail closed to the default authenticated entry.
		expect(buildLoginRedirectUrl("https://evil.example/app/spaces")).toBe(
			"/login?redirect=%2Flogin"
		);
		expect(buildLoginRedirectUrl("//evil.example/app/spaces")).toBe(
			"/login?redirect=%2Flogin"
		);
	});
});
