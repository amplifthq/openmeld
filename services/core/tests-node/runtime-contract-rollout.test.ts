import { CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH } from "@openmeld/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import publishedManifest from "../../../release/local-components.json";
import { assertAgentControllerPermissionModeReleased } from "../src/local-components/runtime-contract-rollout";
import { resolveDaemonExecutionCompatibility } from "../src/runtime-transport/application/daemon-execution-compatibility";

const PREVIOUS_EPOCH = "runtime-transport-epoch-2026-09-image-geometry";
const receiverManifest = structuredClone(publishedManifest);
receiverManifest.components.service.runtimeContractEpoch = PREVIOUS_EPOCH;

describe("Core receiver-first Antigravity rollout", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("keeps the published Service usable while accepting the new receiver protocol and holding writers", () => {
    vi.stubGlobal(
      "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON",
      JSON.stringify(receiverManifest)
    );
    for (const epoch of [
      PREVIOUS_EPOCH,
      CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
    ]) {
      expect(resolveDaemonExecutionCompatibility({ epoch })).toMatchObject({
        status: "compatible",
        expectedEpoch: PREVIOUS_EPOCH,
      });
    }
    for (const mode of [
      "default",
      "acceptEdits",
      "plan",
      "bypassPermissions",
    ]) {
      expect(() =>
        assertAgentControllerPermissionModeReleased(`antigravity:${mode}`)
      ).toThrow("Antigravity permission settings are not available yet");
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
    expect(
      resolveDaemonExecutionCompatibility({ epoch: PREVIOUS_EPOCH }).status
    ).toBe("update_required");
    expect(
      resolveDaemonExecutionCompatibility({
        epoch: CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH,
      }).status
    ).toBe("compatible");
    expect(() =>
      assertAgentControllerPermissionModeReleased("antigravity:acceptEdits")
    ).not.toThrow();
  });

  it("holds new writers when the pinned release manifest is invalid", () => {
    vi.stubGlobal("OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON", "invalid");
    expect(() =>
      assertAgentControllerPermissionModeReleased("antigravity:acceptEdits")
    ).toThrow();
    expect(
      resolveDaemonExecutionCompatibility({ epoch: PREVIOUS_EPOCH }).status
    ).toBe("update_required");
  });
});
