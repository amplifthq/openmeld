import { organizationSkillResourceMetadataSchema } from "@openmeld/schemas";
import type { Context, Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { prepareHumanRequest } from "../organization-skills/organization-skill-rpc";
import { mapRpcHttpError } from "./rpc-http-error";

const RESOURCE_ROUTE =
  "/v1/organizations/current/skills/:skillId/releases/:releaseId/resources";

export function registerOrganizationSkillResourceRoutes(
  app: Hono<HonoBindings>
): void {
  app.get(RESOURCE_ROUTE, (c) => readResource(c));
}

async function readResource(
  c: Context<HonoBindings, typeof RESOURCE_ROUTE>
): Promise<Response> {
  const path = organizationSkillResourceMetadataSchema.shape.path.safeParse(
    c.req.query("path")
  );
  if (!path.success) {
    return c.json(
      {
        error: {
          code: "organization_skill.invalid_bundle",
          message: "Choose a valid Skill resource.",
        },
      },
      400
    );
  }
  try {
    const { actor, service } = await prepareHumanRequest(
      c.env,
      c.var.openMeldRequestContext
    );
    const resource = await service.getResourceContent(
      actor,
      c.req.param("skillId"),
      c.req.param("releaseId"),
      path.data
    );
    const body = new ArrayBuffer(resource.bytes.byteLength);
    new Uint8Array(body).set(resource.bytes);
    return new Response(body, {
      headers: {
        "cache-control": "private, no-store",
        "content-length": String(resource.bytes.byteLength),
        "content-type": "application/octet-stream",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return mapRpcHttpError(c, error);
  }
}
