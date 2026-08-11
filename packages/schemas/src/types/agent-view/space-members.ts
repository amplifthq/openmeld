import type { z } from "zod/v4";

type SpaceMembersEventSchema =
  typeof import("../../schemas/agent-view/space-members")["spaceMembersEventSchema"];

export type SpaceMembersEvent = z.infer<SpaceMembersEventSchema>;
