import { describe, expect, it } from "vitest";
import {
	resolveDefaultOrganizationForSession,
	resolveOrganizationScopeForSession,
	resolvePublicLoginRedirectTarget,
} from "./organization-scope";
import type { OrganizationSummary } from "./organization-types";

const ORGANIZATIONS: readonly OrganizationSummary[] = [
	{ id: "org-acme", name: "Acme", slug: "acme" },
	{ id: "org-beta", name: "Beta", slug: "beta" },
];

function createSession(
	activeOrganizationId: string | null,
	lastSelectedOrganizationId: string | null = null
) {
	return {
		session: {
			activeOrganizationId,
		},
		user: {
			email: "felix@example.com",
			id: "user-123",
			image: null,
			lastSelectedOrganizationId,
			name: "Felix",
		},
	};
}

describe("organization scope resolution", () => {
	it("keeps provider names out of the public login URL for Plugin detail routes", () => {
		expect(
			resolvePublicLoginRedirectTarget("/o/acme/center-agent/plugins/gmail")
		).toBe("/o/acme/center-agent/plugins");
		expect(
			resolvePublicLoginRedirectTarget(
				"/o/acme/center-agent/plugins/googledrive"
			)
		).toBe("/o/acme/center-agent/plugins");
	});

	it("preserves non-Plugin organization deep links during login", () => {
		expect(resolvePublicLoginRedirectTarget("/o/acme/spaces/space-123")).toBe(
			"/o/acme/spaces/space-123"
		);
	});

	it("uses the account's last selected Organization for a later entry", () => {
		expect(
			resolveDefaultOrganizationForSession({
				organizations: ORGANIZATIONS,
				session: createSession("org-acme", "org-beta"),
			})
		).toEqual({ id: "org-beta", name: "Beta", slug: "beta" });
	});

	it("falls back safely when the saved Organization is no longer available", () => {
		expect(
			resolveDefaultOrganizationForSession({
				organizations: ORGANIZATIONS,
				session: createSession("org-acme", "org-revoked"),
			})
		).toEqual({ id: "org-acme", name: "Acme", slug: "acme" });
	});

	it("authorizes a route when the URL slug belongs to the signed-in account", () => {
		const scope = resolveOrganizationScopeForSession({
			organizations: ORGANIZATIONS,
			orgSlug: "acme",
			session: createSession("org-acme", "org-beta"),
		});

		expect(scope).toMatchObject({
			access: "authorized",
			activeOrganization: { id: "org-beta", slug: "beta" },
			currentOrganization: { id: "org-acme", slug: "acme" },
			currentUserId: "user-123",
			storageScope: "user-123",
		});
	});

	it("authorizes the URL organization without requiring a shared Session mutation", () => {
		const scope = resolveOrganizationScopeForSession({
			organizations: ORGANIZATIONS,
			orgSlug: "beta",
			session: createSession("org-acme"),
		});

		expect(scope).toMatchObject({
			access: "authorized",
			activeOrganization: { id: "org-acme", slug: "acme" },
			currentOrganization: { id: "org-beta", slug: "beta" },
		});
	});

	it("fails closed when the URL slug is not one of the account organizations", () => {
		const scope = resolveOrganizationScopeForSession({
			organizations: ORGANIZATIONS,
			orgSlug: "unknown-org",
			session: createSession("org-acme"),
		});

		expect(scope).toMatchObject({
			access: "denied",
			activeOrganization: { id: "org-acme", slug: "acme" },
			currentUserId: "user-123",
			storageScope: "user-123",
		});
		expect("currentOrganization" in scope).toBe(false);
	});

	it("recovers an unavailable URL to the account's last selected Organization", () => {
		const scope = resolveOrganizationScopeForSession({
			organizations: ORGANIZATIONS,
			orgSlug: "unknown-org",
			session: createSession("org-acme", "org-beta"),
		});

		expect(scope).toMatchObject({
			access: "denied",
			activeOrganization: { id: "org-beta", name: "Beta", slug: "beta" },
		});
		expect("currentOrganization" in scope).toBe(false);
	});
});
