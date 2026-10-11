const NATIVE_MESSAGE_ID = /^msg_[a-f0-9]{12}[0-9A-Za-z]{14}$/;

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
import { createOpenCodeAdapter } from "../dist/index.js";

const SERVER = "openmeld_internal_dispatch_space_action";

test(
  "native OpenCode restricts correction without redoing work or loading external plugins",
  { skip: !process.env.OPENMELD_TEST_OPENCODE_BIN, timeout: 120_000 },
  async (t) => {
    const home = await mkdtemp(join(tmpdir(), "openmeld-opencode-delivery-"));
    const workdir = join(home, "workspace");
    await mkdir(workdir);
    const sink = join(home, "replies.jsonl");
    const marker = join(home, "plugin-ran");
    const plugin = join(home, "fixture-plugin.mjs");
    await writeFile(
      plugin,
      `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'unexpected'); export const fixture = async()=>({});`
    );
    const command = join(home, "openmeld");
    // Protocol fixture only: the model cannot run a shell. The MCP carrier owns
    // this trusted process; the sink never reaches a real OpenMeld account/Space.
    await writeFile(
      command,
      `#!${process.execPath}\nimport {createInterface} from 'node:readline';\nimport {appendFileSync} from 'node:fs';\nconst names=['reply','stay_silent','read_receipt'];\ncreateInterface({input:process.stdin}).on('line',line=>{const q=JSON.parse(line);if(q.id===undefined)return;let result;\nif(q.method==='initialize') result={protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}};\nelse if(q.method==='tools/list') result={tools:names.map(name=>({name,description:'Synthetic delivery fixture',inputSchema:{type:'object',properties:{message:{type:'string'},reason:{type:'string'}},additionalProperties:false}}))};\nelse if(q.method==='tools/call'){appendFileSync(${JSON.stringify(sink)},JSON.stringify(q.params)+'\\n');result={content:[{type:'text',text:'Synthetic receipt saved.'}]};}\nelse result={};process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:q.id,result})+'\\n');});\n`
    );
    await chmod(command, 0o700);
    let phase = "source";
    let step = 0;
    const catalogs = [];
    const provider = createServer((request, response) => {
      (async () => {
        let text = "";
        for await (const chunk of request) {
          text += chunk;
        }
        const body = JSON.parse(text);
        catalogs.push({
          phase,
          names: (body.tools ?? []).map(
            (tool) => tool.function?.name ?? tool.name
          ),
        });
        const call = phase === "correction" && step++ === 0;
        const delta = call
          ? {
              role: "assistant",
              tool_calls: [
                {
                  index: 0,
                  id: "synthetic-delivery",
                  type: "function",
                  function: {
                    name: `${SERVER}_reply`,
                    arguments: JSON.stringify({
                      message: "I cannot access the repository.",
                    }),
                  },
                },
              ],
            }
          : {
              role: "assistant",
              content:
                phase === "source"
                  ? "I cannot access the repository."
                  : "Synthetic correction complete.",
            };
        response.writeHead(200, { "content-type": "text/event-stream" });
        const event = (value) =>
          response.write(
            `data: ${JSON.stringify({ id: "fixture-response", object: "chat.completion.chunk", created: 1, model: "fixture", ...value })}\n\n`
          );
        event({ choices: [{ index: 0, delta, finish_reason: null }] });
        event({
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: call ? "tool_calls" : "stop",
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        });
        response.end("data: [DONE]\n\n");
      })().catch((error) => response.destroy(error));
    });
    t.after(async () => {
      provider.closeAllConnections();
      await new Promise((resolve) => provider.close(resolve));
      await rm(home, { recursive: true, force: true });
    });
    provider.listen(0, "127.0.0.1");
    await once(provider, "listening");
    const config = {
      model: "fixture/fixture",
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
    };
    const env = {
      HOME: home,
      XDG_CONFIG_HOME: join(home, "config"),
      XDG_DATA_HOME: join(home, "data"),
      XDG_CACHE_HOME: join(home, "cache"),
      XDG_STATE_HOME: join(home, "state"),
      OPENMELD_HOME: join(home, "openmeld-home"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify(config),
      OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(home, "context.json"),
      OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: command,
      OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
    };
    const adapter = createOpenCodeAdapter({
      launchContract: {
        kind: "executable",
        commandPath: process.env.OPENMELD_TEST_OPENCODE_BIN,
      },
      openCodeTimeoutMs: 45_000,
    });
    const admissions = [];
    const request = {
      onRuntimeEvent: (event) => {
        if (event.phase === "provider_turn_accepted") {
          admissions.push(event);
        }
      },
      agentId: "agt-fixture",
      taskId: "task-source",
      sourceEventId: "evt-fixture",
      spaceId: "space-fixture",
      runtimeContext: { providerRuntimeWorkingDirectory: workdir },
      conversationPolicy: { model: "fixture/fixture" },
      prompt: "Explain the missing repository access.",
      env,
    };
    const source = await adapter.dispatch(request);
    assert.equal(source.status, "success", JSON.stringify(source));
    const sourceId = source.contextDelta?.agentControllerConversationId;
    assert.ok(sourceId);
    assert.equal(admissions.length, 1);
    assert.equal(admissions[0].agentControllerConversationId, sourceId);
    assert.match(admissions[0].turnId, NATIVE_MESSAGE_ID);
    phase = "correction";
    const corrected = await adapter.dispatch({
      ...request,
      taskId: "task-correction",
      agentControllerConversationId: sourceId,
      executionMode: "repair",
      env: {
        ...env,
        OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1",
        OPENCODE_CONFIG_CONTENT: JSON.stringify({
          ...config,
          plugin: [plugin],
        }),
      },
      prompt:
        "Only use the supplied reply tool to deliver the known limitation. Do not redo the task.",
    });
    assert.equal(corrected.status, "success", JSON.stringify(corrected));
    assert.equal(admissions.length, 2);
    assert.notEqual(admissions[0].turnId, admissions[1].turnId);
    assert.equal(
      corrected.contextDelta?.agentControllerConversationId,
      sourceId
    );
    await assert.rejects(stat(marker), { code: "ENOENT" });
    const calls = (await readFile(sink, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, "reply");
    assert.ok(catalogs.some((entry) => entry.phase === "correction"));
    for (const entry of catalogs.filter(
      (entry) => entry.phase === "correction"
    )) {
      assert.deepEqual(
        entry.names.filter(
          (name) =>
            ![
              `${SERVER}_reply`,
              `${SERVER}_stay_silent`,
              `${SERVER}_read_receipt`,
            ].includes(name)
        ),
        [],
        JSON.stringify(entry)
      );
    }
  }
);
