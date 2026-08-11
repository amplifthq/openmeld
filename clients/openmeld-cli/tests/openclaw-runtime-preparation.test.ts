import { describe, expect, it, vi } from "vitest";
import { prepareOpenClawRuntime } from "../src/provider-hosts/openclaw/runtime-preparation";

describe("prepareOpenClawRuntime", () => {
  it("keeps the profile workspace runtime context as the preparation owner", async () => {
    const ensureBootstrap = vi.fn().mockResolvedValue({
      agentId: "openmeld-demo-bot",
      authStatus: "copied",
      bootstrapVersion: 1,
      created: false,
      resolution: "reused",
    });
    const ensureGatewayAgentVisible = vi.fn().mockResolvedValue({
      agentId: "openmeld-demo-bot",
      gatewayRestartAttempted: false,
      gatewayVisibility: "visible",
    });
    const expectedWorkspaceDir = "/tmp/profile-owned-workspace";

    const result = await prepareOpenClawRuntime(
      {
        daemonWorkingDirectory: "/tmp/daemon-workdir",
        mode: "dispatch",
        profileName: "Demo Bot",
        runtimeContext: {
          providerRuntimeWorkingDirectory: expectedWorkspaceDir,
        },
        targetProfileId: "agt_demo",
      },
      {
        ensureBootstrap,
        ensureGatewayAgentVisible,
        fetchGatewayHealth: vi.fn(),
      }
    );

    expect(ensureBootstrap).toHaveBeenCalledWith({
      openClawBin: undefined,
      profile: {
        openMeldProfileId: "agt_demo",
        profileName: "Demo Bot",
      },
      providerRuntimeWorkingDirectory: expectedWorkspaceDir,
    });
    expect(ensureGatewayAgentVisible).toHaveBeenCalledWith({
      agentId: "openmeld-demo-bot",
      openClawBin: undefined,
      providerRuntimeWorkingDirectory: expectedWorkspaceDir,
    });
    expect(result.runtimeContext).toEqual({
      providerRuntimeWorkingDirectory: expectedWorkspaceDir,
    });
  });
});
