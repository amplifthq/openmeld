import {
  respondToSpaceAgentInteractionBodySchema,
  respondToSpaceAgentInteractionResponseSchema,
} from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import {
  buildCoreRpcContext,
  buildCoreRpcCredential,
  executeRpcRoute,
  readSpacePasswordHeader,
  respondBadRequest,
} from "./rpc-http.helpers";
import { readJsonRequestBody } from "./rpc-http.parsers";

const SPACE_AGENT_INTERACTION_RESPONSE_ROUTE =
  "/v1/spaces/:spaceId/agent-interactions/respond";

export function registerAgentInteractionRoutes(app: Hono<HonoBindings>): void {
  app.post(SPACE_AGENT_INTERACTION_RESPONSE_ROUTE, async (c) => {
    const spaceId = c.req.param("spaceId");
    const password = readSpacePasswordHeader(c.req.raw.headers);
    const bodyResult = await readJsonRequestBody(c.req.raw);
    if (!bodyResult.ok) {
      return respondBadRequest({
        c,
        route: SPACE_AGENT_INTERACTION_RESPONSE_ROUTE,
        method: "POST",
        code: "invalid_json",
        message: bodyResult.message,
        spaceId,
      });
    }

    const parsed = respondToSpaceAgentInteractionBodySchema.safeParse(
      bodyResult.value
    );
    if (!parsed.success) {
      return respondBadRequest({
        c,
        route: SPACE_AGENT_INTERACTION_RESPONSE_ROUTE,
        method: "POST",
        message:
          parsed.error.issues[0]?.message ??
          "agent interaction response is invalid",
        spaceId,
      });
    }

    return executeRpcRoute({
      c,
      route: SPACE_AGENT_INTERACTION_RESPONSE_ROUTE,
      method: "POST",
      spaceId,
      responseSchema: respondToSpaceAgentInteractionResponseSchema,
      execute: async () => {
        return await c.var.coreRpc.respondToSpaceAgentInteraction({
          requestCredential: await buildCoreRpcCredential(c),
          body: parsed.data,
          context: buildCoreRpcContext(c),
          ...(password === undefined ? {} : { password }),
          spaceId,
        });
      },
    });
  });
}
