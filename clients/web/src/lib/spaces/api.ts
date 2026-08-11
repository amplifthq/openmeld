import { createSpaceApi } from "@openmeld/api-client";
import { createWebOpenMeldApiFoundation } from "#/lib/openmeld-api/client";

export function createWebSpaceApi(
	input: {
		organizationId?: string;
		organizationSlug?: string;
		openMeldProfileId?: string;
	} = {}
) {
	return createSpaceApi(
		createWebOpenMeldApiFoundation({
			...(input.organizationId === undefined
				? {}
				: { organizationId: input.organizationId }),
			...(input.organizationSlug === undefined
				? {}
				: { organizationSlug: input.organizationSlug }),
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		})
	);
}
