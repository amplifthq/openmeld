import {
  agentAvatarStyleSchema,
  getAgentProfileFoldersResponseSchema,
  manageAgentProfileFoldersBodySchema,
  manageAgentProfileFoldersResponseSchema,
  updateAgentProfileDefaultProjectBodySchema,
  updateAgentProfileDefaultProjectResponseSchema,
  updateProfileResponseSchema,
} from "@openmeld/schemas";
import {
  buildAgentProfileDefaultProjectRoute,
  buildAgentProfileFoldersRoute,
  buildProfileRoute,
} from "./routes";
import type {
  CreateProfilesApi,
  RenameProfileInput,
  UpdateAgentAvatarInput,
  UpdateAgentProfileDefaultProjectInput,
} from "./types";

export const createProfilesApi: CreateProfilesApi = (client) => ({
  manageFolders: async (input) => {
    const body = manageAgentProfileFoldersBodySchema.parse({
      expectedBindingTarget: input.expectedBindingTarget,
      operation: input.operation,
    });
    return await client.requestJson({
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid Agent folder change response.",
      method: "POST",
      operation: "profile.manageFolders",
      requestContext: input.requestContext,
      schema: manageAgentProfileFoldersResponseSchema,
      url: buildAgentProfileFoldersRoute(
        normalizeRequiredText(input.profileId, "profileId")
      ),
    });
  },
  getFolders: async (input) =>
    await client.requestJson({
      invalidMessage: "Invalid Agent folders response.",
      method: "GET",
      operation: "profile.getFolders",
      requestContext: input.requestContext,
      schema: getAgentProfileFoldersResponseSchema,
      url: buildAgentProfileFoldersRoute(
        normalizeRequiredText(input.profileId, "profileId")
      ),
    }),
  updateAgentAvatar: async (input: UpdateAgentAvatarInput) => {
    const avatarStyle = agentAvatarStyleSchema.safeParse(input.avatarStyle);
    const profileId = normalizeRequiredText(input.profileId, "profileId");
    if (
      !(
        avatarStyle.success && ["automatic", "fluid"].includes(avatarStyle.data)
      )
    ) {
      throw new Error("Invalid Remote Agent avatar.");
    }
    return await client.requestJson({
      body: JSON.stringify({ avatarStyle: avatarStyle.data }),
      headers: { "content-type": "application/json" },
      invalidMessage: "Invalid Remote Agent avatar response.",
      method: "PATCH",
      operation: "profile.updateAgentAvatar",
      requestContext: input.requestContext,
      schema: updateProfileResponseSchema,
      url: `/v1/profiles/agents/${encodeURIComponent(profileId)}/avatar`,
    });
  },
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
      ...(request.expectedBindingTarget
        ? { expectedBindingTarget: request.expectedBindingTarget }
        : {}),
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
    ...(input.expectedBindingTarget
      ? { expectedBindingTarget: input.expectedBindingTarget }
      : {}),
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
