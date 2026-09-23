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
import { z } from "zod/v4";
import { invokeClaudeAgentSdkTransport } from "../dist/index.js";

const PREFIX = "mcp__openmeld_internal_dispatch_space_action__";

for (const scenario of ["default", "plan", "approval", "denied"]) {
  test(
    `native Claude delivery-only scope and user policy: ${scenario}`,
    { skip: !process.env.OPENMELD_TEST_CLAUDE_BIN, timeout: 100_000 },
    async (t) => {
      const home = await mkdtemp(join(tmpdir(), "openmeld-claude-delivery-"));
      const workdir = join(home, "workspace");
      const configDir = join(home, "claude");
      await mkdir(workdir);
      await mkdir(configDir);
      let phase = "source";
      let step = 0;
      let recorded = false;
      const catalogs = [];
      const calls = [];
      const approvals = [];
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
          const names = (body.tools ?? []).map((tool) => tool.name);
          catalogs.push({ phase, names });
          if (catalogs.length > 8) {
            throw new Error("Unexpected repeated native model requests");
          }
          let block;
          if (phase === "correction" && step++ === 0) {
            block = {
              type: "tool_use",
              id: "reply-fixture",
              name: `${PREFIX}reply`,
              input: { message: "I cannot access the repository." },
            };
          } else if (
            phase === "correction" &&
            names.includes("StructuredOutput") &&
            step === 2
          ) {
            block = {
              type: "tool_use",
              id: "report-fixture",
              name: "StructuredOutput",
              input: { recorded },
            };
          } else {
            block = {
              type: "text",
              text:
                phase === "source"
                  ? "Private fixture context: repository access is missing."
                  : JSON.stringify({ recorded }),
            };
          }
          const stopReason =
            block.type === "tool_use" ? "tool_use" : "end_turn";
          const message = {
            id: `message-${catalogs.length}`,
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
            content_block:
              block.type === "text"
                ? { type: "text", text: "" }
                : { ...block, input: {} },
          });
          event("content_block_delta", {
            index: 0,
            delta:
              block.type === "text"
                ? { type: "text_delta", text: block.text }
                : {
                    type: "input_json_delta",
                    partial_json: JSON.stringify(block.input),
                  },
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
        await rm(home, { recursive: true, force: true });
      });
      provider.listen(0, "127.0.0.1");
      await once(provider, "listening");
      const env = {
        HOME: home,
        CLAUDE_CONFIG_DIR: configDir,
        OPENMELD_HOME: join(home, "openmeld-home"),
        ANTHROPIC_API_KEY: "synthetic-local-only",
        ANTHROPIC_AUTH_TOKEN: "",
        CLAUDE_CODE_OAUTH_TOKEN: "",
        CLAUDE_CODE_USE_BEDROCK: "",
        CLAUDE_CODE_USE_VERTEX: "",
        CLAUDE_CODE_USE_FOUNDRY: "",
        ANTHROPIC_BASE_URL: `http://127.0.0.1:${provider.address().port}`,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
        DISABLE_AUTOUPDATER: "1",
      };
      const request = {
        launchContract: {
          kind: "executable",
          commandPath: process.env.OPENMELD_TEST_CLAUDE_BIN,
        },
        claudeWorkdir: workdir,
        claudeTimeoutMs: 35_000,
        conversationPolicy: { model: "claude-sonnet-4-6" },
        env,
        sessionId: null,
        prompt: "Explain that repository access is missing. Do not call tools.",
      };
      const source = await invokeClaudeAgentSdkTransport(request);
      assert.ok(source.sessionId);
      const marker = join(home, "hook-ran");
      const hookScript = join(home, "hook.cjs");
      await writeFile(
        hookScript,
        `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected')`
      );
      const settings = {
        hooks: {
          PreToolUse: [
            {
              matcher: "*",
              hooks: [
                {
                  type: "command",
                  command: `${JSON.stringify(process.execPath)} ${JSON.stringify(hookScript)}`,
                },
              ],
            },
          ],
        },
        ...(scenario === "denied"
          ? { permissions: { deny: [`${PREFIX}reply`] } }
          : {}),
        ...(scenario === "approval"
          ? { permissions: { ask: [`${PREFIX}reply`] } }
          : {}),
      };
      const settingsPath = join(configDir, "settings.json");
      const originalSettings = JSON.stringify(settings);
      await writeFile(settingsPath, originalSettings);
      const capability = {
        deliveryOnly: true,
        tools: [
          {
            name: "reply",
            description: "Deliver an explicit public reply",
            inputSchema: z.strictObject({ message: z.string() }),
          },
          {
            name: "stay_silent",
            description: "Choose intentional silence",
            inputSchema: z.strictObject({ reason: z.string() }),
          },
          {
            name: "read_receipt",
            description: "Reconcile the existing local receipt",
            inputSchema: z.strictObject({}),
          },
        ],
        call(name, args) {
          calls.push({ name, args });
          if (name === "reply" || name === "stay_silent") {
            recorded = true;
          }
          return Promise.resolve({
            content: [
              {
                type: "text",
                text: recorded
                  ? "Proposal saved locally; publication unconfirmed."
                  : "No local proposal.",
              },
            ],
            ...(recorded
              ? {
                  structuredContent: {
                    receipt: { status: "proposal_saved_locally" },
                  },
                }
              : {}),
          });
        },
        close() {
          /* This fixture owns no native resources. */
        },
      };
      phase = "correction";
      const runCorrection = () =>
        invokeClaudeAgentSdkTransport({
          ...request,
          env: { ...env, OPENMELD_SPACE_ACTION_DELIVERY_ONLY: "1" },
          executionMode: "repair",
          sessionId: source.sessionId,
          spaceActionTools: capability,
          agentControllerPermissionMode:
            scenario === "plan" ? "claude-code:plan" : "claude-code:default",
          onInteractionRequest: (interaction) => {
            approvals.push(interaction);
            assert.equal(interaction.kind, "permission");
            const option = interaction.options.find(
              (candidate) => candidate.intent === "allow_once"
            );
            assert.ok(option);
            return Promise.resolve({
              kind: "permission",
              optionId: option.optionId,
            });
          },
          prompt:
            "Only deliver the already-known limitation through reply. Do not redo the task or publish private fixture context.",
        });
      if (scenario === "denied") {
        await assert.rejects(runCorrection, {
          code: "space.action.delivery_unconfirmed",
        });
        assert.equal(recorded, false);
      } else {
        const result = await runCorrection();
        assert.equal(result.sessionId, source.sessionId);
        assert.equal(calls.filter((call) => call.name === "reply").length, 1);
        assert.equal(
          result.output,
          "Proposal saved locally; publication unconfirmed."
        );
      }
      // Captured Claude 2.1.278 behavior: user-selected Plan also asks before
      // this effectful MCP call. Keep that native approval, never switch mode.
      assert.equal(
        approvals.length,
        scenario === "approval" || scenario === "plan" ? 1 : 0
      );
      await assert.rejects(stat(marker), { code: "ENOENT" });
      assert.equal(await readFile(settingsPath, "utf8"), originalSettings);
      const allowed = new Set([
        `${PREFIX}reply`,
        `${PREFIX}stay_silent`,
        `${PREFIX}read_receipt`,
        "StructuredOutput",
      ]);
      for (const entry of catalogs.filter(
        (entry) => entry.phase === "correction"
      )) {
        assert.deepEqual(
          entry.names.filter((name) => !allowed.has(name)),
          [],
          JSON.stringify(entry)
        );
      }
    }
  );
}
