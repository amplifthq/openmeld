import type { z } from "zod/v4";

type GetLocalRuntimeExpectedRoutesQuerySchema =
  typeof import("../../schemas/http/local-runtime-expected-routes")["getLocalRuntimeExpectedRoutesQuerySchema"];
type GetLocalRuntimeExpectedRoutesResponseSchema =
  typeof import("../../schemas/http/local-runtime-expected-routes")["getLocalRuntimeExpectedRoutesResponseSchema"];
type LocalRuntimeExpectedRouteSchema =
  typeof import("../../schemas/http/local-runtime-expected-routes")["localRuntimeExpectedRouteSchema"];
type LocalRuntimeExpectedRouteExclusionSchema =
  typeof import("../../schemas/http/local-runtime-expected-routes")["localRuntimeExpectedRouteExclusionSchema"];

export type GetLocalRuntimeExpectedRoutesQuery =
  z.infer<GetLocalRuntimeExpectedRoutesQuerySchema>;
export type GetLocalRuntimeExpectedRoutesResponse =
  z.infer<GetLocalRuntimeExpectedRoutesResponseSchema>;
export type LocalRuntimeExpectedRoute =
  z.infer<LocalRuntimeExpectedRouteSchema>;
export type LocalRuntimeExpectedRouteExclusion =
  z.infer<LocalRuntimeExpectedRouteExclusionSchema>;
