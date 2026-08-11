import {
  approveOrganizationDocumentDraftResponseSchema,
  createOrganizationDocumentBodySchema,
  createOrganizationDocumentFolderBodySchema,
  createOrganizationDocumentFolderResponseSchema,
  createOrganizationDocumentResponseSchema,
  deleteOrganizationDocumentFolderResponseSchema,
  deleteOrganizationDocumentResponseSchema,
  discardOrganizationDocumentDraftResponseSchema,
  getCenterAgentMemberResearchStatusResponseSchema,
  getOrganizationDocumentResponseSchema,
  listOrganizationDocumentsResponseSchema,
  organizationDocumentFolderRouteParamsSchema,
  organizationDocumentRouteParamsSchema,
  startCenterAgentMemberResearchBodySchema,
  startCenterAgentMemberResearchResponseSchema,
  updateOrganizationDocumentBodySchema,
  updateOrganizationDocumentFolderBodySchema,
  updateOrganizationDocumentFolderResponseSchema,
  updateOrganizationDocumentResponseSchema,
} from "@openmeld/schemas";
import type { OpenMeldApiClientFoundation } from "../client";
import {
  buildCenterAgentMemberResearchPath,
  buildOrganizationDocumentApproveDraftPath,
  buildOrganizationDocumentDiscardDraftPath,
  buildOrganizationDocumentFolderPath,
  buildOrganizationDocumentFoldersPath,
  buildOrganizationDocumentPath,
  buildOrganizationDocumentsPath,
} from "./routes";
import type {
  CreateOrganizationDocumentsApi,
  OrganizationDocumentRequestInput,
} from "./types";

export const createOrganizationDocumentsApi: CreateOrganizationDocumentsApi = (
  client: OpenMeldApiClientFoundation
) => ({
  getMemberResearchStatus: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Center Agent member research status response",
      method: "GET",
      operation: "center_agent_member_research.status",
      schema: getCenterAgentMemberResearchStatusResponseSchema,
      url: buildCenterAgentMemberResearchPath(),
    }),
  startMemberResearch: async (input) => {
    const body = requireValidInput(
      startCenterAgentMemberResearchBodySchema,
      input.scope === "member"
        ? {
            expectedOrganizationId: input.expectedOrganizationId,
            scope: input.scope,
            subjectUserId: input.subjectUserId,
          }
        : {
            expectedOrganizationId: input.expectedOrganizationId,
            scope: input.scope,
          },
      "Center Agent member research request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Center Agent member research response",
      method: "POST",
      operation: "center_agent_member_research.start",
      schema: startCenterAgentMemberResearchResponseSchema,
      url: buildCenterAgentMemberResearchPath(),
    });
  },
  list: async (input = {}) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Organization documents response",
      method: "GET",
      operation: "organization_document.list",
      schema: listOrganizationDocumentsResponseSchema,
      url: buildOrganizationDocumentsPath(),
    }),
  get: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      invalidMessage: "invalid Organization document response",
      method: "GET",
      operation: "organization_document.get",
      schema: getOrganizationDocumentResponseSchema,
      url: buildOrganizationDocumentPath(requireDocumentId(input.documentId)),
    }),
  create: async (input) => {
    const body = requireValidInput(
      createOrganizationDocumentBodySchema,
      {
        content: input.content,
        expectedOrganizationId: input.expectedOrganizationId,
        kind: input.kind,
        ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
        ...(input.subjectUserId === undefined
          ? {}
          : { subjectUserId: input.subjectUserId }),
        ...(input.title === undefined ? {} : { title: input.title }),
      },
      "Organization document create request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization document create response",
      method: "POST",
      operation: "organization_document.create",
      schema: createOrganizationDocumentResponseSchema,
      url: buildOrganizationDocumentsPath(),
    });
  },
  update: async (input) => {
    const body = requireValidInput(
      updateOrganizationDocumentBodySchema,
      {
        ...(input.content === undefined ? {} : { content: input.content }),
        expectedOrganizationId: input.expectedOrganizationId,
        ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
        ...(input.title === undefined ? {} : { title: input.title }),
      },
      "Organization document update request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization document update response",
      method: "PATCH",
      operation: "organization_document.update",
      schema: updateOrganizationDocumentResponseSchema,
      url: buildOrganizationDocumentPath(requireDocumentId(input.documentId)),
    });
  },
  delete: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify({
        expectedOrganizationId: input.expectedOrganizationId,
      }),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization document delete response",
      method: "DELETE",
      operation: "organization_document.delete",
      schema: deleteOrganizationDocumentResponseSchema,
      url: buildOrganizationDocumentPath(requireDocumentId(input.documentId)),
    }),
  createFolder: async (input) => {
    const body = requireValidInput(
      createOrganizationDocumentFolderBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        name: input.name,
        ...(input.parentFolderId === undefined
          ? {}
          : { parentFolderId: input.parentFolderId }),
      },
      "Organization document folder create request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization document folder create response",
      method: "POST",
      operation: "organization_document.create_folder",
      schema: createOrganizationDocumentFolderResponseSchema,
      url: buildOrganizationDocumentFoldersPath(),
    });
  },
  updateFolder: async (input) => {
    const body = requireValidInput(
      updateOrganizationDocumentFolderBodySchema,
      {
        expectedOrganizationId: input.expectedOrganizationId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.parentFolderId === undefined
          ? {}
          : { parentFolderId: input.parentFolderId }),
      },
      "Organization document folder update request is invalid."
    );
    return await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization document folder update response",
      method: "PATCH",
      operation: "organization_document.update_folder",
      schema: updateOrganizationDocumentFolderResponseSchema,
      url: buildOrganizationDocumentFolderPath(requireFolderId(input.folderId)),
    });
  },
  deleteFolder: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify({
        expectedOrganizationId: input.expectedOrganizationId,
      }),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization document folder delete response",
      method: "DELETE",
      operation: "organization_document.delete_folder",
      schema: deleteOrganizationDocumentFolderResponseSchema,
      url: buildOrganizationDocumentFolderPath(requireFolderId(input.folderId)),
    }),
  approveDraft: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify({
        expectedDraftCreatedAt: input.expectedDraftCreatedAt,
        expectedOrganizationId: input.expectedOrganizationId,
      }),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization document approval response",
      method: "POST",
      operation: "organization_document.approve_draft",
      schema: approveOrganizationDocumentDraftResponseSchema,
      url: buildOrganizationDocumentApproveDraftPath(
        requireDocumentId(input.documentId)
      ),
    }),
  discardDraft: async (input) =>
    await client.requestJson({
      ...requestOptions(input),
      body: JSON.stringify({
        expectedDraftCreatedAt: input.expectedDraftCreatedAt,
        expectedOrganizationId: input.expectedOrganizationId,
      }),
      headers: { "content-type": "application/json" },
      invalidMessage: "invalid Organization document discard response",
      method: "POST",
      operation: "organization_document.discard_draft",
      schema: discardOrganizationDocumentDraftResponseSchema,
      url: buildOrganizationDocumentDiscardDraftPath(
        requireDocumentId(input.documentId)
      ),
    }),
});

function requireDocumentId(value: string): string {
  return requireValidInput(
    organizationDocumentRouteParamsSchema,
    { documentId: value },
    "Organization document identifier is invalid."
  ).documentId;
}

function requireFolderId(value: string): string {
  return requireValidInput(
    organizationDocumentFolderRouteParamsSchema,
    { folderId: value },
    "Organization document folder identifier is invalid."
  ).folderId;
}

function requestOptions(input: OrganizationDocumentRequestInput) {
  return {
    ...(input.requestContext === undefined
      ? {}
      : { requestContext: input.requestContext }),
    ...(input.signal === undefined ? {} : { signal: input.signal }),
    ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
  };
}

function requireValidInput<T>(
  schema: {
    safeParse(
      value: unknown
    ):
      | { data: T; success: true }
      | { error: { issues: Array<{ message: string }> }; success: false };
  },
  value: unknown,
  message: string
): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `${message} ${parsed.error.issues[0]?.message ?? "Invalid input."}`
    );
  }
  return parsed.data;
}
