import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alignRuntimeConfigStorage,
  createDefaultRuntimeAgentControllerSettings,
  DEFAULT_RUNTIME_DAEMON_GLOBAL_CONCURRENCY,
  DEFAULT_RUNTIME_DAEMON_QUEUE_MAX,
  getConfiguredBaseUrl,
  getConfiguredDaemonDispatchLimits,
  getConfiguredDeviceRuntimeState,
  getConfiguredSkillsConfig,
  getConfiguredStartV1OnboardingState,
  resolveRuntimeSkillsCustomTargetId,
  setConfiguredBaseUrl,
  setConfiguredDeviceRuntimeState,
  setConfiguredSkillsConfig,
  updateConfiguredStartV1OnboardingState,
} from "../src/config/runtime-config";
import { withTempHome } from "./helpers/fs";

describe("runtime config writes", () => {
  it("defaults dev-local and canary controllers to stream mode", () => {
    const previousPreset = process.env.OPENMELD_ENV_PRESET;
    try {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      expect(
        createDefaultRuntimeAgentControllerSettings("codex").streamingMode
      ).toBe("stream");

      process.env.OPENMELD_ENV_PRESET = "canary";
      expect(
        createDefaultRuntimeAgentControllerSettings("codex").streamingMode
      ).toBe("stream");

      process.env.OPENMELD_ENV_PRESET = "prod";
      expect(
        createDefaultRuntimeAgentControllerSettings("codex").streamingMode
      ).toBe("final");
    } finally {
      if (previousPreset === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
      } else {
        process.env.OPENMELD_ENV_PRESET = previousPreset;
      }
    }
  });

  it("preserves both fields during concurrent setter writes", async () => {
    await withTempHome(async () => {
      for (let index = 0; index < 8; index += 1) {
        await Promise.all([
          setConfiguredBaseUrl(`https://gateway-${index}.example.com/`),
          setConfiguredSkillsConfig({
            storeDir: `/tmp/skills-${index}`,
          }),
        ]);

        expect(await getConfiguredBaseUrl()).toBe(
          `https://gateway-${index}.example.com`
        );
        expect((await getConfiguredSkillsConfig())?.storeDir).toBe(
          `/tmp/skills-${index}`
        );
      }
    });
  });

  it("preserves existing fields across setter updates", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        storeDir: "/tmp/skills",
      });
      await setConfiguredBaseUrl("https://gateway.example.com/");

      expect(await getConfiguredBaseUrl()).toBe("https://gateway.example.com");
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe("/tmp/skills");

      await setConfiguredSkillsConfig({
        storeDir: "/tmp/skills-next",
      });
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe(
        "/tmp/skills-next"
      );
      expect(await getConfiguredBaseUrl()).toBe("https://gateway.example.com");
    });
  });

  it("preserves baseUrl and skills when writing agents config", async () => {
    await withTempHome(async () => {
      await setConfiguredBaseUrl("https://gateway.example.com/");
      await setConfiguredSkillsConfig({
        storeDir: "/tmp/skills",
      });

      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      expect(await getConfiguredBaseUrl()).toBe("https://gateway.example.com");
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe("/tmp/skills");
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]?.agentId
      ).toBe("codex");
    });
  });

  it("stores device runtime state in device/agent-runtime.json", async () => {
    await withTempHome(async (home) => {
      await setConfiguredBaseUrl("https://gateway.example.com/");
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      const configRaw = JSON.parse(
        await readFile(
          join(home, ".openmeld", "device", "agent-runtime.json"),
          "utf8"
        )
      ) as {
        deviceRuntimeState?: {
          controllers?: { agentId?: string }[];
        };
      };
      expect(configRaw.deviceRuntimeState?.controllers?.[0]?.agentId).toBe(
        "codex"
      );
    });
  });

  it("round-trips persisted launch contracts in device runtime state", async () => {
    await withTempHome(async () => {
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "openclaw",
            displayName: "OpenClaw",
            enabled: true,
            launchContract: {
              kind: "node_script",
              nodePath: "/Users/demo/.nvm/versions/node/v24.14.0/bin/node",
              scriptPath:
                "/Users/demo/.nvm/versions/node/v24.14.0/lib/node_modules/openclaw/openclaw.mjs",
            },
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]
      ).toMatchObject({
        agentId: "openclaw",
        launchContract: {
          kind: "node_script",
          nodePath: "/Users/demo/.nvm/versions/node/v24.14.0/bin/node",
          scriptPath:
            "/Users/demo/.nvm/versions/node/v24.14.0/lib/node_modules/openclaw/openclaw.mjs",
        },
      });
    });
  });

  it("preserves agents and baseUrl when writing skills config", async () => {
    await withTempHome(async () => {
      await setConfiguredBaseUrl("https://gateway.example.com/");
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "cursor",
            displayName: "Cursor",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      await setConfiguredSkillsConfig({
        storeDir: "/tmp/skills-next",
      });

      expect(await getConfiguredBaseUrl()).toBe("https://gateway.example.com");
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe(
        "/tmp/skills-next"
      );
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]?.agentId
      ).toBe("cursor");
    });
  });

  it("preserves skills and agents when writing baseUrl", async () => {
    await withTempHome(async () => {
      await setConfiguredSkillsConfig({
        storeDir: "/tmp/skills",
      });
      await setConfiguredDeviceRuntimeState({
        controllers: [
          {
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
            registeredAt: "2026-02-23T00:00:00.000Z",
            updatedAt: "2026-02-23T00:00:00.000Z",
          },
        ],
      });

      await setConfiguredBaseUrl("https://gateway-next.example.com/");

      expect(await getConfiguredBaseUrl()).toBe(
        "https://gateway-next.example.com"
      );
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe("/tmp/skills");
      expect(
        (await getConfiguredDeviceRuntimeState())?.controllers?.[0]?.agentId
      ).toBe("codex");
    });
  });

  it("persists onboarding.startV1 state and keeps other config fields", async () => {
    await withTempHome(async () => {
      await setConfiguredBaseUrl("https://gateway.example.com/");
      await setConfiguredSkillsConfig({
        storeDir: "/tmp/skills",
      });
      await updateConfiguredStartV1OnboardingState(() => ({
        disclaimerAcceptedVersion: "start-v1-2026-03-02",
        lastCompletedAt: "2026-03-02T00:00:00.000Z",
        localAgentsSetupCompletedAt: "2026-03-02T00:05:00.000Z",
      }));

      const onboarding = await getConfiguredStartV1OnboardingState();
      expect(onboarding?.disclaimerAcceptedVersion).toBe("start-v1-2026-03-02");
      expect(onboarding?.lastCompletedAt).toBe("2026-03-02T00:00:00.000Z");
      expect(onboarding?.localAgentsSetupCompletedAt).toBe(
        "2026-03-02T00:05:00.000Z"
      );
      expect(await getConfiguredBaseUrl()).toBe("https://gateway.example.com");
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe("/tmp/skills");
    });
  });

  it("keeps valid config fields when baseUrl is invalid", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            baseUrl: "://invalid-url",
            skills: {
              storeDir: "/tmp/skills",
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      expect(await getConfiguredBaseUrl()).toBeNull();
      expect((await getConfiguredSkillsConfig())?.storeDir).toBe("/tmp/skills");
    });
  });

  it("writes runtime config atomically without leaving temp files", async () => {
    await withTempHome(async (home) => {
      await setConfiguredBaseUrl("https://gateway.example.com");

      const deviceEntries = await readdir(join(home, ".openmeld", "device"));
      expect(deviceEntries).toContain("preferences.json");
      expect(
        deviceEntries.some(
          (entry) =>
            entry.startsWith("preferences.json.tmp-") || entry.endsWith(".tmp")
        )
      ).toBe(false);
    });
  });

  it("aligns legacy config.json into split device files", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            baseUrl: "https://gateway.example.com/",
            skills: {
              storeDir: "/tmp/skills",
            },
            deviceRuntimeState: {
              controllers: [
                {
                  agentId: "codex",
                  displayName: "Codex",
                  enabled: true,
                  registeredAt: "2026-02-23T00:00:00.000Z",
                  updatedAt: "2026-02-23T00:00:00.000Z",
                },
              ],
            },
            updatedAt: "2026-03-08T00:00:00.000Z",
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const result = await alignRuntimeConfigStorage();

      expect(result).toEqual({
        migratedLegacyConfig: true,
        removedLegacyConfig: true,
      });
      await expect(
        readFile(join(home, ".openmeld", "config.json"), "utf8")
      ).rejects.toThrow();
      await expect(
        readFile(join(home, ".openmeld", "device", "preferences.json"), "utf8")
      ).resolves.toContain('"baseUrl": "https://gateway.example.com"');
      await expect(
        readFile(
          join(home, ".openmeld", "device", "skills", "store.json"),
          "utf8"
        )
      ).resolves.toContain('"storeDir": "/tmp/skills"');
      await expect(
        readFile(
          join(home, ".openmeld", "device", "agent-runtime.json"),
          "utf8"
        )
      ).resolves.toContain('"agentId": "codex"');
    });
  });

  it("uses the same fallback target id for normalized custom directories", () => {
    const base = resolveRuntimeSkillsCustomTargetId({
      dir: "/tmp/custom-agent/skills",
    });
    const trailingSlash = resolveRuntimeSkillsCustomTargetId({
      dir: "/tmp/custom-agent/skills/",
    });
    const duplicateSeparators = resolveRuntimeSkillsCustomTargetId({
      dir: "/tmp//custom-agent///skills/",
    });

    expect(trailingSlash).toBe(base);
    expect(duplicateSeparators).toBe(base);
  });

  it("preserves windows root semantics when normalizing fallback ids", () => {
    const windowsRootBackslash = resolveRuntimeSkillsCustomTargetId({
      dir: "C:\\",
    });
    const windowsRootSlash = resolveRuntimeSkillsCustomTargetId({
      dir: "C:/",
    });
    const windowsLowercaseDrive = resolveRuntimeSkillsCustomTargetId({
      dir: "c:\\",
    });
    const windowsDriveRelative = resolveRuntimeSkillsCustomTargetId({
      dir: "C:",
    });
    const uncBackslash = resolveRuntimeSkillsCustomTargetId({
      dir: "\\\\server\\share\\skills",
    });
    const uncSlash = resolveRuntimeSkillsCustomTargetId({
      dir: "//server/share/skills/",
    });

    expect(windowsRootBackslash).toBe(windowsRootSlash);
    expect(windowsLowercaseDrive).toBe(windowsRootBackslash);
    expect(windowsDriveRelative).not.toBe(windowsRootBackslash);
    expect(uncBackslash).toBe(uncSlash);
  });

  it("hydrates controller defaults when fields are missing", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            deviceRuntimeState: {
              controllers: [
                {
                  agentId: "codex",
                  displayName: "Codex",
                  enabled: true,
                  registeredAt: "2026-02-25T00:00:00.000Z",
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const registration = (await getConfiguredDeviceRuntimeState())
        ?.controllers?.[0];
      expect(registration?.transportMode).toBe("local-cli");
      expect(registration?.streamingMode).toBe("final");
      expect(registration?.timeoutMs).toBeNull();
      expect(registration?.retry).toBe(0);
      expect(registration?.contextIdMappingSpec?.sourceField).toBe(
        "OPENMELD_CLI_CONTEXT_ID"
      );
      expect(registration?.contextIdMappingSpec?.mappingVersion).toBe(1);
    });
  });

  it("normalizes stale execution timeout and unsupported context source fields", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      for (const sourceField of ["EXTERNAL_AGENT_CONTEXT_ID"]) {
        await writeFile(
          join(home, ".openmeld", "config.json"),
          `${JSON.stringify(
            {
              v: 1,
              deviceRuntimeState: {
                controllers: [
                  {
                    agentId: "codex",
                    displayName: "Codex",
                    enabled: true,
                    transportMode: "local-cli",
                    timeoutMs: 120_000,
                    retry: 0,
                    contextIdMappingSpec: {
                      sourceField,
                      mappingVersion: 1,
                    },
                    registeredAt: "2026-02-25T00:00:00.000Z",
                    updatedAt: "2026-02-25T00:00:00.000Z",
                  },
                ],
              },
              updatedAt: new Date().toISOString(),
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        const registration = (await getConfiguredDeviceRuntimeState())
          ?.controllers?.[0];
        expect(registration?.timeoutMs).toBeNull();
        expect(registration?.contextIdMappingSpec).toEqual({
          sourceField: "OPENMELD_CLI_CONTEXT_ID",
          mappingVersion: 1,
        });
      }
    });
  });

  it("drops controller entries with unsupported legacy transport modes", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            deviceRuntimeState: {
              controllers: [
                {
                  agentId: "codex",
                  displayName: "Codex",
                  enabled: true,
                  transportMode: "stdio",
                  timeoutMs: 120_000,
                  retry: 0,
                  contextIdMappingSpec: {
                    sourceField: "OPENMELD_CLI_CONTEXT_ID",
                    mappingVersion: 1,
                  },
                  registeredAt: "2026-02-25T00:00:00.000Z",
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const registration = (await getConfiguredDeviceRuntimeState())
        ?.controllers;
      expect(registration).toBeUndefined();
    });
  });

  it.each([
    false,
    true,
  ])("refreshes original agent registrations while preserving current settings (current layout: %s)", async (hasCurrentLayout) => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            agents: {
              registrations: [
                {
                  agentId: "codex",
                  displayName: "Codex",
                  enabled: true,
                  transportMode: "local-cli",
                  timeoutMs: 120_000,
                  retry: 0,
                  contextIdMappingSpec: {
                    sourceField: "OPENMELD_CLI_CONTEXT_ID",
                    mappingVersion: 1,
                  },
                  registeredAt: "2026-02-25T00:00:00.000Z",
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            ...(hasCurrentLayout
              ? { deviceRuntimeState: { controllers: [] } }
              : {}),
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const before = await getConfiguredDeviceRuntimeState();
      if (hasCurrentLayout) {
        expect(before?.controllers).toBeUndefined();
      } else {
        expect(before?.controllers).toEqual([
          expect.objectContaining({
            agentId: "codex",
            displayName: "Codex",
            enabled: true,
          }),
        ]);
      }
      await alignRuntimeConfigStorage();
      expect(await getConfiguredDeviceRuntimeState()).toEqual(before);
      await alignRuntimeConfigStorage();
      expect(await getConfiguredDeviceRuntimeState()).toEqual(before);
    });
  });

  it("ignores invalid onboarding.startV1 fields from config.json", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            onboarding: {
              startV1: {
                disclaimerAcceptedVersion: "   ",
                lastCompletedAt: 1,
                localAgentsSetupCompletedAt: false,
              },
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(getConfiguredStartV1OnboardingState()).resolves.toBeNull();
    });
  });

  it("drops invalid controller config registration entries", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            deviceRuntimeState: {
              controllers: [
                {
                  agentId: "codex",
                  displayName: "Codex",
                  enabled: true,
                  transportMode: "http",
                  timeoutMs: 120_000,
                  retry: 0,
                  contextIdMappingSpec: {
                    sourceField: "OPENMELD_CLI_CONTEXT_ID",
                    mappingVersion: 1,
                  },
                  registeredAt: "2026-02-25T00:00:00.000Z",
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const controllers = (await getConfiguredDeviceRuntimeState())
        ?.controllers;
      expect(controllers).toBeUndefined();
    });
  });

  it("ignores legacy snake_case controller keys", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            deviceRuntimeState: {
              controllers: [
                {
                  agentId: "codex",
                  displayName: "Codex",
                  enabled: true,
                  dispatch_policy: "mention_only",
                  transport_mode: "local-cli",
                  timeout_ms: 60_000,
                  retry: 2,
                  context_id_mapping_spec: {
                    sourceField: "CUSTOM_SESSION_ID",
                    mappingVersion: 9,
                  },
                  registeredAt: "2026-02-25T00:00:00.000Z",
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const registration = (await getConfiguredDeviceRuntimeState())
        ?.controllers?.[0];
      expect(registration?.transportMode).toBe("local-cli");
      expect(registration?.streamingMode).toBe("final");
      expect(registration?.timeoutMs).toBeNull();
      expect(registration?.retry).toBe(2);
      expect(registration?.contextIdMappingSpec).toEqual({
        sourceField: "OPENMELD_CLI_CONTEXT_ID",
        mappingVersion: 1,
      });
    });
  });

  it("falls back invalid controller streaming mode to final", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            deviceRuntimeState: {
              controllers: [
                {
                  agentId: "codex",
                  displayName: "Codex",
                  enabled: true,
                  transportMode: "local-cli",
                  streamingMode: "chunk",
                  timeoutMs: 120_000,
                  retry: 0,
                  contextIdMappingSpec: {
                    sourceField: "OPENMELD_CLI_CONTEXT_ID",
                    mappingVersion: 1,
                  },
                  registeredAt: "2026-02-25T00:00:00.000Z",
                  updatedAt: "2026-02-25T00:00:00.000Z",
                },
              ],
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      const registration = (await getConfiguredDeviceRuntimeState())
        ?.controllers?.[0];
      expect(registration?.transportMode).toBe("local-cli");
      expect(registration?.streamingMode).toBe("final");
    });
  });

  it("preserves explicit controller streaming mode even when lane default is stream", async () => {
    const previousPreset = process.env.OPENMELD_ENV_PRESET;
    try {
      process.env.OPENMELD_ENV_PRESET = "dev-local";
      await withTempHome(async (home) => {
        await mkdir(join(home, ".openmeld"), { recursive: true });
        await writeFile(
          join(home, ".openmeld", "config.json"),
          `${JSON.stringify(
            {
              v: 1,
              deviceRuntimeState: {
                controllers: [
                  {
                    agentId: "codex",
                    displayName: "Codex",
                    enabled: true,
                    transportMode: "local-cli",
                    streamingMode: "final",
                    timeoutMs: 120_000,
                    retry: 0,
                    contextIdMappingSpec: {
                      sourceField: "OPENMELD_CLI_CONTEXT_ID",
                      mappingVersion: 1,
                    },
                    registeredAt: "2026-02-25T00:00:00.000Z",
                    updatedAt: "2026-02-25T00:00:00.000Z",
                  },
                ],
              },
              updatedAt: new Date().toISOString(),
            },
            null,
            2
          )}\n`,
          "utf8"
        );

        const registration = (await getConfiguredDeviceRuntimeState())
          ?.controllers?.[0];
        expect(registration?.streamingMode).toBe("final");
      });
    } finally {
      if (previousPreset === undefined) {
        Reflect.deleteProperty(process.env, "OPENMELD_ENV_PRESET");
      } else {
        process.env.OPENMELD_ENV_PRESET = previousPreset;
      }
    }
  });

  it("uses daemon dispatch defaults when daemon.dispatch is missing", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(getConfiguredDaemonDispatchLimits()).resolves.toEqual({
        globalConcurrency: DEFAULT_RUNTIME_DAEMON_GLOBAL_CONCURRENCY,
        queueMax: DEFAULT_RUNTIME_DAEMON_QUEUE_MAX,
      });
    });
  });

  it("falls back daemon dispatch dirty values to defaults", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            daemon: {
              dispatch: {
                globalConcurrency: 0,
                queueMax: "fifty",
              },
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(getConfiguredDaemonDispatchLimits()).resolves.toEqual({
        globalConcurrency: DEFAULT_RUNTIME_DAEMON_GLOBAL_CONCURRENCY,
        queueMax: DEFAULT_RUNTIME_DAEMON_QUEUE_MAX,
      });
    });
  });

  it("reads daemon dispatch limits from config.json", async () => {
    await withTempHome(async (home) => {
      await mkdir(join(home, ".openmeld"), { recursive: true });
      await writeFile(
        join(home, ".openmeld", "config.json"),
        `${JSON.stringify(
          {
            v: 1,
            daemon: {
              dispatch: {
                globalConcurrency: 5,
                queueMax: 100,
              },
            },
            updatedAt: new Date().toISOString(),
          },
          null,
          2
        )}\n`,
        "utf8"
      );

      await expect(getConfiguredDaemonDispatchLimits()).resolves.toEqual({
        globalConcurrency: 5,
        queueMax: 100,
      });
    });
  });
});
