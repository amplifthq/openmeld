import {
	createdHumanProfileActionResponseSchema,
	createHumanProfileBodySchema,
} from "@openmeld/schemas";
import type { z } from "zod/v4";
import { requestAuthBusiness } from "#/lib/auth-business";
export async function createStartHumanProfile({
	data,
}: {
	data: z.infer<typeof createHumanProfileBodySchema>;
}) {
	return (
		await requestAuthBusiness({
			path: "/v1/profiles/humans",
			method: "POST",
			body: createHumanProfileBodySchema.parse(data),
			schema: createdHumanProfileActionResponseSchema,
			profileSessionError: true,
		})
	).profile;
}
