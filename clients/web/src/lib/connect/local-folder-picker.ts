import {
	createLocalFolderPickerApi,
	toStructuredApiClientFailure,
} from "@openmeld/api-client";
import type {
	LocalFolderPickerRequest,
	LocalFolderPickerResult,
	LocalRuntimeComputer,
} from "@openmeld/schemas/types";
import { createUnscopedWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

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
