#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(SCRIPT_FILE), "..", "..");

export const RUNTIME_TOKEN_CONTRACT_CHECKS = [
  {
    id: "shared_epoch_requires_runtime_transport_hub",
    file: "packages/schemas/src/schemas/daemon/runtime-transport.ts",
    pattern:
      /CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH\s*=\s*"runtime-transport-epoch-2026-07-default-project"/u,
  },
  {
    id: "cli_strategy_reports_shared_epoch",
    file: "clients/openmeld-cli/src/strategy-constants.ts",
    pattern:
      /DAEMON_RUNTIME_CONTRACT_EPOCH\s*=\s*CURRENT_DAEMON_EXECUTION_CONTRACT_EPOCH/u,
  },
  {
    id: "local_service_reports_cli_strategy_epoch",
    file: "clients/openmeld-cli/src/local-service/core/constants.ts",
    pattern:
      /DAEMON_RUNTIME_CONTRACT_EPOCH\s*=\s*STRATEGY_DAEMON_RUNTIME_CONTRACT_EPOCH/u,
  },
  {
    id: "daemon_registers_runtime_contract",
    file: "clients/openmeld-cli/src/local-service/carrier/run-socket-session.ts",
    pattern:
      /runtimeContract:\s*\{\s*epoch:\s*DAEMON_RUNTIME_CONTRACT_EPOCH,\s*\}/u,
  },
  {
    id: "core_rejects_missing_daemon_contract",
    file: "services/core/src/runtime-transport/application/daemon-execution-compatibility.ts",
    pattern:
      /reasonCode:\s*"daemon\.runtime_contract\.missing"[\s\S]*status:\s*"update_required"|status:\s*"update_required"[\s\S]*reasonCode:\s*"daemon\.runtime_contract\.missing"/u,
  },
  {
    id: "core_rejects_mismatched_daemon_contract",
    file: "services/core/src/runtime-transport/application/daemon-execution-compatibility.ts",
    pattern:
      /reasonCode:\s*"daemon\.runtime_contract\.mismatch"[\s\S]*status:\s*"update_required"|status:\s*"update_required"[\s\S]*reasonCode:\s*"daemon\.runtime_contract\.mismatch"/u,
  },
  {
    id: "daemon_result_token_validation_before_inbox",
    file: "services/core/src/runtime-transport/transport/do/runtime-transport-hub.ts",
    orderedSubstrings: [
      "const tokenValidation = await this.validateRuntimeCoordinatorProgressToken",
      "acceptDispatchResultInboxRecord(db, result)",
    ],
  },
  {
    id: "space_quarantines_legacy_no_token_results",
    file: "services/core/src/space/transport/do/space.ts",
    pattern:
      /legacy_result_quarantined[\s\S]*runtime_coordinator\.execution_token_required|runtime_coordinator\.execution_token_required[\s\S]*legacy_result_quarantined/u,
  },
  {
    id: "trace_schema_exposes_legacy_quarantine_state",
    file: "packages/schemas/src/schemas/http/space-dispatch-trace.ts",
    pattern: /"legacy_result_quarantined"/u,
  },
  {
    id: "shared_signal_authoring_policy_requires_user_wake_client_message_id",
    file: "packages/schemas/src/schemas/http/space-signals.ts",
    orderedSubstrings: [
      "spaceSignalAuthoringPolicySchema",
      '"user_authored"',
      'authoringPolicy.data === "user_authored" && createsWakeDispatch',
      "SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE",
    ],
  },
  {
    id: "gateway_public_signal_rejects_user_authored_wake_before_core_rpc",
    file: "services/gateway/src/routes/rpc-http.signals.ts",
    orderedSubstrings: [
      "validateSpaceSignalClientMessageIdPolicy({",
      'authoringPolicy: "user_authored"',
      "if (!policyResult.ok)",
      "return respondBadRequest({",
      "signal = await c.var.coreRpc.postSignal(",
    ],
  },
  {
    id: "core_rpc_post_signal_requires_explicit_authoring_policy",
    file: "services/core/src/rpc/methods.ts",
    orderedSubstrings: [
      "authoringPolicy: SpaceSignalAuthoringPolicy;",
      "authoringPolicy: input.authoringPolicy",
    ],
  },
  {
    id: "space_rpc_post_signal_uses_caller_authoring_policy",
    file: "services/core/src/space/transport/do/space.ts",
    orderedSubstrings: [
      "validateSpaceSignalClientMessageIdPolicy({",
      "authoringPolicy: input.authoringPolicy",
      "dispatchSignalsRequest(request, {",
      "authoringPolicy: input.authoringPolicy",
    ],
  },
  {
    id: "space_websocket_uses_user_authored_signal_policy",
    file: "services/core/src/space/transport/do/space.ts",
    orderedSubstrings: [
      "export const handleWebSocketTextSignal",
      "validateSpaceSignalClientMessageIdPolicy({",
      'authoringPolicy: "user_authored"',
      "emitWebSocketErrorFrame(input.webSocket",
    ],
  },
  {
    id: "signal_use_case_rejects_user_authored_wake_without_client_message_id",
    file: "services/core/src/space/application/space-signal-service.ts",
    orderedSubstrings: [
      "validateSpaceSignalClientMessageIdPolicy",
      "authoringPolicy: input.authoringPolicy",
      "if (!policyResult.ok)",
    ],
  },
  {
    id: "gateway_test_proves_missing_client_message_id_skips_core_rpc",
    file: "services/gateway/tests/http-forwarding.test.ts",
    orderedSubstrings: [
      "rejects user-authored Wake POST /signals without calling Core RPC when clientMessageId is missing",
      "SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_ERROR_CODE",
      "expect(rpc.postSignal).not.toHaveBeenCalled()",
    ],
  },
  {
    id: "websocket_test_proves_missing_client_message_id_skips_publish",
    file: "services/core/src/__tests__/space-signal-service.test.ts",
    orderedSubstrings: [
      "rejects WebSocket Wake posts without publishing or broadcasting",
      "SPACE_WAKE_CLIENT_MESSAGE_ID_REQUIRED_MESSAGE",
      "expect(publishTextSignal).not.toHaveBeenCalled()",
    ],
  },
  {
    id: "thread_signal_schema_requires_client_message_id",
    file: "packages/schemas/src/schemas/http/space-threads.ts",
    pattern: /clientMessageId:\s*clientMessageIdSchema/u,
  },
  {
    id: "trace_read_model_covers_ignored_runtime_token_matrix",
    file: "services/core/src/__tests__/space-dispatch-read-repo.test.ts",
    orderedSubstrings: [
      "surfaces the runtime token diagnostic trace matrix without token secrets",
      "execution_token_terminal_late",
      "owner_conflict_stale_token",
      "expect(JSON.stringify(result)).not.toContain(rawToken)",
    ],
  },
  {
    id: "cli_trace_renders_runtime_token_diagnostics",
    file: "clients/openmeld-cli/tests/service-trace.integration.test.ts",
    orderedSubstrings: [
      "renders RuntimeCoordinator token diagnostics without retired claim output",
      "Execution Token:",
      "Ignored Runtime Events:",
      'expect(stdout).not.toContain("Final Claim")',
    ],
  },
  {
    id: "agent_runtime_blocks_old_daemon_contract_readiness",
    file: "packages/agent-runtime/tests/agent-execution-status.test.ts",
    orderedSubstrings: [
      "blocks Ready when OpenMeld Service execution contract reports a mismatch",
      "daemon.runtime_contract.mismatch",
      "executionCompatible: false",
    ],
  },
  {
    id: "web_profile_binding_uses_update_copy_for_old_daemon_contract",
    file: "clients/web/src/lib/profiles/agent-profile-runtime-binding.test.ts",
    orderedSubstrings: [
      "daemon.runtime_contract.mismatch",
      "Update OpenMeld Service before connecting that local agent.",
    ],
  },
  {
    id: "prepare_preserves_old_daemon_contract_diagnostics",
    file: "clients/openmeld-cli/tests/prepare-session-executor.test.ts",
    orderedSubstrings: [
      "daemon.runtime_contract.mismatch",
      'status: "update_required"',
    ],
  },
];

export function verifyRuntimeTokenContract(input = {}) {
  const repoRoot = input.repoRoot ?? REPO_ROOT;
  const checks = input.checks ?? RUNTIME_TOKEN_CONTRACT_CHECKS;
  const failures = [];

  for (const check of checks) {
    const filePath = path.resolve(repoRoot, check.file);
    if (!existsSync(filePath)) {
      failures.push(`${check.id}: missing file ${check.file}`);
      continue;
    }
    const source = readFileSync(filePath, "utf8");
    if (check.pattern && !check.pattern.test(source)) {
      failures.push(`${check.id}: pattern not found in ${check.file}`);
      continue;
    }
    if (check.orderedSubstrings) {
      let offset = -1;
      for (const substring of check.orderedSubstrings) {
        const nextOffset = source.indexOf(substring, offset + 1);
        if (nextOffset === -1) {
          failures.push(
            `${check.id}: missing ordered marker "${substring}" in ${check.file}`
          );
          break;
        }
        offset = nextOffset;
      }
    }
  }

  if (failures.length > 0) {
    throw new Error(failures.join("\n"));
  }

  return { checked: checks.length };
}

const main = () => {
  const result = verifyRuntimeTokenContract();
  process.stdout.write(
    `Runtime execution token contract verification passed (${result.checked} checks).\n`
  );
};

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_FILE) {
  try {
    main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`verify-runtime-token-contract failed:\n${message}\n`);
    process.exit(1);
  }
}
