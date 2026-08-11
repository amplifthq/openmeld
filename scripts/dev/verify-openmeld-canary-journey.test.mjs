import assert from "node:assert/strict";
import test from "node:test";

import {
  assertHistoryContainsAgentReply,
  assertPrepareEvidence,
  assertTraceEvidence,
  parseCliOptions,
  runCanaryJourneyVerification,
} from "./verify-openmeld-canary-journey.mjs";

const BINDING_NOT_ACCEPTED_RE = /formal Agent Profile Binding was not accepted/;
const DISPATCH_NOT_SUCCEEDED_RE = /dispatch did not succeed/;
const EXPECTED_AGENT_REPLY_RE = /expected Agent reply/;
const REPLY_NOT_PUBLISHED_RE = /Space reply was not published/;
const RUNTIME_COORDINATOR_MISSING_RE =
  /RuntimeCoordinator execution was not found/;
const SIGN_IN_REQUIRED_RE = /openmeld-canary is not signed in/;
const WRONG_ENVIRONMENT_RE = /Wrong OpenMeld Environment/;
const WAKE_TOKEN_RE = /OPENMELD_CANARY_WAKE_[A-Za-z0-9_-]+/;

test("assertPrepareEvidence requires submitted runtime report and accepted Binding", () => {
  assert.doesNotThrow(() =>
    assertPrepareEvidence([
      {
        code: "agents.prepare.result",
        payload: {
          agentProfileBindingEnsure: { status: "accepted" },
          runtimeReportSubmission: { status: "submitted" },
        },
      },
    ])
  );

  assert.throws(
    () =>
      assertPrepareEvidence([
        {
          code: "agents.prepare.result",
          payload: {
            agentProfileBindingEnsure: { status: "missing" },
            runtimeReportSubmission: { status: "submitted" },
          },
        },
      ]),
    BINDING_NOT_ACCEPTED_RE
  );
});

test("assertTraceEvidence requires dispatch, RuntimeCoordinator result handling, runtime completion, and reply publication", () => {
  assert.doesNotThrow(() =>
    assertTraceEvidence({
      correlation: {
        runtimeCoordinatorExecutionId: "rce-1",
      },
      trace: {
        dispatch: { status: "succeeded" },
        resultInbox: { publishState: "reply_published" },
        runtimeCoordinatorExecution: {
          runtimeCoordinatorExecutionId: "rce-1",
          status: "reply_published",
        },
        runtime: { exitCode: 0 },
      },
    })
  );

  assert.throws(
    () =>
      assertTraceEvidence({
        trace: {
          dispatch: { status: "succeeded" },
          resultInbox: { publishState: "reply_published" },
          runtime: { exitCode: 0 },
        },
      }),
    RUNTIME_COORDINATOR_MISSING_RE
  );
  assert.throws(
    () =>
      assertTraceEvidence({
        correlation: {
          runtimeCoordinatorExecutionId: "rce-1",
        },
        trace: {
          dispatch: { status: "failed" },
          resultInbox: { publishState: "reply_published" },
          runtimeCoordinatorExecution: {
            runtimeCoordinatorExecutionId: "rce-1",
            status: "reply_published",
          },
          runtime: { exitCode: 0 },
        },
      }),
    DISPATCH_NOT_SUCCEEDED_RE
  );
  assert.throws(
    () =>
      assertTraceEvidence({
        correlation: {
          runtimeCoordinatorExecutionId: "rce-1",
        },
        trace: {
          dispatch: { status: "succeeded" },
          resultInbox: { publishState: "result_accepted" },
          runtimeCoordinatorExecution: {
            runtimeCoordinatorExecutionId: "rce-1",
            status: "result_accepted",
          },
          runtime: { exitCode: 0 },
        },
      }),
    REPLY_NOT_PUBLISHED_RE
  );
});

test("assertHistoryContainsAgentReply requires the Agent Profile reply, not only the user wake text", () => {
  const stdout = [
    JSON.stringify({
      code: "tail.signal",
      payload: {
        data: { text: "@canary(wake) Reply with TOKEN." },
        profile: { profileId: "human-1" },
      },
    }),
    JSON.stringify({
      code: "tail.signal",
      payload: {
        data: { text: "TOKEN" },
        profile: { profileId: "agent-1" },
      },
    }),
  ].join("\n");

  assert.doesNotThrow(() =>
    assertHistoryContainsAgentReply({
      agentProfileId: "agent-1",
      expectedToken: "TOKEN",
      stdout,
    })
  );
  assert.throws(
    () =>
      assertHistoryContainsAgentReply({
        agentProfileId: "agent-2",
        expectedToken: "TOKEN",
        stdout,
      }),
    EXPECTED_AGENT_REPLY_RE
  );
});

test("runCanaryJourneyVerification stops before creating resources when auth is missing", async () => {
  const calls = [];
  const commandRunner = (command, args, options = {}) => {
    calls.push({ args, command, env: options.env });
    if (
      command === "openmeld-canary" &&
      args.join(" ") === "auth status --view agent"
    ) {
      return {
        exitCode: 1,
        stderr: "",
        stdout: "Authentication required. Run `openmeld-canary login`.",
      };
    }
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await assert.rejects(
    () =>
      runCanaryJourneyVerification({
        commandRunner,
        options: parseCliOptions([]),
      }),
    SIGN_IN_REQUIRED_RE
  );
  assert.equal(
    calls.some(
      (call) =>
        call.command === "openmeld-canary" && call.args.includes("profile")
    ),
    false
  );
});

test("runCanaryJourneyVerification preserves environment mismatch diagnostics", async () => {
  const calls = [];
  const commandRunner = (command, args, options = {}) => {
    calls.push({ args, command, env: options.env });
    if (
      command === "openmeld-canary" &&
      args.join(" ") === "auth status --view agent"
    ) {
      return {
        exitCode: 1,
        stderr: "",
        stdout: `${JSON.stringify({
          code: "auth.status.result",
          payload: {
            guidanceReason: "mismatch",
            state: "mismatch",
          },
        })}\n`,
      };
    }
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await assert.rejects(
    () =>
      runCanaryJourneyVerification({
        commandRunner,
        options: parseCliOptions([]),
      }),
    WRONG_ENVIRONMENT_RE
  );
  assert.equal(
    calls.some(
      (call) =>
        call.command === "openmeld-canary" && call.args.includes("profile")
    ),
    false
  );
});

test("runCanaryJourneyVerification runs only user-visible canary commands for the happy path", async () => {
  const calls = [];
  let wakeToken = "";
  const commandRunner = (command, args, options = {}) => {
    calls.push({ args, command, env: options.env });
    const joined = `${command} ${args.join(" ")}`;
    if (joined === "openmeld-canary auth status --view agent") {
      return { exitCode: 0, stderr: "", stdout: "{}\n" };
    }
    if (joined === "openmeld-canary whoami --view agent") {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          code: "whoami.openmeld_profile",
          payload: {
            openMeldProfileId: "human-1",
            profileKind: "human",
          },
        })}\n`,
      };
    }
    if (joined.includes("profile create")) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          code: "profile.created",
          data: { openMeldProfileId: "agent-1" },
        })}\n`,
      };
    }
    if (joined.includes("space create")) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          code: "space.create.created",
          data: { spaceId: "space-1" },
        })}\n`,
      };
    }
    if (joined.includes("agents prepare")) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          code: "agents.prepare.result",
          payload: {
            agentProfileBindingEnsure: { status: "accepted" },
            runtimeReportSubmission: { status: "submitted" },
          },
        })}\n`,
      };
    }
    if (joined.includes("space send")) {
      wakeToken =
        String(
          args.find((arg) => String(arg).includes("OPENMELD_CANARY_WAKE_")) ??
            ""
        ).match(WAKE_TOKEN_RE)?.[0] ?? "";
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          code: "send.response",
          payload: { clientMessageId: "client-message-1" },
        })}\n`,
      };
    }
    if (joined.includes("service trace")) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          code: "service.trace.result",
          payload: {
            correlation: {
              runtimeCoordinatorExecutionId: "rce-1",
            },
            trace: {
              dispatch: { status: "succeeded" },
              resultInbox: { publishState: "reply_published" },
              runtimeCoordinatorExecution: {
                runtimeCoordinatorExecutionId: "rce-1",
                status: "reply_published",
              },
              runtime: { exitCode: 0 },
            },
          },
        })}\n`,
      };
    }
    if (joined.includes("space history")) {
      return {
        exitCode: 0,
        stderr: "",
        stdout: `${JSON.stringify({
          code: "tail.signal",
          payload: {
            data: { text: wakeToken },
            profile: { profileId: "agent-1" },
          },
        })}\n`,
      };
    }
    return { exitCode: 0, stderr: "", stdout: "" };
  };

  await runCanaryJourneyVerification({
    commandRunner,
    options: {
      mode: "local",
      timeoutMs: 1,
    },
  });

  assert.equal(
    calls.every(
      (call) => call.command === "pnpm" || call.command === "openmeld-canary"
    ),
    true
  );
  assert.equal(
    calls.some(
      (call) =>
        call.command === "openmeld-canary" &&
        call.args[0] === "service" &&
        call.args[1] === "trace" &&
        call.args.includes("--details")
    ),
    true
  );
  assert.equal(
    calls.some(
      (call) =>
        call.command === "openmeld-canary" &&
        call.args[0] === "service" &&
        call.args[1] === "stop"
    ),
    true
  );
});
