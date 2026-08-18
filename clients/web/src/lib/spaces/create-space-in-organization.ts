import type {
	AuthProfileView,
	CreateSpaceResponse,
	SpaceAccessMode,
	SpaceOrganizationVisibility,
} from "@openmeld/schemas/types";
import { buildProfileRequestContext } from "#/lib/profiles/human-profiles";
import { createWebSpaceApi } from "./api";

export const ORGANIZATION_SPACE_SCOPE_ERROR_MESSAGE =
	"OpenMeld couldn't verify that the Space was created in this Organization. Return to Spaces and refresh before trying again.";

export class OrganizationSpaceScopeError extends Error {
	constructor(input: {
		expectedOrganizationId: string;
		receivedOrganizationId: string | null;
		spaceId: string;
	}) {
		super(
			`Created Space ${input.spaceId} has Organization ${input.receivedOrganizationId ?? "<missing>"}; expected ${input.expectedOrganizationId}.`
		);
		this.name = "OrganizationSpaceScopeError";
	}
}

export async function createSpaceInOrganization(input: {
	actingProfile: AuthProfileView;
	organizationId: string;
	space: {
		accessMode: SpaceAccessMode;
		name: string;
		password?: string;
		visibility: SpaceOrganizationVisibility;
	};
}): Promise<CreateSpaceResponse> {
	const response = await createWebSpaceApi({
		organizationId: input.organizationId,
		openMeldProfileId: input.actingProfile.openMeldProfileId,
	}).createSpace({
		accessMode: input.space.accessMode,
		name: input.space.name,
		requestContext: buildProfileRequestContext(input.actingProfile),
		visibility: input.space.visibility,
		...(input.space.password ? { password: input.space.password } : {}),
	});

	if (response.meta?.organizationId !== input.organizationId) {
		throw new OrganizationSpaceScopeError({
			expectedOrganizationId: input.organizationId,
			receivedOrganizationId: response.meta?.organizationId ?? null,
			spaceId: response.spaceId,
		});
	}

	return response;
}
