import { accountOrganizationContextSchema } from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { readCurrentAccountOrganizationContext } from "./account-organization-context";
import {
	resolveDefaultOrganizationForSession,
	resolveOptionalActiveOrganizationEntryPath,
	resolveOrganizationScopeForContext,
	resolvePublicLoginRedirectTarget,
} from "./organization-scope";
import type { OrganizationSummary } from "./organization-types";

vi.mock("./account-organization-context", () => ({
	readCurrentAccountOrganizationContext: vi.fn(),
}));

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
	it("keeps entry, denied scope, and account storage tied to the shared projection", async () => {
		vi.mocked(readCurrentAccountOrganizationContext).mockResolvedValue(
			accountOrganizationContextSchema.parse({
				currentUserId: "user-current",
				account: { email: "current@example.com", image: null, name: "Current" },
				organizations: ORGANIZATIONS,
				defaultOrganizationId: "org-beta",
			})
		);
		await expect(
			resolveOptionalActiveOrganizationEntryPath({
				data: { routeFamily: "/desktop-shell" },
			})
		).resolves.toBe("/o/beta/spaces");
		expect(
			resolveOrganizationScopeForContext({
				context: accountOrganizationContextSchema.parse(
					await readCurrentAccountOrganizationContext("/o/acme")
				),
				orgSlug: "acme",
			})
		).toMatchObject({
			access: "authorized",
			currentOrganization: { id: "org-acme" },
			activeOrganization: { id: "org-beta" },
			currentUserId: "user-current",
			storageScope: "user-current",
		});
		const denied = resolveOrganizationScopeForContext({
			context: accountOrganizationContextSchema.parse(
				await readCurrentAccountOrganizationContext("/o/unknown")
			),
			orgSlug: "unknown",
		});
		expect(denied.access).toBe("denied");
		expect("currentOrganization" in denied).toBe(false);
	});

	it("keeps anonymous, no-membership, and unavailable contexts distinct", async () => {
		const entryInput = { data: { routeFamily: "/desktop-shell" } };
		vi.mocked(readCurrentAccountOrganizationContext).mockResolvedValue(null);
		await expect(
			resolveOptionalActiveOrganizationEntryPath(entryInput)
		).resolves.toBeNull();
		vi.mocked(readCurrentAccountOrganizationContext).mockResolvedValue(
			accountOrganizationContextSchema.parse({
				currentUserId: "user",
				account: { email: null, image: null, name: null },
				organizations: [],
				defaultOrganizationId: null,
			})
		);
		await expect(
			resolveOptionalActiveOrganizationEntryPath(entryInput)
		).rejects.toThrow("No organization is available for this account.");
		const error = new Error("upstream unavailable");
		vi.mocked(readCurrentAccountOrganizationContext).mockRejectedValue(error);
		await expect(
			resolveOptionalActiveOrganizationEntryPath(entryInput)
		).rejects.toBe(error);
	});
	it("keeps provider names out of the public login URL for Plugin detail routes", () => {
		expect(
			resolvePublicLoginRedirectTarget("/o/acme/center-agent/plugins/gmail")
		).toBe("/o/acme/plugins");
		expect(
			resolvePublicLoginRedirectTarget("/o/acme/plugins/googledrive")
		).toBe("/o/acme/plugins");
	});

	it("preserves non-Plugin organization deep links during login", () => {
		expect(resolvePublicLoginRedirectTarget("/o/acme/spaces/space-123")).toBe(
			"/o/acme/spaces/space-123"
		);
		expect(
			resolvePublicLoginRedirectTarget(
				"/o/acme/agents",
				"?memberAgentId=agent-1"
			)
		).toBe("/o/acme/agents?memberAgentId=agent-1");
		expect(
			resolvePublicLoginRedirectTarget(
				"/o/acme/center-agent/plugins/gmail",
				"?tab=setup"
			)
		).toBe("/o/acme/plugins");
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
});
