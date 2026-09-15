import { createAccountSpaceIndexApi } from "@openmeld/api-client";
import type { AccountSpaceIndexResponse } from "@openmeld/schemas/types";
import { createIsomorphicFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { getWebGatewayHost } from "#/lib/openmeld-api/gateway-host";
import { rethrowAccountSpaceApiFailure } from "./account-space-api-failure";

const listAccountSpaceIndexInputSchema = z.strictObject({
	includeDirectMessageProfileIds: z.boolean().optional(),
	includePurposes: z.boolean().optional(),
	limit: z.number().int().min(1).max(500).optional(),
	profileId: z.string().trim().min(1),
	scope: z.enum(["account", "profile"]).default("account"),
});

async function listAccountSpaceIndexServer(input: {
	includeDirectMessageProfileIds?: boolean;
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
		includeDirectMessageProfileIds: input.includeDirectMessageProfileIds,
		includePurposes: input.includePurposes,
		...(input.limit === undefined ? {} : { limit: input.limit }),
		webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
		profileId: input.profileId,
		scope: input.scope,
	});
}

const listAccountSpaceIndexImpl = createIsomorphicFn()
	.client(async (input: z.infer<typeof listAccountSpaceIndexInputSchema>) =>
		createAccountSpaceIndexApi(
			createUnscopedWebOpenMeldApiFoundation({
				openMeldProfileId: input.profileId,
			})
		)
			.listAccountSpaces({
				gatewayHost: await getWebGatewayHost(),
				selectedProfileId: input.profileId,
				scope: input.scope,
				limit: input.limit,
				includeDirectMessageProfileIds:
					input.includeDirectMessageProfileIds === true,
				includePurposes: input.includePurposes === true,
				includeRecentlyDeletedItems: true,
				includeMemberPreviews: true,
				includeMessagePreviews: true,
			})
			.catch((error: unknown) =>
				rethrowAccountSpaceApiFailure(
					error,
					"list account spaces",
					"Invalid account spaces response"
				)
			)
	)
	.server(listAccountSpaceIndexServer);

export async function listAccountSpaceIndex(input: {
	data: z.input<typeof listAccountSpaceIndexInputSchema>;
}) {
	const parsed = listAccountSpaceIndexInputSchema.safeParse(input.data);
	if (!parsed.success) {
		throw new Error(
			parsed.error.issues[0]?.message ?? "Invalid account space index input."
		);
	}

	return await listAccountSpaceIndexImpl(parsed.data);
}
