import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveOrganizationScope } from "#/lib/organizations/organization-scope";
import { organizationScopeQueryOptions } from "./organization-scope";

vi.mock("#/lib/organizations/organization-scope", () => ({
	resolveOrganizationScope: vi.fn(),
}));

describe("organizationScopeQueryOptions", () => {
	beforeEach(() => {
		vi.mocked(resolveOrganizationScope).mockReset();
	});

	it("deduplicates concurrent session and organization scope resolution", async () => {
		const queryClient = new QueryClient();
		vi.mocked(resolveOrganizationScope).mockResolvedValue({
			access: "authorized",
			account: { email: "felix@example.com", image: null, name: "Felix" },
			activeOrganization: { id: "org-acme", name: "Acme", slug: "acme" },
			currentOrganization: { id: "org-acme", name: "Acme", slug: "acme" },
			currentUserId: "user-1",
			organizations: [{ id: "org-acme", name: "Acme", slug: "acme" }],
			storageScope: "user-1",
		});
		const options = organizationScopeQueryOptions({
			organizationSlug: "acme",
			routeFamily: "/o/acme/center-agent/chat",
		});

		await Promise.all([
			queryClient.ensureQueryData(options),
			queryClient.ensureQueryData(options),
		]);

		expect(resolveOrganizationScope).toHaveBeenCalledTimes(1);
	});

	it("keeps different organization slugs in separate cache boundaries", () => {
		expect(
			organizationScopeQueryOptions({
				organizationSlug: "acme",
				routeFamily: "/o/acme/center-agent/chat",
			}).queryKey
		).not.toEqual(
			organizationScopeQueryOptions({
				organizationSlug: "other",
				routeFamily: "/o/other/center-agent",
			}).queryKey
		);
	});

	it("marks route membership scope stale so loaders can revalidate it", () => {
		const options = organizationScopeQueryOptions({
			organizationSlug: "acme",
			routeFamily: "/o/acme/center-agent/plugins/github",
		});

		expect(options.staleTime).toBe(0);
	});
});
