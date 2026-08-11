import { describe, expect, it, vi } from "vitest";
import {
  listBuiltinAgentsRegistryEntries,
  resolveRegistryRuntimeAdapterContractByAgentControllerRef,
} from "../src/agents/registry-source";
import {
  listRegisteredProviderRuntimePreparationAdapterIds,
  prepareProviderRuntime,
} from "../src/provider-hosts/prepare-provider-runtime";

const BASE_REQUEST = {
  agentControllerRef: "builtin:codex",
  daemonWorkingDirectory: "/tmp/daemon-workdir",
  mode: "dispatch" as const,
  profileName: "Demo Bot",
  runtimeContext: {
    providerRuntimeWorkingDirectory: "/tmp/provider-runtime",
  },
  targetProfileId: "agt_demo",
};

describe("prepareProviderRuntime", () => {
  it("returns a no-op preparation result when the adapter does not require preparation", async () => {
    const openClawPreparer = vi.fn();

    const result = await prepareProviderRuntime(BASE_REQUEST, {
      preparers: {
        openclaw: openClawPreparer,
      },
      resolveAdapterContract:
        resolveRegistryRuntimeAdapterContractByAgentControllerRef,
    });

    expect(result).toEqual({
      envOverrides: undefined,
      preparationDetails: {
        kind: "none",
      },
      runtimeContext: BASE_REQUEST.runtimeContext,
    });
    expect(openClawPreparer).not.toHaveBeenCalled();
  });

  it("dispatches to the registered provider implementation when preparation is required", async () => {
    const openClawPreparer = vi.fn().mockResolvedValue({
      envOverrides: {
        OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID: "openmeld-demo-bot",
      },
      preparationDetails: {
        bootstrap: {
          agentId: "openmeld-demo-bot",
          authStatus: "copied",
          bootstrapVersion: 1,
          created: false,
          resolution: "reused",
        },
        kind: "openclaw",
        openClawGatewayVisibility: {
          agentId: "openmeld-demo-bot",
          gatewayRestartAttempted: false,
          gatewayVisibility: "visible",
        },
      },
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/openclaw-workspace",
      },
    });

    const result = await prepareProviderRuntime(
      {
        ...BASE_REQUEST,
        agentControllerRef: "builtin:openclaw",
      },
      {
        preparers: {
          openclaw: openClawPreparer,
        },
        resolveAdapterContract:
          resolveRegistryRuntimeAdapterContractByAgentControllerRef,
      }
    );

    expect(openClawPreparer).toHaveBeenCalledWith({
      ...BASE_REQUEST,
      agentControllerRef: "builtin:openclaw",
    });
    expect(result).toMatchObject({
      envOverrides: {
        OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID: "openmeld-demo-bot",
      },
      preparationDetails: {
        kind: "openclaw",
      },
      runtimeContext: {
        providerRuntimeWorkingDirectory: "/tmp/openclaw-workspace",
      },
    });
  });

  it("fails fast when a required adapter has no registered preparation implementation", async () => {
    await expect(
      prepareProviderRuntime(
        {
          ...BASE_REQUEST,
          agentControllerRef: "builtin:openclaw",
        },
        {
          preparers: {},
          resolveAdapterContract:
            resolveRegistryRuntimeAdapterContractByAgentControllerRef,
        }
      )
    ).rejects.toThrow(
      "No runtime preparation implementation is registered for adapter 'openclaw'"
    );
  });

  it("keeps the registered preparation implementations aligned with the registry contract", () => {
    const requiredAdapters = listBuiltinAgentsRegistryEntries()
      .filter((agent) => agent.runtime.supported)
      .flatMap((agent) =>
        agent.runtime.adapters
          .filter(
            (adapter) =>
              adapter.capabilityDeclaration.preparationRequirement ===
              "required"
          )
          .map((adapter) => adapter.adapterId)
      )
      .sort();

    expect(listRegisteredProviderRuntimePreparationAdapterIds()).toEqual(
      requiredAdapters
    );
  });
});
