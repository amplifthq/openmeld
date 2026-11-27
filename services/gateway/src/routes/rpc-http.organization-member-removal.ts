import {
  organizationMemberRemovalPlanSchema,
  organizationMemberRemovalPrepareBodySchema,
  organizationMemberRemovalPrepareResponseSchema,
  organizationMemberRemovalPreviewBodySchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  parseRpcHttpError,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const PREVIEW_ROUTE = "/v1/organizations/current/member-removal/preview";
const PREPARE_ROUTE = "/v1/organizations/current/member-removal/prepare";

export function registerOrganizationMemberRemovalRoutes(
  app: Hono<HonoBindings>
): void {
  app.post(PREVIEW_ROUTE, async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        route: PREVIEW_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: body.message,
      });
    }
    const parsed = organizationMemberRemovalPreviewBodySchema.safeParse(
      body.value
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: PREVIEW_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Choose a valid organization member to remove.",
      });
    }
    return executeRpcRoute({
      c,
      route: PREVIEW_ROUTE,
      method: "POST",
      responseSchema: organizationMemberRemovalPlanSchema,
      execute: async () => {
        const input = { ...parsed.data, context: buildCoreRpcContext(c) };
        if (c.req.query("includeDefaultSuccessor") === "1") {
          try {
            return await c.var.coreRpc.previewOrganizationMemberRemoval({
              ...input,
              includeDefaultSuccessor: true,
            });
          } catch (error) {
            const failure = parseRpcHttpError(error);
            // Old Core deployments reject the additional field before
            // authorization. Retry only this read-only operation: the old
            // request shape still goes through the same server-side checks.
            if (
              failure?.status !== 400 ||
              failure.message !== "Invalid member removal request."
            ) {
              throw error;
            }
          }
        }
        return await c.var.coreRpc.previewOrganizationMemberRemoval(input);
      },
    });
  });

  app.post(PREPARE_ROUTE, async (c) => {
    const body = await readJsonRequestBody(c.req.raw);
    if (!body.ok) {
      return respondBadRequest({
        c,
        route: PREPARE_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: body.message,
      });
    }
    const parsed = organizationMemberRemovalPrepareBodySchema.safeParse(
      body.value
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: PREPARE_ROUTE,
        method: "POST",
        code: "invalid_payload",
        message: "Review the member's Space ownership before removing them.",
      });
    }
    return executeRpcRoute({
      c,
      route: PREPARE_ROUTE,
      method: "POST",
      retryMode: "none",
      responseSchema: organizationMemberRemovalPrepareResponseSchema,
      execute: async () =>
        c.var.coreRpc.prepareOrganizationMemberRemoval({
          ...parsed.data,
          context: buildCoreRpcContext(c),
          requestCredential: await buildCoreRpcCredential(c),
        }),
    });
  });
}
