import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
import { createOpenClawAdapter } from "../dist/index.js";
import {
  capability,
  writeSpaceToolFixture,
} from "./fixtures/space-tool-fixture.js";

for (const scenario of ["default", "minimal", "denied"]) {
  const denied = scenario === "denied";
  test(
    `native OpenClaw correction isolates plugins, preserves canonical identity and respects denial: ${scenario}`,
    { skip: !process.env.OPENMELD_TEST_OPENCLAW_BIN, timeout: 90_000 },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), "openmeld-openclaw-native-"));
      const workdir = join(home, "workspace");
      const foreign = join(home, "foreign-plugin");
      await mkdir(workdir);
      await mkdir(foreign);
      const marker = join(home, "foreign-plugin-ran");
      await writeFile(
        join(foreign, "openclaw.plugin.json"),
        JSON.stringify({
          id: "fixture-foreign",
          configSchema: { type: "object", properties: {} },
        })
      );
      await writeFile(
        join(foreign, "index.mjs"),
        `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'unexpected');export default {id:'fixture-foreign',register(){}};`
      );
      const { command, capture } = await writeSpaceToolFixture(home, true);
      const catalogs = [];
      let step = 0;
      const provider = createServer((request, response) => {
        (async () => {
          let text = "";
          for await (const chunk of request) {
            text += chunk;
          }
          const body = JSON.parse(text);
          const names = (body.tools ?? []).map(
            (tool) => tool.function?.name ?? tool.name
          );
          catalogs.push(names);
          const shouldCall = !denied && step++ === 0;
          const delta = shouldCall
            ? {
                role: "assistant",
                tool_calls: [
                  {
                    index: 0,
                    id: "delivery-fixture",
                    type: "function",
                    function: {
                      name: "openmeld_space_reply",
                      arguments: JSON.stringify({
                        message: "I cannot access the repository.",
                      }),
                    },
                  },
                ],
              }
            : {
                role: "assistant",
                content: "Fixture complete; no business work was performed.",
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
                finish_reason: shouldCall ? "tool_calls" : "stop",
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
      const originalConfig = JSON.stringify({
        agents: {
          defaults: {
            workspace: workdir,
            skipBootstrap: true,
            model: { primary: "fixture/fixture" },
          },
        },
        models: {
          mode: "merge",
          providers: {
            fixture: {
              baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
              apiKey: "synthetic-only",
              api: "openai-completions",
              models: [
                {
                  id: "fixture",
                  name: "fixture",
                  reasoning: false,
                  input: ["text"],
                  contextWindow: 32_000,
                  maxTokens: 4096,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                },
              ],
            },
          },
        },
        plugins: {
          enabled: true,
          slots: { memory: "none" },
          allow: ["fixture-foreign"],
          load: { paths: [foreign] },
          entries: { "fixture-foreign": { enabled: true } },
        },
        tools: {
          ...(scenario === "minimal" ? { profile: "minimal" } : {}),
          ...(denied ? { deny: ["openmeld_space_reply"] } : {}),
        },
      });
      const configPath = join(home, "openclaw.json");
      await writeFile(configPath, originalConfig);
      const canonicalId = randomUUID();
      const result = await createOpenClawAdapter({
        launchContract: {
          kind: "executable",
          commandPath: process.env.OPENMELD_TEST_OPENCLAW_BIN,
        },
        openClawTimeoutMs: 45_000,
      }).dispatch({
        agentId: "agt-fixture",
        agentControllerConversationId: canonicalId,
        taskId: "task-correction",
        sourceEventId: "evt-fixture",
        spaceId: "space-fixture",
        executionMode: "repair",
        runtimeContext: { providerRuntimeWorkingDirectory: workdir },
        prompt:
          "Only deliver the already-known limitation with reply: I cannot access the repository. Do not redo the task.",
        spaceActionTools: capability(true),
        env: {
          HOME: home,
          OPENMELD_HOME: join(home, "openmeld-home"),
          OPENCLAW_STATE_DIR: home,
          OPENCLAW_CONFIG_PATH: configPath,
          OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1",
          OPENMELD_SPACE_ACTION_CONTEXT_PATH: join(home, "context.json"),
          OPENMELD_SPACE_ACTION_TOOL_COMMAND_PATH: command,
          OPENMELD_USER_FACING_CLI_COMMAND: "openmeld",
        },
      });
      assert.equal(result.status, "success", JSON.stringify(result));
      assert.equal(
        result.contextDelta?.agentControllerConversationId,
        canonicalId
      );
      assert.equal(await readFile(configPath, "utf8"), originalConfig);
      await assert.rejects(stat(marker), { code: "ENOENT" });
      assert.ok(catalogs.length > 0);
      const allowed = [
        "openmeld_space_reply",
        "openmeld_space_stay_silent",
        "openmeld_space_read_receipt",
      ];
      for (const names of catalogs) {
        assert.deepEqual(
          names.filter((name) => !allowed.includes(name)),
          []
        );
        assert.equal(names.includes("openmeld_space_reply"), !denied);
      }
      if (denied) {
        await assert.rejects(stat(capture), { code: "ENOENT" });
      } else {
        const calls = (await readFile(capture, "utf8"))
          .trim()
          .split("\n")
          .map(JSON.parse)
          .filter((item) => item.name === "reply");
        assert.equal(calls.length, 1);
        assert.equal(
          calls[0].arguments.message,
          "I cannot access the repository."
        );
      }
    }
  );
}
