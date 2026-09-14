import { describe, expect, it } from "vitest";
import { resolveServiceConnectionReconnectBackoffMs } from "../src/local-service/state/daemon-runtime-state";
import {
  classifyConnectionFailureReason,
  toHealthProjection,
} from "../src/local-service/state/service-connection-state";

describe("classifyConnectionFailureReason", () => {
  it("does not treat arbitrary authentication wording as a rejected credential", () => {
    expect(
      classifyConnectionFailureReason(
        "authentication required while credential storage is unavailable"
      )
    ).toBe("internal");
    expect(
      classifyConnectionFailureReason(
        "network error: unauthorized intermediary"
      )
    ).toBe("network_unreachable");
  });
  it("keeps daemon stream 5xx upgrade rejection classified as internal", () => {
    expect(
      classifyConnectionFailureReason(
        'daemon stream upgrade rejected (status=502, requestId="req_123", bodyExcerpt="core daemon stream upgrade timeout after 15000ms")'
      )
    ).toBe("internal");
  });

  it("keeps daemon stream 401 upgrade rejection classified as auth rejected", () => {
    expect(
      classifyConnectionFailureReason(
        'daemon stream upgrade rejected (status=401, requestId="req_123", bodyExcerpt="authentication required")'
      )
    ).toBe("auth_rejected");
  });

  it("does not classify daemon stream 5xx as auth just because request metadata contains 401", () => {
    expect(
      classifyConnectionFailureReason(
        'daemon stream upgrade rejected (status=500, requestId="req_401", bodyExcerpt="internal error")'
      )
    ).toBe("internal");
  });

  it("projects authentication_required as an explicit degraded health state", () => {
    expect(
      toHealthProjection({
        authState: "expired",
        detail: "connecting without credentials, session=expired",
        reason: "auth_rejected",
        state: "authentication_required",
        updatedAt: "2026-07-02T00:00:00.000Z",
      })
    ).toEqual({
      reasonCode: "authentication_required",
      runtimeState: "suspect",
      state: "degraded",
    });
  });

  it("backs off auth failures by minutes instead of the ordinary 10s cap", () => {
    expect(
      resolveServiceConnectionReconnectBackoffMs({
        attempt: 1,
        reason: "auth_rejected",
      })
    ).toBe(60_000);
    expect(
      resolveServiceConnectionReconnectBackoffMs({
        attempt: 2,
        reason: "auth_rejected",
      })
    ).toBe(5 * 60_000);
    expect(
      resolveServiceConnectionReconnectBackoffMs({
        attempt: 3,
        reason: "auth_rejected",
      })
    ).toBe(15 * 60_000);
    expect(
      resolveServiceConnectionReconnectBackoffMs({
        attempt: 4,
        reason: "auth_rejected",
      })
    ).toBe(15 * 60_000);
    expect(
      resolveServiceConnectionReconnectBackoffMs({
        attempt: 5,
        reason: "network_unreachable",
      })
    ).toBe(10_000);
  });
});
