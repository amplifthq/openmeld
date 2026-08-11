import type { z } from "zod/v4";

type CreateSpaceResponseSchema =
  typeof import("../../schemas/http/space-create-response")["createSpaceResponseSchema"];

export type CreateSpaceResponse = z.infer<CreateSpaceResponseSchema>;
