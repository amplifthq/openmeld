import { describe, expect, it } from "vitest";
import {
  localAgentCatalogSchema,
  localAgentCatalogWithLifecycleSchema,
  prepareLocalAgentCatalogSchema,
  startDeviceAgentCatalogSchema,
} from "../../src/index";

function createValidLocalAgentCatalog() {
  return {
    totalBuiltins: 2,
    detectedSupported: 1,
    needsChoice: 0,
    needsRepair: 0,
    detectedNotSupportedYet: 1,
    notDetected: 0,
    entries: [
      {
        agentId: "codex",
        displayName: "Codex",
        targetKind: "builtin",
        detected: true,
        enabled: true,
        launchStatus: "ready",
        selectable: true,
        selectableReason: null,
      },
      {
        agentId: "openclaw",
        displayName: "OpenClaw",
        targetKind: "builtin",
        detected: true,
        enabled: false,
        launchStatus: "not_available",
        selectable: false,
        selectableReason: "not_supported_yet",
      },
      {
        agentId: "custom-demo",
        displayName: "Custom Demo",
        targetKind: "custom",
        detected: false,
        enabled: false,
        launchStatus: "not_available",
        selectable: false,
        selectableReason: "custom_coming_soon",
      },
    ],
  } as const;
}

describe("local agent catalog schema", () => {
  it("keeps Prepare Session and Start on the base local-agent catalog schema", () => {
    expect(prepareLocalAgentCatalogSchema).toBe(localAgentCatalogSchema);
    expect(startDeviceAgentCatalogSchema).toBe(localAgentCatalogSchema);
  });

  it("accepts builtin and custom local-agent catalog entries", () => {
    const result = localAgentCatalogSchema.safeParse(
      createValidLocalAgentCatalog()
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.entries[0]).not.toHaveProperty("lifecycleStatus");
  });

  it("defaults lifecycle status on local-runtime read-model catalog entries", () => {
    const result = localAgentCatalogWithLifecycleSchema.safeParse(
      createValidLocalAgentCatalog()
    );

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.entries[0]?.lifecycleStatus).toBe("active");
  });

  it("accepts suspended local-runtime read-model catalog entries", () => {
    const catalog = createValidLocalAgentCatalog();
    const result = localAgentCatalogWithLifecycleSchema.safeParse({
      ...catalog,
      entries: catalog.entries.map((entry) =>
        entry.agentId === "openclaw"
          ? { ...entry, lifecycleStatus: "suspended" }
          : { ...entry, lifecycleStatus: "active" }
      ),
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(
      result.data.entries.find((entry) => entry.agentId === "openclaw")
        ?.lifecycleStatus
    ).toBe("suspended");
  });

  it("accepts selectable builtin entries that need repair", () => {
    const result = localAgentCatalogSchema.safeParse({
      totalBuiltins: 1,
      detectedSupported: 0,
      needsChoice: 0,
      needsRepair: 1,
      detectedNotSupportedYet: 0,
      notDetected: 0,
      entries: [
        {
          agentId: "codex",
          displayName: "Codex",
          targetKind: "builtin",
          detected: true,
          enabled: true,
          launchStatus: "needs_repair",
          selectable: true,
          selectableReason: null,
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects ambiguous selectable semantics", () => {
    const result = localAgentCatalogSchema.safeParse({
      ...createValidLocalAgentCatalog(),
      totalBuiltins: 1,
      detectedNotSupportedYet: 0,
      entries: [
        {
          agentId: "codex",
          displayName: "Codex",
          targetKind: "builtin",
          detected: true,
          enabled: true,
          launchStatus: "ready",
          selectable: true,
          selectableReason: "not_supported_yet",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("rejects summary counts that do not match builtin entries", () => {
    const result = localAgentCatalogSchema.safeParse({
      ...createValidLocalAgentCatalog(),
      detectedSupported: 2,
    });

    expect(result.success).toBe(false);
  });
});
