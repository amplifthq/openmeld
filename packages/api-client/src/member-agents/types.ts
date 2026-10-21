import type { ListMemberAgentsResponse } from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";

export type MemberAgentsApi = {
  /**
   * The caller's own MemberAgents in the requested Organization, with their
   * Profiles and the caller's unassigned Agent Profiles. The Organization
   * comes from the foundation's requested-organization header or the Session.
   */
  list: () => Promise<ListMemberAgentsResponse>;
};

export type CreateMemberAgentsApi = (
  client: OpenMeldApiClientFoundation
) => MemberAgentsApi;
