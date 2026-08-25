import * as z from "zod/v4";
import { spaceAgentStreamSnapshotSchema } from "../protocol/agent-stream";
import { spaceRouteParamsSchema } from "./space-route-params";

export const getSpaceConversationStateInputSchema = spaceRouteParamsSchema;

export const getSpaceConversationStateResponseSchema = z
  .strictObject({
    v: z.literal(1),
    spaceId: z.string().trim().min(1),
    streams: z.array(spaceAgentStreamSnapshotSchema),
  })
  .superRefine((response, context) => {
    for (const [index, stream] of response.streams.entries()) {
      if (stream.spaceId !== response.spaceId) {
        context.addIssue({
          code: "custom",
          message: "stream spaceId must match response spaceId",
          path: ["streams", index, "spaceId"],
        });
      }
    }
  });
