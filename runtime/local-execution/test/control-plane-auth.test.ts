import { describe, expect, it, vi } from "vitest";
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
  it.each([
    true,
    false,
    undefined,
  ])("queries explicit carrier support without shutdown: %s", async (supported) => {
    const shutdownHandler = vi.fn();
    const context = {
      ...BASE_CONTEXT,
      accountCheckedServiceControl: supported,
      shutdownHandler,
    };
    const request = {
      v: 1,
      command: "account_control_capabilities",
      authToken: "token-1",
    };
    const response = await buildAuthenticatedControlPlaneResponse({
      context,
      expectedToken: "token-1",
      request,
    });
    expect(response).toEqual({
      v: 1,
      code: "service.account_control_capabilities",
      payload: { supported: supported === true },
    });
    await expect(
      buildAuthenticatedControlPlaneResponse({
        context,
        expectedToken: "other",
        request,
      })
    ).rejects.toThrow("auth.unauthenticated");
    expect(shutdownHandler).not.toHaveBeenCalled();
  });
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
