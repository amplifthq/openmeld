import {
  leaveSpaceResponseSchema,
  postSpaceMembersResponseSchema,
  removeSpaceMembersResponseSchema,
} from "@openmeld/schemas";
import type {
  LeaveSpaceResponse,
  OpenMeldRequestContext,
  PostSpaceMembersResponse,
  RemoveSpaceMembersResponse,
} from "@openmeld/schemas/types";
import { buildOpenMeldRequestContextHeadersWithAuth } from "../config/request-headers";
import {
  toSpaceLeaveUrl,
  toSpaceMembersUrl,
  toSpaceRemoveMembersUrl,
} from "../protocol/urls";
import { fetchSpaceRequestWithTimeout } from "./fetch-with-timeout";
import { readGatewayJsonResponse } from "./gateway-response";

export async function postSpaceMembers(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
  memberProfileIds: string[];
}): Promise<PostSpaceMembersResponse> {
  const endpoint = toSpaceMembersUrl(input.baseUrl, input.space);
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
    spacePassword: input.password,
  });
  headers["content-type"] = "application/json";

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.members.add",
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        memberProfileIds: input.memberProfileIds,
      }),
    },
  });
  return await readGatewayJsonResponse({
    response,
    schema: postSpaceMembersResponseSchema,
    invalidMessage: "invalid add-members response",
  });
}

export async function removeSpaceMembers(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
  memberProfileIds: string[];
}): Promise<RemoveSpaceMembersResponse> {
  const endpoint = toSpaceRemoveMembersUrl(input.baseUrl, input.space);
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
    spacePassword: input.password,
  });
  headers["content-type"] = "application/json";

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.members.remove",
    init: {
      method: "POST",
      headers,
      body: JSON.stringify({
        memberProfileIds: input.memberProfileIds,
      }),
    },
  });
  return await readGatewayJsonResponse({
    response,
    schema: removeSpaceMembersResponseSchema,
    invalidMessage: "invalid remove-members response",
  });
}

export async function leaveSpace(input: {
  requestContext: OpenMeldRequestContext;
  baseUrl: string;
  space: string;
  password?: string;
}): Promise<LeaveSpaceResponse> {
  const endpoint = toSpaceLeaveUrl(input.baseUrl, input.space);
  const headers = await buildOpenMeldRequestContextHeadersWithAuth({
    requestUrl: endpoint,
    requestContext: input.requestContext,
    spacePassword: input.password,
  });

  const response = await fetchSpaceRequestWithTimeout({
    url: endpoint,
    operation: "space.leave",
    init: {
      method: "POST",
      headers,
    },
  });
  return await readGatewayJsonResponse({
    response,
    schema: leaveSpaceResponseSchema,
    invalidMessage: "invalid leave-space response",
  });
}
