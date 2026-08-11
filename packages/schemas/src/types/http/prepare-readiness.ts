import type { z } from "zod/v4";

type GetPrepareReadinessQuerySchema =
  typeof import("../../schemas/http/prepare-readiness")["getPrepareReadinessQuerySchema"];
type GetPrepareReadinessResponseSchema =
  typeof import("../../schemas/http/prepare-readiness")["getPrepareReadinessResponseSchema"];
type PrepareReadinessRouteParamsSchema =
  typeof import("../../schemas/http/prepare-readiness")["prepareReadinessRouteParamsSchema"];

export type GetPrepareReadinessQuery = z.infer<GetPrepareReadinessQuerySchema>;
export type GetPrepareReadinessResponse =
  z.infer<GetPrepareReadinessResponseSchema>;
export type PrepareReadinessRouteParams =
  z.infer<PrepareReadinessRouteParamsSchema>;
