import { accountOrganizationContextSchema } from "@openmeld/schemas";
import { onlineManager, QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readCurrentAccountOrganizationContext } from "#/lib/organizations/account-organization-context";
import { resolveOrganizationScopeForContext } from "#/lib/organizations/organization-scope";
import {
	accountOrganizationContextQueryKey,
	accountOrganizationContextQueryOptions,
} from "./account-organization-context";

vi.mock("#/lib/organizations/account-organization-context", () => ({
	readCurrentAccountOrganizationContext: vi.fn(),
}));
const context = accountOrganizationContextSchema.parse({
	currentUserId: "user-1",
	account: { email: "member@example.com", image: null, name: "Member" },
	organizations: [
		{ id: "acme", name: "Acme", slug: "acme" },
		{ id: "beta", name: "Beta", slug: "beta" },
	],
	defaultOrganizationId: "acme",
});

describe("account navigation context", () => {
	beforeEach(() => {
		vi.mocked(readCurrentAccountOrganizationContext).mockReset();
	});
	it("shares concurrent destinations, then revalidates membership on a later entry", async () => {
		const client = new QueryClient();
		vi.mocked(readCurrentAccountOrganizationContext).mockResolvedValue(context);
		const [acme, beta] = await Promise.all([
			client.fetchQuery(accountOrganizationContextQueryOptions("/o/acme")),
			client.fetchQuery(accountOrganizationContextQueryOptions("/o/beta")),
		]);
		expect(readCurrentAccountOrganizationContext).toHaveBeenCalledTimes(1);
		expect(acme).toBe(beta);
		vi.mocked(readCurrentAccountOrganizationContext).mockResolvedValue({
			...context,
			organizations: context.organizations.slice(0, 1),
		});
		const fresh = await client.fetchQuery(
			accountOrganizationContextQueryOptions("/o/beta")
		);
		expect(
			resolveOrganizationScopeForContext({
				context: accountOrganizationContextSchema.parse(fresh),
				orgSlug: "beta",
			}).access
		).toBe("denied");
		client.clear();
	});
	it("fails an offline entry instead of leaving the parent loader paused", async () => {
		const client = new QueryClient();
		const error = new TypeError("Failed to fetch");
		vi.mocked(readCurrentAccountOrganizationContext).mockRejectedValue(error);
		onlineManager.setOnline(false);
		try {
			await expect(
				client.fetchQuery(accountOrganizationContextQueryOptions("/o/acme"))
			).rejects.toBe(error);
		} finally {
			onlineManager.setOnline(true);
			client.clear();
		}
	});
	it("does not restore the previous account after cancellation and removal", async () => {
		const client = new QueryClient();
		let complete!: (value: typeof context) => void;
		let signal: AbortSignal | undefined;
		vi.mocked(readCurrentAccountOrganizationContext).mockImplementation(
			(_route, querySignal) => {
				signal = querySignal;
				return new Promise((resolve) => {
					complete = resolve;
				});
			}
		);
		const pending = client
			.fetchQuery(accountOrganizationContextQueryOptions("/o/acme"))
			.catch(() => undefined);
		await client.cancelQueries();
		client.removeQueries();
		complete(context);
		await pending;
		expect(signal?.aborted).toBe(true);
		expect(
			client.getQueryData(accountOrganizationContextQueryKey)
		).toBeUndefined();
		client.clear();
	});
});
