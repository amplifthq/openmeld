import {
	type AuthProfileView,
	createHumanProfileBodySchema,
} from "@openmeld/schemas";
import { createServerFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";

export const createStartHumanProfile = createServerFn({
	method: "POST",
})
	.validator((data: unknown) => {
		const parsed = createHumanProfileBodySchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ?? "Invalid create human profile input."
			);
		}

		return parsed.data;
	})
	.handler(async ({ data }): Promise<AuthProfileView> => {
		const { createStartHumanProfileFromRequest } = await import(
			"./create-human-profile.server"
		);

		return await createStartHumanProfileFromRequest({
			authBaseUrl: getRequiredServerEnv("BETTER_AUTH_URL"),
			body: data,
		});
	});
