import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCloudflareHintCommands,
  buildOpenMeldTraceArgs,
  buildTraceInvocation,
  parseOpsTraceArgs,
} from "./trace.mjs";

const EXACTLY_ONE_SELECTOR_RE =
  /Exactly one of --diagnostic-report, --dispatch, --source-signal, or --client-message is required/;
const TARGET_PROFILE_REQUIRED_RE = /--target-profile is required/;
const INVALID_CLI_RE = /Invalid --cli/;
const INVALID_VIEW_RE = /Invalid --view/;
const OPENMELD_DEV_WRAPPER_RE = /scripts\/dev\/openmeld-dev\.mjs$/;

test("builds a client message trace command for the repo-local dev CLI", () => {
  const parsed = parseOpsTraceArgs([
    "--space",
    "sp_123",
    "--client-message",
    "cm_123",
    "--target-profile",
    "ap_123",
  ]);

  assert.equal(parsed.cli, "openmeld-dev");
  assert.deepEqual(buildOpenMeldTraceArgs(parsed), [
    "service",
    "trace",
    "--space",
    "sp_123",
    "--client-message",
    "cm_123",
    "--target-profile",
    "ap_123",
    "--view",
    "human",
  ]);
});

test("builds a dispatch trace command without requiring a target profile", () => {
  const parsed = parseOpsTraceArgs([
    "--cli",
    "openmeld",
    "--space",
    "sp_123",
    "--dispatch",
    "dispatch_123",
    "--profile",
    "operator_profile",
    "--gateway-url",
    "https://gateway.example.com",
    "--view",
    "agent",
  ]);

  assert.equal(parsed.cli, "openmeld");
  assert.equal(parsed.cloudflareHints, false);
  assert.deepEqual(buildOpenMeldTraceArgs(parsed), [
    "service",
    "trace",
    "--space",
    "sp_123",
    "--dispatch",
    "dispatch_123",
    "--profile",
    "operator_profile",
    "--gateway-url",
    "https://gateway.example.com",
    "--view",
    "agent",
  ]);
});

test("uses the repo-local openmeld-dev wrapper for the default CLI", () => {
  const invocation = buildTraceInvocation(
    parseOpsTraceArgs([
      "--space",
      "sp_123",
      "--client-message",
      "cm_123",
      "--target-profile",
      "ap_123",
    ])
  );

  assert.equal(invocation.command, process.execPath);
  assert.match(invocation.args[0], OPENMELD_DEV_WRAPPER_RE);
  assert.deepEqual(invocation.args.slice(1), [
    "service",
    "trace",
    "--space",
    "sp_123",
    "--client-message",
    "cm_123",
    "--target-profile",
    "ap_123",
    "--view",
    "human",
  ]);
});

test("delegates Diagnostic Report lookups to the Diagnostic Report ops resolver", () => {
  const parsed = parseOpsTraceArgs([
    "--diagnostic-report",
    "diag_123",
    "--cli",
    "openmeld",
    "--profile",
    "operator_profile",
    "--gateway-url",
    "https://gateway.example.com",
  ]);

  assert.equal(parsed.cloudflareHints, false);
  assert.deepEqual(parsed.selector, {
    kind: "diagnostic_report",
    diagnosticReportId: "diag_123",
  });
  assert.deepEqual(buildTraceInvocation(parsed), {
    args: [
      "ops:diagnostic-report",
      "--diagnostic-report",
      "diag_123",
      "--cli",
      "openmeld",
      "--profile",
      "operator_profile",
      "--gateway-url",
      "https://gateway.example.com",
    ],
    command: "pnpm",
  });
});

test("requires exactly one trace selector", () => {
  assert.throws(
    () => parseOpsTraceArgs(["--space", "sp_123"]),
    EXACTLY_ONE_SELECTOR_RE
  );
  assert.throws(
    () =>
      parseOpsTraceArgs([
        "--space",
        "sp_123",
        "--client-message",
        "cm_123",
        "--dispatch",
        "dispatch_123",
      ]),
    EXACTLY_ONE_SELECTOR_RE
  );
});

test("requires target profile for client-message and source-signal selectors", () => {
  assert.throws(
    () =>
      parseOpsTraceArgs(["--space", "sp_123", "--client-message", "cm_123"]),
    TARGET_PROFILE_REQUIRED_RE
  );
  assert.throws(
    () =>
      parseOpsTraceArgs(["--space", "sp_123", "--source-signal", "sig_123"]),
    TARGET_PROFILE_REQUIRED_RE
  );
});

test("validates cli command and trace view", () => {
  assert.throws(
    () =>
      parseOpsTraceArgs([
        "--cli",
        "node",
        "--space",
        "sp_123",
        "--dispatch",
        "dispatch_123",
      ]),
    INVALID_CLI_RE
  );
  assert.throws(
    () =>
      parseOpsTraceArgs([
        "--space",
        "sp_123",
        "--dispatch",
        "dispatch_123",
        "--view",
        "json",
      ]),
    INVALID_VIEW_RE
  );
});

test("supports inline option values and explicit Cloudflare hint suppression", () => {
  const parsed = parseOpsTraceArgs([
    "--space=sp_123",
    "--dispatch=dispatch_123",
    "--no-cf-hints",
  ]);

  assert.equal(parsed.cloudflareHints, false);
  assert.deepEqual(parsed.selector, {
    kind: "dispatch",
    dispatchId: "dispatch_123",
  });
});

test("builds Cloudflare runtime evidence follow-up commands from the selector", () => {
  assert.deepEqual(
    buildCloudflareHintCommands(
      parseOpsTraceArgs([
        "--space",
        "sp_123",
        "--client-message",
        "cm_123",
        "--target-profile",
        "ap_123",
      ])
    ),
    [
      [
        "pnpm",
        "ops:cf:query",
        "--space",
        "sp_123",
        "--client-message",
        "cm_123",
        "--target-profile",
        "ap_123",
      ],
    ]
  );

  assert.deepEqual(
    buildCloudflareHintCommands(
      parseOpsTraceArgs(["--space", "sp_123", "--dispatch", "dispatch_123"])
    ),
    [
      [
        "pnpm",
        "ops:cf:query",
        "--space",
        "sp_123",
        "--dispatch",
        "dispatch_123",
      ],
    ]
  );

  assert.deepEqual(
    buildCloudflareHintCommands(
      parseOpsTraceArgs([
        "--space",
        "sp_123",
        "--source-signal",
        "sig_123",
        "--target-profile",
        "ap_123",
      ])
    ),
    [
      [
        "pnpm",
        "ops:cf:query",
        "--space",
        "sp_123",
        "--source-signal",
        "sig_123",
        "--target-profile",
        "ap_123",
      ],
    ]
  );

  assert.deepEqual(
    buildCloudflareHintCommands(
      parseOpsTraceArgs(["--diagnostic-report", "diag_123", "--cf-hints"])
    ),
    []
  );
});
