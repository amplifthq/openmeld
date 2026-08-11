import { describe, expect, it, vi } from "vitest";
import { setProfileDefaultView } from "../src/config/profile-view";
import { resolveOpenMeldProfileOrNull } from "../src/config/resolve-openmeld-profile";
import {
  parseCliViewMode,
  resolveRuntimeContext,
} from "../src/runtime/context";
import { withSilencedStdio, withTempHome } from "./helpers/fs";
import { createTestOpenMeldProfile } from "./helpers/openmeld-profile-fixture";

vi.mock("../src/config/resolve-openmeld-profile", () => {
  return {
    resolveOpenMeldProfileOrNull: vi.fn(),
  };
});

describe("runtime context", () => {
  it("resolves auto view to agent when profile kind is agent", async () => {
    await withTempHome(async () => {
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(
        createTestOpenMeldProfile({
          openMeldProfileId: "mira--aaaaaaaa",
          profileName: "Mira",
          profileKind: "agent",
          createdAt: "2026-02-20T00:00:00.000Z",
          updatedAt: "2026-02-20T00:00:00.000Z",
        })
      );

      const runtime = await resolveRuntimeContext({
        profile: "mira--aaaaaaaa",
        view: "auto",
      });

      expect(runtime.resolvedView).toBe("agent");
      expect(runtime.profileKind).toBe("agent");
      expect(resolveOpenMeldProfileOrNull).toHaveBeenCalledWith({
        openMeldProfileId: "mira--aaaaaaaa",
        allowUnauthenticated: true,
        persistSelection: false,
        allowDefaultFallback: false,
      });
    });
  });

  it("uses profile default view when --view is omitted", async () => {
    await withTempHome(async () => {
      await withSilencedStdio(async () => {
        await setProfileDefaultView({
          openMeldProfileId: "mira--aaaaaaaa",
          view: "agent",
        });
      });

      const runtime = await resolveRuntimeContext({
        profile: "mira--aaaaaaaa",
      });
      expect(runtime.viewMode).toBe("agent");
      expect(runtime.resolvedView).toBe("agent");
    });
  });

  it("allows explicit view override", async () => {
    await withTempHome(async () => {
      const runtime = await resolveRuntimeContext({ view: "human" });
      expect(runtime.resolvedView).toBe("human");
    });
  });

  it("defaults auto view to human without remote fallback when no profile resolves", async () => {
    await withTempHome(async () => {
      vi.mocked(resolveOpenMeldProfileOrNull).mockResolvedValueOnce(null);

      const runtime = await resolveRuntimeContext({ view: "auto" });

      expect(runtime.resolvedView).toBe("human");
      expect(resolveOpenMeldProfileOrNull).toHaveBeenCalledWith({
        openMeldProfileId: undefined,
        allowUnauthenticated: true,
        persistSelection: false,
        allowDefaultFallback: false,
      });
    });
  });

  it("validates unsupported --view values", () => {
    expect(() => parseCliViewMode("robot")).toThrow(
      "invalid --view value: robot"
    );
  });
});
