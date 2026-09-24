import assert from "node:assert/strict";
import { once } from "node:events";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { z } from "zod/v4";
import { invokeGrokBuildAcpTransport } from "../dist/index.js";

const SERVER = "openmeld_internal_dispatch_space_action";
const PERMISSION_FAILURE = /denied|reject|permission/i;
for (const scenario of [
  "approved",
  "denied",
  "plan",
  "blocked-file",
  "full-access",
  "full-access-file",
  "configured-deny",
  "ambient-hook",
]) {
  test(
    `native Grok delivery-only scope: ${scenario}`,
    {
      skip:
        !process.env.OPENMELD_TEST_GROK_BUILD_BIN ||
        process.platform === "win32",
      timeout: 60_000,
    },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), "openmeld-grok-native-"));
      t.after(() => rm(home, { recursive: true, force: true }));
      const workdir = join(home, "workspace");
      const grokHome = join(home, "grok");
      await mkdir(workdir);
      await mkdir(grokHome);
      const receipts = join(home, "receipts.jsonl");
      const sentinel = join(home, "unexpected-business-write");
      const sourceSessionId = "canonical-session-must-not-be-loaded";
      const definitions = [
        {
          name: "reply",
          description: "Submit an explicit public reply.",
          inputSchema: z.object({ message: z.string() }),
        },
        {
          name: "stay_silent",
          description: "Record intentional silence.",
          inputSchema: z.object({ reason: z.string() }),
        },
        {
          name: "read_receipt",
          description: "Read the saved receipt.",
          inputSchema: z.object({}),
        },
      ];
      const mcpScript = join(home, "mcp.mjs");
      await writeFile(
        mcpScript,
        `import {createInterface} from 'node:readline';
import {appendFileSync} from 'node:fs';
const tools=${JSON.stringify(definitions.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: z.toJSONSchema(tool.inputSchema) })))};
createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
let result;if(m.method==='initialize')result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};
else if(m.method==='tools/list')result={tools};
else if(m.method==='tools/call'){appendFileSync(${JSON.stringify(receipts)},JSON.stringify(m.params)+'\\n');result={content:[{type:'text',text:'{"status":"proposal_saved_locally"}'}]};}
else result={};console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));});`
      );
      const cli = join(home, "openmeld");
      await writeFile(
        cli,
        `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(mcpScript)}\n`,
        { mode: 0o700 }
      );
      await chmod(cli, 0o700);
      const argumentFile = join(home, "arguments.json");
      await writeFile(
        argumentFile,
        JSON.stringify({
          tool_name: `${SERVER}__reply`,
          tool_input: { message: "Secret file must not be read." },
        })
      );
      const catalogs = [];
      const toolResults = [];
      const approvals = [];
      let providerError;
      const provider = createServer((request, response) => {
        (async () => {
          let text = "";
          for await (const chunk of request) {
            text += chunk;
          }
          if (request.method === "GET") {
            response.setHeader("content-type", "application/json");
            response.end(
              JSON.stringify({
                data: [
                  {
                    id: "fixture",
                    model: "fixture",
                    name: "Fixture",
                    api_backend: "chat_completions",
                    context_window: 32_000,
                    model_family: "xai",
                  },
                ],
              })
            );
            return;
          }
          const body = JSON.parse(text);
          if (request.url.endsWith("/responses")) {
            const item = {
              id: "title",
              type: "function_call",
              call_id: "title",
              name: "session_title",
              arguments: '{"title":"Synthetic delivery"}',
              status: "completed",
            };
            const result = {
              id: "fixture-title",
              object: "response",
              created_at: 1,
              model: body.model,
              status: "completed",
              output: [item],
              usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
            };
            response.setHeader("content-type", "text/event-stream");
            for (const event of [
              {
                type: "response.created",
                response: { ...result, status: "in_progress", output: [] },
              },
              { type: "response.output_item.done", output_index: 0, item },
              { type: "response.completed", response: result },
            ]) {
              response.write(
                `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
              );
            }
            response.end();
            return;
          }
          const names = (body.tools ?? []).map((tool) => tool.function?.name);
          catalogs.push(names);
          assert.ok(catalogs.length <= 8);
          assert.deepEqual([...names].sort(), ["search_tool", "use_tool"]);
          const results = (body.messages ?? []).filter(
            (message) => message.role === "tool"
          );
          toolResults.push(...results.map((message) => message.content));
          const args =
            scenario === "blocked-file" || scenario === "full-access-file"
              ? { file: argumentFile }
              : {
                  tool_name: `${SERVER}__reply`,
                  tool_input: { message: "I cannot access the repository." },
                };
          const call = {
            index: 0,
            id: "delivery",
            type: "function",
            function: { name: "use_tool", arguments: JSON.stringify(args) },
          };
          const chunk = {
            id: "fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [
              {
                index: 0,
                delta: results.length
                  ? { role: "assistant", content: "Delivery fixture complete." }
                  : { role: "assistant", tool_calls: [call] },
                finish_reason: null,
              },
            ],
          };
          response.setHeader("content-type", "text/event-stream");
          response.end(
            `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: results.length ? "stop" : "tool_calls" }] })}\n\ndata: [DONE]\n\n`
          );
        })().catch((error) => {
          providerError = error;
          response.writeHead(500).end();
        });
      });
      provider.listen(0, "127.0.0.1");
      await once(provider, "listening");
      t.after(() => {
        provider.closeAllConnections();
        provider.close();
      });
      const base = `http://127.0.0.1:${provider.address().port}/v1`;
      const config = `[models]\ndefault="fixture"\n[model.fixture]\nmodel="fixture"\nbase_url=${JSON.stringify(base)}\nname="Fixture"\napi_backend="chat_completions"\ncontext_window=32000\nenv_key="XAI_API_KEY"\n[features]\ntelemetry=false\ntrace_upload=false\n[marketplace]\ndefault_skills_installs_purged=true\n${scenario === "ambient-hook" ? `\n[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype="command"\ncommand=${JSON.stringify(`touch ${sentinel}`)}\n` : ""}`;
      const originalConfig =
        config +
        (scenario === "configured-deny"
          ? `\n[permission]\ndeny=["MCPTool(${SERVER}__reply)"]\n`
          : "");
      await writeFile(join(grokHome, "config.toml"), originalConfig);
      const request = {
        agentControllerPermissionMode:
          {
            plan: "grok-build:plan",
            "full-access": "grok-build:bypassPermissions",
            "full-access-file": "grok-build:bypassPermissions",
          }[scenario] ?? "grok-build:default",
        conversationPolicy: { model: "fixture" },
        env: {
          HOME: home,
          GROK_HOME: grokHome,
          OPENMELD_HOME: join(home, "openmeld-state"),
          XAI_API_KEY: "synthetic-loopback-only",
          GROK_XAI_API_BASE_URL: base,
          GROK_MODELS_BASE_URL: base,
          GROK_MODELS_LIST_URL: `${base}/models`,
          OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(home, "context.json"),
          OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: cli,
          OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
          OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1",
        },
        grokBuildTimeoutMs: 30_000,
        grokBuildWorkdir: workdir,
        launchContract: {
          kind: "executable",
          commandPath: process.env.OPENMELD_TEST_GROK_BUILD_BIN,
        },
        sessionId: sourceSessionId,
        taskId: "synthetic-delivery",
        prompt:
          "Only submit the deliberate public reply using the supplied inline tool arguments.",
        spaceActionTools: {
          deliveryOnly: true,
          tools: definitions,
          call() {
            assert.fail("MCP is the only carrier");
          },
          close() {
            /* The native MCP fixture owns its process lifetime. */
          },
        },
        onInteractionRequest(interaction) {
          approvals.push(interaction);
          assert.equal(interaction.kind, "permission");
          return Promise.resolve({
            kind: "permission",
            optionId: scenario === "denied" ? "reject-once" : "allow-once",
          });
        },
      };
      if (scenario === "ambient-hook") {
        await assert.rejects(invokeGrokBuildAcpTransport(request), {
          code: "space.action.delivery_only_unverified",
        });
        assert.equal(catalogs.length, 0);
      } else if (scenario === "denied") {
        await assert.rejects(invokeGrokBuildAcpTransport(request), {
          code: "runtime.turn.cancelled",
        });
        await assert.rejects(stat(receipts), { code: "ENOENT" });
        assert.ok(approvals.length > 0);
      } else {
        const result = await invokeGrokBuildAcpTransport(request);
        assert.equal(result.sessionId, sourceSessionId);
        assert.ok(catalogs.length > 0);
        if (
          ["blocked-file", "full-access-file", "configured-deny"].includes(
            scenario
          )
        ) {
          await assert.rejects(stat(receipts), { code: "ENOENT" });
          assert.ok(toolResults.some((text) => PERMISSION_FAILURE.test(text)));
        } else {
          const saved = (await readFile(receipts, "utf8"))
            .trim()
            .split("\n")
            .map(JSON.parse);
          assert.deepEqual(
            saved.map(({ name, arguments: args }) => ({
              name,
              arguments: args,
            })),
            [
              {
                name: "reply",
                arguments: { message: "I cannot access the repository." },
              },
            ]
          );
          if (scenario === "full-access") {
            assert.equal(approvals.length, 0);
          } else {
            assert.ok(approvals.length > 0);
          }
        }
      }
      assert.equal(providerError, undefined);
      assert.equal(
        await readFile(join(grokHome, "config.toml"), "utf8"),
        originalConfig
      );
      await assert.rejects(stat(sentinel), { code: "ENOENT" });
    }
  );
}
