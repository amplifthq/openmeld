import { type AuthProfileView, agentProfileIdSchema } from "@openmeld/schemas";
import { createServerFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";

export const deleteStartAgentProfile = createServerFn({
	method: "POST",
})
	.validator((data: unknown) => {
		const parsed = agentProfileIdSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ?? "Invalid delete agent profile input."
			);
		}

		return parsed.data;
	})
	.handler(async ({ data }): Promise<AuthProfileView> => {
		const { deleteStartAgentProfileFromRequest } = await import(
			"./delete-agent-profile.server"
		);

		return await deleteStartAgentProfileFromRequest({
			authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
			gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
			profileId: data,
		});
	});
