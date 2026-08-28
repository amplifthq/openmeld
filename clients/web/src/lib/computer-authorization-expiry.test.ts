import { describe, expect, it } from "vitest";
import { resolveComputerAuthorizationHandoffExpiresAt } from "./computer-authorization-expiry";

describe("computer authorization handoff expiry", () => {
	it("uses the earlier of Prepare and Device Authorization expiry", () => {
		expect(
			resolveComputerAuthorizationHandoffExpiresAt({
				authorizationExpiresInSeconds: 600,
				nowMs: Date.parse("2026-08-29T00:00:00.000Z"),
				prepareSessionExpiresAt: "2026-08-29T00:05:00.000Z",
			})
		).toBe("2026-08-29T00:05:00.000Z");
	});

	it("uses the Device Authorization lifetime when Prepare has no expiry", () => {
		expect(
			resolveComputerAuthorizationHandoffExpiresAt({
				authorizationExpiresInSeconds: 300,
				nowMs: Date.parse("2026-08-29T00:00:00.000Z"),
				prepareSessionExpiresAt: null,
			})
		).toBe("2026-08-29T00:05:00.000Z");
	});
});
