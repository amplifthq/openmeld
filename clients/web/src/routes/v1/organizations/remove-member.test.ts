import { expect, it, vi } from "vitest";
import { handleOrganizationMemberRemoval } from "./remove-member";

const authProxy = vi.hoisted(() => vi.fn());
vi.mock("#/lib/auth-business.server", () => ({
	authBusinessRequest: authProxy,
}));

const target = {
	memberIdOrEmail: "fixture-member",
	organizationId: "fixture-org",
};

function request(body: object) {
	return new Request("http://local/v1/organizations/remove-member", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}

it.each([
	404, 409,
])("does not downgrade a reviewed Team removal after Auth HTTP %i", async (status) => {
	authProxy.mockReset().mockResolvedValue(new Response(null, { status }));
	const response = await handleOrganizationMemberRemoval(
		request({ ...target, expectedMemberRole: "member" })
	);
	expect(response.status).toBe(status);
	expect(authProxy).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({
			upstreamPath: "/api/auth/organization/remove-reviewed-member",
		})
	);
});

it("leaves unchanged Settings requests on the native endpoint", async () => {
	authProxy.mockReset().mockResolvedValue(new Response());
	await handleOrganizationMemberRemoval(request(target));
	expect(authProxy).toHaveBeenCalledExactlyOnceWith(
		expect.objectContaining({
			upstreamPath: "/api/auth/organization/remove-member",
		})
	);
});
