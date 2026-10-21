import type { ModelCatalogAgentController } from "@openmeld/schemas/types";
import { describe, expect, it } from "vitest";
import { resolveAgentControllerModelCompatibility } from "../src/agent-controller-model-compatibility";

const CONTROLLER: ModelCatalogAgentController = {
  defaultModelId: "gpt-5.6-sol",
  models: [
    {
      id: "gpt-5.6-sol",
      displayName: "GPT-5.6 Sol",
      unavailable: false,
      supportedReasoningLevels: ["low", "medium", "high"],
      minCliVersion: "0.142.2",
    },
    {
      id: "gpt-5.6-terra",
      displayName: "GPT-5.6 Terra",
      unavailable: false,
      supportedReasoningLevels: ["low", "medium", "high"],
      minCliVersion: "0.144.0",
    },
    {
      id: "gpt-retired",
      displayName: "GPT Retired",
      unavailable: true,
      supportedReasoningLevels: ["high"],
      minCliVersion: null,
    },
  ],
};

describe("resolveAgentControllerModelCompatibility", () => {
  it("uses an aligned reported model inventory as the strongest evidence", () => {
    expect(
      resolveAgentControllerModelCompatibility({
        controller: CONTROLLER,
        installedVersion: "0.142.5",
        modelId: "gpt-5.6-terra",
        reportedModelIds: ["gpt-5.6-sol"],
      })
    ).toEqual({ status: "not_offered" });

    expect(
      resolveAgentControllerModelCompatibility({
        controller: CONTROLLER,
        installedVersion: "0.100.0",
        modelId: "gpt-5.6-terra",
        reportedModelIds: ["gpt-5.6-terra"],
      })
    ).toEqual({ status: "supported" });
  });

  it("falls back to an explicit version floor when inventory is unavailable", () => {
    expect(
      resolveAgentControllerModelCompatibility({
        controller: CONTROLLER,
        installedVersion: "v0.143.0",
        modelId: "gpt-5.6-terra",
        reportedModelIds: [],
      })
    ).toEqual({
      currentVersion: "v0.143.0",
      minimumVersion: "0.144.0",
      status: "requires_newer_controller",
    });
  });

  it("does not treat a model omitted from a saturated inventory as unavailable", () => {
    const reportedModelIds = [
      "gpt-5.6-sol",
      ...Array.from({ length: 255 }, (_, index) => `provider/model-${index}`),
    ];
    const input = {
      controller: CONTROLLER,
      installedVersion: null,
      modelId: "gpt-5.6-terra",
      reportedModelIds,
    };
    expect(resolveAgentControllerModelCompatibility(input)).toEqual({
      status: "unknown",
    });
    expect(
      resolveAgentControllerModelCompatibility({
        ...input,
        reportedModelIds: reportedModelIds.slice(0, 255),
      })
    ).toEqual({ status: "not_offered" });
    expect(
      resolveAgentControllerModelCompatibility({
        ...input,
        installedVersion: "0.143.0",
      })
    ).toEqual({
      currentVersion: "0.143.0",
      minimumVersion: "0.144.0",
      status: "requires_newer_controller",
    });
    expect(
      resolveAgentControllerModelCompatibility({
        ...input,
        modelId: "gpt-5.6-sol",
      })
    ).toEqual({ status: "supported" });
  });

  it("does not block when model inventory does not use catalog ids", () => {
    expect(
      resolveAgentControllerModelCompatibility({
        controller: CONTROLLER,
        installedVersion: null,
        modelId: "gpt-5.6-terra",
        reportedModelIds: ["provider-specific-terra"],
      })
    ).toEqual({ status: "unknown" });
  });

  it("does not block when version evidence is missing or invalid", () => {
    for (const installedVersion of [null, "unknown"] as const) {
      expect(
        resolveAgentControllerModelCompatibility({
          controller: CONTROLLER,
          installedVersion,
          modelId: "gpt-5.6-terra",
          reportedModelIds: null,
        })
      ).toEqual({ status: "unknown" });
    }
  });

  it("keeps prerelease ordering deterministic", () => {
    expect(
      resolveAgentControllerModelCompatibility({
        controller: CONTROLLER,
        installedVersion: "0.144.0-alpha.4.1",
        modelId: "gpt-5.6-terra",
        reportedModelIds: null,
      })
    ).toEqual({
      currentVersion: "0.144.0-alpha.4.1",
      minimumVersion: "0.144.0",
      status: "requires_newer_controller",
    });
  });

  it("preserves catalog-wide unavailability", () => {
    expect(
      resolveAgentControllerModelCompatibility({
        controller: CONTROLLER,
        installedVersion: "9.0.0",
        modelId: "gpt-retired",
        reportedModelIds: ["gpt-retired"],
      })
    ).toEqual({ status: "catalog_unavailable" });
  });
});
