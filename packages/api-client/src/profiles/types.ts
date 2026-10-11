import type {
  AgentProfileBindingTarget,
  OpenMeldRequestContext,
  UpdateAgentProfileDefaultProjectResponse,
  UpdateProfileResponse,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

export type RenameProfileInput = {
  profileId: string;
  profileName: string;
  requestContext?: OpenMeldRequestContext;
};

export type UpdateAgentAvatarInput = {
  profileId: string;
  avatarStyle: "automatic" | "fluid";
  requestContext?: OpenMeldRequestContext;
};

export type UpdateAgentProfileDefaultProjectInput = {
  expectedBindingTarget?: AgentProfileBindingTarget;
  defaultProjectId: string | null;
  expectedOrganizationId: string;
  profileId: string;
  requestContext?: OpenMeldRequestContext;
};

export type ProfilesApi = {
  rename: (input: RenameProfileInput) => Promise<UpdateProfileResponse>;
  updateAgentAvatar: (
    input: UpdateAgentAvatarInput
  ) => Promise<UpdateProfileResponse>;
  updateDefaultProject: (
    input: UpdateAgentProfileDefaultProjectInput
  ) => Promise<UpdateAgentProfileDefaultProjectResponse>;
};

export type CreateProfilesApi = (
  client: OpenMeldApiClientFoundation
) => ProfilesApi;
