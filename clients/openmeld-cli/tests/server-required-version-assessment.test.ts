import type { CurrentLocalRuntimeReplyReadinessResponse } from "@openmeld/schemas/types";
import { afterEach, describe, expect, it, vi } from "vitest";

const { readCurrentLocalRuntimeReplyReadinessMock } = vi.hoisted(() => ({
  readCurrentLocalRuntimeReplyReadinessMock: vi.fn(),
}));

vi.mock("../src/system/current-local-runtime-reply-readiness", async () => {
  const actual = await vi.importActual<
    typeof import("../src/system/current-local-runtime-reply-readiness")
  >("../src/system/current-local-runtime-reply-readiness");
  return {
    ...actual,
    readCurrentLocalRuntimeReplyReadiness: (
      ...args: Parameters<typeof readCurrentLocalRuntimeReplyReadinessMock>
    ) => readCurrentLocalRuntimeReplyReadinessMock(...args),
  };
});

import {
  assessServerRequiredVersion,
  describeServerRequiredVersionUnavailableReason,
} from "../src/command-entry-checks/server-required-version-assessment";
import { setAuthSession } from "../src/config/auth-session";
import { withTempHome } from "./helpers/fs";

const GATEWAY_URL = "https://gateway.openmeld.invalid";

// Field names/enums here are lifted straight from
// `services/core/src/local-components/update-projection.ts` and
// `@openmeld/schemas` (`localComponentUpdateProjectionSchema` and friends) —
// never hand-invented — so this fixture is a faithful stand-in for what
// `getCurrentLocalRuntimeReplyReadiness` actually returns.
function buildReplyReadinessResponse(
  overrides: Partial<CurrentLocalRuntimeReplyReadinessResponse> = {}
): CurrentLocalRuntimeReplyReadinessResponse {
  return {
    canReplyFromThisComputer: true,
    currentTarget: {
      availability: "resolved",
      deviceId: "11111111-1111-4111-8111-111111111111",
      runtimeLane: "prod",
    },
    generatedAt: "2026-07-10T12:00:00.000Z",
    localComponents: {
      agentSetupCommand:
        "npm install -g openmeld@latest && openmeld setup --view agent",
      cli: {
        commandContractVersion:
          "openmeld-cli-command-contract-2026-05-local-components-v1",
        installedPackageVersion: "0.2.21",
        latestPackageVersion: "0.2.21",
        reasonCodes: [],
        requiredCommandContractVersion: null,
        status: "current",
        updatePolicy: "required",
        wakeBlocked: false,
      },
      generatedAt: "2026-07-10T12:00:00.000Z",
      humanSetupCommand: "npm install -g openmeld@latest && openmeld setup",
      schemaVersion: 1,
      service: {
        installedVersion: "0.2.21",
        latestVersion: "0.2.21",
        reasonCodes: [],
        requiredVersion: null,
        status: "current",
        updatePolicy: "required",
        wakeBlocked: false,
      },
      setupAction: "none",
      setupActionDescription:
        "OpenMeld local components are aligned for this computer.",
      setupActionLabel: "Everything is up to date",
      skills: {
        expectedBundleHash: "abc123",
        expectedTargetCount: 1,
        installedBundleHash: "abc123",
        reasonCodes: [],
        skillContractVersion: "openmeld-skills-contract-2026-05-required-v1",
        status: "current",
        targetCount: 1,
        updatePolicy: "required",
        wakeBlocked: false,
      },
    },
    message: "This computer can currently receive local Wake work.",
    nextAction: "none",
    primaryBlocker: "none",
    runtime: {
      deviceDisplayName: "Test Device",
      deviceId: "11111111-1111-4111-8111-111111111111",
      executionTargetStatus: "ready",
      lastObservedAtMs: Date.parse("2026-07-10T12:00:00.000Z"),
      reasonCodes: [],
      signInOnlyBlockers: false,
      runtimeLane: "prod",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "rt-1",
      },
    },
    service: {
      connected: true,
      executionCompatibility: null,
      matchingCurrentRuntime: true,
      reasonCodes: [],
      sessionDeviceId: "11111111-1111-4111-8111-111111111111",
      sessionLane: "prod",
    },
    status: "ready",
    ...overrides,
  };
}

async function signIn(): Promise<void> {
  process.env.OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN = "1";
  await setAuthSession({
    accessToken: "token-1",
    authBaseUrl: "https://auth.openmeld.invalid",
    clientId: "openmeld-cli",
    tokenType: "Bearer",
    user: {
      email: "mira@openmeld.invalid",
      id: "user-mira",
      name: "Mira",
    },
  });
}

describe("assessServerRequiredVersion", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    readCurrentLocalRuntimeReplyReadinessMock.mockReset();
    Reflect.deleteProperty(
      process.env,
      "OPENMELD_AUTH_FORCE_INSECURE_FILE_TOKEN"
    );
  });

  it("skips the network call entirely when there is no signed-in session", async () => {
    await withTempHome(async () => {
      const assessment = await assessServerRequiredVersion({
        gatewayUrl: GATEWAY_URL,
      });

      expect(assessment).toEqual({
        available: false,
        detail: null,
        reason: "signed_out",
      });
      expect(readCurrentLocalRuntimeReplyReadinessMock).not.toHaveBeenCalled();
    });
  });

  it("returns the server projection verbatim when signed in and reachable", async () => {
    await withTempHome(async () => {
      await signIn();
      const response = buildReplyReadinessResponse({
        localComponents: {
          ...buildReplyReadinessResponse().localComponents,
          cli: {
            commandContractVersion:
              "openmeld-cli-command-contract-2026-05-local-components-v1",
            installedPackageVersion: "0.2.20",
            latestPackageVersion: "0.2.21",
            reasonCodes: ["cli.package_update_available"],
            requiredCommandContractVersion:
              "openmeld-cli-command-contract-2026-05-local-components-v1",
            status: "update_required",
            updatePolicy: "required",
            wakeBlocked: false,
          },
          service: {
            installedVersion: "0.2.20",
            latestVersion: "0.2.21",
            reasonCodes: ["service.version_outdated"],
            requiredVersion: "0.2.21",
            status: "update_required",
            updatePolicy: "required",
            wakeBlocked: true,
          },
        },
      });
      readCurrentLocalRuntimeReplyReadinessMock.mockResolvedValueOnce(response);

      const assessment = await assessServerRequiredVersion({
        gatewayUrl: GATEWAY_URL,
      });

      expect(readCurrentLocalRuntimeReplyReadinessMock).toHaveBeenCalledWith({
        gatewayUrl: GATEWAY_URL,
      });
      expect(assessment).toEqual({
        available: true,
        cli: response.localComponents.cli,
        generatedAt: response.generatedAt,
        service: response.localComponents.service,
      });
    });
  });

  it("degrades to signed_out when the gateway rejects the request as unauthenticated", async () => {
    await withTempHome(async () => {
      await signIn();
      readCurrentLocalRuntimeReplyReadinessMock.mockRejectedValueOnce(
        Object.assign(new Error("Unauthorized"), { status: 401 })
      );

      const assessment = await assessServerRequiredVersion({
        gatewayUrl: GATEWAY_URL,
      });

      expect(assessment.available).toBe(false);
      if (assessment.available) {
        throw new Error("expected unavailable assessment");
      }
      expect(assessment.reason).toBe("signed_out");
    });
  });

  it("degrades to offline on a network/timeout failure without throwing", async () => {
    await withTempHome(async () => {
      await signIn();
      readCurrentLocalRuntimeReplyReadinessMock.mockRejectedValueOnce(
        Object.assign(new Error("request timed out after 10000ms"), {
          code: "network.timeout",
        })
      );

      const assessment = await assessServerRequiredVersion({
        gatewayUrl: GATEWAY_URL,
      });

      expect(assessment).toMatchObject({
        available: false,
        reason: "offline",
      });
      if (!assessment.available) {
        expect(
          describeServerRequiredVersionUnavailableReason(assessment)
        ).toContain("timed out");
      }
    });
  });

  it("degrades to request_failed on an unrecognized gateway error", async () => {
    await withTempHome(async () => {
      await signIn();
      readCurrentLocalRuntimeReplyReadinessMock.mockRejectedValueOnce(
        Object.assign(new Error("Gateway request failed with HTTP 503."), {
          status: 503,
        })
      );

      const assessment = await assessServerRequiredVersion({
        gatewayUrl: GATEWAY_URL,
      });

      expect(assessment).toMatchObject({
        available: false,
        reason: "request_failed",
      });
    });
  });
});
