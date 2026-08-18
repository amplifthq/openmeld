import {
	type AuthProfileView,
	createAgentProfileBodySchema,
} from "@openmeld/schemas";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";

const createStartAgentProfileInputSchema = createAgentProfileBodySchema.extend({
	organizationId: z.string().trim().min(1).max(256),
});

export const createStartAgentProfile = createServerFn({
	method: "POST",
})
	.inputValidator((data: unknown) => {
		const parsed = createStartAgentProfileInputSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ?? "Invalid create agent profile input."
			);
		}

		return parsed.data;
	})
	.handler(async ({ data }): Promise<AuthProfileView> => {
		const { createStartAgentProfileFromRequest } = await import(
			"./create-agent-profile.server"
		);

		const { organizationId, ...body } = data;
		return await createStartAgentProfileFromRequest({
			authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
			body,
			organizationId,
		});
	});
