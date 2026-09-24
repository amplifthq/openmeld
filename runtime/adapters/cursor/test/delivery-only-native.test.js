import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createCursorAdapter } from "../dist/index.js";
import { createDeliveryProvider } from "./fixtures/delivery-provider.js";

const MODES = [
  { name: "approved", mode: "cursor:default", delivered: true },
  {
    name: "user denial",
    mode: "cursor:default",
    denied: true,
    delivered: false,
  },
  { name: "Plan", mode: "cursor:plan", delivered: true },
  { name: "Ask", mode: "cursor:ask", delivered: true },
  { name: "Smart Auto", mode: "cursor:autoReview", delivered: true },
  {
    name: "Force rejects business command",
    mode: "cursor:force",
    command: true,
    delivered: true,
  },
  {
    name: "native deny under Force",
    mode: "cursor:force",
    nativeDeny: true,
    delivered: false,
  },
  {
    name: "cancelled approval",
    mode: "cursor:default",
    cancel: true,
    delivered: false,
  },
  {
    name: "ambient hook",
    mode: "cursor:default",
    hook: true,
    delivered: false,
  },
];

for (const scenario of MODES) {
  test(
    `native Cursor delivery-only: ${scenario.name}`,
    {
      skip:
        !process.env.OPENMELD_TEST_CURSOR_BIN || process.platform === "win32",
      timeout: 30_000,
    },
    async () => {
      const home = await mkdtemp(join(tmpdir(), "cursor-delivery-native-"));
      const workdir = join(home, "workspace");
      const receiptPath = join(home, "receipt.jsonl");
      const sentinel = join(home, "business-command-ran");
      await mkdir(workdir);
      await mkdir(join(home, ".cursor"));
      const configPath = join(home, ".cursor/cli-config.json");
      const originalConfig = JSON.stringify({
        version: 1,
        permissions: {
          allow: [],
          deny: scenario.nativeDeny
            ? ["Mcp(openmeld_internal_dispatch_space_action:reply)"]
            : [],
        },
      });
      await writeFile(configPath, originalConfig);
      if (scenario.hook) {
        await writeFile(
          join(home, ".cursor/hooks.json"),
          JSON.stringify({
            version: 1,
            hooks: { sessionStart: [{ command: `touch ${sentinel}` }] },
          })
        );
      }
      const provider = await createDeliveryProvider(home, {
        command: scenario.command ? `touch ${sentinel}` : undefined,
        workdir,
      });
      const token = `${Buffer.from('{"alg":"HS256"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: "synthetic-loopback-only", exp: Math.floor(Date.now() / 1000) + 3600 })).toString("base64url")}.fixture`;
      const wrapper = join(home, "native-wrapper.mjs");
      const launches = join(home, "launches.jsonl");
      await writeFile(
        wrapper,
        `import {spawn} from 'node:child_process';
import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);
appendFileSync(${JSON.stringify(launches)},JSON.stringify({args,home:process.env.HOME})+'\\n');
const child=spawn(${JSON.stringify(process.env.OPENMELD_TEST_CURSOR_BIN)},args.includes('--version')?args:['-k','-e',${JSON.stringify(provider.endpoint)},'--auth-token',${JSON.stringify(token)},...args],{stdio:'inherit',env:process.env});
child.on('error',()=>{process.exitCode=1;});child.on('exit',code=>{process.exitCode=code??1;});
`
      );
      const tool = join(home, "openmeld");
      await writeFile(
        tool,
        `#!${process.execPath}
import {createInterface} from 'node:readline';import {appendFileSync} from 'node:fs';
const tools=['reply','stay_silent','read_receipt'].map(name=>({name,description:'Synthetic delivery only.',inputSchema:{type:'object',properties:{message:{type:'string'},reason:{type:'string'}}}}));
createInterface({input:process.stdin}).on('line',line=>{
 const q=JSON.parse(line);if(q.id===undefined)return;
 const result=q.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'fixture',version:'1'}}:q.method==='tools/list'?{tools}:{content:[{type:'text',text:'Synthetic proposal saved locally.'}]};
 if(q.method==='tools/call')appendFileSync(${JSON.stringify(receiptPath)},JSON.stringify(q.params)+'\\n');
 console.log(JSON.stringify({jsonrpc:'2.0',id:q.id,result}));
});
`
      );
      await chmod(tool, 0o700);
      const approvals = [];
      let adapter;
      try {
        adapter = createCursorAdapter({
          cursorTimeoutMs: 20_000,
          launchContract: {
            kind: "node_script",
            nodePath: process.execPath,
            scriptPath: wrapper,
          },
        });
        const result = await adapter.dispatch({
          agentId: "agt-fixture",
          sourceEventId: "evt-fixture",
          spaceId: "space-fixture",
          taskId: "delivery-fixture",
          transportMode: "acp",
          executionMode: "repair",
          agentControllerConversationId: "canonical-must-not-be-resumed",
          agentControllerPermissionMode: scenario.mode,
          runtimeContext: { providerRuntimeWorkingDirectory: workdir },
          env: {
            HOME: home,
            USERPROFILE: home,
            CURSOR_CONFIG_DIR: join(home, ".cursor"),
            CURSOR_DATA_DIR: join(home, ".cursor"),
            CURSOR_AUTH_TOKEN: token,
            AGENT_CLI_CREDENTIAL_STORE: "memory",
            OPENMELD_HOME: join(home, "openmeld-home"),
            OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(home, "context.json"),
            OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: tool,
            OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
            OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1",
          },
          spaceActionTools: {
            deliveryOnly: true,
            tools: ["reply", "stay_silent", "read_receipt"].map((name) => ({
              name,
            })),
            call: () => {
              throw new Error("ACP must use its sole MCP recorder");
            },
            close() {
              /* The fixture MCP connection owns its recorder lifecycle. */
            },
          },
          onInteractionRequest: async (request) => {
            approvals.push(request);
            if (scenario.cancel) {
              await adapter.interrupt({
                taskId: "delivery-fixture",
                mode: "graceful",
              });
            }
            return {
              kind: "permission",
              optionId: scenario.denied ? "reject-once" : "allow-once",
            };
          },
          prompt:
            "Previous private result: repository access is missing. Use reply to deliberately explain that limitation. Only delivery is permitted.",
        });
        const receipt = await readFile(receiptPath, "utf8").catch((error) => {
          if (error.code !== "ENOENT") {
            throw error;
          }
          return "";
        });
        assert.equal(
          Boolean(receipt),
          scenario.delivered,
          JSON.stringify({ result, approvals, evidence: provider.evidence })
        );
        if (scenario.delivered) {
          assert.equal(result.status, "success", JSON.stringify(result));
          assert.equal(
            result.contextDelta.agentControllerConversationId,
            "canonical-must-not-be-resumed"
          );
          assert.equal(receipt.trim().split("\n").length, 1);
          assert.equal(
            JSON.parse(receipt).arguments.message,
            "I cannot access the repository."
          );
        }
        if (scenario.hook) {
          assert.equal(provider.evidence.catalogs.length, 0);
        } else {
          assert.equal(provider.evidence.catalogs.length, 1);
        }
        await assert.rejects(stat(sentinel), { code: "ENOENT" });
        assert.equal(await readFile(configPath, "utf8"), originalConfig);
        assert.deepEqual(provider.evidence.errors, []);
        if (!scenario.hook) {
          const run = (await readFile(launches, "utf8"))
            .trim()
            .split("\n")
            .map(JSON.parse)
            .find((entry) => entry.args.includes("acp"));
          assert.notEqual(run.home, home);
          await assert.rejects(stat(run.home), { code: "ENOENT" });
          if (scenario.mode === "cursor:force") {
            assert.ok(run.args.includes("--force"));
          }
          if (scenario.mode === "cursor:default" && scenario.delivered) {
            assert.equal(approvals.length, 1);
          }
        }
      } finally {
        await provider.close();
        await rm(home, { recursive: true, force: true });
      }
    }
  );
}
