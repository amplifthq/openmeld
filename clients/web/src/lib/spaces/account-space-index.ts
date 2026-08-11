import type { AccountSpaceIndexResponse } from "@openmeld/schemas/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";

const listAccountSpaceIndexInputSchema = z.strictObject({
	includePurposes: z.boolean().optional(),
	limit: z.number().int().min(1).max(500).optional(),
	profileId: z.string().trim().min(1),
	scope: z.enum(["account", "profile"]).default("account"),
});

async function listAccountSpaceIndexServer(input: {
	includePurposes?: boolean;
	limit?: number;
	profileId: string;
	scope: "account" | "profile";
}): Promise<AccountSpaceIndexResponse> {
	const { fetchAccountSpaceIndexFromRequest } = await import(
		"./account-space-index.server"
	);

	return await fetchAccountSpaceIndexFromRequest({
		gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
		includePurposes: input.includePurposes,
		...(input.limit === undefined ? {} : { limit: input.limit }),
		webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
		profileId: input.profileId,
		scope: input.scope,
	});
}

export const listAccountSpaceIndex = createServerFn({
	method: "GET",
})
	.inputValidator((data: unknown) => {
		const parsed = listAccountSpaceIndexInputSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ?? "Invalid account space index input."
			);
		}

		return parsed.data;
	})
	.handler(async ({ data }) => await listAccountSpaceIndexServer(data));
