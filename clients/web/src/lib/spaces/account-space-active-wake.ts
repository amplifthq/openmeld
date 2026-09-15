import { buildAccountSpaceActiveWakeSummaryPath } from "@openmeld/api-client";
import { accountSpaceActiveWakeSummaryResponseSchema } from "@openmeld/schemas";
import type { AccountSpaceActiveWakeSummaryResponse } from "@openmeld/schemas/types";
import { createIsomorphicFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";
import { getWebGatewayHost } from "#/lib/openmeld-api/gateway-host";
import { rethrowAccountSpaceApiFailure } from "./account-space-api-failure";

const getAccountSpaceActiveWakeSummaryInputSchema = z.strictObject({
	profileId: z.string().trim().min(1),
});

async function getAccountSpaceActiveWakeSummaryServer(input: {
	profileId: string;
}): Promise<AccountSpaceActiveWakeSummaryResponse> {
	const { fetchAccountSpaceActiveWakeSummaryFromRequest } = await import(
		"./account-space-active-wake.server"
	);

	return await fetchAccountSpaceActiveWakeSummaryFromRequest({
		gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
		webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
		profileId: input.profileId,
	});
}

const getAccountSpaceActiveWakeSummaryImpl = createIsomorphicFn()
	.client(async (input: { profileId: string }) =>
		createUnscopedWebOpenMeldApiFoundation({
			openMeldProfileId: input.profileId,
		})
			.requestJson({
				url: buildAccountSpaceActiveWakeSummaryPath({
					gatewayHost: await getWebGatewayHost(),
					selectedProfileId: input.profileId,
				}),
				method: "GET",
				operation: "list account space active wakes",
				schema: accountSpaceActiveWakeSummaryResponseSchema,
				invalidMessage: "Invalid account space active wake summary response",
			})
			.catch((error: unknown) =>
				rethrowAccountSpaceApiFailure(
					error,
					"list account space active wakes",
					"Invalid account space active wake summary response"
				)
			)
	)
	.server(getAccountSpaceActiveWakeSummaryServer);

export async function getAccountSpaceActiveWakeSummary(input: {
	data: { profileId: string };
}) {
	const parsed = getAccountSpaceActiveWakeSummaryInputSchema.safeParse(
		input.data
	);
	if (!parsed.success) {
		throw new Error(
			parsed.error.issues[0]?.message ??
				"Invalid account space active wake summary input."
		);
	}

	return await getAccountSpaceActiveWakeSummaryImpl(parsed.data);
}
