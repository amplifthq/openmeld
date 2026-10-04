import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { invokeClaudeAgentSdkTransport } from "../dist/index.js";

// Real Claude and SDK; only the provider response is scripted. Synthetic HOME
// and credentials keep this independent of the operator's account and files.
test(
  "native Claude tasks retain outside-folder access, hooks, and native deny rules",
  {
    skip: !process.env.OPENMELD_TEST_CLAUDE_BIN,
    timeout: 100_000,
  },
  async (t) => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-claude-native-task-"));
    const workdir = join(root, "project");
    const configDir = join(root, "claude");
    await mkdir(workdir);
    await mkdir(configDir);
    const marker = join(root, "outside-project.txt");
    const hookMarker = join(root, "native-hook.txt");
    const command = `printf native-access > '${marker}'`;
    let phase = "allowed";
    let step = 0;
    const catalogs = [];
    const toolResults = [];
    const provider = createServer((request, response) => {
      (async () => {
        let text = "";
        for await (const chunk of request) {
          text += chunk;
        }
        const body = text ? JSON.parse(text) : {};
        if (request.url.includes("count_tokens")) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify({ input_tokens: 100 }));
          return;
        }
        if (!request.url.includes("/messages")) {
          response.writeHead(404).end();
          return;
        }
        catalogs.push({
          phase,
          names: (body.tools ?? []).map((tool) => tool.name),
        });
        assert.ok(
          catalogs.length <= 8,
          "Native task must not replay indefinitely"
        );
        const first = step++ === 0;
        if (!first) {
          toolResults.push({ phase, messages: body.messages });
        }
        const block = first
          ? {
              type: "tool_use",
              id: `bash-${phase}`,
              name: "Bash",
              input: { command },
            }
          : { type: "text", text: "Native task finished." };
        const stopReason = first ? "tool_use" : "end_turn";
        const message = {
          id: `native-${phase}-${step}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: [block],
          stop_reason: stopReason,
          stop_sequence: null,
          usage: { input_tokens: 100, output_tokens: 10 },
        };
        if (!body.stream) {
          response.writeHead(200, { "content-type": "application/json" });
          response.end(JSON.stringify(message));
          return;
        }
        response.writeHead(200, { "content-type": "text/event-stream" });
        const event = (type, value) =>
          response.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`
          );
        event("message_start", {
          message: { ...message, content: [], stop_reason: null },
        });
        event("content_block_start", {
          index: 0,
          content_block: first
            ? { ...block, input: {} }
            : { type: "text", text: "" },
        });
        event("content_block_delta", {
          index: 0,
          delta: first
            ? {
                type: "input_json_delta",
                partial_json: JSON.stringify(block.input),
              }
            : { type: "text_delta", text: block.text },
        });
        event("content_block_stop", { index: 0 });
        event("message_delta", {
          delta: { stop_reason: stopReason, stop_sequence: null },
          usage: { output_tokens: 10 },
        });
        event("message_stop", {});
        response.end();
      })().catch((error) => response.destroy(error));
    });
    t.after(async () => {
      provider.closeAllConnections();
      await new Promise((resolve) => provider.close(resolve));
      await rm(root, { recursive: true, force: true });
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const hook = {
      hooks: {
        PreToolUse: [
          {
            matcher: "Bash",
            hooks: [
              { type: "command", command: `printf hook-ran > '${hookMarker}'` },
            ],
          },
        ],
      },
    };
    await writeFile(join(configDir, "settings.json"), JSON.stringify(hook));
    const input = {
      agentControllerPermissionMode: "claude-code:bypassPermissions",
      executionContext: {
        version: 1,
        id: "11111111-1111-4111-8111-111111111111",
        scope: {
          organizationId: "org",
          requesterProfileId: "teammate",
          spaceId: "space",
          targetProfileId: "agent",
          threadId: null,
        },
        access: "workspace",
        workspace: "current",
        permissionSource: "agent_settings",
        nativeConversationId: null,
        runtimeWorkspaceFingerprint: null,
      },
      launchContract: {
        kind: "executable",
        commandPath: process.env.OPENMELD_TEST_CLAUDE_BIN,
      },
      claudeWorkdir: workdir,
      claudeTimeoutMs: 35_000,
      conversationPolicy: { model: "claude-sonnet-4-6" },
      env: {
        HOME: root,
        CLAUDE_CONFIG_DIR: configDir,
        OPENMELD_HOME: join(root, "openmeld-home"),
        ANTHROPIC_API_KEY: "synthetic-local-only",
        ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
        CLAUDE_CODE_USE_BEDROCK: "",
        CLAUDE_CODE_USE_VERTEX: "",
        CLAUDE_CODE_USE_FOUNDRY: "",
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1",
      },
      sessionId: null,
      prompt: "Run the requested command using Bash.",
    };
    const first = await invokeClaudeAgentSdkTransport(input);
    assert.ok(first.sessionId);
    assert.equal(await readFile(marker, "utf8"), "native-access");
    assert.equal(await readFile(hookMarker, "utf8"), "hook-ran");
    assert.ok(catalogs[0].names.includes("Bash"));
    await rm(marker);
    phase = "denied";
    step = 0;
    await writeFile(
      join(configDir, "settings.json"),
      JSON.stringify({ ...hook, permissions: { deny: ["Bash(printf *)"] } })
    );
    const resumed = await invokeClaudeAgentSdkTransport({
      ...input,
      sessionId: first.sessionId,
    });
    assert.equal(resumed.sessionId, first.sessionId);
    await assert.rejects(readFile(marker), { code: "ENOENT" });
    assert.ok(
      toolResults.some(
        (entry) =>
          entry.phase === "denied" &&
          JSON.stringify(entry.messages).includes('"is_error":true')
      )
    );
  }
);
