import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  buildAntigravityArgs,
  invokeAntigravityCliTransport,
  parseAntigravityOutputLine,
  parseAntigravityUsageLimits,
} from "../dist/index.js";

const createNodeScriptLaunchContract = (scriptPath) => ({
  kind: "node_script",
  nodePath: process.execPath,
  scriptPath,
});

describe("Antigravity CLI transport contract", () => {
  it("uses the exact conversation id and model on a resumed turn", () => {
    assert.deepEqual(
      buildAntigravityArgs({
        addDir: "/tmp/openmeld-antigravity-dispatch",
        conversationPolicy: {
          collaborationMode: "plan",
          model: "gemini-3.8-flash-high",
        },
        prompt: "Continue the work.",
        sessionId: "conversation-123",
      }),
      [
        "--print",
        "Continue the work.",
        "--output-format",
        "stream-json",
        "--print-timeout",
        "0",
        "--add-dir",
        "/tmp/openmeld-antigravity-dispatch",
        "--conversation",
        "conversation-123",
        "--model",
        "gemini-3.8-flash-high",
        "--mode",
        "plan",
      ]
    );
  });

  it("parses current-turn deltas and terminal results without transcript text", () => {
    assert.deepEqual(
      parseAntigravityOutputLine(
        JSON.stringify({
          event: "step_update",
          step_update: {
            conversation_id: "conversation-123",
            state: "ERROR",
            step_index: 3,
            step_type: "tool",
            tool_name: "run_command",
            tool_info: {
              error: {
                message:
                  "permission check failed for an OpenMeld Space Action command",
                type: "TOOL_ERROR",
              },
              name: "run_command",
              parameters: { CommandLine: "openmeld space action reply" },
            },
          },
        })
      ),
      {
        conversationId: "conversation-123",
        event: "step_update",
        state: "ERROR",
        stepIndex: 3,
        stepType: "tool",
        textDelta: null,
        toolError:
          "permission check failed for an OpenMeld Space Action command",
        toolInput: { CommandLine: "openmeld space action reply" },
        toolName: "run_command",
      }
    );

    assert.deepEqual(
      parseAntigravityOutputLine(
        JSON.stringify({
          event: "step_update",
          step_update: {
            conversation_id: "conversation-123",
            state: "ACTIVE",
            step_index: 2,
            step_type: "agent_response",
            text_delta: "Current turn only",
          },
        })
      ),
      {
        conversationId: "conversation-123",
        event: "step_update",
        state: "ACTIVE",
        stepIndex: 2,
        stepType: "agent_response",
        textDelta: "Current turn only",
        toolError: null,
        toolInput: undefined,
        toolName: null,
      }
    );

    assert.deepEqual(
      parseAntigravityOutputLine(
        JSON.stringify({
          event: "result",
          result: {
            conversation_id: "conversation-123",
            response: "Done",
            status: "SUCCESS",
            structured_output: { action: "reply", text: "Done" },
            usage: {
              cache_read_tokens: 3,
              input_tokens: 10,
              output_tokens: 4,
              thinking_tokens: 2,
              total_tokens: 19,
            },
          },
        })
      ),
      {
        conversationId: "conversation-123",
        error: null,
        event: "result",
        response: "Done",
        status: "SUCCESS",
        structuredOutput: { action: "reply", text: "Done" },
        usage: {
          cacheReadTokens: 3,
          inputTokens: 10,
          outputTokens: 4,
          thinkingTokens: 2,
          totalTokens: 19,
        },
      }
    );
  });

  it("projects both weekly Antigravity quota groups", () => {
    const limits = parseAntigravityUsageLimits({
      observedAt: "2026-09-21T00:00:00.000Z",
      output: [
        "Gemini Models\tWeekly Limit Remaining\t99%\t2026-09-28T07:03:35Z",
        "Claude and GPT models\tWeekly Limit Remaining\t75%\t2026-09-28T07:32:37Z",
      ].join("\n"),
    });

    assert.deepEqual(
      limits.map((limit) => ({
        key: limit.key,
        provider: limit.provider.id,
        resetsAt: limit.resetsAt,
        usedPercent: limit.usedPercent,
      })),
      [
        {
          key: "antigravity-gemini:weekly",
          provider: "antigravity-gemini",
          resetsAt: "2026-09-28T07:03:35.000Z",
          usedPercent: 1,
        },
        {
          key: "antigravity-other:weekly",
          provider: "antigravity-other",
          resetsAt: "2026-09-28T07:32:37.000Z",
          usedPercent: 25,
        },
      ]
    );
  });

  it("accepts only a complete successful stream and preserves its conversation", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "antigravity-fixture-"));
    const fixturePath = join(fixtureDir, "agy-fixture.mjs");
    await writeFile(
      fixturePath,
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2);",
        "const readArg = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };",
        "if (readArg('--conversation') !== 'conversation-before') throw new Error('wrong conversation');",
        "console.log(JSON.stringify({ event: 'init', conversation_id: 'conversation-before', init: {} }));",
        "for (const text_delta of ['Hello', ' world', '\\n', '  code']) console.log(JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'conversation-before', state: 'ACTIVE', step_index: 1, step_type: 'agent_response', text_delta } }));",
        "console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'conversation-before', status: 'SUCCESS', response: 'Finished' } }));",
      ].join("\n"),
      "utf8"
    );
    await chmod(fixturePath, 0o755);

    try {
      const previews = [];
      const result = await invokeAntigravityCliTransport({
        launchContract: createNodeScriptLaunchContract(fixturePath),
        onPreview: (preview) => {
          previews.push(preview.text);
        },
        prompt: "Continue.",
        sessionId: "conversation-before",
        timeoutMs: 5000,
        workdir: fixtureDir,
      });

      assert.equal(result.output, "Finished");
      assert.equal(result.sessionId, "conversation-before");
      assert.deepEqual(previews, [
        "Hello",
        "Hello world",
        "Hello world\n",
        "Hello world\n  code",
      ]);
      assert.equal(result.telemetry.resumedContext, true);
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  });

  it("fails closed on malformed output even if a success record follows", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "antigravity-fixture-"));
    const fixturePath = join(fixtureDir, "agy-malformed-fixture.mjs");
    await writeFile(
      fixturePath,
      [
        "#!/usr/bin/env node",
        "console.log('not-json');",
        "console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'conversation-1', status: 'SUCCESS', response: 'Finished' } }));",
      ].join("\n"),
      "utf8"
    );
    await chmod(fixturePath, 0o755);

    try {
      await assert.rejects(
        invokeAntigravityCliTransport({
          launchContract: createNodeScriptLaunchContract(fixturePath),
          prompt: "Run.",
          sessionId: null,
          timeoutMs: 5000,
          workdir: fixtureDir,
        }),
        (error) => error?.code === "runtime.output.invalid"
      );
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  });

  it("reports a headless tool denial as a runtime permission failure", async () => {
    const fixtureDir = await mkdtemp(join(tmpdir(), "antigravity-fixture-"));
    const fixturePath = join(fixtureDir, "agy-permission-fixture.mjs");
    await writeFile(
      fixturePath,
      [
        "#!/usr/bin/env node",
        "console.log(JSON.stringify({ event: 'init', conversation_id: 'conversation-1', init: {} }));",
        "console.log(JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'conversation-1', state: 'ERROR', step_index: 2, step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'openmeld space action reply' }, error: { type: 'TOOL_ERROR', message: 'permission check failed for command: user denied permission to run command' } } } }));",
        "console.log(JSON.stringify({ event: 'result', result: { conversation_id: 'conversation-1', status: 'SUCCESS', response: '' } }));",
      ].join("\n"),
      "utf8"
    );
    await chmod(fixturePath, 0o755);

    try {
      await assert.rejects(
        invokeAntigravityCliTransport({
          launchContract: createNodeScriptLaunchContract(fixturePath),
          prompt: "Run.",
          sessionId: null,
          timeoutMs: 5000,
          workdir: fixtureDir,
        }),
        (error) => error?.code === "permission.denied.runtime"
      );
    } finally {
      await rm(fixtureDir, { force: true, recursive: true });
    }
  });
});
