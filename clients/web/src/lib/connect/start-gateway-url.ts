import { createServerFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";

export const readStartGatewayUrl = createServerFn({
	method: "GET",
}).handler(() => getRequiredServerEnv("OPENMELD_GATEWAY_URL"));
