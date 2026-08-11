import { describe, expect, it } from "vitest";
import { shouldPreferMagicLink } from "#/lib/auth-login-preference";

describe("login route magic-link preference", () => {
	it.each([
		"/accept-invitation?invitationId=inv-1",
		"/join-organization?token=joinlink_123",
		"/link-slack?token=slacklink_123",
	])("prefers magic link for identity setup redirect %s", (redirectTarget) => {
		expect(shouldPreferMagicLink(redirectTarget)).toBe(true);
	});

	it("keeps the default login choices for a normal app redirect", () => {
		expect(shouldPreferMagicLink("/o/acme/center-agent/chat")).toBe(false);
	});
});
