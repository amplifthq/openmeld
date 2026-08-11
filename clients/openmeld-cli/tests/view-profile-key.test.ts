import { afterEach, describe, expect, it, vi } from "vitest";

const { resolveOpenMeldProfileByIdOrNameMock } = vi.hoisted(() => ({
  resolveOpenMeldProfileByIdOrNameMock: vi.fn(),
}));

vi.mock("../src/config/openmeld-profiles-api", () => ({
  resolveOpenMeldProfileByIdOrName: (...args: unknown[]) =>
    resolveOpenMeldProfileByIdOrNameMock(...args),
}));

import { resolveViewProfileKey } from "../src/config/view-profile-key";
import { withTempHome } from "./helpers/fs";

describe("view profile key", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves explicit profile names to profile IDs for fixed view commands", async () => {
    await withTempHome(async () => {
      resolveOpenMeldProfileByIdOrNameMock.mockResolvedValueOnce({
        openMeldProfileId: "agt_codex",
      });

      await expect(resolveViewProfileKey("Codex Helper")).resolves.toBe(
        "agt_codex"
      );

      expect(resolveOpenMeldProfileByIdOrNameMock).toHaveBeenCalledWith({
        profileIdentifier: "Codex Helper",
      });
    });
  });

  it("preserves explicit input when profile lookup is unavailable", async () => {
    await withTempHome(async () => {
      resolveOpenMeldProfileByIdOrNameMock.mockRejectedValueOnce(
        new Error("offline")
      );

      await expect(resolveViewProfileKey("agt_codex")).resolves.toBe(
        "agt_codex"
      );
    });
  });
});
