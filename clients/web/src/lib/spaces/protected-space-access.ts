import { createServerFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";
import { protectedSpaceAccessInputSchema } from "./protected-space-access.server";

export const rememberProtectedSpaceAccess = createServerFn({
	method: "POST",
})
	.inputValidator((data: unknown) => {
		const parsed = protectedSpaceAccessInputSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ??
					"Invalid protected space access input."
			);
		}

		return parsed.data;
	})
	.handler(async ({ data }) => {
		const { writeProtectedSpaceAccessCookie } = await import(
			"./protected-space-access.server"
		);

		await writeProtectedSpaceAccessCookie({
			spaceId: data.spaceId,
			password: data.password,
			secret: getRequiredServerEnv("WEB_OPENMELD_SPACE_ACCESS_COOKIE_SECRET"),
			webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
		});

		return {
			ok: true as const,
		};
	});
