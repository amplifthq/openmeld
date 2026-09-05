import type { ProfileSpaceHistoryRecord } from "@openmeld/schemas/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";

const listSingleProfileSpaceHistoryInputSchema = z.strictObject({
	limit: z.number().int().min(1).max(500).optional(),
	pinned: z.boolean().optional(),
	profileId: z.string().trim().min(1),
});

async function listSingleProfileSpaceHistoryServer(input: {
	limit?: number;
	pinned?: boolean;
	profileId: string;
}): Promise<readonly ProfileSpaceHistoryRecord[]> {
	const { fetchProfileSpaceHistoryFromRequest } = await import(
		"./profile-space-history.server"
	);

	return await fetchProfileSpaceHistoryFromRequest({
		gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
		...(input.limit === undefined ? {} : { limit: input.limit }),
		...(input.pinned === undefined ? {} : { pinned: input.pinned }),
		webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
		profileId: input.profileId,
	});
}

// Low-level per-profile history read. User-facing Space lists must use
// listAccountSpaceItems so human and agent profile history stays merged.
export const listSingleProfileSpaceHistory = createServerFn({
	method: "GET",
})
	.validator((data: unknown) => {
		const parsed = listSingleProfileSpaceHistoryInputSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ??
					"Invalid selected profile space history input."
			);
		}

		return parsed.data;
	})
	.handler(async ({ data }) => await listSingleProfileSpaceHistoryServer(data));
