import { describe, expect, it, vi } from "vitest";
import type { DispatchTargetProfileIdentityUnavailableError } from "../dispatch/infrastructure/profile/dispatch-target-profile-identity-adapter";
import { resolveDispatchTargetProfileIdentity } from "../dispatch/infrastructure/profile/dispatch-target-profile-identity-adapter";

describe("dispatch target profile identity adapter", () => {
  it("returns the auth rpc display identity when auth rpc resolves it", async () => {
    const result = await resolveDispatchTargetProfileIdentity({
      authRpc: {
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "user-1",
            profileHandle: "codex-handle",
            profileId: "agt-codex-1",
            profileKind: "agent",
            profileName: "Codex",
            status: "active",
          },
        }),
      } as never,
      targetProfileId: "agt-codex-1",
    });

    expect(result).toEqual({
      defaultProjectId: null,
      profileHandle: "codex-handle",
      profileName: "Codex",
    });
  });

  it("returns null display identity when auth rpc resolves the profile but there is no display metadata", async () => {
    const result = await resolveDispatchTargetProfileIdentity({
      authRpc: {
        resolveProfileById: vi.fn().mockResolvedValue({
          ok: true,
          profile: {
            ownerUserId: "user-1",
            profileHandle: null,
            profileId: "agt-missing-display-1",
            profileKind: "agent",
            profileName: null,
            status: "active",
          },
        }),
      } as never,
      targetProfileId: "agt-missing-display-1",
    });

    expect(result).toEqual({
      defaultProjectId: null,
      profileHandle: null,
      profileName: null,
    });
  });

  it("throws a typed unavailable error when auth rpc is missing", async () => {
    await expect(
      resolveDispatchTargetProfileIdentity({
        authRpc: undefined,
        targetProfileId: "agt-missing-auth-rpc-1",
      })
    ).rejects.toMatchObject({
      name: "DispatchTargetProfileIdentityUnavailableError",
      reasonCode: "dispatch.target_profile_identity.auth_rpc_unavailable",
    } satisfies Partial<DispatchTargetProfileIdentityUnavailableError>);
  });

  it("throws a typed unavailable error when auth rpc returns ok:false", async () => {
    await expect(
      resolveDispatchTargetProfileIdentity({
        authRpc: {
          resolveProfileById: vi.fn().mockResolvedValue({
            ok: false,
            code: "auth.profile_lookup_failed",
            message: "profile lookup failed",
          }),
        } as never,
        targetProfileId: "agt-auth-failed-1",
      })
    ).rejects.toMatchObject({
      name: "DispatchTargetProfileIdentityUnavailableError",
      reasonCode: "dispatch.target_profile_identity.lookup_failed",
      upstreamCode: "auth.profile_lookup_failed",
    } satisfies Partial<DispatchTargetProfileIdentityUnavailableError>);
  });

  it("throws a typed unavailable error when auth rpc throws", async () => {
    await expect(
      resolveDispatchTargetProfileIdentity({
        authRpc: {
          resolveProfileById: vi
            .fn()
            .mockRejectedValue(new Error("auth rpc timeout")),
        } as never,
        targetProfileId: "agt-auth-throws-1",
      })
    ).rejects.toMatchObject({
      name: "DispatchTargetProfileIdentityUnavailableError",
      reasonCode: "dispatch.target_profile_identity.auth_rpc_failed",
    } satisfies Partial<DispatchTargetProfileIdentityUnavailableError>);
  });
});
