import { afterEach, describe, expect, it, vi } from "vitest";
import publishedManifest from "../../../release/local-components.json";
import {
  rememberAgentProfileCreationDefaults,
  resolveFirstUseAgentProfileCreationDefaults,
} from "../src/agent-profile-binding/application/agent-profile-creation-defaults-service";
import { readAuthoredModelCatalog as readModelCatalog } from "../src/config/model-catalog";

describe("first-use Agent Profile creation defaults", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not save a new permission preference before the compatible release", async () => {
    const receiverManifest = structuredClone(publishedManifest);
    receiverManifest.components.service.runtimeContractEpoch =
      "runtime-transport-epoch-2026-09-image-geometry";
    vi.stubGlobal(
      "OPENMELD_LOCAL_COMPONENTS_RELEASE_MANIFEST_JSON",
      JSON.stringify(receiverManifest)
    );
    const prepare = vi.fn();
    await expect(
      rememberAgentProfileCreationDefaults({
        agentControllerRef: "builtin:antigravity",
        db: { prepare } as unknown as D1Database,
        nowMs: 1000,
        organizationId: "org-1",
        userId: "user-1",
        selection: {
          agentControllerCollaborationMode: null,
          agentControllerPermissionMode: "antigravity:acceptEdits",
          defaultProjectId: null,
          modelId: "claude-sonnet-4-6",
          reasoningLevel: null,
          openCodePermission: null,
        },
      })
    ).rejects.toThrow("Antigravity permission settings are not available yet");
    expect(prepare).not.toHaveBeenCalled();
  });
  it("uses a creation recommendation independently of the runtime default", () => {
    const catalog = readModelCatalog();
    const controller = catalog.agentControllers.codex;
    if (!controller) {
      throw new Error("Missing fixture controller");
    }
    controller.creationDefaults = {
      modelId: "gpt-5.5",
      reasoningLevel: "medium",
    };
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:codex",
        modelCatalog: catalog,
      })
    ).toEqual(controller.creationDefaults);
    expect(controller.defaultModelId).toBe("gpt-6.1-sol");
  });

  it("supports an explicit model-default reasoning preference", () => {
    const catalog = readModelCatalog();
    const controller = catalog.agentControllers.codex;
    if (!controller) {
      throw new Error("Missing fixture controller");
    }
    controller.creationDefaults = {
      modelId: "gpt-5.5",
      reasoningLevel: null,
    };
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:codex",
        modelCatalog: catalog,
      })
    ).toEqual({ modelId: "gpt-5.5", reasoningLevel: null });
  });
  it("starts Codex on GPT-6.1 Sol with Medium reasoning", () => {
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:codex",
        modelCatalog: readModelCatalog(),
      })
    ).toEqual({
      modelId: "gpt-6.1-sol",
      reasoningLevel: "medium",
    });
  });

  it("starts Claude on the reviewed Opus 5 recommendation without inventing reasoning", () => {
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:claude-code",
        modelCatalog: readModelCatalog(),
      })
    ).toEqual({
      modelId: "claude-opus-5",
      reasoningLevel: null,
    });
  });

  it("fails closed for an unknown controller", () => {
    expect(
      resolveFirstUseAgentProfileCreationDefaults({
        agentControllerRef: "builtin:missing",
        modelCatalog: readModelCatalog(),
      })
    ).toEqual({ modelId: null, reasoningLevel: null });
  });
});
