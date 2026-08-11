import { describe, expect, it } from "vitest";
import {
  clearDaemonStartFailureState,
  readDaemonStartFailureState,
  writeDaemonStartFailureState,
} from "../src/local-service/state/daemon-start-failure-state";
import { withTempHome } from "./helpers/fs";

describe("local service start failure state", () => {
  it("writes and reads dependency failure state", async () => {
    await withTempHome(async () => {
      await writeDaemonStartFailureState({
        recordedAt: "2026-03-16T00:00:00.000Z",
        reason: "service_dependencies_unavailable",
        detail:
          "OpenMeld auth and gateway are unavailable at `https://auth.openmeld.invalid` and `https://gateway.openmeld.invalid`.",
        rawLogLine: "error: fetch failed",
        dependencyIssues: [
          {
            kind: "auth",
            baseUrl: "https://auth.openmeld.invalid",
            probeUrl: "https://auth.openmeld.invalid/health",
            scope: "remote",
            status: "unreachable",
            httpStatus: null,
          },
        ],
      });

      await expect(readDaemonStartFailureState()).resolves.toEqual({
        schema: "daemon.start.failure.state",
        v: 1,
        recordedAt: "2026-03-16T00:00:00.000Z",
        reason: "service_dependencies_unavailable",
        detail:
          "OpenMeld auth and gateway are unavailable at `https://auth.openmeld.invalid` and `https://gateway.openmeld.invalid`.",
        rawLogLine: "error: fetch failed",
        dependencyIssues: [
          {
            kind: "auth",
            baseUrl: "https://auth.openmeld.invalid",
            probeUrl: "https://auth.openmeld.invalid/health",
            scope: "remote",
            status: "unreachable",
            httpStatus: null,
          },
        ],
        lane: "prod",
      });
    });
  });

  it("clears previously recorded state", async () => {
    await withTempHome(async () => {
      await writeDaemonStartFailureState({
        reason: "startup_failed",
        detail: "OpenMeld could not finish starting OpenMeld Service.",
      });

      await clearDaemonStartFailureState();

      await expect(readDaemonStartFailureState()).resolves.toBeNull();
    });
  });
});
