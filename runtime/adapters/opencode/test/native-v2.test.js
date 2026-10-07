import assert from "node:assert/strict";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createOpenCodeAdapter,
  forkOpenCodeServerSession,
} from "../dist/index.js";

// Optional real-binary regression: local provider and MCP only; no paid model calls.
test(
  "native OpenCode 2 publishes through MCP and resumes its own session",
  { skip: !process.env.OPENMELD_TEST_OPENCODE2_BIN },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "openmeld-native2-smoke-"));
    const cwd = join(root, "workspace");
    await mkdir(cwd);
    const catalogs = [];
    const marker = join(root, "reply.json");
    const command = join(root, "openmeld");
    await writeFile(
      command,
      `#!${process.execPath}\nconst {createInterface}=require('node:readline'); const {writeFileSync}=require('node:fs');createInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return; const result=q.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'smoke',version:'1'}}:q.method==='tools/list'?{tools:[{name:'reply',description:'Save a synthetic smoke reply',inputSchema:{type:'object',properties:{message:{type:'string'}},required:['message']}}]}:q.method==='tools/call'?(writeFileSync(${JSON.stringify(marker)},JSON.stringify(q.params)),{content:[{type:'text',text:'Saved'}]}):{};console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));});`
    );
    await chmod(command, 0o700);
    let called = false;
    const provider = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
      }
      const body = JSON.parse(raw);
      catalogs.push({
        path: req.url,
        tools: body.tools?.map((t) => t.function?.name),
        model: body.model,
        hasInstructions: JSON.stringify(body.messages).includes(
          "OPENMELD_NATIVE_INSTRUCTIONS"
        ),
      });
      res.writeHead(200, { "content-type": "text/event-stream" });
      const tool = body.tools?.find((t) =>
        t.function?.name?.endsWith("_reply")
      );
      const call = tool && !called;
      if (call) {
        called = true;
      }
      const delta = call
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: "reply_smoke",
                type: "function",
                function: {
                  name: tool.function.name,
                  arguments: JSON.stringify({ message: "NATIVE_MCP_OK" }),
                },
              },
            ],
          }
        : { role: "assistant", content: "NATIVE_OK" };
      for (const value of [
        { choices: [{ index: 0, delta, finish_reason: null }] },
        {
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: call ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 2, completion_tokens: 2, total_tokens: 4 },
        },
      ]) {
        res.write(
          `data: ${JSON.stringify({ id: "local-smoke", object: "chat.completion.chunk", created: 1, model: "fixture", ...value })}\n\n`
        );
      }
      res.end("data: [DONE]\n\n");
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const env = {
      HOME: root,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
      XDG_CACHE_HOME: join(root, "cache"),
      XDG_STATE_HOME: join(root, "state"),
      OPENMELD_HOME: join(root, "openmeld-home"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({
        model: "fixture/fixture",
        snapshot: false,
        provider: {
          fixture: {
            npm: "@ai-sdk/openai-compatible",
            name: "Isolated fixture",
            options: {
              baseURL: `http://127.0.0.1:${provider.address().port}/v1`,
              apiKey: "synthetic-only",
            },
            models: {
              fixture: {
                name: "fixture",
                tool_call: true,
                limit: { context: 32_000, output: 4000 },
              },
            },
          },
        },
      }),
    };
    const adapter = createOpenCodeAdapter({
      launchContract: {
        kind: "executable",
        commandPath: resolve(process.env.OPENMELD_TEST_OPENCODE2_BIN),
      },
      openCodeTimeoutMs: 45_000,
    });
    try {
      Object.assign(env, {
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(root, "context.json"),
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: command,
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
      });
      const input = {
        agentId: "fixture",
        taskId: "native-first",
        spaceId: "fixture",
        sourceEventId: "fixture",
        prompt: "Reply NATIVE_OK.",
        instructionPrompt: {
          developerInstructions:
            "OPENMELD_NATIVE_INSTRUCTIONS: Use the Space reply tool to publish the result.",
          userPrompt: "Reply NATIVE_OK.",
        },
        runtimeContext: { providerRuntimeWorkingDirectory: cwd },
        env,
        conversationPolicy: { model: "fixture/fixture" },
        openCodePermission: {
          "*": "deny",
          openmeld_internal_dispatch_space_action_reply: "allow",
        },
      };
      const first = await adapter.dispatch(input);
      assert.equal(first.status, "success", JSON.stringify(first));
      const resumed = await adapter.dispatch({
        ...input,
        taskId: "native-resume",
        agentControllerConversationId:
          first.contextDelta.agentControllerConversationId,
      });
      assert.equal(resumed.status, "success", JSON.stringify(resumed));
      assert.equal(
        resumed.contextDelta.agentControllerConversationId,
        first.contextDelta.agentControllerConversationId
      );
      assert.equal(resumed.output, "NATIVE_OK");
      const fork = await forkOpenCodeServerSession({
        env,
        launchContract: {
          kind: "executable",
          commandPath: resolve(process.env.OPENMELD_TEST_OPENCODE2_BIN),
        },
        openCodeTimeoutMs: 15_000,
        openCodeWorkdir: cwd,
        sourceSessionId: first.contextDelta.agentControllerConversationId,
        title: "Native fork smoke",
      });
      assert.notEqual(
        fork.sessionId,
        first.contextDelta.agentControllerConversationId
      );
      const forked = await adapter.dispatch({
        ...input,
        taskId: "native-fork",
        agentControllerConversationId: fork.sessionId,
      });
      assert.equal(forked.status, "success", JSON.stringify(forked));
      assert.equal(
        forked.contextDelta.agentControllerConversationId,
        fork.sessionId
      );
      assert.ok(
        catalogs.some((c) =>
          c.tools?.includes("openmeld_internal_dispatch_space_action_reply")
        )
      );
      assert.ok(catalogs.some((c) => c.hasInstructions));
      assert.ok(catalogs.every((c) => !c.tools?.includes("shell")));
      assert.equal(
        JSON.parse(await readFile(marker, "utf8")).arguments.message,
        "NATIVE_MCP_OK"
      );
    } finally {
      provider.closeAllConnections();
      await new Promise((r) => provider.close(r));
      await rm(root, { recursive: true, force: true });
    }
  }
);
