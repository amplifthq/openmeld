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
import { isHomebrewCommandPath } from "../src/agents/controller-command-paths";
import type { AgentTargetState } from "../src/agents/registry";
import { createDefaultRuntimeAgentControllerSettings } from "../src/config/runtime-config";
import {
  CLAUDE_CODE_HOMEBREW_CASK_RESPONSE,
  CLAUDE_CODE_HOMEBREW_CASK_URL,
  CURSOR_HOMEBREW_CASK_URL,
  GROK_STABLE_VERSION_URL,
  OPENCODE_GITHUB_RELEASES_URL,
  OPENCODE_HOMEBREW_FORMULA_RESPONSE,
  OPENCODE_HOMEBREW_FORMULA_URL,
  OPENCODE_TAP_FORMULA_SOURCE,
  OPENCODE_TAP_FORMULA_URL,
} from "./fixtures/homebrew-latest-versions";
import {
  CLAUDE_CODE_NPM_LATEST_RESPONSE,
  CLAUDE_CODE_NPM_LATEST_URL,
  OPENCODE_NPM_LATEST_RESPONSE,
  OPENCODE_NPM_LATEST_URL,
} from "./fixtures/opencode-npm-latest";

const { createOpencodeClientMock } = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn(),
}));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: createOpencodeClientMock,
}));

beforeEach(() => {
  vi.resetModules();
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
});

afterEach(() => {
  createOpencodeClientMock.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("agent controller version advisory", () => {
  it("recognizes Homebrew formula, cask, and shim paths", () => {
    expect(isHomebrewCommandPath("/opt/homebrew/bin/opencode")).toBe(true);
    expect(
      isHomebrewCommandPath(
        "/opt/homebrew/Cellar/opencode/1.17.15/bin/opencode"
      )
    ).toBe(true);
    expect(
      isHomebrewCommandPath("/opt/homebrew/Caskroom/claude-code/2.1.197/claude")
    ).toBe(true);
    expect(
      isHomebrewCommandPath("/usr/local/Caskroom/codex/0.144.1/codex")
    ).toBe(true);
  });

  it("does not compare ChatGPT app's bundled Codex with the standalone CLI channel", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-chatgpt-codex-"));
    try {
      const commandPath = join(
        home,
        "Applications",
        "ChatGPT.app",
        "Contents",
        "Resources",
        "codex"
      );
      await writeCodexExecutable(commandPath, "0.149.0-alpha.4.3");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:codex",
        state: createAgentTargetState("codex", "Codex", commandPath),
      });

      expect(snapshot.version).toBe("0.149.0-alpha.4.3");
      expect(snapshot.versionAdvisory).toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("reports the Cursor update command from its managed version path", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-cursor-version-"));
    try {
      const binPath = join(
        home,
        ".local",
        "share",
        "cursor-agent",
        "versions",
        "2026.07.16-899851b",
        "cursor-agent"
      );
      await writeCursorExecutable(binPath);
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === CURSOR_HOMEBREW_CASK_URL) {
          return Promise.resolve(
            Response.json({
              token: "cursor-cli",
              version: "2026.08.04-aaa8809",
            })
          );
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:cursor",
        state: {
          ...createAgentTargetState("cursor", "Cursor", binPath),
          launchContract: {
            kind: "node_script",
            nodePath: "/usr/bin/env",
            scriptPath: binPath,
          },
        },
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "2026.07.16-899851b",
        latestVersion: "2026.08.04-aaa8809",
        status: "behind_latest",
        updateCommand: "cursor-agent update",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it.each([
    {
      auth: "unauthenticated" as const,
      currentVersion: "2026.03.11-6dfa30c",
      name: "an unsigned older Cursor CLI on macOS or Linux",
      platform: "linux" as NodeJS.Platform,
      updateCommand: "curl https://cursor.com/install -fsS | bash",
    },
    {
      auth: "unknown" as const,
      currentVersion: "2026.03.11-6dfa30c",
      name: "an older Cursor CLI whose sign-in check did not finish",
      platform: "linux" as NodeJS.Platform,
      updateCommand: "curl https://cursor.com/install -fsS | bash",
    },
    {
      auth: "authenticated" as const,
      currentVersion: "2026.03.11-6dfa30c",
      name: "a signed-in older Cursor CLI",
      platform: "linux" as NodeJS.Platform,
      updateCommand: "cursor-agent update",
    },
    {
      auth: "unauthenticated" as const,
      currentVersion: "2026.07.17-3e2a980",
      name: "an unsigned Cursor CLI that can update itself",
      platform: "linux" as NodeJS.Platform,
      updateCommand: "cursor-agent update",
    },
    {
      auth: "unauthenticated" as const,
      currentVersion: "2026.03.11-6dfa30c",
      name: "an unsigned older Cursor CLI on Windows",
      platform: "win32" as NodeJS.Platform,
      updateCommand: "irm 'https://cursor.com/install?win32=true' | iex",
    },
  ])("reports the Cursor update command for $name", async ({
    auth,
    currentVersion,
    platform,
    updateCommand,
  }) => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-cursor-update-"));
    const platformSpy = vi
      .spyOn(process, "platform", "get")
      .mockReturnValue(platform);
    try {
      const binPath = join(home, ".local", "bin", "cursor-agent");
      await writeCursorExecutable(binPath, { auth, version: currentVersion });
      vi.stubGlobal(
        "fetch",
        vi.fn((input: string | URL | Request) => {
          const url = String(input);
          if (url === CURSOR_HOMEBREW_CASK_URL) {
            return Promise.resolve(
              Response.json({
                token: "cursor-cli",
                version: "2026.10.19-6bbf2c4",
              })
            );
          }
          throw new Error(`Unexpected version lookup: ${url}`);
        })
      );

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:cursor",
        state: {
          ...createAgentTargetState("cursor", "Cursor", binPath),
          launchContract: {
            kind: "node_script",
            nodePath: "/usr/bin/env",
            scriptPath: binPath,
          },
        },
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion,
        latestVersion: "2026.10.19-6bbf2c4",
        status: "behind_latest",
        updateCommand,
      });
      if (auth === "unknown") {
        expect(snapshot.auth.status).toBe("unknown");
        expect(snapshot.check).toMatchObject({ status: "failed" });
      }
    } finally {
      platformSpy.mockRestore();
      await rm(home, { force: true, recursive: true });
    }
  });

  it("keeps the Homebrew upgrade for an unsigned older Cursor cask", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-cursor-cask-"));
    try {
      const caskPath = join(
        home,
        "opt",
        "homebrew",
        "Caskroom",
        "cursor-cli",
        "2026.03.11",
        "cursor-agent"
      );
      const commandPath = join(home, "opt", "homebrew", "bin", "cursor-agent");
      await writeCursorExecutable(caskPath, {
        auth: "unauthenticated",
        version: "2026.03.11-6dfa30c",
      });
      await mkdir(join(commandPath, ".."), { recursive: true });
      await symlink(caskPath, commandPath);
      vi.stubGlobal(
        "fetch",
        vi.fn((input: string | URL | Request) => {
          const url = String(input);
          if (url === CURSOR_HOMEBREW_CASK_URL) {
            return Promise.resolve(
              Response.json({
                token: "cursor-cli",
                version: "2026.10.19-6bbf2c4",
              })
            );
          }
          throw new Error(`Unexpected version lookup: ${url}`);
        })
      );

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:cursor",
        state: createAgentTargetState("cursor", "Cursor", commandPath),
      });

      expect(snapshot.auth.status).toBe("unauthenticated");
      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "2026.03.11-6dfa30c",
        latestVersion: "2026.10.19-6bbf2c4",
        status: "behind_latest",
        updateCommand: "brew upgrade --cask cursor-cli",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it.each([
    {
      commandPathSegments: [".bun", "bin", "opencode"],
      installMedium: "bun",
      updateCommand: "bun i -g opencode-ai@latest",
    },
    {
      commandPathSegments: [".local", "share", "pnpm", "opencode"],
      installMedium: "pnpm",
      updateCommand: "pnpm add -g opencode-ai@latest",
    },
    {
      commandPathSegments: [
        "lib",
        "node_modules",
        "opencode-ai",
        "bin",
        "opencode",
      ],
      installMedium: "npm",
      updateCommand: "npm install -g opencode-ai@latest",
    },
  ])("keeps the npm baseline for a $installMedium path when realpath also looks like Homebrew", async ({
    commandPathSegments,
    updateCommand,
  }) => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-package-manager-priority-")
    );
    try {
      const cellarBinPath = join(
        home,
        "opt",
        "homebrew",
        "cellar",
        "opencode",
        "1.17.18",
        "bin",
        "opencode"
      );
      const commandPath = join(home, ...commandPathSegments);
      await writeOpenCodeExecutable(cellarBinPath, "1.17.18");
      await mkdir(join(commandPath, ".."), { recursive: true });
      await symlink(cellarBinPath, commandPath);

      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === OPENCODE_NPM_LATEST_URL) {
          return Promise.resolve(Response.json(OPENCODE_NPM_LATEST_RESPONSE));
        }
        if (url === OPENCODE_HOMEBREW_FORMULA_URL) {
          return Promise.resolve(
            Response.json(OPENCODE_HOMEBREW_FORMULA_RESPONSE)
          );
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createAgentTargetState("opencode", "OpenCode", commandPath),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "1.17.18",
        latestVersion: "1.17.18",
        status: "current",
        updateCommand,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(OPENCODE_NPM_LATEST_URL, {
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("does not fall back to npm when a Homebrew baseline lookup fails", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-brew-opencode-failure-")
    );
    try {
      const cellarBinPath = join(
        home,
        "opt",
        "homebrew",
        "cellar",
        "opencode",
        "1.17.15",
        "bin",
        "opencode"
      );
      const commandPath = join(home, "bin", "opencode");
      await writeOpenCodeExecutable(cellarBinPath, "1.17.15");
      await mkdir(join(home, "bin"), { recursive: true });
      await symlink(cellarBinPath, commandPath);

      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === OPENCODE_HOMEBREW_FORMULA_URL) {
          return Promise.resolve(new Response(null, { status: 503 }));
        }
        if (url === OPENCODE_NPM_LATEST_URL) {
          return Promise.resolve(Response.json(OPENCODE_NPM_LATEST_RESPONSE));
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createAgentTargetState("opencode", "OpenCode", commandPath),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "1.17.15",
        latestVersion: null,
        message: "OpenMeld could not check the latest controller version.",
        status: "unknown",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).not.toHaveBeenCalledWith(
        OPENCODE_NPM_LATEST_URL,
        expect.anything()
      );
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("uses the Homebrew formula baseline for a Homebrew OpenCode install", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-brew-opencode-"));
    try {
      const cellarBinPath = join(
        home,
        "opt",
        "homebrew",
        "cellar",
        "opencode",
        "1.17.15",
        "bin",
        "opencode"
      );
      const commandPath = join(home, "bin", "opencode");
      await writeOpenCodeExecutable(cellarBinPath, "1.17.15");
      await mkdir(join(home, "bin"), { recursive: true });
      await symlink(cellarBinPath, commandPath);

      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === OPENCODE_HOMEBREW_FORMULA_URL) {
          return Promise.resolve(
            Response.json(OPENCODE_HOMEBREW_FORMULA_RESPONSE)
          );
        }
        if (url === OPENCODE_NPM_LATEST_URL) {
          return Promise.resolve(Response.json(OPENCODE_NPM_LATEST_RESPONSE));
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createAgentTargetState("opencode", "OpenCode", commandPath),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "1.17.15",
        latestVersion: "1.17.15",
        message: null,
        status: "current",
        updateCommand: "brew upgrade opencode",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(OPENCODE_HOMEBREW_FORMULA_URL, {
        headers: { accept: "application/json" },
        signal: expect.any(AbortSignal),
      });
      expect(fetchMock).not.toHaveBeenCalledWith(
        OPENCODE_NPM_LATEST_URL,
        expect.anything()
      );
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("uses the installed Homebrew tap formula instead of Homebrew core", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-brew-tap-opencode-")
    );
    try {
      const cellarBinPath = join(
        home,
        "opt",
        "homebrew",
        "cellar",
        "opencode",
        "1.18.18",
        "bin",
        "opencode"
      );
      const commandPath = join(home, "opt", "homebrew", "bin", "opencode");
      await writeOpenCodeExecutable(cellarBinPath, "1.18.18");
      await writeHomebrewReceipt(
        join(cellarBinPath, "..", ".."),
        "anomalyco/tap"
      );
      await mkdir(join(home, "opt", "homebrew", "bin"), { recursive: true });
      await symlink(cellarBinPath, commandPath);

      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === OPENCODE_TAP_FORMULA_URL) {
          return Promise.resolve(new Response(OPENCODE_TAP_FORMULA_SOURCE));
        }
        if (
          url === OPENCODE_HOMEBREW_FORMULA_URL ||
          url === OPENCODE_NPM_LATEST_URL
        ) {
          throw new Error(`Unexpected version lookup: ${url}`);
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createAgentTargetState("opencode", "OpenCode", commandPath),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "1.18.18",
        latestVersion: "1.18.22",
        status: "behind_latest",
        updateCommand: "brew upgrade anomalyco/tap/opencode",
      });
      expect(fetchMock).toHaveBeenCalledWith(OPENCODE_TAP_FORMULA_URL, {
        headers: { accept: "text/plain" },
        signal: expect.any(AbortSignal),
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("uses GitHub releases for a native OpenCode install", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-native-opencode-"));
    try {
      const commandPath = join(home, ".opencode", "bin", "opencode");
      await writeOpenCodeExecutable(commandPath, "1.18.18");
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === OPENCODE_GITHUB_RELEASES_URL) {
          return Promise.resolve(
            Response.json({ tag_name: "v1.18.22", name: "v1.18.22" })
          );
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:opencode",
        state: createAgentTargetState("opencode", "OpenCode", commandPath),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "1.18.18",
        latestVersion: "1.18.22",
        status: "behind_latest",
        updateCommand: "opencode upgrade",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("uses Grok's official channel pointer for a native Grok Build install", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-native-grok-"));
    try {
      const commandPath = join(home, ".grok", "bin", "grok");
      await mkdir(join(commandPath, ".."), { recursive: true });
      await writeFile(
        commandPath,
        [
          "#!/bin/sh",
          'if [ "$1" = "--no-auto-update" ] && [ "$2" = "version" ]; then echo "grok 1.0.4"; exit 0; fi',
          'if [ "$1" = "version" ]; then echo "grok 1.0.4"; exit 0; fi',
          "exit 1",
          "",
        ].join("\n"),
        "utf8"
      );
      await chmod(commandPath, 0o755);
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === GROK_STABLE_VERSION_URL) {
          return Promise.resolve(new Response("1.0.5\n"));
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:grok-build",
        state: createAgentTargetState("grok-build", "Grok Build", commandPath),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        latestVersion: "1.0.5",
        status: "behind_latest",
        updateCommand: "grok update",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("uses the Homebrew cask baseline and preserves Claude update-command priority", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-brew-claude-"));
    try {
      const currentCaskPath = join(
        home,
        "opt",
        "homebrew",
        "caskroom",
        "claude-code",
        "2.1.197",
        "claude"
      );
      const currentCommandPath = join(home, ".local", "bin", "claude");
      await writeClaudeCodeExecutable(currentCaskPath, "2.1.197");
      await mkdir(join(home, ".local", "bin"), { recursive: true });
      await symlink(currentCaskPath, currentCommandPath);

      const behindCaskPath = join(
        home,
        "opt",
        "homebrew",
        "caskroom",
        "claude-code",
        "2.1.190",
        "claude"
      );
      const behindCommandPath = join(home, "bin", "claude");
      await writeClaudeCodeExecutable(behindCaskPath, "2.1.190");
      await mkdir(join(home, "bin"), { recursive: true });
      await symlink(behindCaskPath, behindCommandPath);

      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === CLAUDE_CODE_NPM_LATEST_URL) {
          return Promise.resolve(
            Response.json(CLAUDE_CODE_NPM_LATEST_RESPONSE)
          );
        }
        if (url === CLAUDE_CODE_HOMEBREW_CASK_URL) {
          return Promise.resolve(
            Response.json(CLAUDE_CODE_HOMEBREW_CASK_RESPONSE)
          );
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const currentSnapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:claude-code",
        state: createAgentTargetState(
          "claude-code",
          "Claude Code",
          currentCommandPath
        ),
      });
      const behindSnapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:claude-code",
        state: createAgentTargetState(
          "claude-code",
          "Claude Code",
          behindCommandPath
        ),
      });

      expect(currentSnapshot.versionAdvisory).toMatchObject({
        currentVersion: "2.1.197",
        latestVersion: "2.1.197",
        status: "current",
        updateCommand: "claude update",
      });
      expect(behindSnapshot.versionAdvisory).toMatchObject({
        currentVersion: "2.1.190",
        latestVersion: "2.1.197",
        status: "behind_latest",
        updateCommand: "brew upgrade --cask claude-code",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("uses a third-party Homebrew cask receipt from the Caskroom metadata directory", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-brew-tap-cask-"));
    try {
      const caskPath = join(
        home,
        "opt",
        "homebrew",
        "Caskroom",
        "claude-code",
        "2.1.197",
        "claude"
      );
      const commandPath = join(home, "opt", "homebrew", "bin", "claude");
      await writeClaudeCodeExecutable(caskPath, "2.1.197");
      const metadataDirectory = join(caskPath, "..", "..", ".metadata");
      await mkdir(metadataDirectory, { recursive: true });
      await writeHomebrewReceipt(metadataDirectory, "acme/agents");
      await mkdir(join(home, "opt", "homebrew", "bin"), { recursive: true });
      await symlink(caskPath, commandPath);

      const topLevelUrl =
        "https://raw.githubusercontent.com/acme/homebrew-agents/HEAD/claude-code.rb";
      const caskUrl =
        "https://raw.githubusercontent.com/acme/homebrew-agents/HEAD/Casks/claude-code.rb";
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === topLevelUrl) {
          return Promise.resolve(new Response("Not Found", { status: 404 }));
        }
        if (url === caskUrl) {
          return Promise.resolve(
            new Response('cask "claude-code" do\n  version "2.1.198"\nend\n')
          );
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:claude-code",
        state: createAgentTargetState(
          "claude-code",
          "Claude Code",
          commandPath
        ),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "2.1.197",
        latestVersion: "2.1.198",
        status: "behind_latest",
        updateCommand: "brew upgrade --cask acme/agents/claude-code",
      });
      expect(fetchMock).toHaveBeenNthCalledWith(1, topLevelUrl, {
        headers: { accept: "text/plain" },
        signal: expect.any(AbortSignal),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(2, topLevelUrl, {
        headers: { accept: "text/plain" },
        signal: expect.any(AbortSignal),
      });
      expect(fetchMock).toHaveBeenNthCalledWith(3, caskUrl, {
        headers: { accept: "text/plain" },
        signal: expect.any(AbortSignal),
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("recovers within one logical lookup when the fresh retry succeeds", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-version-retry-success-")
    );
    try {
      const commandPath = await createClaudeCodeCaskCommand({
        home,
        version: "2.1.197",
      });
      const warnMock = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      let requestCount = 0;
      const fetchMock = vi.fn(
        (input: string | URL | Request, init?: RequestInit) => {
          expect(init?.signal).toBeInstanceOf(AbortSignal);
          const url = String(input);
          if (url !== CLAUDE_CODE_HOMEBREW_CASK_URL) {
            throw new Error(`Unexpected version lookup: ${url}`);
          }
          requestCount += 1;
          return requestCount === 1
            ? Promise.resolve(new Response(null, { status: 503 }))
            : Promise.resolve(
                Response.json(CLAUDE_CODE_HOMEBREW_CASK_RESPONSE)
              );
        }
      );
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const state = createAgentTargetState(
        "claude-code",
        "Claude Code",
        commandPath
      );
      const recoveredSnapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:claude-code",
        state,
      });
      const cachedSuccessSnapshot =
        await resolveAgentControllerInterfaceSnapshot({
          agentControllerRef: "builtin:claude-code",
          state,
        });

      expect(recoveredSnapshot.versionAdvisory).toMatchObject({
        currentVersion: "2.1.197",
        latestVersion: "2.1.197",
        status: "current",
      });
      expect(cachedSuccessSnapshot.versionAdvisory).toMatchObject({
        latestVersion: "2.1.197",
        status: "current",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]?.[1]?.signal).not.toBe(
        fetchMock.mock.calls[0]?.[1]?.signal
      );
      expect(warnMock).toHaveBeenCalledTimes(1);
      const recoveredWarning = String(warnMock.mock.calls[0]?.[0]);
      expect(recoveredWarning).toContain(
        "[openmeld.agent_controller.latest_version_lookup_attempt_failed]"
      );
      expect(recoveredWarning).toContain('"attempt":1');
      expect(recoveredWarning).toContain('"recovered":true');
      expect(recoveredWarning).toContain('"statusCode":503');
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("caches a failed logical lookup only after both attempts fail", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-version-retry-failure-")
    );
    try {
      const commandPath = await createClaudeCodeCaskCommand({
        home,
        version: "2.1.197",
      });
      const warnMock = vi
        .spyOn(console, "warn")
        .mockImplementation(() => undefined);
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url !== CLAUDE_CODE_HOMEBREW_CASK_URL) {
          throw new Error(`Unexpected version lookup: ${url}`);
        }
        return Promise.resolve(new Response(null, { status: 503 }));
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const state = createAgentTargetState(
        "claude-code",
        "Claude Code",
        commandPath
      );
      const failedSnapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:claude-code",
        state,
      });
      const cachedFailureSnapshot =
        await resolveAgentControllerInterfaceSnapshot({
          agentControllerRef: "builtin:claude-code",
          state,
        });

      expect(failedSnapshot.versionAdvisory).toMatchObject({
        latestVersion: null,
        status: "unknown",
      });
      expect(cachedFailureSnapshot.versionAdvisory).toMatchObject({
        latestVersion: null,
        status: "unknown",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(warnMock).toHaveBeenCalledTimes(2);
      const failureWarnings = warnMock.mock.calls.map((call) =>
        String(call[0])
      );
      expect(failureWarnings[0]).toContain('"attempt":1');
      expect(failureWarnings[0]).toContain('"recovered":false');
      expect(failureWarnings[0]).toContain('"statusCode":503');
      expect(failureWarnings[1]).toContain('"attempt":2');
      expect(failureWarnings[1]).toContain('"recovered":false');
      expect(failureWarnings[1]).toContain('"statusCode":503');
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("retries a failed latest-version lookup after five minutes", async () => {
    const home = await mkdtemp(
      join(tmpdir(), "openmeld-aci-version-cache-recovery-")
    );
    try {
      const commandPath = await createClaudeCodeCaskCommand({
        home,
        version: "2.1.197",
      });

      let nowMs = 1_000_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => nowMs);
      let requestCount = 0;
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url !== CLAUDE_CODE_HOMEBREW_CASK_URL) {
          throw new Error(`Unexpected version lookup: ${url}`);
        }
        requestCount += 1;
        return requestCount <= 2
          ? Promise.resolve(new Response(null, { status: 503 }))
          : Promise.resolve(Response.json(CLAUDE_CODE_HOMEBREW_CASK_RESPONSE));
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const state = createAgentTargetState(
        "claude-code",
        "Claude Code",
        commandPath
      );
      const firstSnapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:claude-code",
        state,
      });

      nowMs += 4 * 60 * 1000;
      const cachedFailureSnapshot =
        await resolveAgentControllerInterfaceSnapshot({
          agentControllerRef: "builtin:claude-code",
          state,
        });

      expect(firstSnapshot.versionAdvisory).toMatchObject({
        latestVersion: null,
        status: "unknown",
      });
      expect(cachedFailureSnapshot.versionAdvisory).toMatchObject({
        latestVersion: null,
        status: "unknown",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);

      nowMs += 60 * 1000 + 1;
      const recoveredSnapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:claude-code",
        state,
      });

      expect(recoveredSnapshot.versionAdvisory).toMatchObject({
        currentVersion: "2.1.197",
        latestVersion: "2.1.197",
        status: "current",
      });
      expect(fetchMock).toHaveBeenCalledTimes(3);
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("compares the semantic-version core of a cask version with a build suffix", async () => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-aci-brew-cask-build-"));
    try {
      const caskBinPath = join(
        home,
        "opt",
        "homebrew",
        "caskroom",
        "codex",
        "0.143.0",
        "codex"
      );
      const commandPath = join(home, "bin", "codex");
      await writeCodexExecutable(caskBinPath, "0.143.0");
      await mkdir(join(home, "bin"), { recursive: true });
      await symlink(caskBinPath, commandPath);

      const caskUrl = "https://formulae.brew.sh/api/cask/codex.json";
      const fetchMock = vi.fn((input: string | URL | Request) => {
        const url = String(input);
        if (url === caskUrl) {
          return Promise.resolve(
            Response.json({ token: "codex", version: "0.143.0,45" })
          );
        }
        throw new Error(`Unexpected version lookup: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);

      const { resolveAgentControllerInterfaceSnapshot } = await import(
        "../src/local-service/inventory/agent-controller-interface"
      );
      const snapshot = await resolveAgentControllerInterfaceSnapshot({
        agentControllerRef: "builtin:codex",
        state: createAgentTargetState("codex", "Codex", commandPath),
      });

      expect(snapshot.versionAdvisory).toMatchObject({
        currentVersion: "0.143.0",
        latestVersion: "0.143.0,45",
        message: null,
        status: "current",
        updateCommand: "brew upgrade --cask codex",
      });
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });
});

async function writeOpenCodeExecutable(
  binPath: string,
  version: string
): Promise<void> {
  await mkdir(join(binPath, ".."), { recursive: true });
  await writeFile(
    binPath,
    [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi`,
      'if [ "$1" = "serve" ]; then echo "opencode server listening on http://127.0.0.1:34567"; sleep 60; exit 0; fi',
      "exit 1",
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(binPath, 0o755);
}

async function writeClaudeCodeExecutable(
  binPath: string,
  version: string
): Promise<void> {
  await mkdir(join(binPath, ".."), { recursive: true });
  await writeFile(
    binPath,
    [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi`,
      'if [ "$1" = "auth" ] && [ "$2" = "status" ] && [ "$3" = "--json" ]; then echo \'{"loggedIn":true}\'; exit 0; fi',
      "exit 1",
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(binPath, 0o755);
}

async function writeCursorExecutable(
  binPath: string,
  input: {
    auth?: "authenticated" | "unauthenticated" | "unknown";
    version?: string;
  } = {}
): Promise<void> {
  const version = input.version ?? "2026.07.16-899851b";
  const auth = input.auth ?? "authenticated";
  const statusCommand =
    auth === "unknown"
      ? "exit 1"
      : `echo '{"status":"${auth}","message":"Logged in"}'; exit 0`;
  await mkdir(join(binPath, ".."), { recursive: true });
  await writeFile(
    binPath,
    [
      "#!/bin/sh",
      `if [ "$1" = "--version" ]; then echo "${version}"; exit 0; fi`,
      `if [ "$1" = "status" ] && [ "$2" = "--format" ] && [ "$3" = "json" ]; then ${statusCommand}; fi`,
      "exit 1",
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(binPath, 0o755);
}

async function createClaudeCodeCaskCommand(input: {
  home: string;
  version: string;
}): Promise<string> {
  const caskBinPath = join(
    input.home,
    "opt",
    "homebrew",
    "caskroom",
    "claude-code",
    input.version,
    "claude"
  );
  const commandPath = join(input.home, "bin", "claude");
  await writeClaudeCodeExecutable(caskBinPath, input.version);
  await mkdir(join(input.home, "bin"), { recursive: true });
  await symlink(caskBinPath, commandPath);
  return commandPath;
}

async function writeCodexExecutable(
  binPath: string,
  version: string
): Promise<void> {
  await mkdir(join(binPath, ".."), { recursive: true });
  await writeFile(
    binPath,
    [
      "#!/bin/sh",
      'if [ "$1" = "app-server" ]; then exit 1; fi',
      `if [ "$1" = "--version" ]; then echo "codex ${version}"; exit 0; fi`,
      "exit 0",
      "",
    ].join("\n"),
    "utf8"
  );
  await chmod(binPath, 0o755);
}

async function writeHomebrewReceipt(
  installDir: string,
  tap: string
): Promise<void> {
  await writeFile(
    join(installDir, "INSTALL_RECEIPT.json"),
    JSON.stringify({ source: { tap } }),
    "utf8"
  );
}

function createAgentTargetState(
  agentId: "claude-code" | "codex" | "cursor" | "grok-build" | "opencode",
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
