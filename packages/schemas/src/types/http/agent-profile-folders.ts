import type { z } from "zod/v4";

type Schemas = typeof import("../../schemas/http/agent-profile-folders");
export type GetAgentProfileFoldersResponse = z.infer<
  Schemas["getAgentProfileFoldersResponseSchema"]
>;
