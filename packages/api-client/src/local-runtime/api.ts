import {
  getLocalRuntimeExpectedRoutesQuerySchema,
  getLocalRuntimeExpectedRoutesResponseSchema,
} from "@openmeld/schemas";
import type {
  GetLocalRuntimeExpectedRoutesResponse,
  OpenMeldRequestContext,
} from "@openmeld/schemas/types";
import type { OpenMeldApiClientFoundation } from "../client";

// Contract: developing/architecture/agent-transport-contract.md ("Expected Routes Projection")
export type GetLocalRuntimeExpectedRoutesInput = {
  contractVersion?: "v2" | "v3";
  deviceId: string;
  lane: string;
  requestContext?: OpenMeldRequestContext;
};

export type LocalRuntimeExpectedRoutesApi = {
  getExpectedRoutes: (
    input: GetLocalRuntimeExpectedRoutesInput
  ) => Promise<GetLocalRuntimeExpectedRoutesResponse>;
};

const LOCAL_RUNTIME_EXPECTED_ROUTES_PATH = "/v1/local-runtime/expected-routes";

function buildExpectedRoutesUrl(
  input: GetLocalRuntimeExpectedRoutesInput
): string {
  const parsed = getLocalRuntimeExpectedRoutesQuerySchema.safeParse({
    contractVersion: input.contractVersion,
    deviceId: input.deviceId,
    lane: input.lane,
  });
  if (!parsed.success) {
    throw new Error(
      parsed.error.issues[0]?.message ??
        "Invalid local runtime expected-routes query."
    );
  }
  const searchParams = new URLSearchParams();
  if (parsed.data.contractVersion) {
    searchParams.set("contractVersion", parsed.data.contractVersion);
  }
  searchParams.set("deviceId", parsed.data.deviceId);
  searchParams.set("lane", parsed.data.lane);
  return `${LOCAL_RUNTIME_EXPECTED_ROUTES_PATH}?${searchParams.toString()}`;
}

export function createLocalRuntimeExpectedRoutesApi(
  client: OpenMeldApiClientFoundation
): LocalRuntimeExpectedRoutesApi {
  return {
    getExpectedRoutes: async (input) =>
      await client.requestJson({
        invalidMessage: "Invalid local runtime expected-routes response.",
        method: "GET",
        operation: "local_runtime.expected_routes.read",
        requestContext: input.requestContext,
        schema: getLocalRuntimeExpectedRoutesResponseSchema,
        url: buildExpectedRoutesUrl(input),
      }),
  };
}
