import { toStructuredApiClientFailure } from "@openmeld/api-client";
import { selectLastSelectedOrganizationErrorResponseSchema } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { selectLastSelectedOrganization } from "./account-organization-preference";

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

describe("Account Organization preference", () => {
	beforeEach(() => {
		fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
			Response.json({
				ok: true,
				organizationId: "org-beta",
			})
		);
		vi.stubGlobal("fetch", fetchMock);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it("uses the Auth-owned account preference contract", async () => {
		await expect(selectLastSelectedOrganization(" org-beta ")).resolves.toEqual(
			{ ok: true, organizationId: "org-beta" }
		);

		expect(fetchMock).toHaveBeenCalledWith(
			`${window.location.origin}/v1/account/last-selected-organization`,
			expect.objectContaining({
				body: JSON.stringify({ organizationId: "org-beta" }),
				credentials: "include",
				method: "PATCH",
			})
		);
	});

	it.each([
		{
			code: "auth.unauthenticated" as const,
			message: "Sign in again to continue.",
			status: 400,
		},
		{
			code: "invalid_payload" as const,
			message: "Choose a valid organization.",
			status: 400,
		},
		{
			code: "organization.membership_required" as const,
			message: "You must be a member of this organization before selecting it.",
			status: 403,
		},
		{
			code: "upstream_error" as const,
			message: "OpenMeld couldn't save your organization. Try again.",
			status: 500,
		},
		{
			code: "upstream_unreachable" as const,
			message: "OpenMeld couldn't reach the auth upstream for this request.",
			status: 502,
		},
	])("preserves the shared $code error code and message", async ({
		code,
		message,
		status,
	}) => {
		fetchMock.mockResolvedValueOnce(
			Response.json(
				selectLastSelectedOrganizationErrorResponseSchema.parse({
					error: {
						code,
						message,
						requestId: `request-${status}`,
					},
					ok: false,
				}),
				{ status }
			)
		);

		let failure: unknown;
		try {
			await selectLastSelectedOrganization("org-beta");
		} catch (error) {
			failure = error;
		}

		expect(toStructuredApiClientFailure(failure)).toMatchObject({
			code,
			message,
			requestId: `request-${status}`,
			status,
		});
	});
});
