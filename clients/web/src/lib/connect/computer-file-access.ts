import {
	createComputerFileAccessApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	ComputerFileAccessPolicyResponse,
	PeopleComputerFileAccessUpdateBody,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function readComputerFileAccessPolicy(
	input: PeopleComputerTarget
): Promise<ComputerFileAccessPolicyResponse> {
	try {
		return await createComputerFileAccessApi(
			createUnscopedWebOpenMeldApiFoundation()
		).readPeopleComputerPolicy(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function updateComputerFileAccessPolicy(
	input: PeopleComputerTarget & PeopleComputerFileAccessUpdateBody
): Promise<ComputerFileAccessPolicyResponse> {
	try {
		return await createComputerFileAccessApi(
			createUnscopedWebOpenMeldApiFoundation()
		).updatePeopleComputerPolicy(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}
