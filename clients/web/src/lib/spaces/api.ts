import { createSpaceApi } from "@openmeld/api-client";
import { withLocalSpaceRuntimeFixtures } from "#/lib/dev/space-runtime-fixtures";
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
	const api = createSpaceApi(createUnscopedWebOpenMeldApiFoundation(input));
	return import.meta.env.DEV
		? withLocalSpaceRuntimeFixtures(api, input.openMeldProfileId)
		: api;
}
