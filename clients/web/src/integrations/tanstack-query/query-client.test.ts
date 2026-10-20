import {
	OpenMeldApiClientHttpError,
	OpenMeldApiClientInvalidResponseError,
} from "@openmeld/api-client";
import { webApplicationErrorReportSchema } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inboxQueryKeys } from "#/query/organizations/inbox";
import { accountSpaceQueryKeys } from "#/query/spaces/account-spaces";
import { spaceUpdatesQueryOptions } from "#/query/spaces/history-sync";
import { spaceQueryKeys } from "#/query/spaces/status";
import {
	resetBrowserQueryClientForTests,
	resolveAppQueryClient,
} from "./query-client";

describe("app query client", () => {
	beforeEach(() => {
		resetBrowserQueryClientForTests();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("creates a fresh query client for each server request", () => {
		const firstQueryClient = resolveAppQueryClient({ isServer: true });
		const secondQueryClient = resolveAppQueryClient({ isServer: true });

		expect(firstQueryClient).not.toBe(secondQueryClient);
	});

	it("reuses one stable browser query client", () => {
		const firstQueryClient = resolveAppQueryClient({ isServer: false });
		const secondQueryClient = resolveAppQueryClient({ isServer: false });

		expect(firstQueryClient).toBe(secondQueryClient);
	});

	it("reports allowlisted query failures without query identities or response content", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
		);
		const queryClient = resolveAppQueryClient({ isServer: false });
		const privateValues = [
			"org-private",
			"item-private",
			"space-private",
			"profile-private",
			"signal-private",
			"token-private",
			"raw-body-private",
			"schema-issue-private",
			"private-operation",
		];
		const cases = [
			{
				category: "inbox",
				error: new OpenMeldApiClientHttpError({
					code: "auth.unauthenticated",
					message: "token-private",
					rawBody: "raw-body-private",
					requestId: "req-http-401",
					status: 401,
				}),
				queryKey: inboxQueryKeys.item("org-private", "item-private"),
			},
			{
				category: "space_members",
				error: Object.assign(new TypeError("token-private"), {
					code: "network.request_failed",
				}),
				queryKey: spaceQueryKeys.members("space-private", "profile-private"),
			},
			{
				category: "space_live",
				error: new OpenMeldApiClientInvalidResponseError({
					message: "token-private",
					operation: "private-operation",
					rawBody: "raw-body-private",
					requestId: "req-invalid-response",
					schemaIssue: { message: "schema-issue-private", path: ["secret"] },
					status: 200,
				}),
				queryKey: spaceUpdatesQueryOptions({
					afterSignalId: "signal-private",
					openMeldProfileId: "profile-private",
					spaceId: "space-private",
				}).queryKey,
			},
			{
				category: "account_spaces",
				error: Object.assign(new Error("token-private"), {
					code: "network.timeout",
				}),
				queryKey: accountSpaceQueryKeys.items("profile-private", "account"),
			},
			{
				category: "account_organization_context",
				error: Object.assign(new Error("token-private"), {
					code: "network.timeout",
					requestId: "req-organization-context-timeout",
				}),
				queryKey: ["account-organization-context"],
			},
			{
				category: "account_session",
				error: new OpenMeldApiClientHttpError({
					code: "gateway.http_error",
					message: "token-private",
					rawBody: "raw-body-private",
					status: 503,
				}),
				queryKey: ["user", "session"],
			},
		] as const;

		for (const input of cases) {
			await expect(
				queryClient.fetchQuery({
					queryFn: () => Promise.reject(input.error),
					queryKey: input.queryKey,
					retry: false,
				})
			).rejects.toBe(input.error);
		}

		const reports = vi
			.mocked(fetch)
			.mock.calls.map(([, options]) =>
				webApplicationErrorReportSchema.parse(JSON.parse(String(options?.body)))
			);
		expect(reports.map((report) => report.query?.category)).toEqual(
			cases.map((input) => input.category)
		);
		expect(reports[0]?.query?.failure).toEqual({
			code: "auth.unauthenticated",
			requestId: "req-http-401",
			status: 401,
		});
		expect(reports[1]?.query?.failure).toEqual({
			code: "network.request_failed",
			requestId: null,
			status: null,
		});
		expect(reports[2]?.query?.failure).toEqual({
			code: "gateway.invalid_response",
			requestId: "req-invalid-response",
			status: 200,
		});
		expect(reports[4]?.query?.failure).toEqual({
			code: "network.timeout",
			requestId: "req-organization-context-timeout",
			status: null,
		});

		const serializedReports = JSON.stringify(reports);
		for (const privateValue of privateValues) {
			expect(serializedReports).not.toContain(privateValue);
		}
	});
});
