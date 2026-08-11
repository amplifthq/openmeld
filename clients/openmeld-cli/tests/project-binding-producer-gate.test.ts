import { describe, expect, it } from "vitest";
import { assertProjectBindingProducerCompatible } from "../src/agent-activity/project-binding-producer-gate";

describe("Project binding producer version gate", () => {
  it.each([
    null,
    "3.0.0",
  ])("allows mutation when the installed Service version is %s", async (installedVersion) => {
    await expect(
      assertProjectBindingProducerCompatible({
        readCompatibility: async () => ({
          blockingAnomalyCodes: [],
          expectedVersion: "3.0.0",
          observedVersions: installedVersion ? [installedVersion] : [],
          servicePresent: installedVersion !== null,
        }),
      })
    ).resolves.toBeUndefined();
  });

  it("fails closed before a v3 producer can write beside an old Service", async () => {
    await expect(
      assertProjectBindingProducerCompatible({
        readCompatibility: async () => ({
          blockingAnomalyCodes: [],
          expectedVersion: "3.0.0",
          observedVersions: ["2.9.0"],
          servicePresent: true,
        }),
      })
    ).rejects.toMatchObject({
      code: "project_bindings.update_required",
      message: expect.stringContaining("Run `openmeld upgrade`"),
    });
  });

  it.each([
    {
      blockingAnomalyCodes: [],
      observedVersions: [],
      reason: "missing version evidence",
    },
    {
      blockingAnomalyCodes: ["runtime_bundle_mismatch"],
      observedVersions: ["3.0.0"],
      reason: "a mismatched running bundle",
    },
  ])("fails closed for $reason", async (compatibility) => {
    await expect(
      assertProjectBindingProducerCompatible({
        readCompatibility: async () => ({
          ...compatibility,
          expectedVersion: "3.0.0",
          servicePresent: true,
        }),
      })
    ).rejects.toMatchObject({ code: "project_bindings.update_required" });
  });
});
