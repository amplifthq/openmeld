import type { PatchProfileSpaceHistoryStatusResponse } from "@openmeld/schemas/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";

const updateProfileSpaceHistoryStatusInputSchema = z.strictObject({
	profileId: z.string().trim().min(1),
	spaceId: z.string().trim().min(1),
	status: z.enum(["active", "removed"]),
	reason: z.string().trim().min(1).max(500).optional(),
});

export const updateProfileSpaceHistoryStatus = createServerFn({
	method: "POST",
})
	.inputValidator((data: unknown) => {
		const parsed = updateProfileSpaceHistoryStatusInputSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ??
					"Invalid profile space history status input."
			);
		}

		return parsed.data;
	})
	.handler(
		async ({ data }): Promise<PatchProfileSpaceHistoryStatusResponse> => {
			const { updateProfileSpaceHistoryStatusFromRequest } = await import(
				"./update-profile-space-history-status.server"
			);

			return await updateProfileSpaceHistoryStatusFromRequest({
				gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
				webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
				profileId: data.profileId,
				spaceId: data.spaceId,
				status: data.status,
				...(data.reason === undefined ? {} : { reason: data.reason }),
			});
		}
	);
