import { createProfileSpaceHistoryApi } from "@openmeld/api-client";
import { upsertProfileSpaceHistoryBodySchema } from "@openmeld/schemas";
import type { UpsertProfileSpaceHistoryResponse } from "@openmeld/schemas/types";
import { createIsomorphicFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { getWebGatewayHost } from "#/lib/openmeld-api/gateway-host";
import { rethrowAccountSpaceApiFailure } from "#/lib/spaces/account-space-api-failure";

const historyWriteItemSchema = z.strictObject({
	profileId: z.string().trim().min(1),
});

const upsertProfileSpaceHistoryInputSchema = z.strictObject({
	spaceId: z.string().trim().min(1),
	spaceName: z.string().trim().min(1).nullable().optional(),
	items: z.array(historyWriteItemSchema).min(1),
	creatorProfileId: z.string().trim().min(1).nullable().optional(),
	creatorKind: z.enum(["human", "agent"]).nullable().optional(),
	spaceCreatedAt: z.string().trim().min(1).nullable().optional(),
	spaceUpdatedAt: z.string().trim().min(1).nullable().optional(),
	lastJoinedAt: z.iso.datetime({ offset: true }).optional(),
	lastSeenTs: z.number().int().min(0).nullable().optional(),
	pinnedAt: z.iso.datetime({ offset: true }).nullable().optional(),
});

export async function upsertProfileSpaceHistory(input: {
	data: z.input<typeof upsertProfileSpaceHistoryInputSchema>;
}) {
	const parsed = upsertProfileSpaceHistoryInputSchema.safeParse(input.data);
	if (!parsed.success) {
		throw new Error(
			parsed.error.issues[0]?.message ??
				"Invalid profile space history upsert input."
		);
	}

	return await upsertProfileSpaceHistoryImpl(parsed.data);
}

const upsertProfileSpaceHistoryImpl = createIsomorphicFn()
	.client(
		async (data: z.infer<typeof upsertProfileSpaceHistoryInputSchema>) => {
			const { items, spaceId, ...fields } = data;
			const body = upsertProfileSpaceHistoryBodySchema.parse({
				...fields,
				// The existing server adapter omits empty descriptive fields; explicit
				// nulls for lastSeenTs and pinnedAt still clear those preferences.
				spaceName: fields.spaceName || undefined,
				creatorProfileId: fields.creatorProfileId || undefined,
				spaceCreatedAt: fields.spaceCreatedAt || undefined,
				spaceUpdatedAt: fields.spaceUpdatedAt || undefined,
				gatewayHost: await getWebGatewayHost(),
				status: "active",
			});
			return await Promise.all(
				items.map(({ profileId }) =>
					createProfileSpaceHistoryApi(
						createUnscopedWebOpenMeldApiFoundation({
							openMeldProfileId: profileId,
						})
					)
						.upsertProfileSpaceHistory({ profileId, spaceId, body })
						.catch((error: unknown) =>
							rethrowAccountSpaceApiFailure(
								error,
								"upsert profile space history",
								"Invalid profile space history upsert response"
							)
						)
				)
			);
		}
	)
	.server(
		async (
			data: z.infer<typeof upsertProfileSpaceHistoryInputSchema>
		): Promise<readonly UpsertProfileSpaceHistoryResponse[]> => {
			const { upsertProfileSpaceHistoryResponseFromRequest } = await import(
				"./upsert-profile-space-history.server"
			);

			const { items, ...fields } = data;
			return await Promise.all(
				items.map(async (item) => {
					return await upsertProfileSpaceHistoryResponseFromRequest({
						...fields,
						gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
						webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
						profileId: item.profileId,
					});
				})
			);
		}
	);
