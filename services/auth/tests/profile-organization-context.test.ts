import { describe, expect, it, vi } from "vitest";
import { resolveAgentProfileOrganizationId } from "../src/lib/hono/profile-routes";

describe("Agent Profile Organization context", () => {
  it("uses the explicitly requested Organization instead of a stale Session selection", async () => {
    const first = vi.fn().mockResolvedValue({
      organization_id: "organization-amplift",
    });
    const bind = vi.fn(() => ({ first }));
    const prepare = vi.fn(() => ({ bind }));

    await expect(
      resolveAgentProfileOrganizationId({
        db: { prepare } as unknown as D1Database,
        headers: new Headers({
          "x-openmeld-requested-organization-id": "organization-amplift",
        }),
        sessionActiveOrganizationId: "organization-personal",
        userId: "user-felix",
      })
    ).resolves.toBe("organization-amplift");
    expect(bind).toHaveBeenCalledWith("user-felix", "organization-amplift");
  });

  it("preserves Session fallback for older unscoped callers", async () => {
    const prepare = vi.fn();

    await expect(
      resolveAgentProfileOrganizationId({
        db: { prepare } as unknown as D1Database,
        headers: new Headers(),
        sessionActiveOrganizationId: "organization-session",
        userId: "user-felix",
      })
    ).resolves.toBe("organization-session");
    expect(prepare).not.toHaveBeenCalled();
  });

  it("rejects ambiguous Organization selectors before reading membership", async () => {
    const prepare = vi.fn();

    await expect(
      resolveAgentProfileOrganizationId({
        db: { prepare } as unknown as D1Database,
        headers: new Headers({
          "x-openmeld-requested-organization-id": "organization-amplift",
          "x-openmeld-requested-organization-slug": "amplift",
        }),
        sessionActiveOrganizationId: "organization-session",
        userId: "user-felix",
      })
    ).rejects.toMatchObject({
      code: "organization.context_invalid",
    });
    expect(prepare).not.toHaveBeenCalled();
  });
});
