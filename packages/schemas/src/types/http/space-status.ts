import type { z } from "zod/v4";

type GetSpaceStatusInputSchema =
  typeof import("../../schemas/http/space-status")["getSpaceStatusInputSchema"];
type GetSpaceStatusResponseSchema =
  typeof import("../../schemas/http/space-status")["getSpaceStatusResponseSchema"];
type SpaceStatusLatestVisibleUpdateSchema =
  typeof import("../../schemas/http/space-status")["spaceStatusLatestVisibleUpdateSchema"];
type SpaceStatusMembersSummarySchema =
  typeof import("../../schemas/http/space-status")["spaceStatusMembersSummarySchema"];

export type GetSpaceStatusInput = z.infer<GetSpaceStatusInputSchema>;
export type GetSpaceStatusResponse = z.infer<GetSpaceStatusResponseSchema>;
export type SpaceStatusLatestVisibleUpdate =
  z.infer<SpaceStatusLatestVisibleUpdateSchema>;
export type SpaceStatusMembersSummary =
  z.infer<SpaceStatusMembersSummarySchema>;
