import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ProjectBinding } from "../src/agent-activity/project-bindings";
import { recordOpenMeldCreatedLocalAgentSession } from "../src/agent-activity/session-inventory-origin-store";
import {
  discoverClaudeRetainedSessions,
  discoverCodexThreads,
  discoverGrokBuildRetainedSessions,
  discoverOpenCodeRetainedSessions,
} from "../src/agent-activity/session-inventory-provider-adapters";

const NOW_MS = Date.UTC(2026, 7, 20, 10, 0, 0);
let root = "";
let repositoryPath = "";
let binding: ProjectBinding;

beforeEach(async () => {
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

  it("reads the complete OpenCode table beyond the legacy 500 row snapshot", async () => {
    const databasePath = join(root, "opencode.db");
    const database = new DatabaseSync(databasePath);
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
        generated_title: "Native Grok title",
        info: { cwd: repositoryPath, id: "grok-native-1" },
        session_summary: "must not become the title",
        updated_at: "2026-08-20T09:30:00.000Z",
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
    expect(sessions).toHaveLength(1);
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

function buildFakeCodexAppServer(cwd: string): string {
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
      ? [{ id: "codex-live", cwd: ${JSON.stringify(cwd)}, createdAt: 30, updatedAt: 40, recencyAt: 40, ephemeral: false, name: "Native Codex title", source: "cli", status: { type: "active", activeFlags: [] } }]
      : [];
  const nextCursor = archived ? null : request.params.cursor === null ? "page-2" : null;
  process.stdout.write(JSON.stringify({ id: request.id, jsonrpc: "2.0", result: { data, nextCursor } }) + "\\n");
}`;
}
