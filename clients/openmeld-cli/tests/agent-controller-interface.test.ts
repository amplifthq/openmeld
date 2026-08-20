import {
  chmod,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentTargetState } from "../src/agents/registry";
import { createDefaultRuntimeAgentControllerSettings } from "../src/config/runtime-config";
import {
  resolveAgentControllerInterfaceSnapshot,
  resolveUsageLimitsAfterCompletedProbe,
} from "../src/local-service/inventory/agent-controller-interface";
import { OPENCLAW_MODELS_STATUS_MISSING_AUTH_RESPONSE } from "./fixtures/openclaw-models-status";
import {
  OPENCODE_NPM_LATEST_RESPONSE,
  OPENCODE_NPM_LATEST_URL,
} from "./fixtures/opencode-npm-latest";
import { OPENCODE_CONNECTED_PROVIDER_LIST_RESPONSE } from "./fixtures/opencode-provider-list";

const { createOpencodeClientMock, warnDaemonEventMock } = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn(),
  warnDaemonEventMock: vi.fn(),
}));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: createOpencodeClientMock,
}));

vi.mock(
  "../src/local-service/core/logger",
  async (
    importOriginal
  ): Promise<typeof import("../src/local-service/core/logger")> => ({
    ...(await importOriginal()),
    warnDaemonEvent: warnDaemonEventMock,
  })
);

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Response.json(OPENCODE_NPM_LATEST_RESPONSE))
  );
});

afterEach(() => {
  createOpencodeClientMock.mockReset();
  warnDaemonEventMock.mockReset();
  vi.unstubAllGlobals();
});

describe("agent controller interface inventory", () => {
  it("preserves last-known provider capacity as stale after a temporary read failure", () => {
    const observedAt = "2026-08-20T08:00:00.000Z";

    expect(
      resolveUsageLimitsAfterCompletedProbe({
        authStatus: "authenticated",
        current: [
          {
            key: "provider",
            label: "Usage limits",
            observedAt: "2026-08-20T08:20:00.000Z",
            resetsAt: null,
            status: "unavailable",
            usedPercent: null,
          },
        ],
        previous: [
          {
            key: "codex:primary",
            label: "5-hour usage",
            observedAt,
            resetsAt: "2026-08-20T12:00:00.000Z",
            status: "available",
            usedPercent: 72,
          },
          {
            key: "codex:secondary",
            label: "Weekly usage",
            observedAt,
            resetsAt: null,
            status: "exhausted",
            usedPercent: 100,
          },
          {
            key: "provider-unavailable",
            label: "Usage limits",
            observedAt,
            resetsAt: null,
            status: "unavailable",
            usedPercent: null,
          },
        ],
        support: "native",
      })
    ).toEqual([
      expect.objectContaining({
        key: "codex:primary",
        observedAt,
        status: "stale",
        usedPercent: 72,
      }),
      expect.objectContaining({
        key: "codex:secondary",
        observedAt,
        status: "stale",
        usedPercent: 100,
      }),
      expect.objectContaining({
        key: "provider-unavailable",
        status: "unavailable",
        usedPercent: null,
      }),
    ]);
  });

  it("keeps a fresh passive observation fresh when the probe does not query capacity", () => {
    const usageLimits = [
      {
        key: "claude-code:five-hour",
        label: "5-hour usage limit",
        observedAt: "2026-08-20T08:00:00.000Z",
        resetsAt: "2026-08-20T12:00:00.000Z",
        status: "available" as const,
        usedPercent: 61,
      },
    ];

    expect(
      resolveUsageLimitsAfterCompletedProbe({
        authStatus: "authenticated",
        current: undefined,
        previous: usageLimits,
        support: "passive",
      })
    ).toEqual(usageLimits);
  });

  it("drops another account's last-known capacity when authentication is lost", () => {
    const unavailable = [
      {
        key: "provider",
        label: "Usage limits",
        observedAt: "2026-08-20T08:20:00.000Z",
        resetsAt: null,
        status: "unavailable" as const,
        usedPercent: null,
      },
    ];

    expect(
      resolveUsageLimitsAfterCompletedProbe({
        authStatus: "unauthenticated",
        current: unavailable,
        previous: [
          {
            key: "codex:primary",
            label: "5-hour usage",
            observedAt: "2026-08-20T08:00:00.000Z",
            resetsAt: "2026-08-20T12:00:00.000Z",
            status: "available",
            usedPercent: 72,
          },
        ],
        support: "native",
      })
    ).toEqual(unavailable);
  });

  it("reports Grok Build ACP authentication and live models", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-grok-build-"));
    try {
      const binPath = join(home, ".grok", "bin", "grok");
      await mkdir(join(home, ".grok", "bin"), { recursive: true });
      await writeGrokBuildBin(binPath, { authenticated: true });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:grok-build",
        state: createBuiltinAgentTargetState(
          "grok-build",
          "Grok Build",
          binPath
        ),
      });

      expect(snapshot).toMatchObject({
        auth: {
          label: "Grok account connected",
          status: "authenticated",
          type: "cached_token",
        },
        capabilities: {
          approvals: true,
          cancel: true,
          interrupt: true,
          modelSelection: true,
          nativeEventStream: true,
          permissionModes: true,
          structuredUserInput: true,
        },
        models: [
          { displayName: "Grok 4.6", id: "grok-4.6" },
          { displayName: "Grok 4.5", id: "grok-4.5" },
        ],
        nativeInterface: "acp",
        status: "ready",
        usageLimits: [
          {
            key: "grok-build:included-credits",
            label: "Weekly usage limit",
            resetsAt: "2026-08-27T00:00:00.000Z",
            status: "available",
            usedPercent: 27,
          },
        ],
        version: "1.0.3",
        versionAdvisory: {
          currentVersion: "1.0.3",
          latestVersion: null,
          status: "unknown",
          updateCommand: "grok update",
        },
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports Grok Build as unauthenticated when ACP only offers browser login", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-grok-no-auth-"));
    try {
      const binPath = join(home, ".grok", "bin", "grok");
      await mkdir(join(home, ".grok", "bin"), { recursive: true });
      await writeGrokBuildBin(binPath, { authenticated: false });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:grok-build",
        state: createBuiltinAgentTargetState(
          "grok-build",
          "Grok Build",
          binPath
        ),
      });

      expect(snapshot).toMatchObject({
        auth: { status: "unauthenticated" },
        check: { status: "succeeded" },
        message:
          "Grok Build is installed, but this computer is not signed in to Grok.",
        models: [],
        status: "error",
        version: "1.0.3",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports Grok Build as signed out when its cached authentication fails", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-grok-expired-auth-")
    );
    try {
      const binPath = join(home, ".grok", "bin", "grok");
      await mkdir(join(home, ".grok", "bin"), { recursive: true });
      await writeGrokBuildBin(binPath, {
        authenticated: true,
        authFailure: "The cached token is expired. Sign in again.",
      });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:grok-build",
        state: createBuiltinAgentTargetState(
          "grok-build",
          "Grok Build",
          binPath
        ),
      });

      expect(snapshot).toMatchObject({
        auth: { status: "unauthenticated" },
        check: { status: "succeeded" },
        message:
          "Grok Build is installed, but this computer is not signed in to Grok.",
        models: [],
        status: "error",
        version: "1.0.3",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports Cursor CLI ACP capabilities and authentication", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Response.json({ version: "2026.07.09-a3815c0" }))
    );
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-cursor-"));
    try {
      const binDir = join(home, ".local", "bin");
      await mkdir(binDir, { recursive: true });
      const binPath = join(binDir, "cursor-agent");
      await writeFile(
        binPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then echo "2026.07.16-899851b"; exit 0; fi',
          'if [ "$1" = "status" ]; then echo "Logged in as cursor@example.com"; exit 0; fi',
          "exit 1",
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(binPath, 0o755);

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:cursor",
        state: createBuiltinAgentTargetState("cursor", "Cursor", binPath),
      });

      expect(snapshot).toMatchObject({
        auth: {
          email: "cursor@example.com",
          label: "cursor@example.com",
          status: "authenticated",
          type: "cursor_login",
        },
        capabilities: {
          approvals: false,
          cancel: true,
          interrupt: true,
          modelSelection: true,
          nativeEventStream: true,
          permissionModes: true,
          structuredUserInput: false,
        },
        nativeInterface: "acp",
        status: "ready",
        version: "2026.07.16-899851b",
        versionAdvisory: {
          currentVersion: "2026.07.16-899851b",
          latestVersion: "2026.07.09-a3815c0",
          status: "current",
          updateCommand: "cursor-agent update",
        },
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports OpenCode auth, models, and interrupt-backed Stop from the local CLI", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-opencode-"));
    try {
      const binPath = join(home, "opencode");
      await writeFile(
        binPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then echo "opencode 1.17.11"; exit 0; fi',
          'if [ "$1" = "serve" ]; then echo "opencode server listening on http://127.0.0.1:34567"; sleep 60; exit 0; fi',
          "exit 1",
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(binPath, 0o755);
      createOpencodeClientMock.mockReturnValue({
        app: {
          agents: vi.fn().mockResolvedValue({ data: [] }),
        },
        provider: {
          list: vi.fn().mockResolvedValue({
            data: {
              all: [
                {
                  id: "openai",
                  models: {
                    "gpt-5.4": {
                      id: "gpt-5.4",
                      name: "GPT-5.4",
                      providerID: "openai",
                    },
                  },
                },
                {
                  id: "anthropic",
                  models: {
                    "claude-opus-4.5": {
                      id: "claude-opus-4.5",
                      name: "Claude Opus 4.5",
                      providerID: "anthropic",
                    },
                  },
                },
              ],
              connected: ["openai"],
              default: {},
            },
          }),
        },
      });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createOpenCodeAgentTargetState(binPath),
      });
      expect(snapshot).toMatchObject({
        auth: {
          label: "1 provider connected",
          status: "authenticated",
          type: "opencode",
        },
        capabilities: {
          approvals: false,
          cancel: false,
          interrupt: true,
          modelSelection: true,
          nativeEventStream: false,
          permissionModes: false,
          structuredUserInput: false,
        },
        models: [{ displayName: "GPT-5.4", id: "openai/gpt-5.4" }],
        nativeInterface: "local-cli",
        status: "ready",
        version: "1.17.11",
        versionAdvisory: {
          currentVersion: "1.17.11",
          latestVersion: "1.17.18",
          status: "behind_latest",
          updateCommand: "opencode upgrade",
        },
      });
      expect(createOpencodeClientMock).toHaveBeenCalledWith({
        baseUrl: "http://127.0.0.1:34567",
        directory: process.cwd(),
        throwOnError: true,
      });
      expect(globalThis.fetch).toHaveBeenCalledWith(OPENCODE_NPM_LATEST_URL, {
        headers: {
          accept: "application/json",
        },
        signal: expect.any(AbortSignal),
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("does not make OpenCode provider readiness depend on the unused agent list", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-opencode-provider-only-")
    );
    try {
      const binPath = join(home, "opencode");
      await writeFile(
        binPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then echo "opencode 1.17.11"; exit 0; fi',
          'if [ "$1" = "serve" ]; then echo "opencode server listening on http://127.0.0.1:34567"; sleep 60; exit 0; fi',
          "exit 1",
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(binPath, 0o755);
      const readAgents = vi
        .fn()
        .mockRejectedValue(new Error("temporary agent list failure"));
      createOpencodeClientMock.mockReturnValue({
        app: {
          agents: readAgents,
        },
        provider: {
          list: vi.fn().mockResolvedValue({
            data: OPENCODE_CONNECTED_PROVIDER_LIST_RESPONSE,
          }),
        },
      });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createOpenCodeAgentTargetState(binPath),
      });
      expect(snapshot).toMatchObject({
        auth: {
          status: "authenticated",
          type: "opencode",
        },
        status: "ready",
      });
      expect(readAgents).not.toHaveBeenCalled();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports OpenCode as current when the CLI matches the npm release", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-opencode-current-")
    );
    try {
      const binPath = join(home, "opencode");
      await writeFile(
        binPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then echo "1.17.18"; exit 0; fi',
          'if [ "$1" = "serve" ]; then echo "opencode server listening on http://127.0.0.1:34567"; sleep 60; exit 0; fi',
          "exit 1",
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(binPath, 0o755);
      createOpencodeClientMock.mockReturnValue({
        app: {
          agents: vi.fn().mockResolvedValue({ data: [] }),
        },
        provider: {
          list: vi.fn().mockResolvedValue({
            data: {
              all: [],
              connected: ["openai"],
              default: {},
            },
          }),
        },
      });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createOpenCodeAgentTargetState(binPath),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "1.17.18",
        latestVersion: "1.17.18",
        message: null,
        status: "current",
        updateCommand: "opencode upgrade",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("fails OpenCode closed when the SDK reports no connected provider", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-opencode-"));
    try {
      const binPath = join(home, "opencode");
      await writeFile(
        binPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--version" ]; then echo "opencode 1.17.11"; exit 0; fi',
          'if [ "$1" = "serve" ]; then echo "opencode server listening on http://127.0.0.1:34567"; sleep 60; exit 0; fi',
          "exit 1",
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(binPath, 0o755);
      createOpencodeClientMock.mockReturnValue({
        app: {
          agents: vi.fn().mockResolvedValue({ data: [] }),
        },
        provider: {
          list: vi.fn().mockResolvedValue({
            data: {
              all: [
                {
                  id: "openai",
                  models: {
                    "gpt-5.4": {
                      id: "gpt-5.4",
                      name: "GPT-5.4",
                      providerID: "openai",
                    },
                  },
                },
              ],
              connected: [],
              default: {},
            },
          }),
        },
      });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createOpenCodeAgentTargetState(binPath),
      });

      expect(snapshot).toMatchObject({
        auth: { status: "unknown" },
        message:
          "OpenCode is installed, but no connected provider was reported. Open OpenCode and sign in to a provider before OpenMeld can launch it.",
        models: [],
        status: "error",
        version: "1.17.11",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it(
    "bounds an OpenCode probe when the server accepts requests but never answers",
    {
      timeout: 15_000,
    },
    async () => {
      const home = await mkdtemp(join(tmpdir(), "openmeld-aci-opencode-hang-"));
      try {
        const binPath = join(home, "opencode");
        await writeFile(
          binPath,
          [
            "#!/bin/sh",
            'if [ "$1" = "--version" ]; then echo "opencode 1.17.11"; exit 0; fi',
            'if [ "$1" = "serve" ]; then echo "opencode server listening on http://127.0.0.1:34567"; sleep 60; exit 0; fi',
            "exit 1",
            "",
          ].join("\n"),
          "utf8"
        );
        await chmod(binPath, 0o755);
        createOpencodeClientMock.mockReturnValue({
          app: {
            agents: vi.fn(() => new Promise(() => undefined)),
          },
          provider: {
            list: vi.fn(() => new Promise(() => undefined)),
          },
        });

        const snapshot = await resolveAgentControllerInterfaceSnapshot({
          agentControllerRef: "builtin:opencode",
          state: createOpenCodeAgentTargetState(binPath),
        });

        expect(snapshot).toMatchObject({
          auth: { status: "unknown" },
          check: {
            lastSucceededAt: null,
            status: "failed",
          },
          status: "unknown",
        });
        expect(snapshot.message).toContain(
          "Timed out while reading OpenCode provider status after 4000ms."
        );
        expect(warnDaemonEventMock).toHaveBeenCalledWith(
          "[openmeld.agent_controller_interface.check_failed]",
          expect.objectContaining({
            agentControllerRef: "builtin:opencode",
            commandFingerprintRemainedStable: true,
            controllerId: "opencode",
            errorMessage: expect.stringContaining(
              "Timed out while reading OpenCode provider status after 4000ms."
            ),
            lastSucceededAt: null,
            probePolicy: "fresh",
          })
        );
      } finally {
        await rm(home, { force: true, recursive: true });
      }
    }
  );

  it("adds a manual update advisory when a Codex npm install is behind latest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ version: "0.143.0" }))
    );
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-version-"));
    try {
      const packageBinDir = join(
        home,
        "lib",
        "node_modules",
        "@openai",
        "codex",
        "bin"
      );
      const binDir = join(home, "bin");
      await mkdir(packageBinDir, { recursive: true });
      await mkdir(binDir, { recursive: true });
      const packageBinPath = join(packageBinDir, "codex");
      const symlinkPath = join(binDir, "codex");
      await writeFile(
        packageBinPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "app-server" ]; then exit 1; fi',
          'if [ "$1" = "--version" ]; then echo "codex 0.142.2"; exit 0; fi',
          "exit 0",
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(packageBinPath, 0o755);
      await symlink(packageBinPath, symlinkPath);

      const state = {
        agentId: "codex",
        contextIdMappingSpec:
          createDefaultRuntimeAgentControllerSettings("codex")
            .contextIdMappingSpec,
        detected: true,
        displayName: "Codex",
        enabled: true,
        installChoices: [],
        lifecycleStatus: "active",
        launchContract: {
          commandPath: symlinkPath,
          kind: "executable",
        },
        launchStatus: "ready",
        launchStatusDetail: null,
        registered: true,
        registration: null,
        runtimeSupported: true,
        selectable: true,
        selectableReason: null,
        targetKind: "builtin",
        transportModes: [
          {
            description: "Run through the local CLI on this computer.",
            label: "Local CLI",
            mode: "local-cli",
          },
        ],
      } satisfies AgentTargetState & { targetKind: "builtin" };

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:codex",
        state,
      });

      expect(snapshot.version).toBe("0.142.2");
      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "0.142.2",
        latestVersion: "0.143.0",
        status: "behind_latest",
        updateCommand: "npm install -g @openai/codex@latest",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports OpenClaw as unauthenticated from its machine-readable auth check", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-openclaw-auth-"));
    try {
      const binPath = join(home, "openclaw.mjs");
      await writeOpenClawBin(binPath, {
        authExitCode: 1,
        authStdout: JSON.stringify(
          OPENCLAW_MODELS_STATUS_MISSING_AUTH_RESPONSE
        ),
      });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:openclaw",
        state: createBuiltinAgentTargetState("openclaw", "OpenClaw", binPath),
      });

      expect(snapshot).toMatchObject({
        auth: { status: "unauthenticated" },
        controllerId: "openclaw",
        status: "error",
        version: "2026.3.13",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports an OpenClaw auth probe failure instead of treating exit 1 as signed out", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-openclaw-error-"));
    try {
      const binPath = join(home, "openclaw.mjs");
      await writeOpenClawBin(binPath, {
        authExitCode: 1,
        authStderr: "Invalid OpenClaw configuration.",
        authStdout: "",
      });

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:openclaw",
        state: createBuiltinAgentTargetState("openclaw", "OpenClaw", binPath),
      });

      expect(snapshot).toMatchObject({
        auth: { status: "unknown" },
        check: {
          lastSucceededAt: null,
          status: "failed",
        },
        status: "unknown",
        version: "2026.3.13",
      });
      expect(snapshot.message).toContain(
        "could not read OpenClaw model provider authentication status"
      );
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("trusts Claude Code loggedIn JSON when an organization ID contains 401", async () => {
    const snapshot = await resolveClaudeCodeSnapshotForAuthOutput({
      authStderr: "Invalid API key from an unrelated hook.",
      authOutput: JSON.stringify({
        apiProvider: "firstParty",
        authMethod: "claude.ai",
        email: "felix@cloudman.win",
        loggedIn: true,
        orgId: "00a7ea44-598c-4500-ac61-84018fed84a1",
        orgName: "Cloudman",
        subscriptionType: "max",
      }),
    });

    expect(snapshot).toMatchObject({
      auth: {
        email: "felix@cloudman.win",
        label: "felix@cloudman.win",
        status: "authenticated",
        type: "claude",
      },
      status: "ready",
    });
  });

  it("trusts Claude Code loggedIn false JSON as unauthenticated", async () => {
    const snapshot = await resolveClaudeCodeSnapshotForAuthOutput({
      authOutput: JSON.stringify({
        authMethod: "none",
        email: "felix@cloudman.win",
        loggedIn: false,
        orgId: "organization-401-normal-value",
      }),
    });

    expect(snapshot).toMatchObject({
      auth: { status: "unauthenticated" },
      status: "error",
    });
  });

  it("falls back to Claude Code unauthenticated wording for non-JSON output", async () => {
    const snapshot = await resolveClaudeCodeSnapshotForAuthOutput({
      authExitCode: 1,
      authOutput: "Invalid API key. Run /login to authenticate.",
    });

    expect(snapshot).toMatchObject({
      auth: { status: "unauthenticated" },
      status: "error",
    });
  });

  it("does not treat unrelated non-JSON Claude Code errors as unauthenticated", async () => {
    const snapshot = await resolveClaudeCodeSnapshotForAuthOutput({
      authExitCode: 1,
      authOutput: "agents-router service is not running",
    });

    expect(snapshot).toMatchObject({
      auth: { status: "unknown" },
      status: "ready",
    });
  });

  it.each([
    "Invalid token. Run /login to authenticate.",
    "Your OAuth session expired. Please sign in again.",
    "Authentication failed: 401 unauthorized.",
  ])("reports Claude Code as unauthenticated for expired auth output: %s", async (authOutput) => {
    const snapshot = await resolveClaudeCodeSnapshotForAuthOutput({
      authOutput,
    });

    expect(snapshot).toMatchObject({
      auth: { status: "unauthenticated" },
      status: "error",
    });
  });

  // Runs after the advisory test: both resolve the "@openai/codex" latest
  // version through the module-level npm cache, and the advisory test needs
  // to be the first writer to observe its own stubbed registry response.
  it("uses shared copy for an unauthenticated Codex inventory snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ version: "0.142.5" }))
    );
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-codex-auth-"));
    try {
      const binPath = join(home, "codex.mjs");
      await writeFile(
        binPath,
        [
          "#!/usr/bin/env node",
          'process.stdin.setEncoding("utf8");',
          'let buffer = "";',
          "const reply = (id, result) => {",
          '  const line = JSON.stringify({ id, jsonrpc: "2.0", result });',
          '  process.stdout.write(line + "\\n");',
          "};",
          "const handle = (message) => {",
          '  if (message.method === "initialize") {',
          '    reply(message.id, { userAgent: "codex/0.142.5 (test)" });',
          "  }",
          '  if (message.method === "account/read") {',
          "    reply(message.id, { account: null, requiresOpenaiAuth: true });",
          "  }",
          '  if (message.method === "skills/list") {',
          "    reply(message.id, { skills: [] });",
          "  }",
          '  if (message.method === "model/list") {',
          "    reply(message.id, { data: [], nextCursor: null });",
          "  }",
          "};",
          'process.stdin.on("data", (chunk) => {',
          "  buffer += chunk;",
          '  let index = buffer.indexOf("\\n");',
          "  while (index >= 0) {",
          "    const line = buffer.slice(0, index).trim();",
          "    buffer = buffer.slice(index + 1);",
          "    if (line) {",
          "      handle(JSON.parse(line));",
          "    }",
          '    index = buffer.indexOf("\\n");',
          "  }",
          "});",
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(binPath, 0o755);

      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:codex",
        state: createCodexAgentTargetState(binPath),
      });

      expect(snapshot).toMatchObject({
        auth: { status: "unauthenticated" },
        message:
          "Codex CLI is installed, but this computer is not signed in to Codex.",
        status: "error",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it(
    "keeps a Codex probe healthy when auxiliary model listing hangs",
    {
      timeout: 15_000,
    },
    async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ version: "0.142.5" }))
      );
      const home = await mkdtemp(join(tmpdir(), "openmeld-aci-codex-aux-"));
      try {
        const binPath = join(home, "codex.mjs");
        await writeFile(
          binPath,
          [
            "#!/usr/bin/env node",
            'process.stdin.setEncoding("utf8");',
            'let buffer = "";',
            "const reply = (id, result) => {",
            '  const line = JSON.stringify({ id, jsonrpc: "2.0", result });',
            '  process.stdout.write(line + "\\n");',
            "};",
            "const handle = (message) => {",
            '  if (message.method === "initialize") {',
            '    reply(message.id, { userAgent: "codex/0.142.5 (test)" });',
            "  }",
            '  if (message.method === "account/read") {',
            '    reply(message.id, { account: { email: "dev@example.com", type: "chatgpt" } });',
            "  }",
            '  if (message.method === "skills/list") {',
            "    reply(message.id, { skills: [] });",
            "  }",
            '  if (message.method === "account/rateLimits/read") {',
            '    reply(message.id, { rateLimits: { limitId: "codex", primary: { usedPercent: 81, resetsAt: 1787259600, windowDurationMins: 300 }, secondary: { usedPercent: 34, resetsAt: null, windowDurationMins: 10080 } } });',
            "  }",
            "  // model/list is intentionally never answered: a hung auxiliary listing.",
            "};",
            'process.stdin.on("data", (chunk) => {',
            "  buffer += chunk;",
            '  let index = buffer.indexOf("\\n");',
            "  while (index >= 0) {",
            "    const line = buffer.slice(0, index).trim();",
            "    buffer = buffer.slice(index + 1);",
            "    if (line) {",
            "      handle(JSON.parse(line));",
            "    }",
            '    index = buffer.indexOf("\\n");',
            "  }",
            "});",
            "",
          ].join("\n"),
          "utf8"
        );
        await chmod(binPath, 0o755);

        const startedAtMs = Date.now();
        const snapshot = await resolveAgentControllerInterfaceSnapshot({
          agentControllerRef: "builtin:codex",
          state: createCodexAgentTargetState(binPath),
        });
        const elapsedMs = Date.now() - startedAtMs;

        expect(snapshot).toMatchObject({
          auth: { email: "dev@example.com", status: "authenticated" },
          models: [],
          status: "ready",
          usageLimits: [
            {
              key: "codex:primary",
              label: "5-hour usage",
              status: "available",
              usedPercent: 81,
            },
            {
              key: "codex:secondary",
              label: "Weekly usage",
              status: "available",
              usedPercent: 34,
            },
          ],
          version: "0.142.5",
        });
        // The probe must settle on the auxiliary grace, not the 8s hard timeout.
        expect(elapsedMs).toBeLessThan(7000);
      } finally {
        await rm(home, { force: true, recursive: true });
      }
    }
  );
});

function createCodexAgentTargetState(
  binPath: string
): AgentTargetState & { targetKind: "builtin" } {
  return createBuiltinAgentTargetState("codex", "Codex", binPath);
}

async function resolveClaudeCodeSnapshotForAuthOutput(input: {
  authExitCode?: number;
  authOutput: string;
  authStderr?: string;
}) {
  const home = await mkdtemp(join(tmpdir(), "openmeld-aci-claude-auth-"));
  try {
    const binPath = join(home, "claude");
    const authCommands = [
      `echo ${JSON.stringify(input.authOutput)}`,
      ...(input.authStderr
        ? [`echo ${JSON.stringify(input.authStderr)} >&2`]
        : []),
      `exit ${input.authExitCode ?? 0}`,
    ].join("; ");
    await writeFile(
      binPath,
      [
        "#!/bin/sh",
        'if [ "$1" = "--version" ]; then echo "2.1.197 (Claude Code)"; exit 0; fi',
        `if [ "$1" = "auth" ] && [ "$2" = "status" ]; then ${authCommands}; fi`,
        "exit 1",
        "",
      ].join("\n"),
      "utf8"
    );
    await chmod(binPath, 0o755);

    return await resolveAgentControllerInterfaceSnapshot({
      agentControllerRef: "builtin:claude-code",
      state: createBuiltinAgentTargetState(
        "claude-code",
        "Claude Code",
        binPath
      ),
    });
  } finally {
    await rm(home, { force: true, recursive: true });
  }
}

async function writeOpenClawBin(
  binPath: string,
  input: {
    authExitCode: number;
    authStderr?: string;
    authStdout: string;
  }
): Promise<void> {
  await writeFile(
    binPath,
    [
      "#!/usr/bin/env node",
      "const args = process.argv.slice(2);",
      'if (args.length === 1 && args[0] === "--version") {',
      '  console.log("OpenClaw 2026.3.13");',
      "  process.exit(0);",
      "}",
      `if (JSON.stringify(args) === ${JSON.stringify(
        JSON.stringify(["models", "status", "--check", "--json"])
      )}) {`,
      ...(input.authStdout
        ? [`  console.log(${JSON.stringify(input.authStdout)});`]
        : []),
      ...(input.authStderr
        ? [`  console.error(${JSON.stringify(input.authStderr)});`]
        : []),
      `  process.exit(${input.authExitCode});`,
      "}",
      "process.exit(64);",
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(binPath, 0o755);
}

function createBuiltinAgentTargetState(
  agentId:
    | "claude-code"
    | "codex"
    | "cursor"
    | "grok-build"
    | "openclaw"
    | "opencode",
  displayName: string,
  binPath: string
): AgentTargetState & { targetKind: "builtin" } {
  return {
    agentId,
    contextIdMappingSpec:
      createDefaultRuntimeAgentControllerSettings(agentId).contextIdMappingSpec,
    detected: true,
    displayName,
    enabled: true,
    installChoices: [],
    lifecycleStatus: "active",
    launchContract: {
      commandPath: binPath,
      kind: "executable",
    },
    launchStatus: "ready",
    launchStatusDetail: null,
    registered: true,
    registration: null,
    runtimeSupported: true,
    selectable: true,
    selectableReason: null,
    targetKind: "builtin",
    transportModes: [
      {
        description: "Run through the local CLI on this computer.",
        label: "Local CLI",
        mode: "local-cli",
      },
    ],
  };
}

async function writeGrokBuildBin(
  binPath: string,
  input: { authenticated: boolean; authFailure?: string }
): Promise<void> {
  const modelState = {
    availableModels: [
      {
        _meta: {
          reasoningEffort: "high",
          reasoningEfforts: [
            { id: "xhigh", value: "xhigh" },
            { id: "high", value: "high" },
            { id: "medium", value: "medium" },
            { id: "low", value: "low" },
          ],
        },
        modelId: "grok-4.6",
        name: "Grok 4.6",
      },
      {
        _meta: {
          reasoningEffort: "high",
          reasoningEfforts: [
            { id: "high", value: "high" },
            { id: "medium", value: "medium" },
            { id: "low", value: "low" },
          ],
        },
        modelId: "grok-4.5",
        name: "Grok 4.5",
      },
    ],
    currentModelId: "grok-4.6",
  };
  const authMethods = input.authenticated
    ? [
        { id: "cached_token", name: "cached_token" },
        { id: "grok.com", name: "Grok" },
      ]
    : [{ id: "grok.com", name: "Grok" }];
  await writeFile(
    binPath,
    [
      "#!/usr/bin/env node",
      'import readline from "node:readline";',
      "const args = process.argv.slice(2);",
      'if (JSON.stringify(args) === JSON.stringify(["--no-auto-update", "version"])) { console.log("1.0.3"); process.exit(0); }',
      "const lines = readline.createInterface({ input: process.stdin });",
      `const modelState = ${JSON.stringify(modelState)};`,
      `const authMethods = ${JSON.stringify(authMethods)};`,
      'const send = (message) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");',
      'lines.on("line", (line) => {',
      "  const message = JSON.parse(line);",
      '  if (message.method === "initialize") {',
      "    send({ id: message.id, result: {",
      `      _meta: { defaultAuthMethodId: ${JSON.stringify(input.authenticated ? "cached_token" : "grok.com")}, modelState },`,
      "      agentCapabilities: { sessionCapabilities: { close: {}, resume: {} } },",
      "      authMethods,",
      "      protocolVersion: 1",
      "    } });",
      '  } else if (message.method === "authenticate") {',
      ...(input.authFailure
        ? [
            `    send({ id: message.id, error: { code: -32000, message: ${JSON.stringify(input.authFailure)} } });`,
          ]
        : ["    send({ id: message.id, result: {} });"]),
      '  } else if (message.method === "_x.ai/billing") {',
      "    send({ id: message.id, result: { config: {",
      '      creditUsagePercent: 27, currentPeriod: { type: "weekly", end: "2026-08-27T00:00:00Z" },',
      "      prepaidBalance: 99, history: [{ private: true }]",
      '    }, subscriptionTier: "private-plan" } });',
      "  }",
      "});",
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(binPath, 0o755);
}

function createOpenCodeAgentTargetState(
  binPath: string
): AgentTargetState & { targetKind: "builtin" } {
  return createBuiltinAgentTargetState("opencode", "OpenCode", binPath);
}
