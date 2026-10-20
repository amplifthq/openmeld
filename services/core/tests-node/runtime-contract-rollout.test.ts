import {
  CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
  localComponentsReleaseManifestSchema,
} from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import { assertAgentControllerPermissionModeReleased } from "../src/local-components/runtime-contract-rollout";
import { resolveDaemonExecutionCompatibility } from "../src/runtime-transport/application/daemon-execution-compatibility";
import { PUBLISHED_LOCAL_COMPONENTS_MANIFEST } from "../test-support/published-local-components-release";
// Captured from release/local-components.json at the published v0.3.248 tag.
import stableManifestJson from "./fixtures/local-components-v0.3.248.json";

const stableManifest =
  localComponentsReleaseManifestSchema.parse(stableManifestJson);
const PREVIOUS_EPOCH = "runtime-transport-epoch-2026-09-image-geometry";
const receiverManifest = structuredClone(PUBLISHED_LOCAL_COMPONENTS_MANIFEST);
receiverManifest.components.service.runtimeContractEpoch = PREVIOUS_EPOCH;

describe("Core runtime contract rollout follows the published Service", () => {
  it.each([
    { manifest: receiverManifest, permissionWritesEnabled: false },
    { manifest: stableManifest, permissionWritesEnabled: true },
  ])("keeps the published $manifest.components.service.runtimeContractEpoch Service usable without regressing released permission modes", ({
    manifest,
    permissionWritesEnabled,
  }) => {
    const publishedEpoch = manifest.components.service.runtimeContractEpoch;
    for (const epoch of [
      publishedEpoch,
      CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    ]) {
      expect(
        resolveDaemonExecutionCompatibility({ epoch }, manifest)
      ).toMatchObject({
        status: "compatible",
        expectedEpoch: publishedEpoch,
      });
    }
    for (const mode of [
      "default",
      "acceptEdits",
      "plan",
      "bypassPermissions",
    ]) {
      const write = () =>
        assertAgentControllerPermissionModeReleased(
          `antigravity:${mode}`,
          manifest
        );
      if (permissionWritesEnabled) {
        expect(write).not.toThrow();
      } else {
        expect(write).toThrow(
          "Antigravity permission settings are not available yet"
        );
      }
    }
    expect(() =>
      assertAgentControllerPermissionModeReleased(null, manifest)
    ).not.toThrow();
    expect(() =>
      assertAgentControllerPermissionModeReleased(
        "codex:approveForMe",
        manifest
      )
    ).not.toThrow();
    expect(
      resolveDaemonExecutionCompatibility({ epoch: "unknown" }, manifest).status
    ).toBe("update_required");
    expect(resolveDaemonExecutionCompatibility(null, manifest).status).toBe(
      "update_required"
    );
  });

  it("enables writers only with the current protocol and requires the matching Service", () => {
    const released = structuredClone(PUBLISHED_LOCAL_COMPONENTS_MANIFEST);
    released.components.service.runtimeContractEpoch =
      CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH;
    for (const epoch of [
      PREVIOUS_EPOCH,
      stableManifest.components.service.runtimeContractEpoch,
    ]) {
      expect(
        resolveDaemonExecutionCompatibility({ epoch }, released).status
      ).toBe("update_required");
    }
    expect(
      resolveDaemonExecutionCompatibility(
        { epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH },
        released
      ).status
    ).toBe("compatible");
    expect(() =>
      assertAgentControllerPermissionModeReleased(
        "antigravity:acceptEdits",
        released
      )
    ).not.toThrow();
  });

  it.each([
    "unreadable",
    "unsupported_epoch",
  ])("enables nothing new for an unreadable or unsupported published release (%s)", (value) => {
    const manifest =
      value === "unreadable" ? null : structuredClone(stableManifest);
    if (manifest) {
      manifest.components.service.runtimeContractEpoch = value;
    }
    expect(() =>
      assertAgentControllerPermissionModeReleased(
        "antigravity:acceptEdits",
        manifest
      )
    ).toThrow();
    expect(
      resolveDaemonExecutionCompatibility({ epoch: PREVIOUS_EPOCH }, manifest)
        .status
    ).toBe("update_required");
    expect(
      resolveDaemonExecutionCompatibility({ epoch: value }, manifest).status
    ).toBe("update_required");
  });
});
