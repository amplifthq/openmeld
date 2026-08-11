import { selectLastSelectedOrganizationErrorResponseSchema } from "@openmeld/schemas";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#/env", () => ({
	getRequiredServerEnv: (name: string) => {
		if (name === "BETTER_AUTH_URL") {
			return "http://localhost:8788";
		}
		if (name === "WEB_APP_URL") {
			return "http://localhost:3000";
		}
		throw new Error(`Unexpected environment variable: ${name}`);
	},
}));

vi.mock("#/lib/openmeld-api/proxy-cloudflare-runtime.server", () => ({
	readWebProxyCloudflareRuntimeEvidence: () => null,
}));

import { Route } from "./last-selected-organization";

describe("last selected Organization Web route", () => {
	beforeEach(() => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn<typeof fetch>()
				.mockResolvedValue(
					Response.json({ ok: true, organizationId: "org-beta" })
				)
		);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("forwards the authenticated account request directly to Auth", async () => {
		const patchHandler = readPatchHandler();
		const request = new Request(
			"http://localhost:3000/v1/account/last-selected-organization",
			{
				body: JSON.stringify({ organizationId: "org-beta" }),
				headers: {
					"content-type": "application/json",
					cookie: "better-auth.session_token=session-123",
					origin: "http://localhost:3000",
				},
				method: "PATCH",
			}
		);

		const response = await patchHandler({ request } as never);

		expect(fetch).toHaveBeenCalledWith(
			"http://localhost:8788/v1/account/last-selected-organization",
			expect.objectContaining({ method: "PATCH", redirect: "manual" })
		);
		const forwardedRequest = vi.mocked(fetch).mock.calls[0]?.[1];
		expect(new Headers(forwardedRequest?.headers).get("cookie")).toBe(
			"better-auth.session_token=session-123"
		);
		expect(response.status).toBe(200);
	});

	it.each([
		{
			code: "auth.invalid_origin" as const,
			downstreamStatus: 403,
			message: "Refresh the page and try again.",
			upstreamStatus: 403,
		},
		{
			code: "auth.unauthenticated" as const,
			downstreamStatus: 400,
			message: "Sign in again to continue.",
			upstreamStatus: 401,
		},
		{
			code: "invalid_payload" as const,
			downstreamStatus: 400,
			message: "Choose a valid organization.",
			upstreamStatus: 400,
		},
		{
			code: "organization.membership_required" as const,
			downstreamStatus: 403,
			message: "You must be a member of this organization before selecting it.",
			upstreamStatus: 403,
		},
		{
			code: "upstream_error" as const,
			downstreamStatus: 500,
			message: "OpenMeld couldn't save your organization. Try again.",
			upstreamStatus: 500,
		},
		{
			code: "upstream_unreachable" as const,
			downstreamStatus: 503,
			message: "OpenMeld couldn't reach authentication. Try again.",
			upstreamStatus: 503,
		},
	])("preserves the Auth $upstreamStatus error envelope", async ({
		code,
		downstreamStatus,
		message,
		upstreamStatus,
	}) => {
		const upstreamEnvelope =
			selectLastSelectedOrganizationErrorResponseSchema.parse({
				error: {
					code,
					message,
					requestId: `request-${upstreamStatus}`,
				},
				ok: false,
			});
		vi.mocked(fetch).mockResolvedValueOnce(
			Response.json(upstreamEnvelope, { status: upstreamStatus })
		);
		const request = new Request(
			"http://localhost:3000/v1/account/last-selected-organization",
			{
				body: JSON.stringify({ organizationId: "org-beta" }),
				headers: {
					"content-type": "application/json",
					cookie: "better-auth.session_token=session-123",
					origin: "http://localhost:3000",
				},
				method: "PATCH",
			}
		);

		const response = await readPatchHandler()({ request } as never);

		expect(response.status).toBe(downstreamStatus);
		await expect(response.json()).resolves.toEqual(upstreamEnvelope);
	});

	it("returns a shared error envelope when Auth cannot be reached", async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error("Auth unavailable"));
		const request = new Request(
			"http://localhost:3000/v1/account/last-selected-organization",
			{
				body: JSON.stringify({ organizationId: "org-beta" }),
				headers: {
					"content-type": "application/json",
					cookie: "better-auth.session_token=session-123",
					origin: "http://localhost:3000",
				},
				method: "PATCH",
			}
		);

		const response = await readPatchHandler()({ request } as never);

		expect(response.status).toBe(502);
		expect(
			selectLastSelectedOrganizationErrorResponseSchema.parse(
				await response.json()
			)
		).toMatchObject({
			error: {
				code: "upstream_unreachable",
				message: "OpenMeld couldn't reach the auth upstream for this request.",
				requestId: expect.any(String),
			},
			ok: false,
		});
	});
});

function readPatchHandler(): (input: {
	request: Request;
}) => Promise<Response> {
	const handlers = Route.options.server?.handlers as
		| {
				PATCH?: (input: { request: Request }) => Promise<Response>;
		  }
		| undefined;
	const patchHandler = handlers?.PATCH;
	if (typeof patchHandler !== "function") {
		throw new Error("Expected the Organization preference PATCH handler");
	}
	return patchHandler;
}
