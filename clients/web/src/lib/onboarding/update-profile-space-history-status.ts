import { createProfileSpaceHistoryApi } from "@openmeld/api-client";
import { patchProfileSpaceHistoryStatusBodySchema } from "@openmeld/schemas";
import type { PatchProfileSpaceHistoryStatusResponse } from "@openmeld/schemas/types";
import { createIsomorphicFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { getWebGatewayHost } from "#/lib/openmeld-api/gateway-host";
import { rethrowAccountSpaceApiFailure } from "#/lib/spaces/account-space-api-failure";

const updateProfileSpaceHistoryStatusInputSchema = z.strictObject({
	profileId: z.string().trim().min(1),
	spaceId: z.string().trim().min(1),
	status: z.enum(["active", "removed"]),
	reason: z.string().trim().min(1).max(500).optional(),
});

export async function updateProfileSpaceHistoryStatus(input: {
	data: z.input<typeof updateProfileSpaceHistoryStatusInputSchema>;
}) {
	const parsed = updateProfileSpaceHistoryStatusInputSchema.safeParse(
		input.data
	);
	if (!parsed.success) {
		throw new Error(
			parsed.error.issues[0]?.message ??
				"Invalid profile space history status input."
		);
	}

	return await updateProfileSpaceHistoryStatusImpl(parsed.data);
}

const updateProfileSpaceHistoryStatusImpl = createIsomorphicFn()
	.client(
		async (data: z.infer<typeof updateProfileSpaceHistoryStatusInputSchema>) =>
			createProfileSpaceHistoryApi(
				createUnscopedWebOpenMeldApiFoundation({
					openMeldProfileId: data.profileId,
				})
			)
				.updateProfileSpaceHistoryStatus({
					profileId: data.profileId,
					spaceId: data.spaceId,
					body: patchProfileSpaceHistoryStatusBodySchema.parse({
						gatewayHost: await getWebGatewayHost(),
						status: data.status,
						...(data.reason === undefined ? {} : { reason: data.reason }),
					}),
				})
				.catch((error: unknown) =>
					rethrowAccountSpaceApiFailure(
						error,
						"update profile space history status",
						"Invalid profile space history status response"
					)
				)
	)
	.server(
		async (
			data: z.infer<typeof updateProfileSpaceHistoryStatusInputSchema>
		): Promise<PatchProfileSpaceHistoryStatusResponse> => {
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
