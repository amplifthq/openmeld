import assert from "node:assert/strict";
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  createAntigravityAdapter,
  probeAntigravityAcp,
} from "../dist/index.js";

for (const scenario of [
  "success",
  "resume",
  "permission",
  "question",
  "no-channel",
  "auth",
  "cancel",
  "unsupported-mode",
]) {
  test(`Antigravity ACP native dispatch: ${scenario}`, async () => {
    const cwd = await mkdtemp(join(tmpdir(), "openmeld-antigravity-acp-"));
    const binary = join(cwd, "agy_acp_server.par");
    const log = join(cwd, "messages.jsonl");
    await copyFile(
      new URL("./fixtures/acp-server.cjs", import.meta.url),
      binary
    );
    const launchContract = {
      kind: "node_script",
      nodePath: process.execPath,
      scriptPath: binary,
    };
    const interactions = [];
    const previews = [];
    const adapter = createAntigravityAdapter({
      launchContract,
      registerRuntimeProcess() {
        // The adapter owns this isolated fixture process.
      },
    });
    try {
      const result = await adapter.dispatch({
        taskId: "task_acp",
        agentId: "agent",
        spaceId: "space",
        sourceEventId: "event",
        prompt: "Check this project",
        timeoutMs: 5000,
        streamingMode: "stream",
        runtimeContext: { providerRuntimeWorkingDirectory: cwd },
        ...(scenario === "resume"
          ? { agentControllerConversationId: "agy_session" }
          : {}),
        env: { FIXTURE_SCENARIO: scenario, FIXTURE_LOG: log },
        agentControllerPermissionMode:
          scenario === "unsupported-mode"
            ? "antigravity:plan"
            : "antigravity:default",
        conversationPolicy: { model: "native-model" },
        onPreview: async (value) => {
          previews.push(value.text);
          if (scenario === "cancel") {
            await adapter.cancel({ taskId: "task_acp" });
          }
        },
        ...(scenario === "no-channel"
          ? {}
          : {
              onInteractionRequest: (request) => {
                interactions.push(request);
                return Promise.resolve(
                  request.kind === "permission"
                    ? { kind: "permission", optionId: "thread" }
                    : {
                        kind: "question",
                        answers: [{ questionId: "choice", values: ["md"] }],
                      }
                );
              },
            }),
      });
      const messages = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      if (["success", "resume", "permission", "question"].includes(scenario)) {
        assert.equal(result.status, "success", JSON.stringify(result));
        assert.equal(result.output, "Native Antigravity reply");
        assert.deepEqual(previews, ["Native Antigravity reply"]);
        assert.equal(
          result.contextDelta.agentControllerConversationId,
          "agy_session"
        );
        assert.ok(
          messages.some(
            (message) =>
              message.method ===
              (scenario === "resume" ? "session/resume" : "session/new")
          )
        );
      } else {
        assert.equal(result.status, "failed", JSON.stringify(result));
        assert.equal(
          result.errorCode,
          {
            auth: "auth.required",
            cancel: "runtime.interrupted",
            "no-channel": "interaction.required",
            "unsupported-mode": "permission.mode_unsupported",
          }[scenario]
        );
      }
      if (scenario === "permission") {
        assert.equal(
          interactions[0].options.find((option) => option.optionId === "thread")
            .intent,
          "allow_session"
        );
        assert.ok(interactions[0].description.includes("access your files"));
        assert.equal(
          messages.find((message) => message.id === "permission_request").result
            .outcome.optionId,
          "thread"
        );
      }
      if (scenario === "question") {
        assert.equal(interactions[0].kind, "question");
        assert.equal(interactions[0].questions[0].allowOther, false);
        assert.equal(
          messages.find((message) => message.id === "permission_request").result
            .outcome.optionId,
          "md"
        );
      }
      if (scenario === "cancel") {
        assert.ok(
          messages.some((message) => message.method === "session/cancel")
        );
      }
      if (scenario === "unsupported-mode") {
        assert.equal(
          messages.some((message) => message.method === "session/prompt"),
          false
        );
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}

test("Antigravity ACP inventory only initializes and never starts authentication", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "openmeld-antigravity-probe-"));
  const binary = join(cwd, "agy_acp_server.par");
  // A probe fixture that fails immediately if any auth/session method is sent.
  const { writeFile } = await import("node:fs/promises");
  await writeFile(
    binary,
    `const { createInterface } = require('node:readline'); createInterface({input:process.stdin}).on('line', line => { const message=JSON.parse(line); if(message.method !== 'initialize') process.exit(2); console.log(JSON.stringify({jsonrpc:'2.0',id:message.id,result:{protocolVersion:1,agentCapabilities:{},agentInfo:{name:'antigravity-acp',version:'1.3.0'}}})); });`
  );
  try {
    const result = await probeAntigravityAcp({
      cwd,
      launchContract: {
        kind: "node_script",
        nodePath: process.execPath,
        scriptPath: binary,
      },
      timeoutMs: 5000,
    });
    assert.equal(result.agentInfo.version, "1.3.0");
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
