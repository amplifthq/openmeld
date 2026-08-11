import {
  approveOrganizationDocumentDraftBodySchema,
  approveOrganizationDocumentDraftResponseSchema,
  createOrganizationDocumentBodySchema,
  createOrganizationDocumentFolderBodySchema,
  createOrganizationDocumentFolderResponseSchema,
  createOrganizationDocumentResponseSchema,
  deleteOrganizationDocumentBodySchema,
  deleteOrganizationDocumentFolderBodySchema,
  deleteOrganizationDocumentFolderResponseSchema,
  deleteOrganizationDocumentResponseSchema,
  discardOrganizationDocumentDraftBodySchema,
  discardOrganizationDocumentDraftResponseSchema,
  getCenterAgentMemberResearchStatusResponseSchema,
  getOrganizationDocumentResponseSchema,
  listOrganizationDocumentsQuerySchema,
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
import type { Context, Hono } from "hono";
import type { z } from "zod/v4";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  executeRpcRoute,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";
import type { RpcHttpMethod } from "./rpc-http.types";

const DOCUMENTS_ROUTE = "/v1/organizations/current/documents";
const DOCUMENT_ROUTE = `${DOCUMENTS_ROUTE}/:documentId`;
const DOCUMENT_FOLDERS_ROUTE = `${DOCUMENTS_ROUTE}/folders`;
const DOCUMENT_FOLDER_ROUTE = `${DOCUMENT_FOLDERS_ROUTE}/:folderId`;
const APPROVE_DRAFT_ROUTE = `${DOCUMENT_ROUTE}/approve-draft`;
const DISCARD_DRAFT_ROUTE = `${DOCUMENT_ROUTE}/discard-draft`;
const MEMBER_RESEARCH_ROUTE = "/v1/organizations/current/member-research";

export function registerOrganizationDocumentRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(MEMBER_RESEARCH_ROUTE, (c) =>
    executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getCenterAgentMemberResearchStatus({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: getCenterAgentMemberResearchStatusResponseSchema,
      route: MEMBER_RESEARCH_ROUTE,
    })
  );

  app.post(MEMBER_RESEARCH_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      MEMBER_RESEARCH_ROUTE,
      "POST",
      startCenterAgentMemberResearchBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.startCenterAgentMemberResearch({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: startCenterAgentMemberResearchResponseSchema,
      route: MEMBER_RESEARCH_ROUTE,
      successStatus: 202,
    });
  });

  app.get(DOCUMENTS_ROUTE, (c) => {
    const query = listOrganizationDocumentsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return invalidPayloadResponse(c, DOCUMENTS_ROUTE, "GET", query.error);
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listOrganizationDocuments({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: listOrganizationDocumentsResponseSchema,
      route: DOCUMENTS_ROUTE,
    });
  });

  app.post(DOCUMENT_FOLDERS_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      DOCUMENT_FOLDERS_ROUTE,
      "POST",
      createOrganizationDocumentFolderBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.createOrganizationDocumentFolder({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: createOrganizationDocumentFolderResponseSchema,
      route: DOCUMENT_FOLDERS_ROUTE,
      successStatus: 201,
    });
  });

  app.patch(DOCUMENT_FOLDER_ROUTE, async (c) => {
    const params = parseFolderParams(c, DOCUMENT_FOLDER_ROUTE, "PATCH");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      DOCUMENT_FOLDER_ROUTE,
      "PATCH",
      updateOrganizationDocumentFolderBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.updateOrganizationDocumentFolder({
          ...body.data,
          context: buildCoreRpcContext(c),
          folderId: params.data.folderId,
        }),
      method: "PATCH",
      responseSchema: updateOrganizationDocumentFolderResponseSchema,
      route: DOCUMENT_FOLDER_ROUTE,
    });
  });

  app.delete(DOCUMENT_FOLDER_ROUTE, async (c) => {
    const params = parseFolderParams(c, DOCUMENT_FOLDER_ROUTE, "DELETE");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      DOCUMENT_FOLDER_ROUTE,
      "DELETE",
      deleteOrganizationDocumentFolderBodySchema,
      true
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.deleteOrganizationDocumentFolder({
          ...body.data,
          context: buildCoreRpcContext(c),
          folderId: params.data.folderId,
        }),
      method: "DELETE",
      responseSchema: deleteOrganizationDocumentFolderResponseSchema,
      route: DOCUMENT_FOLDER_ROUTE,
    });
  });

  app.get(DOCUMENT_ROUTE, (c) => {
    const params = parseParams(c, DOCUMENT_ROUTE, "GET");
    if (!params.ok) {
      return params.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getOrganizationDocument({
          context: buildCoreRpcContext(c),
          documentId: params.data.documentId,
        }),
      method: "GET",
      responseSchema: getOrganizationDocumentResponseSchema,
      route: DOCUMENT_ROUTE,
    });
  });

  app.post(DOCUMENTS_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      DOCUMENTS_ROUTE,
      "POST",
      createOrganizationDocumentBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.createOrganizationDocument({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: createOrganizationDocumentResponseSchema,
      route: DOCUMENTS_ROUTE,
      successStatus: 201,
    });
  });

  app.patch(DOCUMENT_ROUTE, async (c) => {
    const params = parseParams(c, DOCUMENT_ROUTE, "PATCH");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      DOCUMENT_ROUTE,
      "PATCH",
      updateOrganizationDocumentBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.updateOrganizationDocument({
          ...body.data,
          context: buildCoreRpcContext(c),
          documentId: params.data.documentId,
        }),
      method: "PATCH",
      responseSchema: updateOrganizationDocumentResponseSchema,
      route: DOCUMENT_ROUTE,
    });
  });

  app.delete(DOCUMENT_ROUTE, async (c) => {
    const params = parseParams(c, DOCUMENT_ROUTE, "DELETE");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      DOCUMENT_ROUTE,
      "DELETE",
      deleteOrganizationDocumentBodySchema,
      true
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.deleteOrganizationDocument({
          ...body.data,
          context: buildCoreRpcContext(c),
          documentId: params.data.documentId,
        }),
      method: "DELETE",
      responseSchema: deleteOrganizationDocumentResponseSchema,
      route: DOCUMENT_ROUTE,
    });
  });

  app.post(APPROVE_DRAFT_ROUTE, async (c) => {
    const params = parseParams(c, APPROVE_DRAFT_ROUTE, "POST");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      APPROVE_DRAFT_ROUTE,
      "POST",
      approveOrganizationDocumentDraftBodySchema,
      true
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.approveOrganizationDocumentDraft({
          ...body.data,
          context: buildCoreRpcContext(c),
          documentId: params.data.documentId,
        }),
      method: "POST",
      responseSchema: approveOrganizationDocumentDraftResponseSchema,
      route: APPROVE_DRAFT_ROUTE,
    });
  });

  app.post(DISCARD_DRAFT_ROUTE, async (c) => {
    const params = parseParams(c, DISCARD_DRAFT_ROUTE, "POST");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      DISCARD_DRAFT_ROUTE,
      "POST",
      discardOrganizationDocumentDraftBodySchema,
      true
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.discardOrganizationDocumentDraft({
          ...body.data,
          context: buildCoreRpcContext(c),
          documentId: params.data.documentId,
        }),
      method: "POST",
      responseSchema: discardOrganizationDocumentDraftResponseSchema,
      route: DISCARD_DRAFT_ROUTE,
    });
  });
}

type ParseResult<T> = { data: T; ok: true } | { ok: false; response: Response };

async function parseBody<T>(
  c: Context<HonoBindings>,
  route: string,
  method: "DELETE" | "PATCH" | "POST",
  schema: z.ZodType<T>,
  acceptMissingBody = false
): Promise<ParseResult<T>> {
  const body = await readJsonRequestBody(c.req.raw);
  if (!body.ok) {
    return {
      ok: false,
      response: respondBadRequest({
        c,
        code: "invalid_json",
        message: body.message,
        method,
        route,
      }),
    };
  }
  const value = acceptMissingBody && body.value === undefined ? {} : body.value;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, parsed.error),
    };
  }
  return { data: parsed.data, ok: true };
}

function parseParams(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
): ParseResult<{ documentId: string }> {
  const parsed = organizationDocumentRouteParamsSchema.safeParse({
    documentId: c.req.param("documentId"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, parsed.error),
    };
  }
  return { data: parsed.data, ok: true };
}

function parseFolderParams(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod
): ParseResult<{ folderId: string }> {
  const parsed = organizationDocumentFolderRouteParamsSchema.safeParse({
    folderId: c.req.param("folderId"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      response: invalidPayloadResponse(c, route, method, parsed.error),
    };
  }
  return { data: parsed.data, ok: true };
}

function invalidPayloadResponse(
  c: Context<HonoBindings>,
  route: string,
  method: RpcHttpMethod,
  error: z.ZodError
): Response {
  return respondBadRequest({
    c,
    code: "invalid_payload",
    message:
      error.issues[0]?.message ?? "Invalid Organization document request.",
    method,
    route,
  });
}
