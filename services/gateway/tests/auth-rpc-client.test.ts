import { OPENMELD_HEADER_SPACE_PASSWORD } from "@openmeld/gateway-contract";
import { describe, expect, it, vi } from "vitest";
import {
  type GatewayAuthRpcWorker,
  resolveProfile,
  resolveRequestAuth,
} from "../src/lib/auth-rpc-client";

describe("auth rpc client", () => {
  it("forwards resolveRequestAuth with request headers", async () => {
    const resolveRequestAuthMock = vi.fn(async () => ({
      ok: true,
      claims: {
        authenticated: true,
        requestId: "req-1",
        profileId: "profile-1",
        profileKind: "human",
        ownerIds: [],
        authMethod: "session",
      },
    }));
    const authRpc = {
      resolveRequestAuth: resolveRequestAuthMock,
    } as unknown as GatewayAuthRpcWorker;
    const headers = new Headers({
      authorization: "Bearer token",
      "x-openmeld-request-id": "req-1",
      [OPENMELD_HEADER_SPACE_PASSWORD]: "secret-1",
    });

    const result = await resolveRequestAuth({
      authRpc,
      headers,
      requestId: "req-1",
      requestedOrganization: {
        organizationSlug: "amplift",
      },
    });

    expect(result.ok).toBe(true);
    expect(resolveRequestAuthMock).toHaveBeenCalledWith({
      headers: {
        authorization: "Bearer token",
        "x-openmeld-request-id": "req-1",
      },
      requestId: "req-1",
      requestedOrganization: {
        organizationSlug: "amplift",
      },
    });
  });

  it("rejects malformed Auth claims at the Gateway boundary", async () => {
    const authRpc = {
      resolveRequestAuth: vi.fn(async () => ({
        ok: true,
        claims: {
          authenticated: true,
          requestId: "req-invalid",
        },
      })),
    } as unknown as GatewayAuthRpcWorker;

    await expect(
      resolveRequestAuth({
        authRpc,
        headers: new Headers(),
        requestId: "req-invalid",
      })
    ).rejects.toThrow();
  });

  it("forwards resolveProfile with optional selector fields", async () => {
    const openMeldProfileId = "11111111-1111-4111-8111-111111111111";
    const resolveProfileMock = vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId,
        profileHandle: "felix",
        profileName: "Felix",
        profileKind: "human",
        ownerUserId: "owner-1",
      },
    }));
    const authRpc = {
      resolveProfile: resolveProfileMock,
    } as unknown as GatewayAuthRpcWorker;
    const headers = new Headers({
      authorization: "Bearer token",
      [OPENMELD_HEADER_SPACE_PASSWORD]: "secret-2",
    });

    const result = await resolveProfile({
      authRpc,
      headers,
      requestId: "req-2",
      openMeldProfileId,
      profileKind: "human",
    });

    expect(result.ok).toBe(true);
    expect(result).toMatchObject({
      resolvedProfile: {
        profileHandle: "felix",
        openMeldProfileId,
      },
    });
    expect(resolveProfileMock).toHaveBeenCalledWith({
      headers: {
        authorization: "Bearer token",
      },
      requestId: "req-2",
      openMeldProfileId,
      profileKind: "human",
    });
  });

  it("rejects a successful direct Profile response without a resolved Profile", async () => {
    const authRpc = {
      resolveProfile: vi.fn(async () => ({
        ok: true,
      })),
    } as unknown as GatewayAuthRpcWorker;

    await expect(
      resolveProfile({
        authRpc,
        headers: new Headers({ authorization: "Bearer token" }),
        requestId: "req-missing-resolved-profile",
      })
    ).rejects.toThrow();
  });

  it("preserves agentControllerRef from the current resolvedProfile response", async () => {
    const resolveProfileMock = vi.fn(async () => ({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
        profileHandle: "codex-agent",
        profileName: "Codex Agent",
        profileKind: "agent",
        ownerUserId: "owner-1",
        agentControllerRef: "builtin:codex",
      },
    }));
    const authRpc = {
      resolveProfile: resolveProfileMock,
    } as unknown as GatewayAuthRpcWorker;

    const result = await resolveProfile({
      authRpc,
      headers: new Headers({ authorization: "Bearer token" }),
      requestId: "req-resolved-profile-agent-controller-ref",
      openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
      profileKind: "agent",
    });

    expect(result).toEqual({
      ok: true,
      resolvedProfile: {
        openMeldProfileId: "agt_33333333-3333-4333-8333-333333333333",
        profileHandle: "codex-agent",
        profileName: "Codex Agent",
        profileKind: "agent",
        ownerUserId: "owner-1",
        agentControllerRef: "builtin:codex",
      },
    });
  });
});
