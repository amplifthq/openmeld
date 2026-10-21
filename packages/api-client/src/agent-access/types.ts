import type {
  AgentAccessDecision,
  CreateAgentProfileAccessGrantResponse,
  CreateSpaceAgentRequestResponse,
  DecideAgentAccessRequestResponse,
  GetAgentAccessRequestResponse,
  ListAgentAccessRequestsQuery,
  ListAgentAccessRequestsResponse,
  ListAgentProfileAccessGrantsResponse,
  ListViewerAgentAccessGrantsResponse,
  RevokeAgentProfileAccessGrantResponse,
  WithdrawAgentAccessRequestResponse,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";

export type AgentAccessApi = {
  /** Requests where the caller is the Agent owner or the requester. */
  list: (
    query?: ListAgentAccessRequestsQuery
  ) => Promise<ListAgentAccessRequestsResponse>;
  get: (requestId: string) => Promise<GetAgentAccessRequestResponse>;
  /** The Agent owner's answer; Core applies it in the request's Space. */
  decide: (
    requestId: string,
    decision: AgentAccessDecision
  ) => Promise<DecideAgentAccessRequestResponse>;
  withdraw: (requestId: string) => Promise<WithdrawAgentAccessRequestResponse>;
  /** Ask an Agent's owner to let it join a Space, optionally for a message. */
  requestForSpace: (input: {
    spaceId: string;
    agentProfileId: string;
    signalId?: string;
  }) => Promise<CreateSpaceAgentRequestResponse>;
  listGrants: (
    agentProfileId: string
  ) => Promise<ListAgentProfileAccessGrantsResponse>;
  /** Colleagues' Agents the caller may start work with without asking. */
  listViewerGrants: () => Promise<ListViewerAgentAccessGrantsResponse>;
  /**
   * The owner always allows a member: a new standing grant, or the active
   * one. The request that led to it keeps its decision.
   */
  alwaysAllow: (
    agentProfileId: string,
    granteeUserId: string
  ) => Promise<CreateAgentProfileAccessGrantResponse>;
  revokeGrant: (
    agentProfileId: string,
    grantId: string
  ) => Promise<RevokeAgentProfileAccessGrantResponse>;
};

export type CreateAgentAccessApi = (
  client: OpenMeldApiClientFoundation
) => AgentAccessApi;
