import assert from "node:assert/strict";
import { once } from "node:events";
import {
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
import { invokeAntigravityCliTransport } from "../dist/index.js";
import { withAntigravityDispatchSpaceAction } from "../dist/transport/antigravity-space-action.js";

for (const scenario of [
  "default",
  "plan",
  "bypass",
  "rogue-command",
  "uncommitted-text",
  "hook",
  "ambient-mcp",
]) {
  test(
    `native Antigravity correction: ${scenario}`,
    {
      skip:
        !process.env.OPENMELD_TEST_ANTIGRAVITY_BIN ||
        process.platform === "win32",
      timeout: 45_000,
    },
    async (t) => {
      const home = await mkdtemp(
        join(tmpdir(), "openmeld-antigravity-native-")
      );
      t.after(() => rm(home, { recursive: true, force: true }));
      const workdir = join(home, "workspace");
      const settingsDir = join(home, ".gemini/antigravity-cli");
      await mkdir(workdir);
      await mkdir(settingsDir, { recursive: true });
      const settings = JSON.stringify({
        modelProvider: "gemini",
        enableTelemetry: false,
        toolPermission: "strict",
      });
      await writeFile(join(settingsDir, "settings.json"), settings);
      const sentinel = join(home, "business-command-ran");
      if (scenario === "hook" || scenario === "ambient-mcp") {
        await mkdir(join(home, ".gemini/config"), { recursive: true });
        const configName =
          scenario === "hook" ? "hooks.json" : "mcp_config.json";
        const config =
          scenario === "hook"
            ? {
                fixture: {
                  PreInvocation: [
                    { type: "command", command: `touch ${sentinel}` },
                  ],
                },
              }
            : {
                mcpServers: {
                  external: { command: "touch", args: [sentinel] },
                },
              };
        await writeFile(
          join(home, ".gemini/config", configName),
          JSON.stringify(config)
        );
      }
      const outcome = {
        action: "reply",
        text: "I cannot access the repository.",
        wakeTargets: [],
        referenceTargets: [],
        mentionTargets: [],
      };
      const catalogs = [];
      let error;
      let sentCommand = false;
      const provider = createServer((request, response) => {
        (async () => {
          let text = "";
          for await (const chunk of request) {
            text += chunk;
          }
          const body = JSON.parse(text || "{}");
          const names = (body.tools ?? []).flatMap((tool) =>
            (tool.functionDeclarations ?? []).map(
              (definition) => definition.name
            )
          );
          const main = names.length > 0;
          if (main) {
            catalogs.push(names);
            assert.deepEqual([...names].sort(), ["finish", "manage_task"]);
            assert.ok(catalogs.length < 6);
          }
          let parts = main
            ? [
                {
                  functionCall: {
                    name: "finish",
                    args: {
                      ...outcome,
                      toolSummary: "Delivery result",
                      toolAction: "Delivering reply",
                    },
                  },
                },
              ]
            : [{ text: "Synthetic delivery" }];
          if (main && scenario === "uncommitted-text") {
            parts = [{ text: JSON.stringify(outcome) }];
          }
          if (main && scenario === "rogue-command" && !sentCommand) {
            sentCommand = true;
            parts = [
              {
                functionCall: {
                  name: "run_command",
                  args: {
                    CommandLine: `touch ${sentinel}`,
                    Cwd: workdir,
                    toolSummary: "Forbidden write",
                    toolAction: "Writing sentinel",
                  },
                },
              },
            ];
          }
          const payload = {
            candidates: [
              {
                content: { role: "model", parts },
                finishReason: "STOP",
                index: 0,
              },
            ],
            usageMetadata: {
              promptTokenCount: 1,
              candidatesTokenCount: 1,
              totalTokenCount: 2,
            },
          };
          response.setHeader("content-type", "text/event-stream");
          response.end(`data: ${JSON.stringify(payload)}\n\n`);
        })().catch((failure) => {
          error = failure;
          response.writeHead(500).end();
        });
      });
      provider.listen(0, "127.0.0.1");
      await once(provider, "listening");
      t.after(() => {
        provider.closeAllConnections();
        provider.close();
      });
      const writer = join(home, "openmeld-dev");
      const receipt = join(home, "receipt.json");
      await writeFile(
        writer,
        `#!/usr/bin/env node\nimport{writeFileSync}from'node:fs';let text='';for await(const chunk of process.stdin)text+=chunk;writeFileSync(${JSON.stringify(receipt)},JSON.stringify({args:process.argv.slice(2),text}));`,
        { mode: 0o700 }
      );
      const env = {
        HOME: home,
        GEMINI_API_KEY: "synthetic-loopback-only",
        GOOGLE_GEMINI_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
        OPENMELD_HOME: join(home, "openmeld-state"),
        OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(home, "context.json"),
        OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: writer,
        OPENMELD_USER_FACING_CLI_COMMAND: "openmeld-dev",
        OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1",
      };
      const run = () =>
        withAntigravityDispatchSpaceAction({
          env,
          workdir,
          prompt:
            "Correct only the final public reply; do not repeat the business work.",
          run: ({ prompt, jsonSchema }) =>
            invokeAntigravityCliTransport({
              prompt,
              jsonSchema,
              env,
              workdir,
              agentControllerPermissionMode:
                {
                  plan: "antigravity:plan",
                  bypass: "antigravity:bypassPermissions",
                  "rogue-command": "antigravity:bypassPermissions",
                }[scenario] ?? "antigravity:default",
              launchContract: {
                kind: "executable",
                commandPath: process.env.OPENMELD_TEST_ANTIGRAVITY_BIN,
              },
              sessionId: "canonical-conversation-must-not-be-resumed",
              timeoutMs: 25_000,
            }),
        });
      if (scenario === "hook" || scenario === "ambient-mcp") {
        await assert.rejects(run(), {
          code: "space.action.delivery_only_unverified",
        });
        assert.equal(catalogs.length, 0);
        await assert.rejects(stat(receipt), { code: "ENOENT" });
      } else if (scenario === "uncommitted-text") {
        await assert.rejects(run(), { code: "space.action.record_failed" });
        await assert.rejects(stat(receipt), { code: "ENOENT" });
      } else {
        const result = await run();
        assert.equal(
          result.sessionId,
          "canonical-conversation-must-not-be-resumed"
        );
        assert.deepEqual(result.structuredOutput, outcome);
        assert.deepEqual(JSON.parse(await readFile(receipt, "utf8")), {
          args: ["space", "action", "reply", "--message-file", "-"],
          text: outcome.text,
        });
        assert.ok(catalogs.length > 0);
      }
      await assert.rejects(stat(sentinel), { code: "ENOENT" });
      assert.equal(
        await readFile(join(settingsDir, "settings.json"), "utf8"),
        settings
      );
      assert.equal(error, undefined);
    }
  );
}
