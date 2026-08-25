import * as z from "zod/v4";
import {
  spaceAgentStreamPresenceSchema,
  spaceAgentStreamSnapshotSchema,
} from "../protocol/agent-stream";
import { optionalBooleanQuerySchema } from "../protocol/shared";
import { catchupResponseSchema } from "./catchup-response";
import { spaceMembersSnapshotSchema } from "./space-members";
import { getSpaceStatusResponseSchema } from "./space-status";
import { listSpaceThreadsResponseSchema } from "./space-threads";

export const spaceBootstrapResponseSchema = z.strictObject({
  activeAgentStreamPresences: z
    .array(spaceAgentStreamPresenceSchema)
    .optional(),
  activeAgentStreams: z.array(spaceAgentStreamSnapshotSchema).optional(),
  status: getSpaceStatusResponseSchema,
  members: spaceMembersSnapshotSchema,
  history: catchupResponseSchema,
  threads: listSpaceThreadsResponseSchema,
});

export const spaceBootstrapQuerySchema = z.strictObject({
  includeAgentStreamPresence: optionalBooleanQuerySchema,
});
