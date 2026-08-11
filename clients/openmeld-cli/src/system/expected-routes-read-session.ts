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
    const response = await readNewestSupportedExpectedRoutes({
      api,
      deviceId,
      lane,
    });
    return {
      response,
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
}): Promise<GetLocalRuntimeExpectedRoutesResponse> {
  for (const contractVersion of ["v3", "v2", undefined] as const) {
    try {
      return await input.api.getExpectedRoutes({
        ...(contractVersion ? { contractVersion } : {}),
        deviceId: input.deviceId,
        lane: input.lane,
      });
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

function isUnsupportedExpectedRoutesContract(error: unknown): boolean {
  return (
    error instanceof OpenMeldApiClientHttpError &&
    error.status === 400 &&
    (error.code === "invalid_payload" ||
      error.upstreamCode === "invalid_payload")
  );
}
