import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { supportsAgentControllerVersion } from "@openmeld/agent-runtime";
import { z } from "zod/v4";
import {
  createCodexAdapter,
  forkCodexAppServerThread,
  resolveCodexAppServerCompletedTurn,
} from "../dist/index.js";

const CODEX_VERSION_PREFIX = /^codex-cli\s+/;

test(
  "native Codex delivers despite unrelated MCP resource stalls, duplicate connection stalls and startup failures",
  { skip: !process.env.OPENMELD_TEST_CODEX_BIN, timeout: 90_000 },
  async (t) => {
    // Actual executable, temporary homes, dummy credentials and a loopback-only
    // scripted model. The tool sink has no OpenMeld or external side effects.
    const home = await mkdtemp(join(tmpdir(), "openmeld-native-space-"));
    const workdir = join(home, "workspace");
    await mkdir(workdir);
    const mcpLog = join(home, "mcp-requests.jsonl");
    const mcpScript = join(home, "ambient-mcp.cjs");
    const nativeVersion = execFileSync(
      process.env.OPENMELD_TEST_CODEX_BIN,
      ["--version"],
      {
        encoding: "utf8",
        env: { ...process.env, HOME: home, CODEX_HOME: home },
      }
    )
      .trim()
      .replace(CODEX_VERSION_PREFIX, "");
    const selectedStatusSupported = supportsAgentControllerVersion(
      nativeVersion,
      ">=0.160.0"
    );
    const connectionMarker = join(home, "first-connection");
    const admissionMarker = join(home, "start-admission");
    if (selectedStatusSupported) {
      await writeFile(admissionMarker, "");
    }
    // Resource discovery never responds. During initial admission on a current
    // controller, the thread's first connection works but an extra connection
    // hangs. This catches rediscovery even when resources are already omitted.
    await writeFile(
      mcpScript,
      `const {appendFileSync,existsSync,openSync,closeSync}=require('node:fs');
let duplicate=false;
if(existsSync(${JSON.stringify(admissionMarker)})) {
 try { closeSync(openSync(${JSON.stringify(connectionMarker)},'wx')); }
 catch(error) { if(error.code!=='EEXIST') throw error; duplicate=true; }
}
const lines=require('node:readline').createInterface({input:process.stdin});
lines.on('line',line=>{
 const request=JSON.parse(line);
 appendFileSync(${JSON.stringify(mcpLog)},JSON.stringify({method:request.method,pid:process.pid,duplicate})+'\\n');
 if(duplicate) return;
 let result;
 if(request.method==='initialize') result={protocolVersion:'2024-11-05',capabilities:{tools:{},resources:{}},serverInfo:{name:'ambient-fixture',version:'1'}};
 if(request.method==='tools/list') result={tools:[{name:'read_fixture',description:'Synthetic read-only tool.',inputSchema:{type:'object'}}]};
 if(result) process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:request.id,result})+'\\n');
});`
    );
    const calls = [];
    const catalogs = [];
    let phase = "start";
    let step = 0;
    let sequence = 0;
    const server = createServer((req, res) => {
      (async () => {
        let text = "";
        for await (const chunk of req) {
          text += chunk;
        }
        if (!req.url.endsWith("/responses")) {
          res.writeHead(404).end();
          return;
        }
        const body = JSON.parse(text);
        catalogs.push({
          phase,
          tools: body.tools ?? [],
          // Older controllers advertise MCP namespaces in the world state and
          // defer their individual tool schemas to native tool_search.
          ambientVisible: JSON.stringify(body).includes("ambient"),
        });
        const id = `native_${++sequence}`;
        const first = step++ === 0;
        const item = first
          ? {
              id: `fc_${id}`,
              type: "function_call",
              call_id: `call_${id}`,
              name: "openmeld_space_reply",
              arguments: JSON.stringify({ message: `Synthetic ${phase}` }),
              status: "completed",
            }
          : {
              id: `msg_${id}`,
              type: "message",
              role: "assistant",
              status: "completed",
              content: [
                {
                  type: "output_text",
                  text: "Native fixture complete.",
                  annotations: [],
                },
              ],
            };
        const response = {
          id,
          object: "response",
          model: body.model,
          output: [],
        };
        const event = (type, payload) =>
          res.write(
            `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`
          );
        res.writeHead(200, { "content-type": "text/event-stream" });
        event("response.created", {
          response: { ...response, status: "in_progress" },
        });
        event("response.output_item.added", {
          output_index: 0,
          item: {
            ...item,
            status: "in_progress",
            ...(first ? { arguments: "" } : { content: [] }),
          },
        });
        if (first) {
          event("response.function_call_arguments.delta", {
            item_id: item.id,
            output_index: 0,
            delta: item.arguments,
          });
          event("response.function_call_arguments.done", {
            item_id: item.id,
            output_index: 0,
            arguments: item.arguments,
          });
        } else {
          event("response.output_text.delta", {
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            delta: "Native fixture complete.",
          });
        }
        event("response.output_item.done", { output_index: 0, item });
        event("response.completed", {
          response: {
            ...response,
            status: "completed",
            output: [item],
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
          },
        });
        res.end();
      })().catch((error) => res.destroy(error));
    });
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      await rm(home, { recursive: true, force: true });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    await writeFile(
      join(home, "config.toml"),
      [
        'model = "gpt-5.4"',
        'model_provider = "fixture"',
        'web_search = "disabled"',
        "[model_providers.fixture]",
        'name = "Isolated native fixture"',
        `base_url = "http://127.0.0.1:${server.address().port}/v1"`,
        'wire_api = "responses"',
        "requires_openai_auth = false",
        "[mcp_servers.ambient]",
        `command = ${JSON.stringify(process.execPath)}`,
        `args = [${JSON.stringify(mcpScript)}]`,
        "startup_timeout_sec = 60",
        "tool_timeout_sec = 60",
        "[mcp_servers.unavailable]",
        `command = ${JSON.stringify(join(home, "missing-mcp-executable"))}`,
        "",
      ].join("\n")
    );
    const launchContract = {
      kind: "executable",
      commandPath: process.env.OPENMELD_TEST_CODEX_BIN,
    };
    const env = {
      HOME: home,
      CODEX_HOME: home,
      OPENMELD_HOME: join(home, "openmeld-home"),
      OPENAI_API_KEY: "synthetic-local-only",
      RUST_LOG: "error",
      OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(home, "context.json"),
      // Deliberately not executable: native success must not depend on MCP.
      OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: join(home, "openmeld"),
      OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
    };
    const run = async (
      name,
      threadId,
      executionMode = "normal",
      deliveryOnly = false
    ) => {
      phase = name;
      step = 0;
      const before = calls.length;
      let turnId;
      const result = await createCodexAdapter({
        launchContract,
        codexTimeoutMs: 20_000,
      }).dispatch({
        agentId: "agt-native-fixture",
        taskId: `task-${name}`,
        sourceEventId: `evt-${name}`,
        spaceId: "space-native-fixture",
        runtimeContext: { providerRuntimeWorkingDirectory: workdir },
        agentControllerConversationId: threadId,
        agentControllerPermissionMode: deliveryOnly
          ? "codex:fullAccess"
          : "codex:askForApproval",
        executionMode,
        transportMode: "codex-app-server",
        env: {
          ...env,
          ...(deliveryOnly ? { OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" } : {}),
        },
        prompt: "Call the synthetic reply tool once; no other action.",
        onRuntimeEvent: (event) => {
          if (event.phase === "provider_turn_accepted") {
            turnId = event.turnId;
          }
        },
        spaceActionTools: {
          deliveryOnly,
          tools: [
            {
              name: "reply",
              description: "Synthetic fixture with no external effect.",
              inputSchema: z.strictObject({ message: z.string().min(1) }),
            },
          ],
          call: (tool, args) => {
            calls.push({ invocation: name, tool, args });
            return Promise.resolve({
              content: [
                { type: "text", text: "Saved in synthetic sink only." },
              ],
            });
          },
          close: () => undefined,
        },
      });
      assert.equal(result.status, "success", JSON.stringify(result));
      assert.equal(calls.length, before + 1, name);
      assert.deepEqual(calls.at(-1), {
        invocation: name,
        tool: "reply",
        args: { message: `Synthetic ${name}` },
      });
      const conversationId = result.contextDelta?.agentControllerConversationId;
      assert.ok(conversationId);
      assert.ok(turnId);
      if (threadId) {
        assert.equal(conversationId, threadId);
      }
      return { conversationId, turnId };
    };
    const started = await run("start");
    await rm(admissionMarker, { force: true });
    const resumed = await run("cold-resume", started.conversationId);
    await run("repair-fork", resumed.conversationId, "repair");
    // The Service prepares a recovery fork without dispatch credentials. The
    // old fixture always supplied the MCP transport and hid a disabled-only
    // table that Codex 0.150.1 rejects with "invalid transport".
    const preparationEnv = {
      ...env,
      OPENMELD_SPACE_ACTION_CONTEXT_PATH: undefined,
      OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: undefined,
      OPENMELD_USER_FACING_CLI_COMMAND: undefined,
    };
    for (const [name, forkEnv] of [
      ["persistent-fork", env],
      ["recovery-fork", preparationEnv],
    ]) {
      const fork = await forkCodexAppServerThread({
        launchContract,
        codexTimeoutMs: 15_000,
        codexWorkdir: workdir,
        env: forkEnv,
        sourceThreadId: resumed.conversationId,
        sourceCompletedTurnId: resumed.turnId,
      });
      assert.notEqual(fork.threadId, resumed.conversationId);
      await run(name, fork.threadId);
      const source = await resolveCodexAppServerCompletedTurn({
        launchContract,
        codexTimeoutMs: 15_000,
        codexWorkdir: workdir,
        env: preparationEnv,
        threadId: resumed.conversationId,
      });
      assert.equal(source.completedTurnId, resumed.turnId);
    }
    await run("delivery-only", resumed.conversationId, "repair", true);
    const mcpRequests = (await readFile(mcpLog, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.ok(mcpRequests.some((request) => request.method === "tools/list"));
    if (selectedStatusSupported) {
      assert.equal(
        mcpRequests.some((request) => request.duplicate),
        false,
        "ordinary admission must reuse the thread instead of opening a second connection"
      );
    }
    assert.equal(
      mcpRequests.some((request) => request.method.startsWith("resources/")),
      false,
      "Space carrier admission must not enumerate unrelated resources"
    );
    assert.equal(catalogs.length, 12);
    for (const entry of catalogs.filter(
      (entry) => entry.phase === "delivery-only"
    )) {
      const names = entry.tools.flatMap((tool) =>
        tool.tools
          ? tool.tools.map((nested) => `${tool.name}.${nested.name}`)
          : [tool.name]
      );
      // Internal plan/user-input and empty skill discovery are metadata only;
      // filesystem, command, web, app, delegate and other MCP effects are absent.
      const allowed = new Set([
        "openmeld_space_reply",
        "update_plan",
        "request_user_input",
        "skills.list",
        "skills.read",
      ]);
      assert.deepEqual(
        names.filter((name) => !allowed.has(name)),
        [],
        JSON.stringify(entry.tools)
      );
    }
    for (const entry of catalogs) {
      const names = entry.tools.map((tool) => tool.name).filter(Boolean);
      assert.equal(
        names.filter((name) => name === "openmeld_space_reply").length,
        1
      );
      assert.equal(
        names.some((name) =>
          name.includes("mcp__openmeld_internal_dispatch_space_action")
        ),
        false
      );
    }
    assert.ok(
      catalogs.some(
        (entry) =>
          entry.phase !== "delivery-only" &&
          (JSON.stringify(entry.tools).includes("read_fixture") ||
            entry.ambientVisible)
      ),
      "the ordinary task retains its configured ambient tool or deferred namespace"
    );
  }
);
