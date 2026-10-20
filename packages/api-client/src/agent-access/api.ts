import {
  AGENT_ACCESS_REQUEST_DECISION_ROUTE,
  AGENT_ACCESS_REQUEST_ROUTE,
  AGENT_ACCESS_REQUEST_WITHDRAW_ROUTE,
  AGENT_ACCESS_REQUESTS_ROUTE,
  AGENT_PROFILE_ACCESS_GRANT_REVOKE_ROUTE,
  AGENT_PROFILE_ACCESS_GRANTS_ROUTE,
  createAgentProfileAccessGrantResponseSchema,
  createSpaceAgentRequestResponseSchema,
  decideAgentAccessRequestResponseSchema,
  getAgentAccessRequestResponseSchema,
  listAgentAccessRequestsResponseSchema,
  listAgentProfileAccessGrantsResponseSchema,
  listViewerAgentAccessGrantsResponseSchema,
  revokeAgentProfileAccessGrantResponseSchema,
  SPACE_AGENT_REQUESTS_ROUTE,
  VIEWER_AGENT_ACCESS_GRANTS_ROUTE,
  withdrawAgentAccessRequestResponseSchema,
} from "@openmeld/schemas";
import type { CreateAgentAccessApi } from "./types";

const JSON_HEADERS = { "content-type": "application/json" } as const;

function fill(route: string, params: Record<string, string>): string {
  return route.replace(/:([A-Za-z]+)/gu, (_match, name: string) => {
    const value = params[name];
    if (value === undefined) {
      throw new Error(`Missing route parameter ${name}.`);
    }
    return encodeURIComponent(value);
  });
}

/** Agent owner consent requests and grants (member-agent-program.md §4.6). */
export const createAgentAccessApi: CreateAgentAccessApi = (client) => ({
  list: async (query = {}) => {
    const search = new URLSearchParams(
      Object.entries(query).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ).toString();
    return await client.requestJson({
      invalidMessage: "Invalid Agent access request list.",
      method: "GET",
      operation: "agent_access.list_requests",
      schema: listAgentAccessRequestsResponseSchema,
      url: search
        ? `${AGENT_ACCESS_REQUESTS_ROUTE}?${search}`
        : AGENT_ACCESS_REQUESTS_ROUTE,
    });
  },
  get: async (requestId) =>
    await client.requestJson({
      invalidMessage: "Invalid Agent access request.",
      method: "GET",
      operation: "agent_access.get_request",
      schema: getAgentAccessRequestResponseSchema,
      url: fill(AGENT_ACCESS_REQUEST_ROUTE, { requestId }),
    }),
  decide: async (requestId, decision) =>
    await client.requestJson({
      body: JSON.stringify({ decision }),
      headers: JSON_HEADERS,
      invalidMessage: "Invalid Agent access decision response.",
      method: "POST",
      operation: "agent_access.decide_request",
      schema: decideAgentAccessRequestResponseSchema,
      url: fill(AGENT_ACCESS_REQUEST_DECISION_ROUTE, { requestId }),
    }),
  withdraw: async (requestId) =>
    await client.requestJson({
      invalidMessage: "Invalid Agent access withdrawal response.",
      method: "POST",
      operation: "agent_access.withdraw_request",
      schema: withdrawAgentAccessRequestResponseSchema,
      url: fill(AGENT_ACCESS_REQUEST_WITHDRAW_ROUTE, { requestId }),
    }),
  requestForSpace: async (input) =>
    await client.requestJson({
      body: JSON.stringify({
        agentProfileId: input.agentProfileId,
        ...(input.signalId ? { signalId: input.signalId } : {}),
      }),
      headers: JSON_HEADERS,
      invalidMessage: "Invalid Space Agent request response.",
      method: "POST",
      operation: "agent_access.request_for_space",
      schema: createSpaceAgentRequestResponseSchema,
      url: fill(SPACE_AGENT_REQUESTS_ROUTE, { spaceId: input.spaceId }),
    }),
  listGrants: async (agentProfileId) =>
    await client.requestJson({
      invalidMessage: "Invalid Agent access list.",
      method: "GET",
      operation: "agent_access.list_grants",
      schema: listAgentProfileAccessGrantsResponseSchema,
      url: fill(AGENT_PROFILE_ACCESS_GRANTS_ROUTE, { agentProfileId }),
    }),
  listViewerGrants: async () =>
    await client.requestJson({
      invalidMessage: "Invalid Agent access list.",
      method: "GET",
      operation: "agent_access.list_viewer_grants",
      schema: listViewerAgentAccessGrantsResponseSchema,
      url: VIEWER_AGENT_ACCESS_GRANTS_ROUTE,
    }),
  alwaysAllow: async (agentProfileId, granteeUserId) =>
    await client.requestJson({
      body: JSON.stringify({ granteeUserId, scope: "always" }),
      headers: JSON_HEADERS,
      invalidMessage: "Invalid Agent access grant response.",
      method: "POST",
      operation: "agent_access.always_allow",
      schema: createAgentProfileAccessGrantResponseSchema,
      url: fill(AGENT_PROFILE_ACCESS_GRANTS_ROUTE, { agentProfileId }),
    }),
  revokeGrant: async (agentProfileId, grantId) =>
    await client.requestJson({
      invalidMessage: "Invalid Agent access revoke response.",
      method: "POST",
      operation: "agent_access.revoke_grant",
      schema: revokeAgentProfileAccessGrantResponseSchema,
      url: fill(AGENT_PROFILE_ACCESS_GRANT_REVOKE_ROUTE, {
        agentProfileId,
        grantId,
      }),
    }),
});
