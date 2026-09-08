import {
	createLocalFolderPickerApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	LocalFolderPickerRequest,
	LocalFolderPickerResult,
	LocalRuntimeComputer,
	PeopleComputerFolderPickerBody,
	PeopleComputerTarget,
} from "@openmeld/schemas/types";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export async function selectPeopleComputerFolders(
	input: PeopleComputerTarget &
		PeopleComputerFolderPickerBody & { timeoutMs: number }
): Promise<LocalFolderPickerResult> {
	try {
		return await createLocalFolderPickerApi(
			createUnscopedWebOpenMeldApiFoundation()
		).selectPeopleComputerFolders(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export async function selectLocalFolders(
	input: LocalFolderPickerRequest & { timeoutMs: number }
): Promise<LocalFolderPickerResult> {
	try {
		return await createLocalFolderPickerApi(
			createUnscopedWebOpenMeldApiFoundation()
		).selectFolders(input);
	} catch (error) {
		throw toStructuredApiClientFailure(error);
	}
}

export function resolveLocalFolderPickerDeviceId(
	computer: LocalRuntimeComputer | null | undefined
): string | null {
	return computer?.localFolderPicker?.selectFolders === true
		? computer.deviceId
		: null;
}
