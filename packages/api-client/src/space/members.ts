import {
  addCenterAgentToSpaceBodySchema,
  addOrganizationDirectoryProfilesToSpaceBodySchema,
  postSpaceMembersResponseSchema,
  spaceIdentityDirectorySchema,
  spaceMemberDirectorySchema,
  spaceMembersSnapshotSchema,
  spaceViewerMembershipResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildSpaceCenterAgentMemberPath,
  buildSpaceIdentityDirectoryPath,
  buildSpaceJoinPath,
  buildSpaceMemberDirectoryPath,
  buildSpaceMembersPath,
  buildSpaceOrganizationDirectoryProfilesPath,
  buildSpaceViewerMembershipPath,
} from "./routes";
import type {
  AddCenterAgentToSpaceInput,
  AddOrganizationDirectoryProfilesToSpaceInput,
  SpaceRequestInput,
} from "./types";

export async function getSpaceMembersSnapshot(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
) {
  return await client.requestJson({
    url: buildSpaceMembersPath(input.spaceId),
    operation: "space.members.list",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: spaceMembersSnapshotSchema,
    invalidMessage: "invalid space members response",
  });
}

export async function getSpaceMemberDirectory(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
) {
  return await client.requestJson({
    url: buildSpaceMemberDirectoryPath(input.spaceId),
    operation: "space.member_directory.read",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: spaceMemberDirectorySchema,
    invalidMessage: "invalid space member directory response",
  });
}

export async function getSpaceIdentityDirectory(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
) {
  return await client.requestJson({
    url: buildSpaceIdentityDirectoryPath(input.spaceId),
    operation: "space.identity_directory.read",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: spaceIdentityDirectorySchema,
    invalidMessage: "invalid space identity directory response",
  });
}

export async function getSpaceViewerMembership(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
) {
  return await client.requestJson({
    url: buildSpaceViewerMembershipPath(input.spaceId),
    operation: "space.viewer_membership.read",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: spaceViewerMembershipResponseSchema,
    invalidMessage: "invalid space viewer membership response",
  });
}

export async function joinSpace(
  client: OpenMeldApiClientFoundation,
  input: SpaceRequestInput
) {
  return await client.requestJson({
    url: buildSpaceJoinPath(input.spaceId),
    operation: "space.join",
    method: "POST",
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: postSpaceMembersResponseSchema,
    invalidMessage: "invalid space join response",
  });
}

/** @deprecated Use addOrganizationDirectoryProfilesToSpace instead. */
export async function addCenterAgentToSpace(
  client: OpenMeldApiClientFoundation,
  input: AddCenterAgentToSpaceInput
) {
  const parsedBody = addCenterAgentToSpaceBodySchema.safeParse({
    expectedCenterAgentProfileId: input.expectedCenterAgentProfileId,
  });
  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ??
        "invalid add Center Agent Space member request body"
    );
  }
  return await client.requestJson({
    url: buildSpaceCenterAgentMemberPath(input.spaceId),
    operation: "space.center_agent_member.add",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsedBody.data),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: postSpaceMembersResponseSchema,
    invalidMessage: "invalid add Center Agent Space member response",
  });
}

export async function addOrganizationDirectoryProfilesToSpace(
  client: OpenMeldApiClientFoundation,
  input: AddOrganizationDirectoryProfilesToSpaceInput
) {
  const parsedBody =
    addOrganizationDirectoryProfilesToSpaceBodySchema.safeParse({
      directoryProfileIds: input.directoryProfileIds,
      ...(input.expectedCenterAgentProfileId === undefined
        ? {}
        : {
            expectedCenterAgentProfileId: input.expectedCenterAgentProfileId,
          }),
    });
  if (!parsedBody.success) {
    throw new Error(
      parsedBody.error.issues[0]?.message ??
        "invalid Organization Directory Space member request body"
    );
  }
  return await client.requestJson({
    url: buildSpaceOrganizationDirectoryProfilesPath(input.spaceId),
    operation: "space.organization_directory_profiles.add",
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(parsedBody.data),
    requestContext: input.requestContext,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    ...(input.spacePassword === undefined
      ? {}
      : { spacePassword: input.spacePassword }),
    schema: postSpaceMembersResponseSchema,
    invalidMessage: "invalid Organization Directory Space member response",
  });
}
