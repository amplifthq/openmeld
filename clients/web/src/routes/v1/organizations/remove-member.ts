import {
	organizationActionSuccessSchema,
	organizationMemberRemovalActionSchema,
	organizationReviewedMemberRemovalActionSchema,
} from "@openmeld/schemas";
import { createFileRoute } from "@tanstack/react-router";
import { authBusinessRequest } from "#/lib/auth-business.server";

export const Route = createFileRoute("/v1/organizations/remove-member")({
	server: {
		handlers: {
			POST: ({ request }) => handleOrganizationMemberRemoval(request),
		},
	},
});

export async function handleOrganizationMemberRemoval(request: Request) {
	// A reviewed Team request must never hit the old native endpoint,
	// including during an Auth rollout or rollback.
	const body = await request
		.clone()
		.json()
		.catch(() => null);
	const reviewed =
		body !== null &&
		typeof body === "object" &&
		Object.hasOwn(body, "expectedMemberRole");
	return authBusinessRequest({
		request,
		upstreamPath: reviewed
			? "/api/auth/organization/remove-reviewed-member"
			: "/api/auth/organization/remove-member",
		responseSchema: organizationActionSuccessSchema,
		bodySchema: reviewed
			? organizationReviewedMemberRemovalActionSchema
			: organizationMemberRemovalActionSchema,
		project: () => ({ ok: true }),
	});
}
