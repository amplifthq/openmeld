import { describe, expect, it, vi } from "vitest";
import {
  rememberAgentProfileCreationDefaults,
  resolveFirstUseAgentProfileCreationDefaults,
} from "../src/agent-profile-binding/application/agent-profile-creation-defaults-service";
import { readAuthoredModelCatalog as readModelCatalog } from "../src/config/model-catalog";
import { createProjectionPostgresDatabase } from "../test-support/postgresql-query.test-support";
import { PUBLISHED_LOCAL_COMPONENTS_MANIFEST } from "../test-support/published-local-components-release";

describe("first-use Agent Profile creation defaults", () => {
  it("does not save a new permission preference before the compatible release", async () => {
    const receiverManifest = structuredClone(
      PUBLISHED_LOCAL_COMPONENTS_MANIFEST
    );
    receiverManifest.components.service.runtimeContractEpoch =
      "runtime-transport-epoch-2026-09-image-geometry";
    const db = createProjectionPostgresDatabase(() => []);
    const query = vi.spyOn(db, "query");
    await expect(
      rememberAgentProfileCreationDefaults({
        localComponentsManifest: receiverManifest,
        agentControllerRef: "builtin:antigravity",
        db,
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
    expect(query).not.toHaveBeenCalled();
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
