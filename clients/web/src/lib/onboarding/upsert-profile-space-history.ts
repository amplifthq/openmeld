import type {
	ProfileSpaceCreatorKind,
	UpsertProfileSpaceHistoryResponse,
} from "@openmeld/schemas/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";

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

export const upsertProfileSpaceHistory = createServerFn({
	method: "POST",
})
	.validator((data: unknown) => {
		const parsed = upsertProfileSpaceHistoryInputSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ??
					"Invalid profile space history upsert input."
			);
		}

		return parsed.data;
	})
	.handler(
		async ({ data }): Promise<readonly UpsertProfileSpaceHistoryResponse[]> => {
			const { upsertProfileSpaceHistoryResponseFromRequest } = await import(
				"./upsert-profile-space-history.server"
			);

			return await Promise.all(
				data.items.map(async (item) => {
					return await upsertProfileSpaceHistoryResponseFromRequest({
						gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
						webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
						profileId: item.profileId,
						spaceId: data.spaceId,
						...(data.spaceName === undefined
							? {}
							: { spaceName: data.spaceName }),
						...(data.creatorProfileId === undefined
							? {}
							: { creatorProfileId: data.creatorProfileId }),
						...(data.creatorKind === undefined
							? {}
							: {
									creatorKind:
										data.creatorKind as ProfileSpaceCreatorKind | null,
								}),
						...(data.spaceCreatedAt === undefined
							? {}
							: { spaceCreatedAt: data.spaceCreatedAt }),
						...(data.spaceUpdatedAt === undefined
							? {}
							: { spaceUpdatedAt: data.spaceUpdatedAt }),
						...(data.lastJoinedAt === undefined
							? {}
							: { lastJoinedAt: data.lastJoinedAt }),
						...(data.lastSeenTs === undefined
							? {}
							: { lastSeenTs: data.lastSeenTs }),
						...(data.pinnedAt === undefined ? {} : { pinnedAt: data.pinnedAt }),
					});
				})
			);
		}
	);
