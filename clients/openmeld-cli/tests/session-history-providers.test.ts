import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SessionMessage } from "@anthropic-ai/claude-agent-sdk";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import {
  projectClaudeHistory,
  readClaudeHistory,
} from "../src/local-service/session-history/claude-history-reader";
import {
  projectGrokHistory,
  readGrokHistory,
} from "../src/local-service/session-history/grok-history-reader";
import { readOpenCodeHistory } from "../src/local-service/session-history/opencode-history-reader";

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
const sessionId = "12345678-1234-4234-8234-123456789012";
async function fixture() {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "history-providers-"))
  );
  roots.push(root);
  const cwd = join(root, "project");
  await mkdir(cwd);
  return { root, cwd };
}

it("projects Claude SDK messages without tool results, reasoning, or subagent messages", () => {
  const message = (
    type: "user" | "assistant",
    content: unknown
  ): SessionMessage => ({
    type,
    uuid: "message",
    session_id: sessionId,
    message: { content },
    parent_tool_use_id: null,
    parent_agent_id: null,
  });
  const projected = projectClaudeHistory(
    [
      message("user", [
        { type: "text", text: "Find the checkout bug" },
        { type: "tool_result", content: "PRIVATE_TOOL" },
      ]),
      message("assistant", [
        { type: "thinking", thinking: "PRIVATE_REASONING" },
        { type: "text", text: "The payment token expired" },
      ]),
      { ...message("assistant", "PRIVATE_SUBAGENT"), parent_agent_id: "child" },
    ],
    sessionId
  );
  expect(projected).toEqual({
    messages: [
      { role: "user", text: "Find the checkout bug", truncated: false },
      {
        role: "assistant",
        text: "The payment token expired",
        truncated: false,
      },
    ],
    omittedNonMessageItems: true,
  });
  expect(() =>
    projectClaudeHistory([message("user", "text")], "other-session")
  ).toThrow("identity");
});

// Native JSONL envelope from Claude Agent SDK SessionMessage + parentUuid chain.
it("reads a Claude retained session through the SDK without modifying its source", async () => {
  const { root, cwd } = await fixture();
  vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
  const directory = join(
    root,
    "claude",
    "projects",
    cwd.replace(/[^a-zA-Z0-9]/g, "-")
  );
  await mkdir(directory, { recursive: true });
  const file = join(directory, `${sessionId}.jsonl`);
  const source = `${[
    {
      type: "user",
      uuid: "user-1",
      parentUuid: null,
      sessionId,
      cwd,
      isSidechain: false,
      timestamp: "2026-01-01T00:00:00.000Z",
      message: { role: "user", content: "Checkout investigation" },
    },
    {
      type: "assistant",
      uuid: "assistant-1",
      parentUuid: "user-1",
      sessionId,
      cwd,
      isSidechain: false,
      timestamp: "2026-01-01T00:00:01.000Z",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Token expired" }],
      },
    },
  ]
    .map((item) => JSON.stringify(item))
    .join("\n")}\n`;
  await writeFile(file, source);
  const result = await readClaudeHistory({
    sessionId,
    authorizePath: (path) => {
      expect(path).toBe(cwd);
      return Promise.resolve();
    },
  });
  expect(result.messages.map((item) => item.text)).toEqual([
    "Checkout investigation",
    "Token expired",
  ]);
  expect(await readFile(file, "utf8")).toBe(source);
  await expect(
    readClaudeHistory({
      sessionId,
      authorizePath: () => Promise.reject(new Error("Access denied")),
    })
  ).rejects.toThrow("Access denied");
});

// OpenCode official session/sql.ts tables; data follows SDK Message/TextPart types.
it("reads OpenCode text only, respects undo, rejects a changed scope, and leaves SQLite unchanged", async () => {
  const { root, cwd } = await fixture();
  const databasePath = join(root, "opencode.db");
  const db = new Database(databasePath);
  db.exec(
    "CREATE TABLE session (id TEXT, directory TEXT, time_updated INTEGER, revert TEXT); CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT); CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, data TEXT)"
  );
  db.prepare("INSERT INTO session VALUES (?, ?, 1, NULL)").run(sessionId, cwd);
  db.prepare("INSERT INTO message VALUES ('msg_1', ?, 1, ?)").run(
    sessionId,
    JSON.stringify({ role: "user" })
  );
  const insert = db.prepare("INSERT INTO part VALUES (?, 'msg_1', ?, ?)");
  insert.run(
    "prt_1",
    sessionId,
    JSON.stringify({ type: "text", text: "Find the bug" })
  );
  insert.run(
    "prt_2",
    sessionId,
    JSON.stringify({ type: "tool", state: { output: "PRIVATE_TOOL" } })
  );
  insert.run(
    "prt_3",
    sessionId,
    JSON.stringify({ type: "text", synthetic: true, text: "PRIVATE_SYNTHETIC" })
  );
  db.close();
  const before = await readFile(databasePath);
  const result = await readOpenCodeHistory({
    sessionId,
    databasePath,
    authorizePath: (path) => {
      expect(path).toBe(cwd);
      return Promise.resolve();
    },
  });
  expect(result.messages).toEqual([
    { role: "user", text: "Find the bug", truncated: false },
  ]);
  expect(await readFile(databasePath)).toEqual(before);
  await expect(
    readOpenCodeHistory({
      sessionId,
      databasePath,
      authorizePath: () => Promise.reject(new Error("Access denied")),
    })
  ).rejects.toThrow("Access denied");
  const writer = new Database(databasePath);
  writer
    .prepare("UPDATE session SET revert = ?")
    .run(JSON.stringify({ messageID: "msg_1" }));
  writer.close();
  expect(
    (
      await readOpenCodeHistory({
        sessionId,
        databasePath,
        authorizePath: () => Promise.resolve(),
      })
    ).messages
  ).toEqual([]);
});

// xai-org/grok-build session/storage/mod.rs: SessionUpdateEnvelope / ACP content.
const grokUpdate = (
  sessionUpdate: string,
  content: unknown,
  method = "session/update"
) =>
  JSON.stringify({
    method,
    params: { sessionId, update: { sessionUpdate, content } },
  });
it("reads Grok ACP text without tool/thought updates and fails closed on undo or wrong identity", async () => {
  const { root, cwd } = await fixture();
  const directory = join(root, "sessions", encodeURIComponent(cwd), sessionId);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "summary.json"),
    JSON.stringify({ id: sessionId, cwd })
  );
  const source = `${[
    grokUpdate("user_message_chunk", { type: "text", text: "Find the bug" }),
    grokUpdate("agent_thought_chunk", {
      type: "text",
      text: "PRIVATE_REASONING",
    }),
    grokUpdate("tool_call", { type: "text", text: "PRIVATE_TOOL" }),
    grokUpdate("agent_message_chunk", { type: "text", text: "Token " }),
    grokUpdate("agent_message_chunk", { type: "text", text: "expired" }),
  ].join("\n")}\n`;
  await writeFile(join(directory, "updates.jsonl"), source);
  const result = await readGrokHistory({
    sessionId,
    grokHome: root,
    authorizePath: (path) => {
      expect(path).toBe(cwd);
      return Promise.resolve();
    },
  });
  expect(result.messages.map((item) => item.text)).toEqual([
    "Find the bug",
    "Token expired",
  ]);
  expect(await readFile(join(directory, "updates.jsonl"), "utf8")).toBe(source);
  await writeFile(join(directory, "updates.jsonl"), "INVALID_BODY");
  await expect(
    readGrokHistory({
      sessionId,
      grokHome: root,
      authorizePath: () => Promise.reject(new Error("Access denied")),
    })
  ).rejects.toThrow("Access denied");
  expect(() => projectGrokHistory(source, "wrong-id")).toThrow("identity");
  expect(() =>
    projectGrokHistory(
      grokUpdate("rewind_marker", null, "_x.ai/session/update"),
      sessionId
    )
  ).toThrow("Rewound");
});
