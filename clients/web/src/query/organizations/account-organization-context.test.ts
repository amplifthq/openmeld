import { accountOrganizationContextSchema } from "@openmeld/schemas";
import {
	focusManager,
	onlineManager,
	QueryClient,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
	afterEach(() => {
		focusManager.setFocused(undefined);
	});
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
	it.each([
		new TypeError("Failed to fetch"),
		Object.assign(new Error("request timed out"), { code: "network.timeout" }),
	])("fails an offline entry instead of leaving the parent loader paused: %s", async (error) => {
		const client = new QueryClient();
		vi.mocked(readCurrentAccountOrganizationContext).mockRejectedValue(error);
		onlineManager.setOnline(false);
		try {
			await expect(
				client.fetchQuery(accountOrganizationContextQueryOptions("/o/acme"))
			).rejects.toBe(error);
			expect(readCurrentAccountOrganizationContext).toHaveBeenCalledTimes(1);
		} finally {
			onlineManager.setOnline(true);
			client.clear();
		}
	});
	it.each([
		"fresh membership",
		"signed out",
		"another timeout",
	])("retries a timeout once and uses the new outcome: %s", async (outcome) => {
		focusManager.setFocused(false);
		const client = new QueryClient();
		client.setQueryData(accountOrganizationContextQueryKey, context);
		const timeout = Object.assign(new Error("request timed out"), {
			code: "network.timeout",
			requestId: "failed-request",
		});
		let retry = false;
		let rejectFirstRead!: (error: Error) => void;
		const firstRead = new Promise<typeof context | null>((_resolve, reject) => {
			rejectFirstRead = reject;
		});
		const fresh = {
			...context,
			organizations: context.organizations.slice(0, 1),
		};
		vi.mocked(readCurrentAccountOrganizationContext).mockImplementation(() => {
			if (!retry) {
				return firstRead;
			}
			if (outcome === "another timeout") {
				return Promise.reject(timeout);
			}
			return Promise.resolve(outcome === "signed out" ? null : fresh);
		});
		const result = client
			.fetchQuery(accountOrganizationContextQueryOptions("/o/beta"))
			.then(
				(value) => ({ value }),
				(error: unknown) => ({ error })
			);
		retry = true;
		rejectFirstRead(timeout);
		expect(await result).toEqual(
			outcome === "another timeout"
				? { error: timeout }
				: { value: outcome === "signed out" ? null : fresh }
		);
		expect(readCurrentAccountOrganizationContext).toHaveBeenCalledTimes(2);
		client.clear();
	});
	it.each([
		"gateway.http_error",
		"gateway.invalid_response",
		"network.request_failed",
	])("does not automatically retry a non-timeout failure: %s", async (code) => {
		const client = new QueryClient();
		const error = Object.assign(new Error("failed read"), { code });
		vi.mocked(readCurrentAccountOrganizationContext).mockRejectedValue(error);
		await expect(
			client.fetchQuery(accountOrganizationContextQueryOptions("/o/acme"))
		).rejects.toBe(error);
		expect(readCurrentAccountOrganizationContext).toHaveBeenCalledTimes(1);
		client.clear();
	});
	it.each([
		"success",
		"timeout",
	])("does not restore or retry the previous account after cancellation: %s", async (outcome) => {
		const client = new QueryClient();
		let complete!: () => void;
		let signal: AbortSignal | undefined;
		vi.mocked(readCurrentAccountOrganizationContext).mockImplementation(
			(_route, querySignal) => {
				signal = querySignal;
				return new Promise((resolve, reject) => {
					complete = () => {
						if (outcome === "success") {
							resolve(context);
						} else {
							reject(
								Object.assign(new Error("request timed out"), {
									code: "network.timeout",
								})
							);
						}
					};
				});
			}
		);
		const pending = client
			.fetchQuery(accountOrganizationContextQueryOptions("/o/acme"))
			.catch(() => undefined);
		await client.cancelQueries();
		client.removeQueries();
		complete();
		await pending;
		expect(signal?.aborted).toBe(true);
		expect(readCurrentAccountOrganizationContext).toHaveBeenCalledTimes(1);
		expect(
			client.getQueryData(accountOrganizationContextQueryKey)
		).toBeUndefined();
		client.clear();
	});
});
