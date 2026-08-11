import type { AccountSpaceActiveWakeSummaryResponse } from "@openmeld/schemas/types";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";

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

export const getAccountSpaceActiveWakeSummary = createServerFn({
	method: "GET",
})
	.inputValidator((data: unknown) => {
		const parsed = getAccountSpaceActiveWakeSummaryInputSchema.safeParse(data);
		if (!parsed.success) {
			throw new Error(
				parsed.error.issues[0]?.message ??
					"Invalid account space active wake summary input."
			);
		}

		return parsed.data;
	})
	.handler(
		async ({ data }) => await getAccountSpaceActiveWakeSummaryServer(data)
	);
