import {
	createAgentProfileBodySchema,
	createdAgentProfileActionResponseSchema,
} from "@openmeld/schemas";
import type { z } from "zod/v4";
import { requestAuthBusiness } from "#/lib/auth-business";
import { createOrganizationScopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
export async function createStartAgentProfile({
	data,
}: {
	data: z.infer<typeof createAgentProfileBodySchema> & {
		organizationId: string;
	};
}) {
	const { organizationId, ...body } = data;
	return (
		await requestAuthBusiness({
			path: "/v1/profiles/agents",
			method: "POST",
			body: createAgentProfileBodySchema.parse(body),
			schema: createdAgentProfileActionResponseSchema,
			client: createOrganizationScopedWebOpenMeldApiFoundation({
				organizationId,
			}),
			profileSessionError: true,
		})
	).profile;
}
