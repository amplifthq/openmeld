import {
	createComputerFileAccessApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	ComputerFileAccessPolicyResponse,
	ComputerFileAccessUpdateRequest,
} from "@openmeld/schemas/types";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readComputerFileAccessPolicy(input: {
	expectedDeviceId: string;
}): Promise<ComputerFileAccessPolicyResponse> {
	try {
		return await createComputerFileAccessApi(
			createWebOpenMeldApiFoundation()
		).readPolicy(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateComputerFileAccessPolicy(
	input: ComputerFileAccessUpdateRequest
): Promise<ComputerFileAccessPolicyResponse> {
	try {
		return await createComputerFileAccessApi(
			createWebOpenMeldApiFoundation()
		).updatePolicy(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
