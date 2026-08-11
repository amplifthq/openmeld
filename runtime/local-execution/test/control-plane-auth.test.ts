import { describe, expect, it } from "vitest";
import {
  buildAuthenticatedControlPlaneResponse,
  verifyControlPlaneToken,
} from "../src/control-plane-auth";

const BASE_CONTEXT = {
  statusPayload: {
    installed: true,
    running: true,
    daemonVersion: "0.1.2",
    runtimeRoot: "/tmp/.openmeld/runtime/daemon",
    checkedAt: "2026-02-25T12:00:00.000Z",
  },
  healthPayload: {
    state: "ok" as const,
    runtimeState: "healthy" as const,
    reasonCode: "ok",
    checkedAt: "2026-02-25T12:00:00.000Z",
  },
  historyEntries: [],
};

describe("local execution control-plane auth", () => {
  it("verifies token equality", () => {
    expect(
      verifyControlPlaneToken({
        expectedToken: "token-1",
        providedToken: "token-1",
      })
    ).toBe(true);
    expect(
      verifyControlPlaneToken({
        expectedToken: "token-1",
        providedToken: "token-2",
      })
    ).toBe(false);
  });

  it("builds response when request auth token is valid", async () => {
    const response = await buildAuthenticatedControlPlaneResponse({
      context: BASE_CONTEXT,
      expectedToken: "token-1",
      request: {
        v: 1,
        command: "status",
        authToken: "token-1",
      },
    });
    expect(response.code).toBe("service.status");
  });

  it("throws unauthenticated when auth token is missing", async () => {
    await expect(
      buildAuthenticatedControlPlaneResponse({
        context: BASE_CONTEXT,
        expectedToken: "token-1",
        request: {
          v: 1,
          command: "status",
        },
      })
    ).rejects.toThrowError("auth.unauthenticated");
  });
});
