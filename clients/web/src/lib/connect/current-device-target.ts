import { createCurrentDeviceApi } from "@openmeld/api-client";
import type {
	CurrentDeviceTargetResponse,
	ForgetComputerResponse,
	ForgetCurrentComputerResponse,
} from "@openmeld/schemas";
import { createIsomorphicFn } from "@tanstack/react-start";
import { getRequiredServerEnv } from "#/env";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

const resolveCurrentDeviceTargetImpl = createIsomorphicFn()
	.client(async (): Promise<CurrentDeviceTargetResponse> => {
		return await createCurrentDeviceApi(
			createWebOpenMeldApiFoundation()
		).getCurrentTarget();
	})
	.server(async (): Promise<CurrentDeviceTargetResponse> => {
		const { fetchCurrentDeviceTargetFromRequest } = await import(
			"./current-device-target.server"
		);

		return await fetchCurrentDeviceTargetFromRequest({
			webAppUrl: getRequiredServerEnv("WEB_APP_URL"),
		});
	});

export async function resolveCurrentDeviceTarget() {
	return await resolveCurrentDeviceTargetImpl();
}

export async function forgetCurrentComputer(): Promise<ForgetCurrentComputerResponse> {
	return await createCurrentDeviceApi(
		createWebOpenMeldApiFoundation()
	).forgetCurrentComputer();
}

export async function forgetComputer(input: {
	deviceId: string;
}): Promise<ForgetComputerResponse> {
	return await createCurrentDeviceApi(
		createWebOpenMeldApiFoundation()
	).forgetComputer(input);
}
