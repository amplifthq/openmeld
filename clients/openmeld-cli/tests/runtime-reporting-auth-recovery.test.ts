import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeReportingAttemptObserver } from "../src/local-service/reporting/runtime-reporting-attempt-observer";
import { createRuntimeReportingAuthenticationRecovery } from "../src/local-service/reporting/runtime-reporting-auth-recovery";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Runtime reporting authentication recovery", () => {
  it("requests one carrier handshake per five-minute recovery window", async () => {
    let nowMs = Date.parse("2026-07-10T08:00:00.000Z");
    const requestCarrierHandshake = vi.fn(async () => undefined);
    const recover = createRuntimeReportingAuthenticationRecovery({
      now: () => nowMs,
      requestCarrierHandshake,
    });
    const failure = {
      message: "authentication required",
      reasonCode: "runtime.reporting.authentication_required",
    };

    await expect(recover(failure)).resolves.toEqual({ status: "requested" });

    nowMs += 5 * 60_000 - 1;
    await expect(recover(failure)).resolves.toMatchObject({
      status: "debounced",
      retryAfterMs: 1,
    });

    nowMs += 1;
    await expect(recover(failure)).resolves.toEqual({ status: "requested" });
    expect(requestCarrierHandshake).toHaveBeenCalledTimes(2);
    expect(requestCarrierHandshake).toHaveBeenCalledWith(failure);
  });

  it("requests authentication recovery for a locally detected carrier handshake requirement", async () => {
    const openMeldHome = await mkdtemp(
      join(tmpdir(), "openmeld-reporting-auth-recovery-")
    );
    vi.stubEnv("OPENMELD_HOME", openMeldHome);
    const onAuthenticationFailure = vi.fn(async () => undefined);
    const observe = createRuntimeReportingAttemptObserver({
      onAuthenticationFailure,
      serviceIdentity: { contractGeneration: 1, deviceId: "device-test" },
    });

    try {
      await observe({
        authenticationRejected: false,
        family: "runtime_agent_controller",
        message: "Local authentication is expired.",
        reasonCode: "runtime.reporting.auth_expired",
        requiresCarrierHandshake: true,
        status: "failed",
      });
      await observe({
        authenticationRejected: false,
        family: "runtime_agent_controller",
        message: "The reporting Gateway does not match local authentication.",
        reasonCode: "runtime.reporting.auth_gateway_mismatch",
        requiresCarrierHandshake: false,
        status: "failed",
      });

      expect(onAuthenticationFailure).toHaveBeenCalledOnce();
      expect(onAuthenticationFailure).toHaveBeenCalledWith({
        message: "Local authentication is expired.",
        reasonCode: "runtime.reporting.auth_expired",
      });
    } finally {
      await rm(openMeldHome, { force: true, recursive: true });
    }
  });
});
