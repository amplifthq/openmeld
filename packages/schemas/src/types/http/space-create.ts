import type { z } from "zod/v4";

type CreateSpaceBodySchema =
  typeof import("../../schemas/http/space-create")["createSpaceBodySchema"];

export type CreateSpaceBody = z.infer<CreateSpaceBodySchema>;
