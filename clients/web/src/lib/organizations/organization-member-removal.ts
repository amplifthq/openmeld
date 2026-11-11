import {
	type OrganizationMemberRemovalPrepareBody,
	organizationMemberRemovalPlanSchema,
	organizationMemberRemovalPrepareBodySchema,
	organizationMemberRemovalPrepareResponseSchema,
	organizationMemberRemovalPreviewBodySchema,
} from "@openmeld/schemas";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

const route = "/v1/organizations/current/member-removal";

export async function previewOrganizationMemberRemoval(input: {
	organizationId: string;
	memberId: string;
}) {
	const plan = await createOrganizationScopedWebOpenMeldApiFoundation({
		organizationId: input.organizationId,
	}).requestJson({
		method: "POST",
		operation: "organization.member_removal.preview",
		url: `${route}/preview`,
		body: JSON.stringify(
			organizationMemberRemovalPreviewBodySchema.parse({
				memberId: input.memberId,
			})
		),
		schema: organizationMemberRemovalPlanSchema,
		invalidMessage: "Couldn't verify this member's Space ownership.",
	});
	if (plan.memberId !== input.memberId) {
		throw new Error("The removal review belongs to another member.");
	}
	return plan;
}

export function prepareOrganizationMemberRemoval(
	input: OrganizationMemberRemovalPrepareBody & { organizationId: string }
) {
	const { organizationId, ...body } = input;
	return createOrganizationScopedWebOpenMeldApiFoundation({
		organizationId,
	}).requestJson({
		method: "POST",
		operation: "organization.member_removal.prepare",
		url: `${route}/prepare`,
		body: JSON.stringify(
			organizationMemberRemovalPrepareBodySchema.parse(body)
		),
		schema: organizationMemberRemovalPrepareResponseSchema,
		invalidMessage:
			"Couldn't confirm the Space changes. Review before retrying.",
	});
}
