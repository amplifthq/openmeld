import { getSpaceConversationStateResponseSchema } from "@openmeld/schemas";
import type { Hono } from "hono";
import type { HonoBindings } from "../lib/bindings";
import { buildGatewaySpaceAccessContext } from "../lib/space-access-context";
import {
  executePublicRpcRoute,
  formatAuditValue,
  respondPublicBadRequest,
} from "./rpc-http.helpers";
import { parseSpaceRouteParams } from "./rpc-http.parsers";

const SPACE_CONVERSATION_STATE_ROUTE = "/v1/spaces/:spaceId/conversation-state";

export function registerConversationStateRoute(app: Hono<HonoBindings>): void {
  app.get(SPACE_CONVERSATION_STATE_ROUTE, (c) => {
    const rawSpaceId = c.req.param("spaceId");
    const parsedSpace = parseSpaceRouteParams(rawSpaceId);
    if (!parsedSpace.ok) {
      return respondPublicBadRequest({
        c,
        route: SPACE_CONVERSATION_STATE_ROUTE,
        method: "GET",
        code: "invalid_space_id",
        message: parsedSpace.message,
        reason: `invalid_space_id_param spaceId=${formatAuditValue(rawSpaceId)}`,
      });
    }

    const spaceId = parsedSpace.value.spaceId;
    return executePublicRpcRoute({
      c,
      route: SPACE_CONVERSATION_STATE_ROUTE,
      method: "GET",
      execute: async () => {
        const result = await c.var.coreRpc.getSpaceConversationState({
          spaceId,
          spaceAccess: buildGatewaySpaceAccessContext(c, spaceId),
        });
        return {
          ...result,
          streams: agentStreamsForReplyPlacementReader(
            result.streams,
            c.req.header(AGENT_REPLY_PLACEMENT_HEADER) === "1"
          ),
        };
      },
      responseSchema: getSpaceConversationStateResponseSchema,
    });
  });
}

import {
  AGENT_REPLY_PLACEMENT_HEADER,
  agentStreamsForReplyPlacementReader,
} from "@openmeld/schemas";
