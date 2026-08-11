import type { z } from "zod/v4";

type DeleteSpaceResponseSchema =
  typeof import("../../schemas/http/space-delete")["deleteSpaceResponseSchema"];

export type DeleteSpaceResponse = z.infer<DeleteSpaceResponseSchema>;
