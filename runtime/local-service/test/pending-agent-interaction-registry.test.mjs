import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPendingAgentInteractionRegistry } from "../dist/index.js";

const createAuthority = () => ({
  attemptId: "attempt-1",
  dispatchId: "dispatch-1",
  executionIdentityEcho: {
    echoSource: "daemon_delivery_context",
    core: {
      modelVersion: "openmeld.runtime.execution_identity.v1",
      spaceId: "space-1",
      dispatchId: "dispatch-1",
      targetProfileId: "profile-1",
      openMeldServiceRuntimeId: {
        source: "runtime_registry_authority",
        value: "runtime-1",
      },
      bindingId: "binding-1",
      agentControllerRef: "builtin:codex",
    },
  },
  executionTokenEcho: {
    executionToken:
      "rcet_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runId: "run-1",
    runtimeCoordinatorExecutionId: "execution-1",
    tokenFingerprint: "etfp_v1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  },
  runtimeCoordinatorExecutionId: "execution-1",
  targetProfileId: "profile-1",
});

const createRequest = (
  interactionId = "interaction-1",
  requestedAtMs = Date.now()
) => ({
  v: 1,
  interactionId,
  requestedAtMs,
  expiresAtMs: requestedAtMs + 60_000,
  kind: "permission",
  title: "Allow this command?",
  subject: {
    type: "command",
    command: "pnpm test",
  },
  options: [
    {
      optionId: "accept",
      label: "Allow once",
      intent: "allow_once",
    },
  ],
});

describe("pending agent interaction registry", () => {
  it("preserves the interaction expiry code for the adapter result boundary", async () => {
    const registry = createPendingAgentInteractionRegistry();
    const responsePromise = registry.register({
      authority: createAuthority(),
      request: {
        ...createRequest(),
        expiresAtMs: 0,
      },
      taskId: "task-1",
    });

    await assert.rejects(responsePromise, (error) => {
      assert.equal(error.code, "interaction.expired");
      assert.equal(error.errorType, "timeout");
      return true;
    });
    assert.deepEqual(registry.list(), []);
  });

  it("resolves the registered agent interaction exactly once", async () => {
    const registry = createPendingAgentInteractionRegistry();
    const responsePromise = registry.register({
      authority: createAuthority(),
      request: createRequest(),
      taskId: "task-1",
    });
    const response = {
      kind: "permission",
      optionId: "accept",
    };

    assert.equal(
      registry.resolve({
        interactionId: "interaction-1",
        response,
      }).status,
      "resolved"
    );
    assert.deepEqual(await responsePromise, response);
    assert.equal(
      registry.resolve({
        interactionId: "interaction-1",
        response,
      }).status,
      "already_resolved"
    );
  });

  it("rejects unresolved interactions when their task ends", async () => {
    const registry = createPendingAgentInteractionRegistry();
    const responsePromise = registry.register({
      authority: createAuthority(),
      request: createRequest(),
      taskId: "task-1",
    });

    registry.removeTask("task-1");

    await assert.rejects(responsePromise, (error) => {
      assert.equal(error.code, "interaction.cancelled");
      assert.equal(error.errorType, "adapter");
      return true;
    });
    assert.deepEqual(registry.list(), []);
  });

  it("replays interactions in request order instead of generated id order", () => {
    const registry = createPendingAgentInteractionRegistry();
    const later = registry.register({
      authority: createAuthority(),
      request: createRequest("interaction-a", 2000),
      taskId: "task-1",
    });
    const earlier = registry.register({
      authority: createAuthority(),
      request: createRequest("interaction-z", 1000),
      taskId: "task-1",
    });
    later.catch(() => undefined);
    earlier.catch(() => undefined);

    assert.deepEqual(
      registry.list().map((record) => record.request.interactionId),
      ["interaction-z", "interaction-a"]
    );

    registry.removeTask("task-1");
  });
});
