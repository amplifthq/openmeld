import type { z } from "zod/v4";

type GetSpaceDispatchResultInputSchema =
  typeof import("../../schemas/http/space-result")["getSpaceDispatchResultInputSchema"];
type GetSpaceDispatchResultResponseSchema =
  typeof import("../../schemas/http/space-result")["getSpaceDispatchResultResponseSchema"];

export type GetSpaceDispatchResultInput =
  z.infer<GetSpaceDispatchResultInputSchema>;
export type GetSpaceDispatchResultResponse =
  z.infer<GetSpaceDispatchResultResponseSchema>;
