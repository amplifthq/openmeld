import assert from "node:assert/strict";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createOpenCodeAdapter } from "../dist/index.js";

// The old-major fixture cannot expose v2 receipt, form and permission contracts.
for (const scenario of [
  "success",
  "permission",
  "form",
  "failure",
  "wrong-receipt",
  "busy",
  "exit-during-question",
]) {
  test(`OpenCode 2 native dispatch: ${scenario}`, async () => {
    const cwd = await realpath(
      await mkdtemp(join(tmpdir(), "openmeld-opencode2-"))
    );
    const log = join(cwd, "requests.jsonl");
    try {
      const interactions = [];
      const runtimeEvents = [];
      const adapter = createOpenCodeAdapter({
        launchContract: {
          kind: "node_script",
          nodePath: process.execPath,
          scriptPath: fileURLToPath(
            new URL("./fixtures/server-v2.mjs", import.meta.url)
          ),
        },
        openCodeTimeoutMs: 5000,
      });
      const result = await adapter.dispatch({
        taskId: "task_v2",
        agentId: "agent",
        spaceId: "space",
        sourceEventId: "event",
        prompt: "Check the project",
        runtimeContext: { providerRuntimeWorkingDirectory: cwd },
        ...(scenario === "busy"
          ? { agentControllerConversationId: "ses_native" }
          : {}),
        env: { FIXTURE_SCENARIO: scenario, FIXTURE_LOG: log },
        openCodePermission: { bash: { "*": "deny", "git status": "ask" } },
        onRuntimeEvent: (event) => {
          runtimeEvents.push(event);
        },
        onInteractionRequest: (request) => {
          interactions.push(request);
          if (scenario === "exit-during-question") {
            return new Promise(() => {
              // Simulate a person who has not answered before the process exits.
            });
          }
          return Promise.resolve(
            request.kind === "permission"
              ? { kind: "permission", optionId: "once" }
              : {
                  kind: "question",
                  answers: [{ questionId: "format", values: ["0"] }],
                }
          );
        },
      });
      const requests = (await readFile(log, "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line));
      if (["success", "permission", "form"].includes(scenario)) {
        assert.equal(result.status, "success", JSON.stringify(result));
        assert.equal(result.output, "Native reply");
        assert.equal(
          result.contextDelta.agentControllerConversationId,
          "ses_native"
        );
        assert.ok(
          runtimeEvents.some(
            (event) =>
              event.phase === "provider_turn_accepted" &&
              event.turnId === "inbox_current"
          )
        );
        assert.deepEqual(
          requests.find((request) => request.path === "/api/session").body
            .permissions,
          [
            { action: "shell", resource: "*", effect: "deny" },
            { action: "shell", resource: "git status", effect: "ask" },
          ]
        );
      } else {
        assert.equal(result.status, "failed", JSON.stringify(result));
        assert.equal(
          result.errorCode,
          {
            failure: "provider.insufficient_balance",
            "wrong-receipt": "protocol.receipt_missing",
            busy: "conversation.busy",
            "exit-during-question": "upstream_unreachable",
          }[scenario],
          JSON.stringify(result)
        );
        if (scenario === "busy") {
          assert.equal(
            requests.some((request) => request.path.endsWith("/prompt")),
            false
          );
        }
      }
      if (scenario === "permission") {
        assert.deepEqual(
          requests.find((request) => request.path.endsWith("/reply")).body,
          { decision: "once" }
        );
      }
      if (scenario === "form") {
        assert.deepEqual(
          requests.find((request) => request.path.endsWith("/reply")).body,
          { answer: { format: "md" } }
        );
      }
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
}
