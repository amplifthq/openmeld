import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it, vi } from "vitest";
import {
  ensureOpenClawGatewayAgentVisible,
  ensureOpenClawLocalBootstrap,
  OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
} from "../src/provider-hosts/openclaw/local-bootstrap";
import {
  readOpenClawLocalBootstrapState,
  resolveOpenClawLocalBootstrapPaths,
  writeOpenClawLocalBootstrapState,
} from "../src/provider-hosts/openclaw/local-bootstrap-store";
import {
  buildOpenClawBootstrapAgentId,
  buildOpenClawBootstrapIdentityName,
} from "../src/provider-hosts/openclaw/naming";
import { withTempHome } from "./helpers/fs";

const OPENCLAW_BOOTSTRAP_AGENT_ID_RE =
  /^openmeld-yc-pm-host-prod-agt-yc-p-[0-9a-f]{8}$/u;

function createPaths(openMeldProfileId: string) {
  return resolveOpenClawLocalBootstrapPaths({ openMeldProfileId });
}

function createBootstrapAgentId(input: {
  openMeldProfileId: string;
  profileName: string;
}) {
  return buildOpenClawBootstrapAgentId({
    ...input,
    laneKey: "prod",
  });
}

describe("openclaw local bootstrap", () => {
  it("builds a stable OpenMeld-prefixed agent id and identity name", () => {
    expect(
      buildOpenClawBootstrapAgentId({
        openMeldProfileId: "agt_yc_pm_host",
        laneKey: "prod",
        profileName: "YC PM Host",
      })
    ).toMatch(OPENCLAW_BOOTSTRAP_AGENT_ID_RE);
    expect(buildOpenClawBootstrapIdentityName("YC PM Host")).toBe(
      "OpenMeld YC PM Host"
    );
  });

  it("creates a new local bootstrap binding in the OpenMeld-owned provider directory", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt_yc_pm_host";
      const profileName = "YC PM Host";
      const providerRuntimeWorkingDirectory = "/tmp/daemon-workdir";
      const expectedAgentId = createBootstrapAgentId({
        openMeldProfileId,
        profileName,
      });
      const bootstrapPaths = createPaths(openMeldProfileId);
      const openClawRoot = join(home, "openclaw");
      const defaultAgentDir = join(openClawRoot, "agents", "main", "agent");
      const createdAgentDir = join(
        openClawRoot,
        "agents",
        expectedAgentId,
        "agent"
      );
      await mkdir(defaultAgentDir, { recursive: true });
      await mkdir(createdAgentDir, { recursive: true });
      await writeFile(
        join(defaultAgentDir, "auth-profiles.json"),
        "{}",
        "utf8"
      );

      const createAgent = vi.fn().mockResolvedValue(undefined);
      const copyAuthFile = vi.fn().mockResolvedValue(undefined);
      const setIdentity = vi.fn().mockResolvedValue(undefined);
      const listAgents = vi
        .fn()
        .mockResolvedValueOnce([
          {
            agentDir: defaultAgentDir,
            agentId: "main",
            isDefault: true,
            name: "OpenClaw",
            workspace: join(openClawRoot, "workspace"),
          },
        ])
        .mockResolvedValueOnce([
          {
            agentDir: defaultAgentDir,
            agentId: "main",
            isDefault: true,
            name: "OpenClaw",
            workspace: join(openClawRoot, "workspace"),
          },
          {
            agentDir: createdAgentDir,
            agentId: expectedAgentId,
            isDefault: false,
            name: null,
            workspace: providerRuntimeWorkingDirectory,
          },
        ]);

      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory,
          profile: {
            openMeldProfileId,
            profileName,
          },
        },
        {
          createAgent,
          copyAuthFile,
          listAgents,
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity,
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toEqual({
        agentId: expectedAgentId,
        authStatus: "copied",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        created: true,
        resolution: "created",
      });
      expect(createAgent).toHaveBeenCalledWith({
        agentId: expectedAgentId,
        cwd: providerRuntimeWorkingDirectory,
        openClawBin: undefined,
        workspace: providerRuntimeWorkingDirectory,
      });
      expect(copyAuthFile).toHaveBeenCalledWith(
        join(defaultAgentDir, "auth-profiles.json"),
        join(createdAgentDir, "auth-profiles.json")
      );
      expect(setIdentity).toHaveBeenCalledWith({
        agentId: expectedAgentId,
        cwd: providerRuntimeWorkingDirectory,
        identityName: "OpenMeld YC PM Host",
        openClawBin: undefined,
      });
      expect(listAgents).toHaveBeenNthCalledWith(1, {
        cwd: providerRuntimeWorkingDirectory,
        openClawBin: undefined,
      });
      expect(listAgents).toHaveBeenNthCalledWith(2, {
        cwd: providerRuntimeWorkingDirectory,
        openClawBin: undefined,
      });
      await expect(
        readOpenClawLocalBootstrapState({ openMeldProfileId })
      ).resolves.toEqual({
        agentId: expectedAgentId,
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
      });

      const rawState = JSON.parse(
        await readFile(bootstrapPaths.bootstrapPath, "utf8")
      ) as {
        agentId?: string;
        bootstrapVersion?: number;
        v?: number;
      };
      expect(rawState).toEqual({
        agentId: expectedAgentId,
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        v: 1,
      });
    });
  });

  it("creates the destination auth directory before copying official auth state", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt_yc_pm_host";
      const profileName = "YC PM Host";
      const expectedAgentId = createBootstrapAgentId({
        openMeldProfileId,
        profileName,
      });
      const _bootstrapPaths = createPaths(openMeldProfileId);
      const openClawRoot = join(home, "openclaw");
      const defaultAgentDir = join(openClawRoot, "agents", "main", "agent");
      const createdAgentDir = join(
        openClawRoot,
        "agents",
        expectedAgentId,
        "agent"
      );
      await mkdir(defaultAgentDir, { recursive: true });
      await writeFile(
        join(defaultAgentDir, "auth-profiles.json"),
        '{"provider":"openai"}',
        "utf8"
      );

      const copyAuthFile = vi.fn(
        async (sourcePath: string, destinationPath: string) => {
          await copyFile(sourcePath, destinationPath);
        }
      );

      await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile: {
            openMeldProfileId,
            profileName,
          },
        },
        {
          createAgent: vi.fn().mockResolvedValue(undefined),
          copyAuthFile,
          listAgents: vi
            .fn()
            .mockResolvedValueOnce([
              {
                agentDir: defaultAgentDir,
                agentId: "main",
                isDefault: true,
                name: "OpenClaw",
                workspace: join(openClawRoot, "workspace"),
              },
            ])
            .mockResolvedValueOnce([
              {
                agentDir: defaultAgentDir,
                agentId: "main",
                isDefault: true,
                name: "OpenClaw",
                workspace: join(openClawRoot, "workspace"),
              },
              {
                agentDir: createdAgentDir,
                agentId: expectedAgentId,
                isDefault: false,
                name: null,
                workspace: "/tmp/daemon-workdir",
              },
            ]),
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity: vi.fn().mockResolvedValue(undefined),
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(copyAuthFile).toHaveBeenCalledTimes(1);
      await expect(
        readFile(join(createdAgentDir, "auth-profiles.json"), "utf8")
      ).resolves.toBe('{"provider":"openai"}');
    });
  });

  it("treats an EEXIST auth copy race as already present", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt_yc_pm_host";
      const profileName = "YC PM Host";
      const expectedAgentId = createBootstrapAgentId({
        openMeldProfileId,
        profileName,
      });
      const _bootstrapPaths = createPaths(openMeldProfileId);
      const openClawRoot = join(home, "openclaw");
      const defaultAgentDir = join(openClawRoot, "agents", "main", "agent");
      const createdAgentDir = join(
        openClawRoot,
        "agents",
        expectedAgentId,
        "agent"
      );
      await mkdir(defaultAgentDir, { recursive: true });
      await mkdir(createdAgentDir, { recursive: true });
      await writeFile(
        join(defaultAgentDir, "auth-profiles.json"),
        "{}",
        "utf8"
      );

      const copyRaceError = Object.assign(new Error("file already exists"), {
        code: "EEXIST",
      });

      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile: {
            openMeldProfileId,
            profileName,
          },
        },
        {
          createAgent: vi.fn().mockResolvedValue(undefined),
          copyAuthFile: vi.fn().mockRejectedValue(copyRaceError),
          listAgents: vi
            .fn()
            .mockResolvedValueOnce([
              {
                agentDir: defaultAgentDir,
                agentId: "main",
                isDefault: true,
                name: "OpenClaw",
                workspace: join(openClawRoot, "workspace"),
              },
            ])
            .mockResolvedValueOnce([
              {
                agentDir: defaultAgentDir,
                agentId: "main",
                isDefault: true,
                name: "OpenClaw",
                workspace: join(openClawRoot, "workspace"),
              },
              {
                agentDir: createdAgentDir,
                agentId: expectedAgentId,
                isDefault: false,
                name: null,
                workspace: "/tmp/daemon-workdir",
              },
            ]),
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity: vi.fn().mockResolvedValue(undefined),
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toMatchObject({
        agentId: expectedAgentId,
        authStatus: "present",
      });
    });
  });

  it("is idempotent, only syncs visible identity after rename, and does not recreate the agent", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt_demo";
      const _bootstrapPaths = createPaths(openMeldProfileId);
      await writeOpenClawLocalBootstrapState({
        openMeldProfileId,
        state: {
          agentId: "openmeld-demo-bot",
          bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        },
      });

      const createAgent = vi.fn().mockResolvedValue(undefined);
      const copyAuthFile = vi.fn().mockResolvedValue(undefined);
      const setIdentity = vi.fn().mockResolvedValue(undefined);
      const listAgents = vi.fn().mockResolvedValue([
        {
          agentDir: "/tmp/openclaw/agents/openmeld-demo-bot/agent",
          agentId: "openmeld-demo-bot",
          isDefault: false,
          name: "OpenMeld Demo Bot",
          workspace: "/tmp/daemon-workdir",
        },
      ]);

      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile: {
            openMeldProfileId,
            profileName: "Renamed Demo Bot",
          },
        },
        {
          createAgent,
          copyAuthFile,
          listAgents,
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity,
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toEqual({
        agentId: "openmeld-demo-bot",
        authStatus: "source_missing",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        created: false,
        resolution: "reused",
      });
      expect(createAgent).not.toHaveBeenCalled();
      expect(copyAuthFile).not.toHaveBeenCalled();
      expect(setIdentity).toHaveBeenCalledWith({
        agentId: "openmeld-demo-bot",
        cwd: "/tmp/daemon-workdir",
        identityName: "OpenMeld Renamed Demo Bot",
        openClawBin: undefined,
      });
    });
  });

  it("adopts the listed agent when create reports that the agent already exists", async () => {
    await withTempHome(async () => {
      const profile = {
        openMeldProfileId: "agt_demo",
        profileName: "Demo Bot",
      };
      const expectedAgentId = createBootstrapAgentId(profile);
      const _bootstrapPaths = createPaths(profile.openMeldProfileId);

      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile,
        },
        {
          createAgent: vi
            .fn()
            .mockRejectedValue(
              new Error(`Agent "${expectedAgentId}" already exists.`)
            ),
          copyAuthFile: vi.fn(),
          listAgents: vi.fn().mockResolvedValue([
            {
              agentDir: `/tmp/openclaw/agents/${expectedAgentId}/agent`,
              agentId: expectedAgentId,
              isDefault: false,
              name: "OpenMeld Demo Bot",
              workspace: "/tmp/daemon-workdir",
            },
          ]),
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity: vi.fn().mockResolvedValue(undefined),
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toEqual({
        agentId: expectedAgentId,
        authStatus: "source_missing",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        created: false,
        resolution: "adopted",
      });
    });
  });

  it("serializes concurrent bootstrap calls for the same profile", async () => {
    await withTempHome(async (home) => {
      const profile = {
        openMeldProfileId: "agt_demo",
        profileName: "Demo Bot",
      };
      const expectedAgentId = createBootstrapAgentId(profile);
      const _bootstrapPaths = createPaths(profile.openMeldProfileId);
      const openClawRoot = join(home, "openclaw");
      const defaultAgentDir = join(openClawRoot, "agents", "main", "agent");
      const createdAgentDir = join(
        openClawRoot,
        "agents",
        expectedAgentId,
        "agent"
      );
      await mkdir(defaultAgentDir, { recursive: true });

      const listedAgents: Array<{
        agentDir: string;
        agentId: string;
        isDefault: boolean;
        name: string | null;
        workspace: string;
      }> = [
        {
          agentDir: defaultAgentDir,
          agentId: "main",
          isDefault: true,
          name: "OpenClaw",
          workspace: join(openClawRoot, "workspace"),
        },
      ];

      const createAgent = vi.fn(async () => {
        await mkdir(createdAgentDir, { recursive: true });
        await delay(50);
        listedAgents.push({
          agentDir: createdAgentDir,
          agentId: expectedAgentId,
          isDefault: false,
          name: "OpenMeld Demo Bot",
          workspace: "/tmp/daemon-workdir",
        });
      });

      const results = await Promise.all([
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile,
          },
          {
            createAgent,
            copyAuthFile: vi.fn(),
            listAgents: vi.fn(async () => listedAgents),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi.fn().mockResolvedValue(undefined),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        ),
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile,
          },
          {
            createAgent,
            copyAuthFile: vi.fn(),
            listAgents: vi.fn(async () => listedAgents),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi.fn().mockResolvedValue(undefined),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        ),
      ]);

      expect(createAgent).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(2);
      expect(results).toEqual(
        expect.arrayContaining([
          {
            agentId: expectedAgentId,
            authStatus: "source_missing",
            bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
            created: true,
            resolution: "created",
          },
          {
            agentId: expectedAgentId,
            authStatus: "source_missing",
            bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
            created: false,
            resolution: "reused",
          },
        ])
      );
    });
  });

  it("preserves non-recoverable create failures", async () => {
    await withTempHome(async () => {
      await expect(
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile: {
              openMeldProfileId: "agt_demo",
              profileName: "Demo Bot",
            },
          },
          {
            createAgent: vi
              .fn()
              .mockRejectedValue(new Error("openclaw add failed")),
            copyAuthFile: vi.fn(),
            listAgents: vi.fn().mockResolvedValue([]),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi.fn(),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        )
      ).rejects.toThrow("openclaw add failed");
    });
  });

  it("adopts an existing exact-workspace agent when bootstrap metadata is missing", async () => {
    await withTempHome(async (home) => {
      const profile = {
        openMeldProfileId: "agt_demo",
        profileName: "Demo Bot",
      };
      const _bootstrapPaths = createPaths(profile.openMeldProfileId);
      const openClawRoot = join(home, "openclaw");
      const adoptedAgentDir = join(
        openClawRoot,
        "agents",
        "adopted-agent",
        "agent"
      );
      const defaultAgentDir = join(openClawRoot, "agents", "main", "agent");
      await mkdir(defaultAgentDir, { recursive: true });
      await mkdir(adoptedAgentDir, { recursive: true });

      const createAgent = vi.fn().mockResolvedValue(undefined);
      const setIdentity = vi.fn().mockResolvedValue(undefined);

      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile,
        },
        {
          createAgent,
          copyAuthFile: vi.fn().mockResolvedValue(undefined),
          listAgents: vi.fn().mockResolvedValue([
            {
              agentDir: defaultAgentDir,
              agentId: "main",
              isDefault: true,
              name: "OpenClaw",
              workspace: join(openClawRoot, "workspace"),
            },
            {
              agentDir: adoptedAgentDir,
              agentId: "adopted-agent",
              isDefault: false,
              name: "OpenMeld Demo Bot",
              workspace: "/tmp/daemon-workdir",
            },
          ]),
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity,
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toEqual({
        agentId: "adopted-agent",
        authStatus: "source_missing",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        created: false,
        resolution: "adopted",
      });
      expect(createAgent).not.toHaveBeenCalled();
      await expect(
        readOpenClawLocalBootstrapState({
          openMeldProfileId: profile.openMeldProfileId,
        })
      ).resolves.toEqual({
        agentId: "adopted-agent",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
      });
      expect(setIdentity).toHaveBeenCalledWith({
        agentId: "adopted-agent",
        cwd: "/tmp/daemon-workdir",
        identityName: "OpenMeld Demo Bot",
        openClawBin: undefined,
      });
    });
  });

  it("fails clearly when multiple listed agents match the expected workspace", async () => {
    await withTempHome(async () => {
      const profile = {
        openMeldProfileId: "agt_demo",
        profileName: "Demo Bot",
      };
      const _bootstrapPaths = createPaths(profile.openMeldProfileId);
      const createAgent = vi.fn().mockResolvedValue(undefined);

      await expect(
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile,
          },
          {
            createAgent,
            copyAuthFile: vi.fn().mockResolvedValue(undefined),
            listAgents: vi.fn().mockResolvedValue([
              {
                agentDir: "/tmp/openclaw/agents/agent-a/agent",
                agentId: "agent-a",
                isDefault: false,
                name: "Agent A",
                workspace: "/tmp/daemon-workdir",
              },
              {
                agentDir: "/tmp/openclaw/agents/agent-b/agent",
                agentId: "agent-b",
                isDefault: false,
                name: "Agent B",
                workspace: "/tmp/daemon-workdir",
              },
            ]),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi.fn().mockResolvedValue(undefined),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        )
      ).rejects.toMatchObject({
        code: "openclaw.bootstrap.workspace_ambiguous",
      });
      expect(createAgent).not.toHaveBeenCalled();
    });
  });

  it("does not overwrite existing auth for the destination agent", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt_demo";
      const profileName = "Demo Bot";
      const expectedAgentId = createBootstrapAgentId({
        openMeldProfileId,
        profileName,
      });
      const _bootstrapPaths = createPaths(openMeldProfileId);
      const openClawRoot = join(home, "openclaw");
      const defaultAgentDir = join(openClawRoot, "agents", "main", "agent");
      const createdAgentDir = join(
        openClawRoot,
        "agents",
        expectedAgentId,
        "agent"
      );
      await mkdir(defaultAgentDir, { recursive: true });
      await mkdir(createdAgentDir, { recursive: true });
      await writeFile(
        join(defaultAgentDir, "auth-profiles.json"),
        "{}",
        "utf8"
      );
      await writeFile(
        join(createdAgentDir, "auth-profiles.json"),
        "{}",
        "utf8"
      );

      const copyAuthFile = vi.fn().mockResolvedValue(undefined);
      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile: {
            openMeldProfileId,
            profileName,
          },
        },
        {
          createAgent: vi.fn().mockResolvedValue(undefined),
          copyAuthFile,
          listAgents: vi
            .fn()
            .mockResolvedValueOnce([
              {
                agentDir: defaultAgentDir,
                agentId: "main",
                isDefault: true,
                name: "OpenClaw",
                workspace: join(openClawRoot, "workspace"),
              },
            ])
            .mockResolvedValueOnce([
              {
                agentDir: defaultAgentDir,
                agentId: "main",
                isDefault: true,
                name: "OpenClaw",
                workspace: join(openClawRoot, "workspace"),
              },
              {
                agentDir: createdAgentDir,
                agentId: expectedAgentId,
                isDefault: false,
                name: null,
                workspace: "/tmp/daemon-workdir",
              },
            ]),
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity: vi.fn().mockResolvedValue(undefined),
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toEqual({
        agentId: expectedAgentId,
        authStatus: "present",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        created: true,
        resolution: "created",
      });
      expect(copyAuthFile).not.toHaveBeenCalled();
    });
  });

  it("recreates the bound agent when bootstrap metadata exists and the OpenMeld workspace is empty", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt_demo";
      const _bootstrapPaths = createPaths(openMeldProfileId);
      const openClawRoot = join(home, "openclaw");
      const defaultAgentDir = join(openClawRoot, "agents", "main", "agent");
      const recreatedAgentDir = join(
        openClawRoot,
        "agents",
        "openmeld-demo-bot",
        "agent"
      );
      await mkdir(defaultAgentDir, { recursive: true });
      await mkdir(recreatedAgentDir, { recursive: true });
      await writeOpenClawLocalBootstrapState({
        openMeldProfileId,
        state: {
          agentId: "openmeld-demo-bot",
          bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        },
      });

      const createAgent = vi.fn().mockResolvedValue(undefined);
      const setIdentity = vi.fn().mockResolvedValue(undefined);
      const listAgents = vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            agentDir: recreatedAgentDir,
            agentId: "openmeld-demo-bot",
            isDefault: false,
            name: null,
            workspace: "/tmp/daemon-workdir",
          },
          {
            agentDir: defaultAgentDir,
            agentId: "main",
            isDefault: true,
            name: "OpenClaw",
            workspace: join(openClawRoot, "workspace"),
          },
        ]);

      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile: {
            openMeldProfileId,
            profileName: "Demo Bot",
          },
        },
        {
          createAgent,
          copyAuthFile: vi.fn(),
          listAgents,
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity,
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toEqual({
        agentId: "openmeld-demo-bot",
        authStatus: "source_missing",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        created: true,
        resolution: "recreated",
      });
      expect(createAgent).toHaveBeenCalledWith({
        agentId: "openmeld-demo-bot",
        cwd: "/tmp/daemon-workdir",
        openClawBin: undefined,
        workspace: "/tmp/daemon-workdir",
      });
      expect(setIdentity).toHaveBeenCalledWith({
        agentId: "openmeld-demo-bot",
        cwd: "/tmp/daemon-workdir",
        identityName: "OpenMeld Demo Bot",
        openClawBin: undefined,
      });
    });
  });

  it("fails clearly when bootstrap metadata points to a missing agent but the OpenMeld workspace is already occupied by another agent", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt_demo";
      const _bootstrapPaths = createPaths(openMeldProfileId);
      await writeOpenClawLocalBootstrapState({
        openMeldProfileId,
        state: {
          agentId: "openmeld-demo-bot",
          bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        },
      });

      await expect(
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile: {
              openMeldProfileId,
              profileName: "Demo Bot",
            },
          },
          {
            createAgent: vi.fn(),
            copyAuthFile: vi.fn(),
            listAgents: vi.fn().mockResolvedValue([
              {
                agentDir: "/tmp/openclaw/agents/adopted-agent/agent",
                agentId: "adopted-agent",
                isDefault: false,
                name: "OpenMeld Demo Bot",
                workspace: "/tmp/daemon-workdir",
              },
            ]),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi.fn(),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        )
      ).rejects.toMatchObject({
        code: "openclaw.bootstrap.binding_conflict",
      });
    });
  });

  it("fails clearly when bootstrap metadata uses an unsupported file version", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt_demo";
      const bootstrapPaths = createPaths(openMeldProfileId);
      await mkdir(bootstrapPaths.profileRoot, { recursive: true });
      await writeFile(
        bootstrapPaths.bootstrapPath,
        `${JSON.stringify({
          agentId: "openmeld-demo-bot",
          bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
          v: OPENCLAW_LOCAL_BOOTSTRAP_VERSION + 1,
        })}\n`,
        "utf8"
      );

      await expect(
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile: {
              openMeldProfileId,
              profileName: "Demo Bot",
            },
          },
          {
            createAgent: vi.fn(),
            copyAuthFile: vi.fn(),
            listAgents: vi.fn().mockResolvedValue([]),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi.fn(),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        )
      ).rejects.toMatchObject({
        code: "openclaw.bootstrap.version_mismatch",
      });
      await expect(
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile: {
              openMeldProfileId,
              profileName: "Demo Bot",
            },
          },
          {
            createAgent: vi.fn(),
            copyAuthFile: vi.fn(),
            listAgents: vi.fn().mockResolvedValue([]),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi.fn(),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        )
      ).rejects.toThrow(
        `expected v${OPENCLAW_LOCAL_BOOTSTRAP_VERSION}, found v${OPENCLAW_LOCAL_BOOTSTRAP_VERSION + 1}`
      );
    });
  });

  it("adopts a uniquely matching OpenMeld workspace agent when bootstrap metadata is invalid", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt_demo";
      const bootstrapPaths = createPaths(openMeldProfileId);
      await mkdir(bootstrapPaths.profileRoot, { recursive: true });
      await writeFile(
        bootstrapPaths.bootstrapPath,
        `${JSON.stringify({ bootstrapVersion: 1, v: 1 })}\n`,
        "utf8"
      );

      const setIdentity = vi.fn().mockResolvedValue(undefined);

      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile: {
            openMeldProfileId,
            profileName: "Demo Bot",
          },
        },
        {
          createAgent: vi.fn(),
          copyAuthFile: vi.fn(),
          listAgents: vi.fn().mockResolvedValue([
            {
              agentDir: "/tmp/openclaw/agents/adopted-agent/agent",
              agentId: "adopted-agent",
              isDefault: false,
              name: "OpenMeld Demo Bot",
              workspace: "/tmp/daemon-workdir",
            },
          ]),
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity,
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toEqual({
        agentId: "adopted-agent",
        authStatus: "source_missing",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        created: false,
        resolution: "adopted",
      });
      await expect(
        readOpenClawLocalBootstrapState({ openMeldProfileId })
      ).resolves.toEqual({
        agentId: "adopted-agent",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
      });
      expect(setIdentity).toHaveBeenCalledWith({
        agentId: "adopted-agent",
        cwd: "/tmp/daemon-workdir",
        identityName: "OpenMeld Demo Bot",
        openClawBin: undefined,
      });
    });
  });

  it("adopts a uniquely matching OpenMeld workspace agent when bootstrap metadata uses an unsupported file version", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt_demo";
      const bootstrapPaths = createPaths(openMeldProfileId);
      await mkdir(bootstrapPaths.profileRoot, { recursive: true });
      await writeFile(
        bootstrapPaths.bootstrapPath,
        `${JSON.stringify({
          agentId: "openmeld-demo-bot",
          bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
          v: OPENCLAW_LOCAL_BOOTSTRAP_VERSION + 1,
        })}\n`,
        "utf8"
      );

      const result = await ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
          profile: {
            openMeldProfileId,
            profileName: "Demo Bot",
          },
        },
        {
          createAgent: vi.fn(),
          copyAuthFile: vi.fn(),
          listAgents: vi.fn().mockResolvedValue([
            {
              agentDir: "/tmp/openclaw/agents/adopted-agent/agent",
              agentId: "adopted-agent",
              isDefault: false,
              name: "OpenMeld Demo Bot",
              workspace: "/tmp/daemon-workdir",
            },
          ]),
          readBootstrapState: readOpenClawLocalBootstrapState,
          setIdentity: vi.fn().mockResolvedValue(undefined),
          writeBootstrapState: writeOpenClawLocalBootstrapState,
        }
      );

      expect(result).toEqual({
        agentId: "adopted-agent",
        authStatus: "source_missing",
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        created: false,
        resolution: "adopted",
      });
    });
  });

  it("fails clearly when the bound agent uses a different workspace", async () => {
    await withTempHome(async () => {
      const openMeldProfileId = "agt_demo";
      await writeOpenClawLocalBootstrapState({
        openMeldProfileId,
        state: {
          agentId: "openmeld-demo-bot",
          bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
        },
      });

      await expect(
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile: {
              openMeldProfileId,
              profileName: "Demo Bot",
            },
          },
          {
            createAgent: vi.fn(),
            copyAuthFile: vi.fn(),
            listAgents: vi.fn().mockResolvedValue([
              {
                agentDir: "/tmp/openclaw/agents/openmeld-demo-bot/agent",
                agentId: "openmeld-demo-bot",
                isDefault: false,
                name: "OpenMeld Demo Bot",
                workspace: "/tmp/not-owned-by-openmeld",
              },
            ]),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi.fn(),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        )
      ).rejects.toMatchObject({
        code: "openclaw.bootstrap.workspace_mismatch",
      });
    });
  });

  it("keeps the binding after post-create bootstrap failure so the next run can retry", async () => {
    await withTempHome(async (home) => {
      const openMeldProfileId = "agt_demo";
      const profileName = "Demo Bot";
      const expectedAgentId = createBootstrapAgentId({
        openMeldProfileId,
        profileName,
      });
      const _bootstrapPaths = createPaths(openMeldProfileId);
      const openClawRoot = join(home, "openclaw");
      const defaultAgentDir = join(openClawRoot, "agents", "main", "agent");
      const createdAgentDir = join(
        openClawRoot,
        "agents",
        expectedAgentId,
        "agent"
      );
      await mkdir(defaultAgentDir, { recursive: true });
      await writeFile(
        join(defaultAgentDir, "auth-profiles.json"),
        "{}",
        "utf8"
      );

      await expect(
        ensureOpenClawLocalBootstrap(
          {
            providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
            profile: {
              openMeldProfileId,
              profileName,
            },
          },
          {
            createAgent: vi.fn().mockResolvedValue(undefined),
            copyAuthFile: vi.fn().mockResolvedValue(undefined),
            listAgents: vi
              .fn()
              .mockResolvedValueOnce([
                {
                  agentDir: defaultAgentDir,
                  agentId: "main",
                  isDefault: true,
                  name: "OpenClaw",
                  workspace: join(openClawRoot, "workspace"),
                },
              ])
              .mockResolvedValueOnce([
                {
                  agentDir: defaultAgentDir,
                  agentId: "main",
                  isDefault: true,
                  name: "OpenClaw",
                  workspace: join(openClawRoot, "workspace"),
                },
                {
                  agentDir: createdAgentDir,
                  agentId: expectedAgentId,
                  isDefault: false,
                  name: null,
                  workspace: "/tmp/daemon-workdir",
                },
              ]),
            readBootstrapState: readOpenClawLocalBootstrapState,
            setIdentity: vi
              .fn()
              .mockRejectedValue(new Error("identity sync failed")),
            writeBootstrapState: writeOpenClawLocalBootstrapState,
          }
        )
      ).rejects.toThrow("identity sync failed");

      await expect(
        readOpenClawLocalBootstrapState({ openMeldProfileId })
      ).resolves.toEqual({
        agentId: expectedAgentId,
        bootstrapVersion: OPENCLAW_LOCAL_BOOTSTRAP_VERSION,
      });
    });
  });

  it("rejects explicit invalid providerRuntimeWorkingDirectory values", async () => {
    const deps = {
      createAgent: vi.fn(),
      copyAuthFile: vi.fn(),
      listAgents: vi.fn(),
      readBootstrapState: vi.fn(),
      setIdentity: vi.fn(),
      writeBootstrapState: vi.fn(),
    };

    await expect(
      ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: "",
          profile: {
            openMeldProfileId: "agt_demo",
            profileName: "Demo Bot",
          },
        },
        deps
      )
    ).rejects.toMatchObject({
      code: "openclaw.bootstrap.invalid_working_directory",
    });

    await expect(
      ensureOpenClawLocalBootstrap(
        {
          providerRuntimeWorkingDirectory: `/tmp/${"x".repeat(4097)}`,
          profile: {
            openMeldProfileId: "agt_demo",
            profileName: "Demo Bot",
          },
        },
        deps
      )
    ).rejects.toMatchObject({
      code: "openclaw.bootstrap.invalid_working_directory",
    });

    await expect(
      ensureOpenClawLocalBootstrap(
        {
          profile: {
            openMeldProfileId: "agt_demo",
            profileName: "Demo Bot",
          },
        },
        deps
      )
    ).rejects.toMatchObject({
      code: "openclaw.bootstrap.invalid_working_directory",
    });

    expect(deps.listAgents).not.toHaveBeenCalled();
    expect(deps.createAgent).not.toHaveBeenCalled();
  });

  it("accepts gateway visibility immediately when the running gateway already sees the agent", async () => {
    const listGatewayAgents = vi.fn().mockResolvedValue([
      {
        agentId: "openmeld-demo-bot",
        identityName: "OpenMeld Demo Bot",
        name: "openmeld-demo-bot",
      },
    ]);
    const restartGateway = vi.fn().mockResolvedValue(undefined);

    const result = await ensureOpenClawGatewayAgentVisible(
      {
        agentId: "openmeld-demo-bot",
        providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
      },
      {
        listGatewayAgents,
        restartGateway,
      }
    );

    expect(result).toEqual({
      agentId: "openmeld-demo-bot",
      gatewayRestartAttempted: false,
      gatewayVisibility: "visible",
    });
    expect(restartGateway).not.toHaveBeenCalled();
  });

  it("restarts the gateway once when the bootstrapped agent is initially invisible", async () => {
    const listGatewayAgents = vi
      .fn()
      .mockResolvedValueOnce([
        {
          agentId: "main",
          identityName: "OpenClaw",
          name: "main",
        },
      ])
      .mockResolvedValueOnce([
        {
          agentId: "openmeld-demo-bot",
          identityName: "OpenMeld Demo Bot",
          name: "openmeld-demo-bot",
        },
      ]);
    const restartGateway = vi.fn().mockResolvedValue(undefined);

    const result = await ensureOpenClawGatewayAgentVisible(
      {
        agentId: "openmeld-demo-bot",
        providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
      },
      {
        listGatewayAgents,
        restartGateway,
      }
    );

    expect(result).toEqual({
      agentId: "openmeld-demo-bot",
      gatewayRestartAttempted: true,
      gatewayVisibility: "visible_after_restart",
    });
    expect(restartGateway).toHaveBeenCalledTimes(1);
  });

  it("fails clearly when the agent is still invisible after one official gateway restart", async () => {
    const listGatewayAgents = vi.fn().mockResolvedValue([
      {
        agentId: "main",
        identityName: "OpenClaw",
        name: "main",
      },
    ]);
    const restartGateway = vi.fn().mockResolvedValue(undefined);

    await expect(
      ensureOpenClawGatewayAgentVisible(
        {
          agentId: "openmeld-demo-bot",
          providerRuntimeWorkingDirectory: "/tmp/daemon-workdir",
        },
        {
          listGatewayAgents,
          restartGateway,
        }
      )
    ).rejects.toMatchObject({
      code: "openclaw.gateway.agent_not_visible",
      diagnostics: {
        agentId: "openmeld-demo-bot",
        gatewayRestartAttempted: true,
        gatewayVisibility: "missing_after_restart",
      },
    });
  });
});
