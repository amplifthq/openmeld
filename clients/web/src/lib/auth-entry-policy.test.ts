import { describe, expect, it } from "vitest";
import {
	DEFAULT_AUTHENTICATED_ENTRY_PATH,
	resolveAuthenticatedEntryTarget,
	sanitizeAuthenticatedEntryTarget,
} from "./auth-entry-policy";

describe("auth entry policy", () => {
	it("falls back to the authenticated entry when redirect is missing", () => {
		expect(sanitizeAuthenticatedEntryTarget(null)).toBe(
			DEFAULT_AUTHENTICATED_ENTRY_PATH
		);
	});

	it("keeps a safe internal relative path as-is", () => {
		expect(
			sanitizeAuthenticatedEntryTarget("/o/acme/spaces/space-123?view=recent")
		).toBe("/o/acme/spaces/space-123?view=recent");
	});

	it("normalizes a trusted absolute url into an internal path", () => {
		expect(
			sanitizeAuthenticatedEntryTarget(
				"http://localhost:3000/o/acme/settings/account?tab=security#sessions",
				{
					trustedOrigins: ["http://localhost:3000"],
				}
			)
		).toBe("/o/acme/settings/account?tab=security#sessions");
	});

	it("fails closed to the login entry for untrusted, retired, or malformed redirects", () => {
		expect(
			sanitizeAuthenticatedEntryTarget("https://evil.example/app/account")
		).toBe(DEFAULT_AUTHENTICATED_ENTRY_PATH);
		expect(sanitizeAuthenticatedEntryTarget("//evil.example/app/account")).toBe(
			DEFAULT_AUTHENTICATED_ENTRY_PATH
		);
		expect(sanitizeAuthenticatedEntryTarget("/app/spaces/space-123")).toBe(
			DEFAULT_AUTHENTICATED_ENTRY_PATH
		);
		expect(sanitizeAuthenticatedEntryTarget("not a real url\n\t")).toBe(
			DEFAULT_AUTHENTICATED_ENTRY_PATH
		);
	});

	it("resolves explicit redirect precedence without inventing a current space", () => {
		expect(
			resolveAuthenticatedEntryTarget({
				requestedRedirect: "/device?user_code=abc123",
			})
		).toBe("/device?user_code=abc123");
		expect(
			resolveAuthenticatedEntryTarget({
				requestedRedirect: null,
			})
		).toBe(DEFAULT_AUTHENTICATED_ENTRY_PATH);
	});
});
