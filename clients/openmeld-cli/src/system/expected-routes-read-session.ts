import {
  createLocalRuntimeExpectedRoutesApi,
  OpenMeldApiClientHttpError,
} from "@openmeld/api-client";
import type { GetLocalRuntimeExpectedRoutesResponse } from "@openmeld/schemas/types";
import { resolveBaseUrl } from "../config/base-url";
import { readDaemonServiceContract } from "../config/daemon-service-contract";
import { createCliApiClientFoundation } from "../space/api-client-foundation";

// Contract: developing/architecture/agent-transport-contract.md ("Expected Routes Projection")
// One expected-routes read per logical operation, shared by the device
// projection and the route catalog. Consumption policy:
// - resolved                    -> consumers use the device-scoped projection,
//   including explicit runtime missing/conflict responses
// - legacy_endpoint_unavailable -> consumers use the transitional per-profile
//   fallback only when an older server explicitly returns 404
// - local identity / 5xx / network failures -> the read REJECTS so callers
//   preserve their current device-scoped state
// Like the binding read session, this is process-internal and
// operation-scoped by construction - never persist or reuse it.
export type ExpectedRoutesReadResult =
  | {
      contractVersion: "legacy" | "v2" | "v3" | "v4";
      response: GetLocalRuntimeExpectedRoutesResponse;
      status: "resolved";
    }
  | {
      status: "legacy_endpoint_unavailable";
    };

export type ExpectedRoutesReadSession = {
  read: () => Promise<ExpectedRoutesReadResult>;
};

export function createExpectedRoutesReadSession(input?: {
  baseUrl?: string;
}): ExpectedRoutesReadSession {
  let readPromise: Promise<ExpectedRoutesReadResult> | null = null;
  return {
    read: () => {
      readPromise ??= readExpectedRoutesOnce(input?.baseUrl);
      return readPromise;
    },
  };
}

async function readExpectedRoutesOnce(
  baseUrl?: string
): Promise<ExpectedRoutesReadResult> {
  const serviceContract = await readDaemonServiceContract();
  const deviceId = serviceContract?.deviceId?.trim() ?? "";
  const lane = serviceContract?.lane?.trim() ?? "";
  if (!(deviceId && lane)) {
    throw new Error(
      "OpenMeld Service contract is unavailable; expected routes cannot be scoped to this device"
    );
  }

  const api = createLocalRuntimeExpectedRoutesApi(
    createCliApiClientFoundation(baseUrl ?? (await resolveBaseUrl()))
  );
  try {
    const negotiated = await readNewestSupportedExpectedRoutes({
      api,
      deviceId,
      lane,
    });
    return {
      ...negotiated,
      status: "resolved",
    };
  } catch (error) {
    if (error instanceof OpenMeldApiClientHttpError && error.status === 404) {
      return {
        status: "legacy_endpoint_unavailable",
      };
    }
    throw error;
  }
}

async function readNewestSupportedExpectedRoutes(input: {
  api: ReturnType<typeof createLocalRuntimeExpectedRoutesApi>;
  deviceId: string;
  lane: string;
}): Promise<{
  contractVersion: "legacy" | "v2" | "v3" | "v4";
  response: GetLocalRuntimeExpectedRoutesResponse;
}> {
  for (const contractVersion of ["v4", "v3", "v2", undefined] as const) {
    try {
      const response = await input.api.getExpectedRoutes({
        ...(contractVersion ? { contractVersion } : {}),
        deviceId: input.deviceId,
        lane: input.lane,
      });
      if (contractVersion === "v4") {
        assertCompleteV4ExpectedRoutes(response);
      }
      return {
        contractVersion: contractVersion ?? "legacy",
        response,
      };
    } catch (error) {
      if (
        contractVersion === undefined ||
        !isUnsupportedExpectedRoutesContract(error)
      ) {
        throw error;
      }
    }
  }
  throw new Error("expected-routes contract negotiation exhausted");
}

function assertCompleteV4ExpectedRoutes(
  response: GetLocalRuntimeExpectedRoutesResponse
): void {
  for (const route of response.expectedRoutes) {
    if (
      route.configurationRevision === undefined ||
      !Object.hasOwn(route, "defaultProjectId")
    ) {
      throw new Error(
        `expected-routes v4 response omitted current working-folder identity for ${route.agentProfileId}`
      );
    }
  }
}

function isUnsupportedExpectedRoutesContract(error: unknown): boolean {
  return (
    error instanceof OpenMeldApiClientHttpError &&
    error.status === 400 &&
    (error.code === "invalid_payload" ||
      error.upstreamCode === "invalid_payload")
  );
}
