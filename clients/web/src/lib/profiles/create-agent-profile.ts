import {
	type AuthProfileView,
	createAgentProfileBodySchema,
} from "@openmeld/schemas";
import { createServerFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";

export const createStartAgentProfile = createServerFn({
	method: "POST",
})
	.inputValidator((data: unknown) => {
		const parsed = createAgentProfileBodySchema.safeParse(data);
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

		return await createStartAgentProfileFromRequest({
			authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
			body: data,
		});
	});
