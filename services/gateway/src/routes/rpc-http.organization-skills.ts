import {
  createOrganizationSkillBodySchema,
  createOrganizationSkillResponseSchema,
  deleteOrganizationSkillBodySchema,
  deleteOrganizationSkillResponseSchema,
  getOrganizationSkillResponseSchema,
  importOrganizationSkillFromGitHubBodySchema,
  importOrganizationSkillFromGitHubResponseSchema,
  listOrganizationSkillsQuerySchema,
  listOrganizationSkillsResponseSchema,
  organizationSkillRouteParamsSchema,
  previewOrganizationSkillFromGitHubBodySchema,
  previewOrganizationSkillFromGitHubResponseSchema,
  setOrganizationSkillEnabledBodySchema,
  setOrganizationSkillEnabledResponseSchema,
  setOrganizationSkillMaintainersBodySchema,
  setOrganizationSkillMaintainersResponseSchema,
  updateOrganizationSkillBodySchema,
  updateOrganizationSkillResponseSchema,
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

const SKILLS_ROUTE = "/v1/organizations/current/skills";
const SKILL_ROUTE = `${SKILLS_ROUTE}/:skillId`;
const SKILL_ENABLED_ROUTE = `${SKILL_ROUTE}/enabled`;
const SKILL_MAINTAINERS_ROUTE = `${SKILL_ROUTE}/maintainers`;
const SKILL_GITHUB_IMPORT_ROUTE = `${SKILLS_ROUTE}/import-github`;
const SKILL_GITHUB_PREVIEW_ROUTE = `${SKILLS_ROUTE}/preview-github`;

export function registerOrganizationSkillRoutes(app: Hono<HonoBindings>): void {
  app.get(SKILLS_ROUTE, (c) => {
    const query = listOrganizationSkillsQuerySchema.safeParse(c.req.query());
    if (!query.success) {
      return invalidPayloadResponse(c, SKILLS_ROUTE, "GET", query.error);
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.listOrganizationSkills({
          context: buildCoreRpcContext(c),
        }),
      method: "GET",
      responseSchema: listOrganizationSkillsResponseSchema,
      route: SKILLS_ROUTE,
    });
  });

  app.post(SKILLS_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      SKILLS_ROUTE,
      "POST",
      createOrganizationSkillBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.createOrganizationSkill({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: createOrganizationSkillResponseSchema,
      route: SKILLS_ROUTE,
      successStatus: 201,
    });
  });

  app.post(SKILL_GITHUB_IMPORT_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      SKILL_GITHUB_IMPORT_ROUTE,
      "POST",
      importOrganizationSkillFromGitHubBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.importOrganizationSkillFromGitHub({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: importOrganizationSkillFromGitHubResponseSchema,
      route: SKILL_GITHUB_IMPORT_ROUTE,
      successStatus: 201,
    });
  });

  app.post(SKILL_GITHUB_PREVIEW_ROUTE, async (c) => {
    const body = await parseBody(
      c,
      SKILL_GITHUB_PREVIEW_ROUTE,
      "POST",
      previewOrganizationSkillFromGitHubBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.previewOrganizationSkillFromGitHub({
          ...body.data,
          context: buildCoreRpcContext(c),
        }),
      method: "POST",
      responseSchema: previewOrganizationSkillFromGitHubResponseSchema,
      route: SKILL_GITHUB_PREVIEW_ROUTE,
    });
  });

  app.get(SKILL_ROUTE, (c) => {
    const params = parseParams(c, SKILL_ROUTE, "GET");
    if (!params.ok) {
      return params.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.getOrganizationSkill({
          context: buildCoreRpcContext(c),
          skillId: params.data.skillId,
        }),
      method: "GET",
      responseSchema: getOrganizationSkillResponseSchema,
      route: SKILL_ROUTE,
    });
  });

  app.patch(SKILL_ROUTE, async (c) => {
    const params = parseParams(c, SKILL_ROUTE, "PATCH");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      SKILL_ROUTE,
      "PATCH",
      updateOrganizationSkillBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.updateOrganizationSkill({
          ...body.data,
          context: buildCoreRpcContext(c),
          skillId: params.data.skillId,
        }),
      method: "PATCH",
      responseSchema: updateOrganizationSkillResponseSchema,
      route: SKILL_ROUTE,
    });
  });

  app.patch(SKILL_ENABLED_ROUTE, async (c) => {
    const params = parseParams(c, SKILL_ENABLED_ROUTE, "PATCH");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      SKILL_ENABLED_ROUTE,
      "PATCH",
      setOrganizationSkillEnabledBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.setOrganizationSkillEnabled({
          ...body.data,
          context: buildCoreRpcContext(c),
          skillId: params.data.skillId,
        }),
      method: "PATCH",
      responseSchema: setOrganizationSkillEnabledResponseSchema,
      route: SKILL_ENABLED_ROUTE,
    });
  });

  app.put(SKILL_MAINTAINERS_ROUTE, async (c) => {
    const params = parseParams(c, SKILL_MAINTAINERS_ROUTE, "PUT");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      SKILL_MAINTAINERS_ROUTE,
      "PUT",
      setOrganizationSkillMaintainersBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.setOrganizationSkillMaintainers({
          ...body.data,
          context: buildCoreRpcContext(c),
          skillId: params.data.skillId,
        }),
      method: "PUT",
      responseSchema: setOrganizationSkillMaintainersResponseSchema,
      route: SKILL_MAINTAINERS_ROUTE,
    });
  });

  app.delete(SKILL_ROUTE, async (c) => {
    const params = parseParams(c, SKILL_ROUTE, "DELETE");
    if (!params.ok) {
      return params.response;
    }
    const body = await parseBody(
      c,
      SKILL_ROUTE,
      "DELETE",
      deleteOrganizationSkillBodySchema
    );
    if (!body.ok) {
      return body.response;
    }
    return executeRpcRoute({
      c,
      execute: async () =>
        await c.var.coreRpc.deleteOrganizationSkill({
          ...body.data,
          context: buildCoreRpcContext(c),
          skillId: params.data.skillId,
        }),
      method: "DELETE",
      responseSchema: deleteOrganizationSkillResponseSchema,
      route: SKILL_ROUTE,
    });
  });
}

type ParseResult<T> = { data: T; ok: true } | { ok: false; response: Response };

async function parseBody<T>(
  c: Context<HonoBindings>,
  route: string,
  method: "DELETE" | "PATCH" | "POST" | "PUT",
  schema: z.ZodType<T>
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
  const parsed = schema.safeParse(body.value);
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
): ParseResult<{ skillId: string }> {
  const parsed = organizationSkillRouteParamsSchema.safeParse({
    skillId: c.req.param("skillId"),
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
    message: error.issues[0]?.message ?? "Invalid Organization Skill request.",
    method,
    route,
  });
}
