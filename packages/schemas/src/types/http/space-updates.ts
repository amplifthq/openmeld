import type { z } from "zod/v4";

type GetSpaceUpdatesInputSchema =
  typeof import("../../schemas/http/space-updates")["getSpaceUpdatesInputSchema"];
type GetSpaceUpdatesResponseSchema =
  typeof import("../../schemas/http/space-updates")["getSpaceUpdatesResponseSchema"];

export type GetSpaceUpdatesInput = z.infer<GetSpaceUpdatesInputSchema>;
export type GetSpaceUpdatesResponse = z.infer<GetSpaceUpdatesResponseSchema>;
