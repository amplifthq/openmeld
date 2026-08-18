import { createSpaceApi } from "@openmeld/api-client";
import {
	createOrganizationScopedWebOpenMeldApiFoundation,
	createUnscopedWebOpenMeldApiFoundation,
	type WebOrganizationSelector,
} from "#/lib/openmeld-api/client";

type WebSpaceApiInput = {
	openMeldProfileId?: string;
};

export function createOrganizationScopedWebSpaceApi(
	input: WebSpaceApiInput & WebOrganizationSelector
) {
	return createSpaceApi(
		createOrganizationScopedWebOpenMeldApiFoundation({
			...(input.organizationId === undefined
				? { organizationSlug: input.organizationSlug }
				: { organizationId: input.organizationId }),
			...(input.openMeldProfileId === undefined
				? {}
				: { openMeldProfileId: input.openMeldProfileId }),
		})
	);
}

export function createUnscopedWebSpaceApi(input: WebSpaceApiInput = {}) {
	return createSpaceApi(createUnscopedWebOpenMeldApiFoundation(input));
}
