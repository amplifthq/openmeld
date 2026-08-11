import type {
  GetPrepareReadinessQuery,
  GetPrepareReadinessResponse,
  PrepareReadinessRouteParams,
} from "@openmeld/schemas/types";

export type GetPrepareReadinessInput = PrepareReadinessRouteParams &
  GetPrepareReadinessQuery & {
    requestContext?: import("@openmeld/schemas/types").OpenMeldRequestContext;
  };

export type CreatePrepareReadinessApi = (
  client: import("../client").OpenMeldApiClientFoundation
) => {
  getReadiness: (
    input: GetPrepareReadinessInput
  ) => Promise<GetPrepareReadinessResponse>;
};
