import {
  resolveProjectionReconcileDecision,
  resolveRouteRegistrationReconcileDecision,
} from "@openmeld/local-service";
import { describe, expect, it } from "vitest";

describe("local service reconcile decision", () => {
  it("keeps projection drift on the runtime-state-sync owner", () => {
    const decision = resolveProjectionReconcileDecision({
      result: {
        status: "degraded",
        mode: "check",
        projectedControllerIds: ["codex"],
        missingControllerIds: ["codex"],
        disabledControllerIds: [],
        repairedControllerIds: [],
        reason: "local projection is missing for one or more bound controllers",
      },
    });

    expect(decision).toMatchObject({
      action: "repair_projection",
      driftClass: "projection",
      driftDetected: true,
      owner: "device-runtime-state-sync",
      skipReason: "read_only_surface",
    });
  });

  it("keeps route registration drift on the service-runner owner", () => {
    const decision = resolveRouteRegistrationReconcileDecision({
      driftDetected: true,
      foregroundActive: true,
    });

    expect(decision).toMatchObject({
      action: "reconnect_route_registration",
      driftClass: "route_registration",
      driftDetected: true,
      foregroundActive: true,
      owner: "service-runner",
      skipReason: null,
    });
  });
});
