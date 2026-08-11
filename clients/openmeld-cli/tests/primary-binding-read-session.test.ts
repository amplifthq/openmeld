import { createAgentProfileBindingApi } from "@openmeld/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenMeldProfile } from "../src/config/openmeld-profiles-api";
import { createPrimaryBindingReadSession } from "../src/system/primary-binding-read-session";

const getPrimaryBinding = vi.fn();

vi.mock("@openmeld/api-client", () => ({
  createAgentProfileBindingApi: vi.fn(),
}));

vi.mock("../src/config/base-url", () => ({
  resolveBaseUrl: async () => "https://gateway.test",
}));

vi.mock("../src/space/api-client-foundation", () => ({
  createCliApiClientFoundation: () => ({}),
}));

const createProfile = (openMeldProfileId: string): OpenMeldProfile =>
  ({
    openMeldProfileId,
    ownerUserId: "owner-1",
    profileKind: "agent",
    profileName: `Profile ${openMeldProfileId}`,
    status: "active",
  }) as OpenMeldProfile;

describe("primary binding read session", () => {
  beforeEach(() => {
    vi.mocked(createAgentProfileBindingApi).mockReturnValue({
      getPrimaryBinding,
    } as never);
    getPrimaryBinding.mockReset();
  });

  it("reads each profile binding once and shares the result", async () => {
    getPrimaryBinding.mockResolvedValue({
      binding: { bindingId: "bind-a" },
      status: "found",
    });
    const session = createPrimaryBindingReadSession();
    const profile = createProfile("agt-a");

    const [first, second] = await Promise.all([
      session.readPrimaryBinding(profile),
      session.readPrimaryBinding(profile),
    ]);
    const third = await session.readPrimaryBinding(profile);

    expect(getPrimaryBinding).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("reads distinct profiles separately", async () => {
    getPrimaryBinding.mockImplementation(({ agentProfileId }) =>
      Promise.resolve({
        binding: { bindingId: `bind-${agentProfileId}` },
        status: "found",
      })
    );
    const session = createPrimaryBindingReadSession();

    const [a, b] = await Promise.all([
      session.readPrimaryBinding(createProfile("agt-a")),
      session.readPrimaryBinding(createProfile("agt-b")),
    ]);

    expect(getPrimaryBinding).toHaveBeenCalledTimes(2);
    expect(a.binding).toEqual({ bindingId: "bind-agt-a" });
    expect(b.binding).toEqual({ bindingId: "bind-agt-b" });
  });

  it("shares one rejection across concurrent readers", async () => {
    getPrimaryBinding.mockRejectedValue(new Error("gateway unreachable"));
    const session = createPrimaryBindingReadSession();
    const profile = createProfile("agt-a");

    const results = await Promise.allSettled([
      session.readPrimaryBinding(profile),
      session.readPrimaryBinding(profile),
    ]);

    expect(getPrimaryBinding).toHaveBeenCalledTimes(1);
    for (const result of results) {
      expect(result.status).toBe("rejected");
    }
  });

  it("bounds concurrent reads to the configured limit", async () => {
    let active = 0;
    let maxActive = 0;
    const releases: Array<() => void> = [];
    getPrimaryBinding.mockImplementation(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise((resolve) => {
        releases.push(() => {
          active -= 1;
          resolve({ binding: {}, status: "found" });
        });
      });
    });
    const session = createPrimaryBindingReadSession({
      maxConcurrentReads: 2,
    });

    const reads = Promise.all(
      ["agt-1", "agt-2", "agt-3", "agt-4", "agt-5"].map((profileId) =>
        session.readPrimaryBinding(createProfile(profileId))
      )
    );

    await vi.waitFor(() => {
      expect(getPrimaryBinding).toHaveBeenCalledTimes(2);
    });
    while (releases.length > 0) {
      releases.shift()?.();
      // Let the limiter admit the next queued read before releasing again.
      await Promise.resolve();
      await Promise.resolve();
    }
    await reads;

    expect(getPrimaryBinding).toHaveBeenCalledTimes(5);
    expect(maxActive).toBeLessThanOrEqual(2);
  });
});
