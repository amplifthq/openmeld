import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  analyzeServiceStatusPayload,
  parseAuthSessionState,
  parseServiceStatusPayload,
} from "./service-readiness-smoke.mjs";

describe("service readiness smoke helpers", () => {
  it("reads the agent-view auth session state from ndjson", () => {
    const state = parseAuthSessionState(
      [
        JSON.stringify({ code: "auth.status.start", payload: {} }),
        JSON.stringify({
          code: "auth.status.session",
          payload: { state: "valid" },
        }),
      ].join("\n")
    );

    assert.equal(state, "valid");
  });

  it("accepts the read-only service status payload used by the smoke", () => {
    const payload = parseServiceStatusPayload(
      `${JSON.stringify(createServiceStatusPayload())}\n`
    );
    const analysis = analyzeServiceStatusPayload(payload);

    assert.deepEqual(analysis.failures, []);
    assert.deepEqual(analysis.summary, {
      installed: true,
      routeReasonCode: "profile_not_selected",
      routeStatus: "unavailable",
      runtimeStatus: "running",
    });
  });

  it("can require an online daemon route when a profile-scoped smoke asks for it", () => {
    const analysis = analyzeServiceStatusPayload(createServiceStatusPayload(), {
      requireOnlineRoute: true,
    });

    assert.deepEqual(analysis.failures, [
      "daemon route observation is not online (status=unavailable)",
    ]);
  });
});

function createServiceStatusPayload() {
  return {
    type: "daemon.status",
    localResult: {
      installed: true,
      statusScope: "local_service",
      environmentTarget: { preset: "prod" },
      runtime: { status: "running" },
    },
    result: {
      daemonRouteObservation: {
        reasonCode: "profile_not_selected",
        route: null,
        status: "unavailable",
      },
      diagnostics: {
        localServiceDiagnostics: {
          authoritative: false,
          source: "local_service_diagnostics",
        },
      },
    },
    runtimeProjection: null,
  };
}
