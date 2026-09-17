import { createServerFn } from "@tanstack/react-start";
import { z } from "zod/v4";
import { getRequiredServerEnv } from "#/env";
import type { PublicSpaceInitialData } from "./public-space-initial-read.server";

const publicSpaceInitialReadInputSchema = z.strictObject({
	spaceId: z.string().trim().min(1).max(200),
	signalId: z.string().trim().min(1).max(200).optional(),
	threadRootSignalId: z.string().trim().min(1).max(200).optional(),
});

const readPublicSpaceInitialDataJson = createServerFn({ method: "GET" })
	.validator((input: unknown) => publicSpaceInitialReadInputSchema.parse(input))
	.handler(async ({ data }) => {
		const { readPublicSpaceInitialDataFromRequest } = await import(
			"./public-space-initial-read.server"
		);
		return JSON.stringify(
			await readPublicSpaceInitialDataFromRequest({
				...data,
				gatewayUrl: getRequiredServerEnv("OPENMELD_GATEWAY_URL"),
				webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
			})
		);
	});

export async function readPublicSpaceInitialData(input: {
	data: z.infer<typeof publicSpaceInitialReadInputSchema>;
}): Promise<PublicSpaceInitialData> {
	return JSON.parse(
		await readPublicSpaceInitialDataJson(input)
	) as PublicSpaceInitialData;
}
