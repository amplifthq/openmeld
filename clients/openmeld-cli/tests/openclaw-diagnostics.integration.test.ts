import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { resolveOpenClawLocalDiagnostics } from "../src/provider-hosts/openclaw/diagnostics";
import { resolveOpenClawLocalBootstrapPaths } from "../src/provider-hosts/openclaw/local-bootstrap-store";
import { OPENCLAW_AUTH_PROFILE_FILENAME } from "../src/provider-hosts/openclaw/local-state";
import { withTempHome } from "./helpers/fs";

describe("resolveOpenClawLocalDiagnostics", () => {
  it("does not trigger shared runtime preparation in inspect mode", async () => {
    await withTempHome(async () => {
      const profile = {
        openMeldProfileId: "agt-openclaw",
        profileName: "OpenClaw Phase One",
      };
      const providerRuntimeWorkingDirectory = "/tmp/openclaw-profile-workspace";
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: profile.openMeldProfileId,
      });
      const agentDir = join(paths.profileRoot, "agent-store");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, OPENCLAW_AUTH_PROFILE_FILENAME),
        "{}\n",
        "utf8"
      );

      const prepareRuntime = vi.fn();
      const diagnostics = await resolveOpenClawLocalDiagnostics(
        {
          mode: "inspect",
          profile,
          providerRuntimeWorkingDirectory,
        },
        {
          fetchGatewayHealth: vi.fn().mockResolvedValue({ ok: true }),
          listAgents: vi.fn().mockResolvedValue([
            {
              agentDir,
              agentId: "openmeld-openclaw-phase-one",
              isDefault: false,
              name: "OpenMeld OpenClaw Phase One",
              workspace: providerRuntimeWorkingDirectory,
            },
          ]),
          listGatewayAgents: vi.fn().mockResolvedValue([
            {
              agentId: "openmeld-openclaw-phase-one",
              identityName: "OpenMeld OpenClaw Phase One",
              name: "OpenMeld OpenClaw Phase One",
            },
          ]),
          prepareRuntime,
          readBootstrapState: vi.fn().mockResolvedValue({
            agentId: "openmeld-openclaw-phase-one",
            bootstrapVersion: 1,
          }),
        }
      );

      expect(prepareRuntime).not.toHaveBeenCalled();
      expect(diagnostics).toMatchObject({
        agentId: "openmeld-openclaw-phase-one",
        authStatus: "present",
        bootstrapResolution: null,
        bootstrapStatus: "healthy",
        gatewayHealth: "healthy",
        gatewayVisibility: "visible",
        workspaceDir: providerRuntimeWorkingDirectory,
      });
    });
  });

  it("reuses shared runtime preparation in repair mode", async () => {
    await withTempHome(async () => {
      const profile = {
        openMeldProfileId: "agt-openclaw",
        profileName: "OpenClaw Phase One",
      };
      const prepareRuntime = vi.fn().mockResolvedValue({
        envOverrides: {
          OPENMELD_DAEMON_RUNTIME_OPENCLAW_AGENT_ID:
            "openmeld-openclaw-phase-one",
        },
        preparationDetails: {
          bootstrap: {
            agentId: "openmeld-openclaw-phase-one",
            authStatus: "copied",
            bootstrapVersion: 1,
            created: false,
            resolution: "adopted",
          },
          kind: "openclaw",
          openClawGatewayVisibility: {
            agentId: "openmeld-openclaw-phase-one",
            gatewayRestartAttempted: false,
            gatewayVisibility: "visible",
          },
        },
        runtimeContext: {
          providerRuntimeWorkingDirectory: "/tmp/openclaw-workspace",
        },
      });

      const diagnostics = await resolveOpenClawLocalDiagnostics(
        {
          mode: "repair",
          profile,
          providerRuntimeWorkingDirectory: "/tmp/openclaw-daemon",
        },
        {
          fetchGatewayHealth: vi.fn(),
          listAgents: vi.fn(),
          listGatewayAgents: vi.fn(),
          prepareRuntime,
          readBootstrapState: vi.fn(),
        }
      );

      expect(prepareRuntime).toHaveBeenCalledWith({
        agentControllerRef: "builtin:openclaw",
        daemonWorkingDirectory: "/tmp/openclaw-daemon",
        mode: "reply_readiness",
        openClawBin: undefined,
        profileName: "OpenClaw Phase One",
        runtimeContext: {
          providerRuntimeWorkingDirectory: "/tmp/openclaw-daemon",
        },
        targetProfileId: "agt-openclaw",
      });
      expect(diagnostics).toMatchObject({
        agentId: "openmeld-openclaw-phase-one",
        authStatus: "copied",
        bootstrapResolution: "adopted",
        bootstrapStatus: "healthy",
        gatewayHealth: "healthy",
        gatewayVisibility: "visible",
        workspaceDir: "/tmp/openclaw-workspace",
      });
    });
  });

  it("maps shared runtime preparation gateway failures into diagnostics state", async () => {
    await withTempHome(async () => {
      const profile = {
        openMeldProfileId: "agt-openclaw",
        profileName: "OpenClaw Phase One",
      };
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: profile.openMeldProfileId,
      });
      const agentDir = join(paths.profileRoot, "agent-store");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, OPENCLAW_AUTH_PROFILE_FILENAME),
        "{}\n",
        "utf8"
      );

      const diagnostics = await resolveOpenClawLocalDiagnostics(
        {
          mode: "repair",
          profile,
          providerRuntimeWorkingDirectory: "/tmp/openclaw-daemon",
        },
        {
          fetchGatewayHealth: vi.fn(),
          listAgents: vi.fn().mockResolvedValue([
            {
              agentDir,
              agentId: "openmeld-openclaw-phase-one",
              isDefault: false,
              name: "OpenMeld OpenClaw Phase One",
              workspace: "/tmp/openclaw-daemon",
            },
          ]),
          listGatewayAgents: vi.fn(),
          prepareRuntime: vi.fn().mockRejectedValue(
            Object.assign(new Error("Gateway is offline"), {
              code: "controller.gateway.unhealthy",
              openClawGatewayVisibility: {
                agentId: "openmeld-openclaw-phase-one",
                gatewayRestartAttempted: true,
                gatewayVisibility: "missing_after_restart",
              },
              providerErrorCode: "openclaw.gateway.agent_not_visible",
            })
          ),
          readBootstrapState: vi.fn().mockResolvedValue({
            agentId: "openmeld-openclaw-phase-one",
            bootstrapVersion: 1,
          }),
        }
      );

      expect(diagnostics).toMatchObject({
        agentId: "openmeld-openclaw-phase-one",
        bootstrapStatus: "healthy",
        errorCode: "controller.gateway.unhealthy",
        gatewayHealth: "healthy",
        gatewayVisibility: "not_visible",
        message: "Gateway is offline",
      });
    });
  });

  it("preserves the original repair error when bootstrap inspection has no specific diagnosis", async () => {
    await withTempHome(async () => {
      const profile = {
        openMeldProfileId: "agt-openclaw",
        profileName: "OpenClaw Phase One",
      };
      const paths = resolveOpenClawLocalBootstrapPaths({
        openMeldProfileId: profile.openMeldProfileId,
      });
      const agentDir = join(paths.profileRoot, "agent-store");
      await mkdir(agentDir, { recursive: true });
      await writeFile(
        join(agentDir, OPENCLAW_AUTH_PROFILE_FILENAME),
        "{}\n",
        "utf8"
      );

      const diagnostics = await resolveOpenClawLocalDiagnostics(
        {
          mode: "repair",
          profile,
          providerRuntimeWorkingDirectory: "/tmp/openclaw-daemon",
        },
        {
          fetchGatewayHealth: vi.fn(),
          listAgents: vi.fn().mockResolvedValue([
            {
              agentDir,
              agentId: "openmeld-openclaw-phase-one",
              isDefault: false,
              name: "OpenMeld OpenClaw Phase One",
              workspace: "/tmp/openclaw-daemon",
            },
          ]),
          listGatewayAgents: vi.fn(),
          prepareRuntime: vi.fn().mockRejectedValue(
            Object.assign(new Error("repair preparation exploded"), {
              code: "openclaw.prepare.failed",
            })
          ),
          readBootstrapState: vi.fn().mockResolvedValue({
            agentId: "openmeld-openclaw-phase-one",
            bootstrapVersion: 1,
          }),
        }
      );

      expect(diagnostics).toMatchObject({
        agentId: "openmeld-openclaw-phase-one",
        bootstrapStatus: "healthy",
        errorCode: "openclaw.prepare.failed",
        gatewayHealth: "unhealthy",
        gatewayVisibility: "not_checked",
        message: "repair preparation exploded",
      });
    });
  });

  it("surfaces listAgents failures instead of treating them as an empty inventory", async () => {
    await withTempHome(async () => {
      const profile = {
        openMeldProfileId: "agt-openclaw",
        profileName: "OpenClaw Phase One",
      };

      await expect(
        resolveOpenClawLocalDiagnostics(
          {
            mode: "inspect",
            profile,
            providerRuntimeWorkingDirectory: "/tmp/openclaw-daemon",
          },
          {
            fetchGatewayHealth: vi.fn().mockResolvedValue({ ok: true }),
            listAgents: vi
              .fn()
              .mockRejectedValue(new Error("openclaw agents list failed")),
            listGatewayAgents: vi.fn(),
            prepareRuntime: vi.fn(),
            readBootstrapState: vi.fn().mockResolvedValue(null),
          }
        )
      ).rejects.toThrow("openclaw agents list failed");
    });
  });
});
