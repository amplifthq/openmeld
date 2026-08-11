import type {
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

export type UpdateAgentProfileDefaultProjectInput = {
  defaultProjectId: string | null;
  expectedOrganizationId: string;
  profileId: string;
  requestContext?: OpenMeldRequestContext;
};

export type ProfilesApi = {
  rename: (input: RenameProfileInput) => Promise<UpdateProfileResponse>;
  updateDefaultProject: (
    input: UpdateAgentProfileDefaultProjectInput
  ) => Promise<UpdateAgentProfileDefaultProjectResponse>;
};

export type CreateProfilesApi = (
  client: OpenMeldApiClientFoundation
) => ProfilesApi;
