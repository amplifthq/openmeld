import {
  currentDeviceTargetResponseSchema,
  forgetComputerResponseSchema,
  forgetCurrentComputerResponseSchema,
  localRuntimesResponseSchema,
  refreshCurrentLocalAgentCatalogResponseSchema,
  setCurrentAgentProfileWorkspaceResponseSchema,
  setCurrentLocalAgentEnabledResponseSchema,
  writeCurrentDeviceObservedMetadataResponseSchema,
} from "@openmeld/schemas";
import { describe, expect, it, vi } from "vitest";
import { createCurrentDeviceApi, createOpenMeldApiClient } from "../src";

describe("api-client current device api", () => {
  it("exposes the canonical current device methods", () => {
    const client = createOpenMeldApiClient({
      baseUrl: "https://gateway.openmeld.invalid",
      transport: vi.fn(() => Promise.resolve(new Response("ok"))),
    });

    expect(Object.keys(createCurrentDeviceApi(client)).sort()).toEqual([
      "enrollLocalRuntime",
      "forgetComputer",
      "forgetCurrentComputer",
      "getCurrentLocalAgentInstallations",
      "getCurrentLocalRuntimeReplyReadiness",
      "getCurrentTarget",
      "listLocalRuntimes",
      "refreshCurrentLocalAgentCatalog",
      "requestCurrentOpenMeldToolsUpdate",
      "selectCurrentLocalAgentInstallation",
      "setCurrentAgentProfileWorkspace",
      "setCurrentLocalAgentEnabled",
      "setCurrentOpenMeldToolsMaintenance",
      "setDisplayName",
      "writeObservedMetadata",
    ]);
  });

  it("uses one-click OpenMeld Tools update routes", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            operation: {
              operationId: "update-1",
              phase: "updating",
              requestSource: "web",
              requestedAt: "2026-08-25T10:00:00.000Z",
              targetVersion: "0.3.90",
              updatedAt: "2026-08-25T10:00:00.000Z",
              urgency: "available",
            },
            status: "started",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            automaticUpdatesEnabled: false,
            status: "updated",
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.requestCurrentOpenMeldToolsUpdate()
    ).resolves.toMatchObject({
      status: "started",
    });
    await expect(
      api.setCurrentOpenMeldToolsMaintenance({ automaticUpdatesEnabled: false })
    ).resolves.toEqual({
      automaticUpdatesEnabled: false,
      status: "updated",
    });
    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        init: expect.objectContaining({ method: "POST" }),
        operation: "local_runtime.current.openmeld_tools.update",
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/openmeld-tools/update",
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({ automaticUpdatesEnabled: false }),
          method: "PUT",
        }),
        operation: "local_runtime.current.openmeld_tools.maintenance.write",
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/openmeld-tools/maintenance",
      })
    );
  });

  it("reads the current device target through the canonical current-device route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            availability: "resolved",
            deviceId: "device-macbook-pro",
            runtimeLane: "canary",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.getCurrentTarget();

    expect(result).toEqual({
      availability: "resolved",
      deviceId: "device-macbook-pro",
      runtimeLane: "canary",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/devices/current",
        operation: "current_device.read",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("lists local runtimes through the canonical local-runtimes route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            currentConnectedComputerId: "computer-macbook-pro",
            currentDeviceId: "device-macbook-pro",
            currentRuntimeLane: "dev-local",
            legacyDeviceEvidence: [
              {
                connectionStatus: "legacy_disconnected",
                deviceId: "device-old",
                deviceDisplayName: "Felix's MacBook Pro",
                deviceDisplayNameSource: "observed",
                platformFamily: "macOS",
                osVersion: "15.5",
                deviceType: "laptop",
                firstSeenAtMs: 1_712_000_000_000,
                lastObservedAtMs: 1_712_100_000_000,
                executionTargets: [],
              },
            ],
            localRuntimes: [
              {
                connectedComputerId: "computer-macbook-pro",
                connectionStatus: "connected",
                deviceId: "device-macbook-pro",
                deviceDisplayName: "This computer",
                deviceDisplayNameSource: "placeholder",
                platformFamily: "Unknown",
                osVersion: null,
                deviceType: "unknown",
                firstSeenAtMs: 1_712_699_000_000,
                lastObservedAtMs: 1_712_700_000_000,
                isCurrent: true,
                legacyDeviceIds: ["device-macbook-pro"],
                executionTargets: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.listLocalRuntimes();

    expect(result).toEqual({
      currentConnectedComputerId: "computer-macbook-pro",
      currentDeviceId: "device-macbook-pro",
      currentRuntimeLane: "dev-local",
      legacyDeviceEvidence: [
        {
          connectionStatus: "legacy_disconnected",
          deviceId: "device-old",
          deviceDisplayName: "Felix's MacBook Pro",
          deviceDisplayNameSource: "observed",
          platformFamily: "macOS",
          osVersion: "15.5",
          deviceType: "laptop",
          firstSeenAtMs: 1_712_000_000_000,
          lastObservedAtMs: 1_712_100_000_000,
          executionTargets: [],
        },
      ],
      localRuntimes: [
        {
          connectedComputerId: "computer-macbook-pro",
          connectionStatus: "connected",
          deviceId: "device-macbook-pro",
          deviceDisplayName: "This computer",
          deviceDisplayNameSource: "placeholder",
          platformFamily: "Unknown",
          osVersion: null,
          deviceType: "unknown",
          firstSeenAtMs: 1_712_699_000_000,
          lastObservedAtMs: 1_712_700_000_000,
          isCurrent: true,
          legacyDeviceIds: ["device-macbook-pro"],
          executionTargets: [],
        },
      ],
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes",
        operation: "local_runtime.list",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("can request safe legacy current-computer adoption for local runtime reads", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            currentConnectedComputerId: "computer-macbook-pro",
            currentDeviceId: "device-macbook-pro",
            currentRuntimeLane: "dev-local",
            legacyDeviceEvidence: [],
            localRuntimes: [],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.listLocalRuntimes({
      connectionIdentityAdoption: "safe_legacy_current",
      includeUsageLimits: "true",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes?connectionIdentityAdoption=safe_legacy_current&includeUsageLimits=true",
        operation: "local_runtime.list",
        init: expect.objectContaining({
          method: "GET",
        }),
      })
    );
  });

  it("stores the current device target through the canonical current-device route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            deviceId: "device-macbook-pro",
            runtimeLane: "canary",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.enrollLocalRuntime({
      deviceId: "device-macbook-pro",
      runtimeLane: "canary",
    });

    expect(result).toEqual({
      deviceId: "device-macbook-pro",
      runtimeLane: "canary",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/device-macbook-pro/enrollment",
        operation: "local_runtime.enroll",
        init: expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            runtimeLane: "canary",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      })
    );
  });

  it("passes through the if_missing write mode for first-device bootstrap writes", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            deviceId: "device-macbook-pro",
            runtimeLane: "canary",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.enrollLocalRuntime({
      deviceId: "device-macbook-pro",
      runtimeLane: "canary",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            runtimeLane: "canary",
          }),
        }),
      })
    );
  });

  it("passes through the local setup activation source for forgotten computer reactivation", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            deviceId: "device-macbook-pro",
            runtimeLane: "canary",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.enrollLocalRuntime({
      deviceId: "device-macbook-pro",
      runtimeLane: "canary",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            runtimeLane: "canary",
          }),
        }),
      })
    );
  });

  it("passes through connected computer evidence during local setup", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            connectedComputerId: "computer-existing",
            deviceId: "device-new-home",
            runtimeLane: "canary",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await api.enrollLocalRuntime({
      connectedComputerId: "computer-existing",
      deviceId: "device-new-home",
      runtimeLane: "canary",
    });

    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        init: expect.objectContaining({
          body: JSON.stringify({
            connectedComputerId: "computer-existing",
            runtimeLane: "canary",
          }),
        }),
      })
    );
  });

  it("forgets the current computer through the canonical forget route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "forgotten",
            forgottenDeviceId: "device-macbook-pro",
            currentDeviceTarget: {
              availability: "missing",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.forgetCurrentComputer();

    expect(result).toEqual({
      status: "forgotten",
      forgottenDeviceId: "device-macbook-pro",
      currentDeviceTarget: {
        availability: "missing",
      },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/devices/current/forget",
        operation: "current_device.forget",
        init: expect.objectContaining({
          method: "POST",
        }),
      })
    );
  });

  it("forgets a local runtime through the canonical device forget route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "forgotten",
            forgottenDeviceId: "device-other",
            currentDeviceTarget: {
              availability: "resolved",
              deviceId: "device-current",
              runtimeLane: "dev-local",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.forgetComputer({
      deviceId: "device-other",
    });

    expect(result).toEqual({
      status: "forgotten",
      forgottenDeviceId: "device-other",
      currentDeviceTarget: {
        availability: "resolved",
        deviceId: "device-current",
        runtimeLane: "dev-local",
      },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/devices/device-other/forget",
        operation: "local_runtime.forget",
        init: expect.objectContaining({
          method: "POST",
        }),
      })
    );
  });

  it("rejects invalid current-device payloads before making a request", async () => {
    const transport = vi.fn(() => Promise.resolve(new Response("ok")));
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.enrollLocalRuntime({
        deviceId: "device-1",
        runtimeLane: "" as never,
      })
    ).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });

  it("uses the shared current-device response schemas", () => {
    expect(currentDeviceTargetResponseSchema).toBeDefined();
    expect(forgetComputerResponseSchema).toBeDefined();
    expect(forgetCurrentComputerResponseSchema).toBeDefined();
    expect(localRuntimesResponseSchema).toBeDefined();
    expect(refreshCurrentLocalAgentCatalogResponseSchema).toBeDefined();
    expect(setCurrentAgentProfileWorkspaceResponseSchema).toBeDefined();
    expect(setCurrentLocalAgentEnabledResponseSchema).toBeDefined();
    expect(writeCurrentDeviceObservedMetadataResponseSchema).toBeDefined();
  });

  it("sets a local runtime display name and returns the local runtime inventory", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            currentDeviceId: "device-macbook-pro",
            currentRuntimeLane: "dev-local",
            localRuntimes: [
              {
                deviceId: "device-macbook-pro",
                deviceDisplayName: "Office MacBook",
                deviceDisplayNameSource: "user",
                platformFamily: "macOS",
                osVersion: "15.4",
                deviceType: "laptop",
                firstSeenAtMs: 1_712_699_000_000,
                lastObservedAtMs: 1_712_700_000_000,
                isCurrent: true,
                executionTargets: [],
              },
            ],
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.setDisplayName({
      deviceId: "device-macbook-pro",
      displayName: "  Office MacBook  ",
    });

    expect(result.localRuntimes[0]?.deviceDisplayName).toBe("Office MacBook");
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/device-macbook-pro/display-name",
        operation: "local_runtime.display_name.write",
        init: expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            displayName: "Office MacBook",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      })
    );
  });

  it("sets the current local agent enabled state through the canonical current-service route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            agentId: "codex",
            changed: true,
            enabled: false,
            localRuntimes: {
              currentDeviceId: "device-macbook-pro",
              currentRuntimeLane: "dev-local",
              localRuntimes: [
                {
                  deviceId: "device-macbook-pro",
                  deviceDisplayName: "Office MacBook",
                  deviceDisplayNameSource: "observed",
                  platformFamily: "macOS",
                  osVersion: "15.4",
                  deviceType: "laptop",
                  firstSeenAtMs: 1_712_699_000_000,
                  lastObservedAtMs: 1_712_700_000_000,
                  isCurrent: true,
                  executionTargets: [
                    {
                      openMeldServiceRuntimeId: {
                        source: "runtime_registry_authority",
                        value: "rt_authority_01JZ3W9BQQ7N8JH4Y4A7B2C3D4",
                      },
                      capabilities: [
                        {
                          agentControllerRef: "builtin:codex",
                          enabled: false,
                          reasonCodes: [],
                          status: "not_ready",
                        },
                      ],
                      deviceId: "device-macbook-pro",
                      isCurrent: true,
                      lastObservedAtMs: 1_712_700_000_000,
                      localAgentCatalog: {
                        detectedNotSupportedYet: 0,
                        detectedSupported: 1,
                        entries: [
                          {
                            agentId: "codex",
                            detected: true,
                            displayName: "Codex",
                            enabled: false,
                            launchStatus: "ready",
                            selectable: true,
                            selectableReason: null,
                            targetKind: "builtin",
                          },
                        ],
                        needsChoice: 0,
                        needsRepair: 0,
                        notDetected: 0,
                        totalBuiltins: 1,
                      },
                      localAgentControl: {
                        refreshCatalog: true,
                        setEnabled: true,
                      },
                      reasonCodes: [],
                      runtimeLane: "dev-local",
                      status: "partial",
                      userFacingCommand: "openmeld-dev",
                    },
                  ],
                },
              ],
            },
            reportSyncStatus: "submitted",
            status: "updated",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.setCurrentLocalAgentEnabled({
      agentId: "codex",
      enabled: false,
    });

    expect(result.enabled).toBe(false);
    expect(
      result.localRuntimes.localRuntimes[0]?.executionTargets[0]
    ).toMatchObject({
      localAgentControl: { refreshCatalog: true, setEnabled: true },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/local-agents/codex/enabled",
        operation: "local_runtime.current.local_agent_enabled.write",
        init: expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            enabled: false,
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      })
    );
  });

  it("reads and selects a current local agent installation through the canonical current-service route", async () => {
    const transport = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agentId: "claude-code",
            installations: [
              {
                details: "Claude Code installed for this account",
                installationId: "install-local",
                name: "User installation",
                selected: true,
              },
              {
                details: "Claude Code installed with Homebrew",
                installationId: "install-homebrew",
                name: "Homebrew installation",
                selected: false,
              },
            ],
            selectionStatus: "available",
            selectedInstallationId: "install-local",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            agentId: "claude-code",
            changed: true,
            installations: [
              {
                details: "Claude Code installed for this account",
                installationId: "install-local",
                name: "User installation",
                selected: false,
              },
              {
                details: "Claude Code installed with Homebrew",
                installationId: "install-homebrew",
                name: "Homebrew installation",
                selected: true,
              },
            ],
            localRuntimes: {
              currentDeviceId: "device-macbook-pro",
              currentRuntimeLane: "prod",
              localRuntimes: [],
            },
            reportSyncStatus: "submitted",
            selectionStatus: "available",
            selectedInstallationId: "install-homebrew",
            status: "updated",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const listed = await api.getCurrentLocalAgentInstallations({
      agentId: "claude-code",
    });
    expect(listed.selectedInstallationId).toBe("install-local");

    const selected = await api.selectCurrentLocalAgentInstallation({
      agentId: "claude-code",
      installationId: "install-homebrew",
    });
    expect(selected).toMatchObject({
      changed: true,
      selectedInstallationId: "install-homebrew",
      status: "updated",
    });
    expect(transport).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/local-agents/claude-code/installations",
        operation: "local_runtime.current.local_agent_installations.read",
        init: expect.objectContaining({ method: "GET" }),
      })
    );
    expect(transport).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/local-agents/claude-code/installations",
        operation: "local_runtime.current.local_agent_installation.write",
        init: expect.objectContaining({
          body: JSON.stringify({ installationId: "install-homebrew" }),
          method: "PUT",
        }),
      })
    );
  });

  it("sets the current Agent Profile workspace through the canonical current-service route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
            status: "updated",
            workspaceMode: "custom",
            workspacePath: "/Users/felix/Desktop/work/openmeld",
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.setCurrentAgentProfileWorkspace({
      agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
      workspaceMode: "custom",
      workspacePath: "/Users/felix/Desktop/work/openmeld",
    });

    expect(result).toMatchObject({
      agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
      status: "updated",
      workspaceMode: "custom",
      workspacePath: "/Users/felix/Desktop/work/openmeld",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/agent-profiles/agt_99999999-9999-4999-8999-999999999999/workspace",
        operation: "local_runtime.current.agent_profile_workspace.write",
        init: expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            workspaceMode: "custom",
            workspacePath: "/Users/felix/Desktop/work/openmeld",
          }),
          headers: {
            "content-type": "application/json",
          },
        }),
      })
    );
  });

  it("refreshes the current local agent catalog through the canonical route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            localRuntimes: {
              currentDeviceId: "device-macbook-pro",
              currentRuntimeLane: "dev-local",
              localRuntimes: [],
            },
            sync: {
              accepted: true,
              profileIds: ["agt_00000000-0000-4000-8000-000000000001"],
              syncStatus: "unchanged",
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.refreshCurrentLocalAgentCatalog();

    expect(result.sync).toMatchObject({
      accepted: true,
      syncStatus: "unchanged",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/local-runtimes/current/local-agents/refresh-catalog",
        operation: "local_runtime.current.local_agent_catalog.refresh",
        init: expect.objectContaining({
          method: "POST",
        }),
      })
    );
  });

  it("rejects invalid current local agent enabled payloads before making a request", async () => {
    const transport = vi.fn(() => Promise.resolve(new Response("ok")));
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.setCurrentLocalAgentEnabled({
        agentId: "codex",
        enabled: undefined as never,
      })
    ).rejects.toThrow("Invalid input: expected boolean");
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects invalid current Agent Profile workspace payloads before making a request", async () => {
    const transport = vi.fn(() => Promise.resolve(new Response("ok")));
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.setCurrentAgentProfileWorkspace({
        agentProfileId: "agt_99999999-9999-4999-8999-999999999999",
        workspaceMode: "custom",
      })
    ).rejects.toThrow(
      "workspacePath is required for a custom profile workspace"
    );
    expect(transport).not.toHaveBeenCalled();
  });

  it("rejects invalid local runtime display name payloads before making a request", async () => {
    const transport = vi.fn(() => Promise.resolve(new Response("ok")));
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    await expect(
      api.setDisplayName({
        deviceId: "device-macbook-pro",
        displayName: "   ",
      })
    ).rejects.toThrow("Too small: expected string to have >=1 characters");
    expect(transport).not.toHaveBeenCalled();
  });

  it("writes observed metadata through the canonical current-device route", async () => {
    const transport = vi.fn(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            metadata: {
              observedDisplayName: "Felix's MacBook Pro",
              platformFamily: "macOS",
              osVersion: "15.4",
              deviceType: "laptop",
              observedAtMs: 1_712_966_400_000,
            },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          }
        )
      )
    );
    const api = createCurrentDeviceApi(
      createOpenMeldApiClient({
        baseUrl: "https://gateway.openmeld.invalid",
        transport,
      })
    );

    const result = await api.writeObservedMetadata({
      deviceId: "device-macbook-pro",
      metadata: {
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.4",
        deviceType: "laptop",
        observedAtMs: 1_712_966_400_000,
      },
    });

    expect(result).toEqual({
      metadata: {
        observedDisplayName: "Felix's MacBook Pro",
        platformFamily: "macOS",
        osVersion: "15.4",
        deviceType: "laptop",
        observedAtMs: 1_712_966_400_000,
      },
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://gateway.openmeld.invalid/v1/devices/device-macbook-pro/observed-metadata",
        operation: "current_device.observed_metadata.write",
        init: expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({
            metadata: {
              observedDisplayName: "Felix's MacBook Pro",
              platformFamily: "macOS",
              osVersion: "15.4",
              deviceType: "laptop",
              observedAtMs: 1_712_966_400_000,
            },
          }),
        }),
      })
    );
  });
});
