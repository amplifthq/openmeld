import { describe, expect, it } from "vitest";
import { projectLocalAgentCatalogFromCapabilities } from "../src/local-agent-catalog";

describe("local agent catalog projection", () => {
  it("projects the full builtin local-agent catalog from runtime agent controller reports", () => {
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [
        { agentControllerRef: "builtin:codex", status: "ready" },
        { agentControllerRef: "builtin:openclaw", status: "not_ready" },
      ],
    });

    expect(catalog.detectedSupported).toBe(1);
    expect(catalog.needsRepair).toBe(1);
    expect(catalog.totalBuiltins).toBeGreaterThan(3);
    expect(catalog.notDetected).toBe(catalog.totalBuiltins - 2);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "amp",
          detected: false,
          displayName: "Amp",
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_detected",
        }),
        expect.objectContaining({
          agentId: "claude-code",
          detected: false,
          displayName: "Claude Code",
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_detected",
        }),
        expect.objectContaining({
          agentId: "codex",
          detected: true,
          displayName: "Codex",
          enabled: true,
          lifecycleStatus: "active",
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
        }),
        expect.objectContaining({
          agentId: "openclaw",
          detected: true,
          displayName: "OpenClaw",
          enabled: true,
          lifecycleStatus: "suspended",
          launchStatus: "needs_repair",
          selectable: true,
          selectableReason: null,
        }),
      ])
    );
  });

  it("keeps builtin display names in stable case-insensitive English order", () => {
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [],
    });
    const builtinIds = catalog.entries
      .filter((entry) => entry.targetKind === "builtin")
      .map((entry) => entry.agentId);

    expect(
      builtinIds.filter((agentId) =>
        ["github-copilot", "iflow-cli", "junie"].includes(agentId)
      )
    ).toEqual(["github-copilot", "iflow-cli", "junie"]);
  });

  it("keeps detected supported builtin agents selectable when launch status needs repair", () => {
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [
        { agentControllerRef: "builtin:codex", status: "not_ready" },
      ],
    });

    expect(catalog.needsRepair).toBe(1);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "codex",
          detected: true,
          enabled: true,
          launchStatus: "needs_repair",
          selectable: true,
          selectableReason: null,
          targetKind: "builtin",
        }),
      ])
    );
  });

  it("does not turn a failed controller check into setup repair", () => {
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [
        {
          agentControllerRef: "builtin:opencode",
          reasonCodes: ["controller.interface.check_failed"],
          status: "not_ready",
        },
      ],
    });

    expect(catalog.needsRepair).toBe(0);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "opencode",
          detected: true,
          enabled: true,
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
          targetKind: "builtin",
        }),
      ])
    );
  });

  it("keeps the last launch result when a ready report expires before its next check lands", () => {
    // Core marks a report stale once its native check is older than the auth
    // freshness window. That is missing evidence, not a failed launch.
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [
        {
          agentControllerRef: "builtin:codex",
          reasonCodes: ["runtime.agent_controller_report.ready"],
          status: "stale",
        },
      ],
    });

    expect(catalog.needsRepair).toBe(0);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "codex",
          detected: true,
          enabled: true,
          launchStatus: "ready",
          selectable: true,
        }),
      ])
    );
  });

  it("keeps launch repair when the expired report itself carried a launch failure", () => {
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [
        {
          agentControllerRef: "builtin:codex",
          reasonCodes: ["controller.launch.needs_repair"],
          status: "stale",
        },
      ],
    });

    expect(catalog.needsRepair).toBe(1);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "codex",
          launchStatus: "needs_repair",
        }),
      ])
    );
  });

  it("does not turn provider sign-in blockers into launch repair", () => {
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [
        {
          agentControllerRef: "builtin:claude-code",
          reasonCodes: [
            "provider_account.access_required",
            "controller.auth.unauthenticated",
          ],
          status: "not_ready",
        },
      ],
    });

    expect(catalog.needsRepair).toBe(0);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "claude-code",
          detected: true,
          enabled: true,
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
          targetKind: "builtin",
        }),
      ])
    );
  });

  it("preserves disabled local agent state without treating it as a repair failure", () => {
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [
        {
          agentControllerRef: "builtin:codex",
          enabled: false,
          status: "not_ready",
        },
      ],
    });

    expect(catalog.needsRepair).toBe(0);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "codex",
          detected: true,
          enabled: false,
          launchStatus: "ready",
          selectable: true,
          selectableReason: null,
          targetKind: "builtin",
        }),
      ])
    );
  });

  it("projects detected unsupported builtin agents as coming soon", () => {
    const catalog = projectLocalAgentCatalogFromCapabilities({
      capabilities: [
        { agentControllerRef: "builtin:amp", status: "ready" },
        { agentControllerRef: "provider:future", status: "ready" },
      ],
    });

    expect(catalog.detectedSupported).toBe(0);
    expect(catalog.detectedNotSupportedYet).toBe(1);
    expect(catalog.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          agentId: "amp",
          detected: true,
          displayName: "Amp",
          enabled: false,
          launchStatus: "not_available",
          selectable: false,
          selectableReason: "not_supported_yet",
        }),
      ])
    );
    expect(catalog.entries.some((entry) => entry.agentId === "future")).toBe(
      false
    );
  });
});
