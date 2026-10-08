import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import publishedManifest from "../../../release/local-components.json";
import { assertAgentControllerPermissionModeReleased } from "../src/local-components/runtime-contract-rollout";
import { resolveDaemonExecutionCompatibility } from "../src/runtime-transport/application/daemon-execution-compatibility";
// Captured from release/local-components.json at the published v0.3.248 tag.
import stableManifest from "./fixtures/local-components-v0.3.248.json";

const PREVIOUS_EPOCH = "runtime-transport-epoch-2026-09-image-geometry";
const receiverManifest = structuredClone(publishedManifest);
receiverManifest.components.service.runtimeContractEpoch = PREVIOUS_EPOCH;

describe("Core receiver-first runtime contract rollout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it.each([
    { manifest: receiverManifest, permissionWritesEnabled: false },
    { manifest: stableManifest, permissionWritesEnabled: true },
  ])("keeps the pinned $manifest.components.service.runtimeContractEpoch Service usable without regressing released permission modes", ({
    manifest,
    permissionWritesEnabled,
  }) => {
    const publishedEpoch = manifest.components.service.runtimeContractEpoch;
    vi.stubGlobal(
      "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON",
      JSON.stringify(manifest)
    );
    for (const epoch of [
      publishedEpoch,
      CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    ]) {
      expect(resolveDaemonExecutionCompatibility({ epoch })).toMatchObject({
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
        assertAgentControllerPermissionModeReleased(`antigravity:${mode}`);
      if (permissionWritesEnabled) {
        expect(write).not.toThrow();
      } else {
        expect(write).toThrow(
          "Antigravity permission settings are not available yet"
        );
      }
    }
    expect(() =>
      assertAgentControllerPermissionModeReleased(null)
    ).not.toThrow();
    expect(() =>
      assertAgentControllerPermissionModeReleased("codex:approveForMe")
    ).not.toThrow();
    expect(
      resolveDaemonExecutionCompatibility({ epoch: "unknown" }).status
    ).toBe("update_required");
    expect(resolveDaemonExecutionCompatibility(null).status).toBe(
      "update_required"
    );
  });

  it.each([
    false,
    true,
  ])("enables writers only with the current protocol and requires the matching Service (override=%s)", (override) => {
    if (override) {
      const released = structuredClone(publishedManifest);
      released.components.service.runtimeContractEpoch =
        CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH;
      vi.stubGlobal(
        "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON",
        JSON.stringify(released)
      );
    }
    for (const epoch of [
      PREVIOUS_EPOCH,
      stableManifest.components.service.runtimeContractEpoch,
    ]) {
      expect(resolveDaemonExecutionCompatibility({ epoch }).status).toBe(
        "update_required"
      );
    }
    expect(
      resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }).status
    ).toBe("compatible");
    expect(() =>
      assertAgentControllerPermissionModeReleased("antigravity:acceptEdits")
    ).not.toThrow();
  });

  it.each([
    "invalid",
    "unsupported_epoch",
  ])("rejects an invalid or unsupported pinned release (%s)", (value) => {
    const manifest = structuredClone(stableManifest);
    manifest.components.service.runtimeContractEpoch = value;
    vi.stubGlobal(
      "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON",
      value === "invalid" ? value : JSON.stringify(manifest)
    );
    expect(() =>
      assertAgentControllerPermissionModeReleased("antigravity:acceptEdits")
    ).toThrow();
    expect(
      resolveDaemonExecutionCompatibility({ epoch: PREVIOUS_EPOCH }).status
    ).toBe("update_required");
    expect(
      resolveDaemonExecutionCompatibility({
        epoch: manifest.components.service.runtimeContractEpoch,
      }).status
    ).toBe("update_required");
  });
});
