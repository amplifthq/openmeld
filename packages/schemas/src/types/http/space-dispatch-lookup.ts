import type { z } from "zod/v4";

type GetSpaceDispatchLookupInputSchema =
  typeof import("../../schemas/http/space-dispatch-lookup")["getSpaceDispatchLookupInputSchema"];
type SpaceDispatchLookupMatchSchema =
  typeof import("../../schemas/http/space-dispatch-lookup")["spaceDispatchLookupMatchSchema"];
type GetSpaceDispatchLookupResponseSchema =
  typeof import("../../schemas/http/space-dispatch-lookup")["getSpaceDispatchLookupResponseSchema"];

export type GetSpaceDispatchLookupInput =
  z.infer<GetSpaceDispatchLookupInputSchema>;
export type SpaceDispatchLookupMatch = z.infer<SpaceDispatchLookupMatchSchema>;
export type GetSpaceDispatchLookupResponse =
  z.infer<GetSpaceDispatchLookupResponseSchema>;
