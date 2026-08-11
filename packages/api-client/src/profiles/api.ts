import {
  updateAgentProfileDefaultProjectBodySchema,
  updateAgentProfileDefaultProjectResponseSchema,
  updateProfileResponseSchema,
} from "@openmeld/schemas";
import {
  buildAgentProfileDefaultProjectRoute,
  buildProfileRoute,
} from "./routes";
import type {
  CreateProfilesApi,
  RenameProfileInput,
  UpdateAgentProfileDefaultProjectInput,
} from "./types";

export const createProfilesApi: CreateProfilesApi = (client) => ({
  rename: async (input) => {
    const request = requireValidRenameProfileInput(input);

    return await client.requestJson({
      body: JSON.stringify({
        profileName: request.profileName,
      }),
      headers: {
        "content-type": "application/json",
      },
      invalidMessage: "Invalid Profile rename response.",
      method: "PATCH",
      operation: "profile.rename",
      requestContext: request.requestContext,
      schema: updateProfileResponseSchema,
      url: buildProfileRoute(request.profileId),
    });
  },
  updateDefaultProject: async (input) => {
    const request = requireValidUpdateDefaultProjectInput(input);
    const parsedBody = updateAgentProfileDefaultProjectBodySchema.safeParse({
      defaultProjectId: request.defaultProjectId,
      expectedOrganizationId: request.expectedOrganizationId,
    });
    if (!parsedBody.success) {
      throw new Error(
        `Invalid Agent Profile Default Project request: ${parsedBody.error.message}`
      );
    }

    return await client.requestJson({
      body: JSON.stringify(parsedBody.data),
      headers: {
        "content-type": "application/json",
      },
      invalidMessage: "Invalid Agent Profile default Project response.",
      method: "PATCH",
      operation: "profile.updateDefaultProject",
      requestContext: request.requestContext,
      schema: updateAgentProfileDefaultProjectResponseSchema,
      url: buildAgentProfileDefaultProjectRoute(request.profileId),
    });
  },
});

function requireValidRenameProfileInput(
  input: RenameProfileInput
): RenameProfileInput {
  const profileId = normalizeRequiredText(input.profileId, "profileId");
  const profileName = normalizeRequiredText(input.profileName, "profileName");
  return {
    profileId,
    profileName,
    ...(input.requestContext ? { requestContext: input.requestContext } : {}),
  };
}

function requireValidUpdateDefaultProjectInput(
  input: UpdateAgentProfileDefaultProjectInput
): UpdateAgentProfileDefaultProjectInput {
  const profileId = normalizeRequiredText(input.profileId, "profileId");
  const expectedOrganizationId = normalizeRequiredText(
    input.expectedOrganizationId,
    "expectedOrganizationId"
  );
  const defaultProjectId =
    input.defaultProjectId === null
      ? null
      : normalizeRequiredText(input.defaultProjectId, "defaultProjectId");
  return {
    defaultProjectId,
    expectedOrganizationId,
    profileId,
    ...(input.requestContext ? { requestContext: input.requestContext } : {}),
  };
}

function normalizeRequiredText(value: unknown, fieldName: string): string {
  const normalized = String(value ?? "").trim();
  if (normalized.length === 0) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}
