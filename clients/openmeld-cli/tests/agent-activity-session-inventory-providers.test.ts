import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectBinding } from "../src/agent-activity/project-bindings";
import { recordOpenMeldCreatedLocalAgentSession } from "../src/agent-activity/session-inventory-origin-store";
import {
  discoverClaudeRetainedSessions,
  discoverCodexThreads,
  discoverGrokBuildRetainedSessions,
  discoverLocalAgentSessionProviders,
  discoverOpenCodeRetainedSessions,
} from "../src/agent-activity/session-inventory-provider-adapters";

const launchMocks = vi.hoisted(() => ({
  claude: vi.fn(),
  codex: vi.fn(),
  grok: vi.fn(),
  opencode: vi.fn(),
}));

vi.mock("@openmeld/adapter-claude-code", () => ({
  resolveInstalledClaudeCodeLaunchCandidates: launchMocks.claude,
}));
vi.mock("@openmeld/adapter-codex", () => ({
  resolveInstalledCodexLaunchCandidates: launchMocks.codex,
}));
vi.mock("@openmeld/adapter-grok-build", () => ({
  resolveInstalledGrokBuildLaunchCandidates: launchMocks.grok,
}));
vi.mock("@openmeld/adapter-opencode", () => ({
  resolveInstalledOpenCodeLaunchCandidates: launchMocks.opencode,
}));

const NOW_MS = Date.UTC(2026, 7, 20, 10, 0, 0);
let root = "";
let repositoryPath = "";
let binding: ProjectBinding;

beforeEach(async () => {
  const notInstalled = {
    errorMessage: "not installed",
    ok: false as const,
    reason: "not_installed" as const,
  };
  launchMocks.claude.mockResolvedValue(notInstalled);
  launchMocks.codex.mockResolvedValue(notInstalled);
  launchMocks.grok.mockResolvedValue(notInstalled);
  launchMocks.opencode.mockResolvedValue(notInstalled);
  root = await mkdtemp(join(tmpdir(), "openmeld-session-inventory-"));
  repositoryPath = join(root, "openmeld");
  await mkdir(repositoryPath, { recursive: true });
  repositoryPath = await realpath(repositoryPath);
  binding = {
    bindingGeneration: "binding-generation-1",
    boundAtMs: NOW_MS - 1000,
    isDefault: true,
    organizationId: "org-1",
    projectId: "project-1",
    projectSlug: "openmeld",
    repositoryFingerprint: null,
    repositoryPath,
  };
});

afterEach(async () => {
  await rm(root, { force: true, recursive: true });
});

describe("Local Agent Session Inventory provider adapters", () => {
  it("preserves Codex inventory when a retained thread record is malformed", async () => {
    const serverPath = join(root, "malformed-codex-app-server.mjs");
    await writeFile(
      serverPath,
      buildFakeCodexAppServer(repositoryPath, { malformedThread: true }),
      "utf8"
    );
    launchMocks.codex.mockResolvedValue({
      candidates: [
        {
          commandPath: process.execPath,
          launchContract: {
            argsPrefix: [serverPath],
            commandPath: process.execPath,
            kind: "executable",
          },
        },
      ],
      ok: true,
    });

    const discoveries = await discoverLocalAgentSessionProviders({
      bindings: [binding],
      homeDir: root,
      nowMs: NOW_MS,
      rootDir: root,
    });

    expect(discoveries.find(({ provider }) => provider === "codex")).toEqual({
      agentControllerRef: "builtin:codex",
      problemCode: "codex_thread_list_failed",
      provider: "codex",
      result: "error",
    });
  });

  it("preserves Claude and Grok inventory when retained roots cannot be inspected", async () => {
    const claudeConfigDir = join(root, "claude-config-error");
    const grokHome = join(root, "grok-home-error");
    const claudeRegistryPath = join(root, "claude-registry.mjs");
    await mkdir(claudeConfigDir, { recursive: true });
    await mkdir(grokHome, { recursive: true });
    await symlink(
      join(claudeConfigDir, "projects"),
      join(claudeConfigDir, "projects")
    );
    await symlink(join(grokHome, "sessions"), join(grokHome, "sessions"));
    await writeFile(
      claudeRegistryPath,
      'process.stdout.write("[]\\n");\n',
      "utf8"
    );
    launchMocks.claude.mockResolvedValue({
      candidates: [
        {
          commandPath: process.execPath,
          launchContract: {
            argsPrefix: [claudeRegistryPath],
            commandPath: process.execPath,
            kind: "executable",
          },
        },
      ],
      ok: true,
    });
    launchMocks.grok.mockResolvedValue({
      candidates: [
        {
          commandPath: "grok",
          launchContract: {
            argsPrefix: [],
            commandPath: "grok",
            kind: "executable",
          },
        },
      ],
      ok: true,
    });

    const previousClaudeConfigDir = process.env.CLAUDE_CONFIG_DIR;
    const previousGrokHome = process.env.GROK_HOME;
    process.env.CLAUDE_CONFIG_DIR = claudeConfigDir;
    process.env.GROK_HOME = grokHome;
    try {
      const discoveries = await discoverLocalAgentSessionProviders({
        bindings: [binding],
        homeDir: root,
        nowMs: NOW_MS,
        rootDir: root,
      });

      expect(
        discoveries.find(({ provider }) => provider === "claude-code")
      ).toEqual({
        agentControllerRef: "builtin:claude-code",
        problemCode: "claude_code_retained_inventory_failed",
        provider: "claude-code",
        result: "error",
      });
      expect(
        discoveries.find(({ provider }) => provider === "grok-build")
      ).toEqual({
        agentControllerRef: "builtin:grok-build",
        problemCode: "grok_build_retained_inventory_failed",
        provider: "grok-build",
        result: "error",
      });
    } finally {
      if (previousClaudeConfigDir === undefined) {
        Reflect.deleteProperty(process.env, "CLAUDE_CONFIG_DIR");
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousClaudeConfigDir;
      }
      if (previousGrokHome === undefined) {
        Reflect.deleteProperty(process.env, "GROK_HOME");
      } else {
        process.env.GROK_HOME = previousGrokHome;
      }
    }
  });

  it("preserves the last inventory when an installed provider is temporarily not launchable", async () => {
    launchMocks.codex.mockResolvedValue({
      errorMessage: "launch timed out",
      ok: false,
      reason: "not_launchable",
    });

    const discoveries = await discoverLocalAgentSessionProviders({
      bindings: [binding],
      homeDir: root,
      nowMs: NOW_MS,
      rootDir: root,
    });

    expect(discoveries.find(({ provider }) => provider === "codex")).toEqual({
      agentControllerRef: "builtin:codex",
      problemCode: "codex_provider_not_launchable",
      provider: "codex",
      result: "error",
    });
    expect(
      discoveries.find(({ provider }) => provider === "claude-code")
    ).toMatchObject({
      problemCode: "claude_code_provider_not_installed",
      result: "unsupported",
    });
  });

  it("preserves Claude inventory when the complete native registry cannot be read", async () => {
    const configDir = join(root, "claude-config");
    const projectsDir = join(configDir, "projects", "openmeld");
    const registryPath = join(root, "invalid-claude-registry.mjs");
    await mkdir(projectsDir, { recursive: true });
    await writeFile(
      join(projectsDir, "session.jsonl"),
      `${JSON.stringify({
        cwd: repositoryPath,
        sessionId: "claude-retained",
        timestamp: "2026-08-20T09:00:00.000Z",
      })}\n`,
      "utf8"
    );
    await writeFile(registryPath, 'process.stdout.write("not-json\\n");\n');
    launchMocks.claude.mockResolvedValue({
      candidates: [
        {
          commandPath: process.execPath,
          launchContract: {
            argsPrefix: [registryPath],
            commandPath: process.execPath,
            kind: "executable",
          },
        },
      ],
      ok: true,
    });

    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      const discoveries = await discoverLocalAgentSessionProviders({
        bindings: [binding],
        homeDir: root,
        nowMs: NOW_MS,
        rootDir: root,
      });

      expect(
        discoveries.find(({ provider }) => provider === "claude-code")
      ).toEqual({
        agentControllerRef: "builtin:claude-code",
        problemCode: "claude_code_retained_inventory_failed",
        provider: "claude-code",
        result: "error",
      });
    } finally {
      if (previousConfigDir === undefined) {
        Reflect.deleteProperty(process.env, "CLAUDE_CONFIG_DIR");
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
    }
  });

  it("includes a registry-only Claude Session in the complete inventory", async () => {
    const configDir = join(root, "claude-config-registry-only");
    const registryPath = join(root, "claude-registry-only.mjs");
    await mkdir(join(configDir, "projects"), { recursive: true });
    await writeFile(
      registryPath,
      `process.stdout.write(JSON.stringify([${JSON.stringify({
        cwd: repositoryPath,
        id: "agent-registry-only",
        kind: "local",
        name: "Registry agent name is not a Session title",
        sessionId: "claude-registry-only",
        startedAt: NOW_MS - 1000,
        state: "running",
      })}]) + "\\n");\n`,
      "utf8"
    );
    launchMocks.claude.mockResolvedValue({
      candidates: [
        {
          commandPath: process.execPath,
          launchContract: {
            argsPrefix: [registryPath],
            commandPath: process.execPath,
            kind: "executable",
          },
        },
      ],
      ok: true,
    });

    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      const discoveries = await discoverLocalAgentSessionProviders({
        bindings: [binding],
        homeDir: root,
        nowMs: NOW_MS,
        rootDir: root,
      });

      expect(
        discoveries.find(({ provider }) => provider === "claude-code")
      ).toMatchObject({
        result: "sessions",
        sessions: [
          {
            session: {
              lastActiveAtMs: NOW_MS - 1000,
              nativeSessionId: "claude-registry-only",
              nativeSessionTitle: null,
              startedAtMs: null,
              status: "working",
            },
          },
        ],
      });
    } finally {
      if (previousConfigDir === undefined) {
        Reflect.deleteProperty(process.env, "CLAUDE_CONFIG_DIR");
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
    }
  });

  it("fails closed when a Claude registry Session lacks required metadata", async () => {
    const configDir = join(root, "claude-config-registry-incomplete");
    const registryPath = join(root, "claude-registry-incomplete.mjs");
    await mkdir(join(configDir, "projects"), { recursive: true });
    await writeFile(
      registryPath,
      `process.stdout.write(JSON.stringify([${JSON.stringify({
        id: "agent-registry-incomplete",
        sessionId: "claude-registry-incomplete",
        startedAt: NOW_MS - 1000,
        state: "running",
      })}]) + "\\n");\n`,
      "utf8"
    );
    launchMocks.claude.mockResolvedValue({
      candidates: [
        {
          commandPath: process.execPath,
          launchContract: {
            argsPrefix: [registryPath],
            commandPath: process.execPath,
            kind: "executable",
          },
        },
      ],
      ok: true,
    });

    const previousConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CONFIG_DIR = configDir;
    try {
      const discoveries = await discoverLocalAgentSessionProviders({
        bindings: [binding],
        homeDir: root,
        nowMs: NOW_MS,
        rootDir: root,
      });

      expect(
        discoveries.find(({ provider }) => provider === "claude-code")
      ).toEqual({
        agentControllerRef: "builtin:claude-code",
        problemCode: "claude_code_retained_inventory_failed",
        provider: "claude-code",
        result: "error",
      });
    } finally {
      if (previousConfigDir === undefined) {
        Reflect.deleteProperty(process.env, "CLAUDE_CONFIG_DIR");
      } else {
        process.env.CLAUDE_CONFIG_DIR = previousConfigDir;
      }
    }
  });

  it("preserves OpenCode inventory when its database cannot be inspected", async () => {
    const xdgDataHome = join(root, "xdg-data");
    const databaseDirectory = join(xdgDataHome, "opencode");
    const databasePath = join(databaseDirectory, "opencode.db");
    await mkdir(databaseDirectory, { recursive: true });
    await symlink(databasePath, databasePath);
    launchMocks.opencode.mockResolvedValue({
      candidates: [
        {
          commandPath: "opencode",
          launchContract: {
            argsPrefix: [],
            commandPath: "opencode",
            kind: "executable",
          },
        },
      ],
      ok: true,
    });

    const discoveries = await discoverLocalAgentSessionProviders({
      bindings: [binding],
      homeDir: root,
      nowMs: NOW_MS,
      rootDir: root,
      xdgDataHome,
    });

    expect(discoveries.find(({ provider }) => provider === "opencode")).toEqual(
      {
        agentControllerRef: "builtin:opencode",
        problemCode: "opencode_retained_inventory_failed",
        provider: "opencode",
        result: "error",
      }
    );
  });

  it("preserves OpenCode inventory when a retained row is malformed", async () => {
    const xdgDataHome = join(root, "xdg-data");
    const databaseDirectory = join(xdgDataHome, "opencode");
    const databasePath = join(databaseDirectory, "opencode.db");
    await mkdir(databaseDirectory, { recursive: true });
    const database = new Database(databasePath);
    database.exec(`CREATE TABLE session (
      id TEXT,
      directory TEXT,
      title TEXT,
      time_created INTEGER,
      time_updated INTEGER,
      time_archived INTEGER
    )`);
    const insert = database.prepare(
      "INSERT INTO session (id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, NULL)"
    );
    insert.run(
      "opencode-valid",
      repositoryPath,
      "Valid native title",
      NOW_MS - 2000,
      NOW_MS - 1000
    );
    insert.run(
      null,
      repositoryPath,
      "Malformed native title",
      NOW_MS - 2000,
      NOW_MS - 500
    );
    database.close();
    launchMocks.opencode.mockResolvedValue({
      candidates: [
        {
          commandPath: "opencode",
          launchContract: {
            argsPrefix: [],
            commandPath: "opencode",
            kind: "executable",
          },
        },
      ],
      ok: true,
    });

    const discoveries = await discoverLocalAgentSessionProviders({
      bindings: [binding],
      homeDir: root,
      nowMs: NOW_MS,
      rootDir: root,
      xdgDataHome,
    });

    expect(discoveries.find(({ provider }) => provider === "opencode")).toEqual(
      {
        agentControllerRef: "builtin:opencode",
        problemCode: "opencode_retained_inventory_failed",
        provider: "opencode",
        result: "error",
      }
    );
  });

  it("discovers OpenCode from the effective XDG data home", async () => {
    const xdgDataHome = join(root, "xdg-data");
    const databaseDirectory = join(xdgDataHome, "opencode");
    const databasePath = join(databaseDirectory, "opencode.db");
    await mkdir(databaseDirectory, { recursive: true });
    const database = new Database(databasePath);
    database.exec(`CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      title TEXT,
      time_created INTEGER,
      time_updated INTEGER NOT NULL,
      time_archived INTEGER
    )`);
    database
      .prepare(
        "INSERT INTO session (id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, NULL)"
      )
      .run(
        "opencode-xdg",
        repositoryPath,
        "XDG native title",
        NOW_MS - 2000,
        NOW_MS - 1000
      );
    database.close();
    launchMocks.opencode.mockResolvedValue({
      candidates: [
        {
          commandPath: "opencode",
          launchContract: {
            argsPrefix: [],
            commandPath: "opencode",
            kind: "executable",
          },
        },
      ],
      ok: true,
    });

    const discoveries = await discoverLocalAgentSessionProviders({
      bindings: [binding],
      homeDir: join(root, "unrelated-home"),
      nowMs: NOW_MS,
      rootDir: root,
      xdgDataHome,
    });

    expect(
      discoveries.find(({ provider }) => provider === "opencode")
    ).toMatchObject({
      result: "sessions",
      sessions: [
        {
          session: {
            nativeSessionId: "opencode-xdg",
            nativeSessionTitle: "XDG native title",
          },
        },
      ],
    });
  });

  it("exhausts Codex native pages and keeps archived capabilities honest", async () => {
    const serverPath = join(root, "fake-codex-app-server.mjs");
    await writeFile(
      serverPath,
      buildFakeCodexAppServer(repositoryPath),
      "utf8"
    );
    const sessions = await discoverCodexThreads({
      bindings: [binding],
      launchContract: {
        argsPrefix: [serverPath],
        commandPath: process.execPath,
        kind: "executable",
      },
      nowMs: NOW_MS,
      rootDir: root,
    });

    const byId = new Map(
      sessions.map((entry) => [entry.session.nativeSessionId, entry.session])
    );
    expect(byId.get("codex-live")).toMatchObject({
      canFork: false,
      canResume: true,
      nativeSessionTitle: "Native Codex title",
      origin: "local",
      status: "working",
    });
    expect(byId.get("codex-archived")).toMatchObject({
      canFork: false,
      canResume: false,
      nativeSessionTitle: null,
      origin: "unknown",
      status: "ended",
    });
  });

  it("rejects a malformed non-null Codex pagination cursor", async () => {
    const serverPath = join(root, "fake-codex-invalid-cursor.mjs");
    await writeFile(
      serverPath,
      buildFakeCodexAppServer(repositoryPath, { firstPageNextCursor: "" }),
      "utf8"
    );

    await expect(
      discoverCodexThreads({
        bindings: [binding],
        launchContract: {
          argsPrefix: [serverPath],
          commandPath: process.execPath,
          kind: "executable",
        },
        nowMs: NOW_MS,
        rootDir: root,
      })
    ).rejects.toThrow("Codex thread/list nextCursor is invalid");
  });

  it.each([
    null,
    false,
    "",
  ])("rejects a non-numeric Codex retained timestamp %#", async (threadTimestamp) => {
    const serverPath = join(root, "fake-codex-invalid-timestamp.mjs");
    await writeFile(
      serverPath,
      buildFakeCodexAppServer(repositoryPath, { threadTimestamp }),
      "utf8"
    );

    await expect(
      discoverCodexThreads({
        bindings: [binding],
        launchContract: {
          argsPrefix: [serverPath],
          commandPath: process.execPath,
          kind: "executable",
        },
        nowMs: NOW_MS,
        rootDir: root,
      })
    ).rejects.toThrow("Codex returned a malformed retained thread record");
  });

  it("reads old Claude Sessions, latest native titles, and excludes subagents", async () => {
    const configDir = join(root, "claude-config");
    const projectsDir = join(configDir, "projects", "openmeld");
    await mkdir(join(projectsDir, "subagents"), { recursive: true });
    await writeFile(
      join(projectsDir, "session.jsonl"),
      [
        {
          cwd: repositoryPath,
          sessionId: "claude-native-1",
          timestamp: "2025-01-01T00:00:00.000Z",
          type: "session-start",
        },
        {
          customTitle: "First title",
          sessionId: "claude-native-1",
          timestamp: "2025-01-01T00:01:00.000Z",
          type: "custom-title",
        },
        {
          custom_title: "Latest native title",
          cwd: repositoryPath,
          sessionId: "claude-native-1",
          timestamp: "2025-01-01T00:02:00.000Z",
          type: "custom-title",
        },
      ]
        .map((value) => JSON.stringify(value))
        .join("\n"),
      "utf8"
    );
    await writeFile(
      join(projectsDir, "subagents", "child.jsonl"),
      `${JSON.stringify({
        cwd: repositoryPath,
        sessionId: "claude-subagent",
        timestamp: "2025-01-01T00:03:00.000Z",
      })}\n`,
      "utf8"
    );

    const sessions = await discoverClaudeRetainedSessions({
      bindings: [binding],
      configDir,
      nowMs: NOW_MS,
      rootDir: root,
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.session).toMatchObject({
      canFork: false,
      canResume: true,
      nativeSessionId: "claude-native-1",
      nativeSessionTitle: "Latest native title",
      status: "unknown",
    });
  });

  it("rejects a malformed Claude Session file instead of publishing a partial inventory", async () => {
    const configDir = join(root, "claude-config-malformed");
    const projectsDir = join(configDir, "projects", "openmeld");
    await mkdir(projectsDir, { recursive: true });
    await writeFile(
      join(projectsDir, "session.jsonl"),
      `${JSON.stringify({
        cwd: repositoryPath,
        sessionId: "claude-native-malformed",
        timestamp: "2025-01-01T00:00:00.000Z",
      })}\n{"type":"custom-title"`,
      "utf8"
    );

    await expect(
      discoverClaudeRetainedSessions({
        bindings: [binding],
        configDir,
        nowMs: NOW_MS,
        rootDir: root,
      })
    ).rejects.toThrow("Claude Code Session file contains malformed JSON");
  });

  it("rejects a structurally incomplete Claude Session file", async () => {
    const configDir = join(root, "claude-config-incomplete");
    const projectsDir = join(configDir, "projects", "openmeld");
    await mkdir(projectsDir, { recursive: true });
    await writeFile(
      join(projectsDir, "session.jsonl"),
      `${JSON.stringify({
        customTitle: "Incomplete native Session",
        type: "custom-title",
      })}\n`,
      "utf8"
    );

    await expect(
      discoverClaudeRetainedSessions({
        bindings: [binding],
        configDir,
        nowMs: NOW_MS,
        rootDir: root,
      })
    ).rejects.toThrow("Claude Code Session file is missing required metadata");
  });

  it("reads the complete OpenCode table beyond the legacy 500 row snapshot", async () => {
    const databasePath = join(root, "opencode.db");
    const database = new Database(databasePath);
    database.exec(`CREATE TABLE session (
      id TEXT PRIMARY KEY,
      directory TEXT NOT NULL,
      title TEXT,
      time_created INTEGER,
      time_updated INTEGER NOT NULL,
      time_archived INTEGER
    )`);
    const insert = database.prepare(
      "INSERT INTO session (id, directory, title, time_created, time_updated, time_archived) VALUES (?, ?, ?, ?, ?, NULL)"
    );
    for (let index = 0; index < 501; index += 1) {
      insert.run(
        `opencode-${String(index).padStart(4, "0")}`,
        repositoryPath,
        `Native title ${index}`,
        NOW_MS - 10_000,
        NOW_MS - index
      );
    }
    database.close();

    const sessions = await discoverOpenCodeRetainedSessions({
      bindings: [binding],
      databasePath,
      nowMs: NOW_MS,
      rootDir: root,
    });
    expect(sessions).toHaveLength(501);
    expect(
      new Set(sessions.map((entry) => entry.session.nativeSessionId)).size
    ).toBe(501);
    expect(sessions.every((entry) => entry.session.status === "unknown")).toBe(
      true
    );
  });

  it("adds Grok Build from its metadata-only retained summary index", async () => {
    const grokHome = join(root, "grok-home");
    const sessionDir = join(grokHome, "sessions", "workspace", "grok-1");
    await mkdir(sessionDir, { recursive: true });
    await writeFile(
      join(sessionDir, "summary.json"),
      JSON.stringify({
        created_at: "2026-08-20T09:00:00.000Z",
        cwd: repositoryPath,
        generated_title: "Native Grok title",
        id: "grok-native-1",
        session_summary: "must not become the title",
        updated_at: "2026-08-20T09:30:00.000Z",
      }),
      "utf8"
    );
    const nestedSessionDir = join(grokHome, "sessions", "workspace", "grok-2");
    await mkdir(nestedSessionDir, { recursive: true });
    await writeFile(
      join(nestedSessionDir, "summary.json"),
      JSON.stringify({
        created_at: "2026-08-20T08:00:00.000Z",
        generated_title: "Installed-layout title",
        info: { cwd: repositoryPath, id: "grok-native-2" },
        updated_at: "2026-08-20T08:30:00.000Z",
      }),
      "utf8"
    );
    await recordOpenMeldCreatedLocalAgentSession({
      agentControllerRef: "builtin:grok-build",
      nativeSessionId: "grok-native-1",
      rootDir: root,
    });

    const sessions = await discoverGrokBuildRetainedSessions({
      bindings: [binding],
      grokHome,
      rootDir: root,
    });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]?.session).toEqual({
      canFork: false,
      canResume: true,
      lastActiveAtMs: Date.UTC(2026, 7, 20, 9, 30),
      nativeSessionId: "grok-native-1",
      nativeSessionTitle: "Native Grok title",
      origin: "openmeld",
      startedAtMs: Date.UTC(2026, 7, 20, 9),
      status: "unknown",
    });
    expect(sessions[1]?.session).toMatchObject({
      nativeSessionId: "grok-native-2",
      nativeSessionTitle: "Installed-layout title",
      origin: "unknown",
    });
    const originStorePath = join(
      root,
      "device",
      "agent-activity",
      "session-inventory-origins.json"
    );
    expect((await stat(originStorePath)).mode % 0o1000).toBe(0o600);
    expect(await readFile(originStorePath, "utf8")).not.toContain(
      "grok-native-1"
    );
  });
});

function buildFakeCodexAppServer(
  cwd: string,
  input: {
    firstPageNextCursor?: unknown;
    malformedThread?: boolean;
    threadTimestamp?: unknown;
  } = {}
): string {
  const threadTimestamp = Object.hasOwn(input, "threadTimestamp")
    ? input.threadTimestamp
    : 40;
  const liveThread = {
    createdAt: 30,
    cwd,
    ephemeral: false,
    id: input.malformedThread ? undefined : "codex-live",
    name: "Native Codex title",
    recencyAt: threadTimestamp,
    source: "cli",
    status: { activeFlags: [], type: "active" },
    updatedAt: threadTimestamp,
  };
  return `import { createInterface } from "node:readline";
const sourceKinds = ${JSON.stringify([
    "cli",
    "vscode",
    "exec",
    "appServer",
    "subAgent",
    "subAgentReview",
    "subAgentCompact",
    "subAgentThreadSpawn",
    "subAgentOther",
    "unknown",
  ])};
const lines = createInterface({ input: process.stdin });
for await (const line of lines) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({ id: request.id, jsonrpc: "2.0", result: {} }) + "\\n");
    continue;
  }
  if (request.method !== "thread/list" || JSON.stringify(request.params.sourceKinds) !== JSON.stringify(sourceKinds)) {
    process.stdout.write(JSON.stringify({ id: request.id, jsonrpc: "2.0", error: { message: "incomplete source filter" } }) + "\\n");
    continue;
  }
  const archived = request.params.archived === true;
  const data = archived
    ? [{ id: "codex-archived", cwd: ${JSON.stringify(cwd)}, createdAt: 10, updatedAt: 20, recencyAt: 20, ephemeral: false, name: null, source: "appServer", status: { type: "notLoaded" } }]
    : request.params.cursor === null
      ? [${JSON.stringify(liveThread)}]
      : [];
  const nextCursor = archived ? null : request.params.cursor === null ? ${JSON.stringify(
    input.firstPageNextCursor === undefined
      ? "page-2"
      : input.firstPageNextCursor
  )} : null;
  process.stdout.write(JSON.stringify({ id: request.id, jsonrpc: "2.0", result: { data, nextCursor } }) + "\\n");
}`;
}
