import { describe, expect, it } from "vitest";
import {
  classifyDispatchError,
  DISPATCH_STORAGE_OVERLOADED_ERROR_CODE,
  DISPATCH_STORAGE_SCHEMA_MISSING_ERROR_CODE,
  isD1SchemaError,
  isDispatchAttemptTimeoutErrorCode,
  isOfflineRetryErrorCode,
  isRuntimeTaskDedupedErrorCode,
  resolveDispatchErrorCode,
} from "../dispatch/rules/dispatch-error-policy";

describe("dispatch error policy timeout/runtime classifications", () => {
  it.each([
    "D1_ERROR: D1 DB is overloaded. Requests queued for too long.",
    "D1_ERROR: D1 DB is overloaded. Too many requests queued.",
  ])("preserves D1 backpressure as retryable storage evidence: %s", (message) => {
    expect(classifyDispatchError(new Error(message), message)).toBe(
      "retryable"
    );
    expect(resolveDispatchErrorCode(new Error(message), message)).toBe(
      DISPATCH_STORAGE_OVERLOADED_ERROR_CODE
    );
    expect(
      classifyDispatchError(
        { code: DISPATCH_STORAGE_OVERLOADED_ERROR_CODE },
        "Storage is temporarily unavailable"
      )
    ).toBe("retryable");
  });

  it("treats timed_out_no_output as non_retryable", () => {
    expect(
      classifyDispatchError(
        { code: "timed_out_no_output" },
        "timed_out_no_output: codex invocation exceeded 5000ms before producing any runtime output"
      )
    ).toBe("non_retryable");
  });

  it("treats timed_out_after_output as non_retryable", () => {
    expect(
      classifyDispatchError(
        { code: "timed_out_after_output" },
        "timed_out_after_output: claude invocation exceeded 5000ms after producing runtime output"
      )
    ).toBe("non_retryable");
  });

  it("treats provider_exit_error as non_retryable", () => {
    expect(
      classifyDispatchError(
        { code: "provider_exit_error" },
        "provider_exit_error: codex invocation exited before returning a classified upstream error"
      )
    ).toBe("non_retryable");
  });

  it("treats an externally terminated provider process as non_retryable", () => {
    expect(
      classifyDispatchError(
        { code: "provider.process_terminated" },
        "provider.process_terminated: claude process was terminated by SIGTERM before returning a result"
      )
    ).toBe("non_retryable");
  });

  it("treats missing local conversation context as non_retryable", () => {
    expect(
      classifyDispatchError(
        { code: "context_not_found" },
        "context_not_found: no rollout found for the saved local conversation"
      )
    ).toBe("non_retryable");
  });

  it("retries while the local service is still applying profile settings", () => {
    expect(
      classifyDispatchError(
        { code: "daemon.profile.configuration_not_synced" },
        "daemon.profile.configuration_not_synced: waiting for the local service to apply the current Binding revision"
      )
    ).toBe("retryable");
    expect(
      isOfflineRetryErrorCode("daemon.profile.configuration_not_synced")
    ).toBe(true);
  });

  it("treats openmeld.space_action.repair_failed as non_retryable", () => {
    expect(
      classifyDispatchError(
        { code: "openmeld.space_action.repair_failed" },
        "openmeld.space_action.repair_failed: A valid OpenMeld Space action is required in collaboration mode."
      )
    ).toBe("non_retryable");
  });

  it("keeps runtime.task.deduped out of retryable and non-retryable failure policy", () => {
    expect(
      classifyDispatchError(
        { code: "runtime.task.deduped" },
        "runtime.task.deduped: task deduped within 24h window"
      )
    ).toBe("unknown");
    expect(isRuntimeTaskDedupedErrorCode("runtime.task.deduped")).toBe(true);
  });

  it("classifies all daemon lifecycle timeout reasons as attempt timeout facts", () => {
    for (const code of [
      "daemon.delivery.timeout",
      "daemon.delivery.start_timeout",
      "daemon.delivery.execution_stalled",
      "daemon.delivery.finalization_timeout",
    ]) {
      expect(isDispatchAttemptTimeoutErrorCode(code)).toBe(true);
    }
  });

  it("treats controller.client.upgrade_required as non_retryable", () => {
    expect(
      classifyDispatchError(
        { code: "controller.client.upgrade_required" },
        "controller.client.upgrade_required: The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."
      )
    ).toBe("non_retryable");
  });

  it("treats dispatch target profile auth rpc failures as retryable", () => {
    expect(
      classifyDispatchError(
        { code: "dispatch.target_profile_identity.auth_rpc_failed" },
        "dispatch.target_profile_identity.auth_rpc_failed: OpenMeld auth RPC threw while resolving dispatch target profile identity."
      )
    ).toBe("retryable");
    expect(
      classifyDispatchError(
        { code: "dispatch.target_profile_identity.auth_rpc_unavailable" },
        "dispatch.target_profile_identity.auth_rpc_unavailable: OpenMeld auth RPC is unavailable while resolving dispatch target profile identity."
      )
    ).toBe("retryable");
  });

  it("treats dispatch target profile lookup failures as non_retryable", () => {
    expect(
      classifyDispatchError(
        { code: "dispatch.target_profile_identity.lookup_failed" },
        "dispatch.target_profile_identity.lookup_failed: resolveProfileById failed (auth.profile_lookup_failed): profile lookup failed"
      )
    ).toBe("non_retryable");
  });

  it("treats RuntimeCoordinator delivery preparation gaps as retryable", () => {
    for (const code of [
      "runtime_coordinator.head_execution_link_unavailable",
      "runtime_coordinator.execution_token_unavailable",
    ]) {
      expect(classifyDispatchError({ code }, `${code}: try again`)).toBe(
        "retryable"
      );
    }
  });

  it("treats Core primary binding state failures by recoverability", () => {
    for (const code of [
      "agent_profile_binding.lookup_failed",
      "agent_profile_binding.profile_owner_unavailable",
    ]) {
      expect(classifyDispatchError({ code }, `${code}: try again`)).toBe(
        "retryable"
      );
    }

    for (const code of [
      "agent_profile_binding.missing",
      "agent_profile_binding.disabled",
      "agent_profile_binding.profile_owner_invalid",
      "agent_profile_binding.owner_mismatch",
    ]) {
      expect(classifyDispatchError({ code }, `${code}: cannot dispatch`)).toBe(
        "non_retryable"
      );
    }
  });

  it("treats deterministic claim eligibility failures as non_retryable", () => {
    for (const code of [
      "claim_eligibility.binding_missing",
      "claim_eligibility.binding_runtime_mismatch",
      "claim_eligibility.binding_capability_mismatch",
      "claim_eligibility.owner_mismatch",
      "claim_eligibility.openmeld_service_runtime_id_mismatch",
      "claim_eligibility.runtime_missing",
      "claim_eligibility.agent_controller_report_stale",
      "claim_eligibility.wake_no_longer_allowed_by_policy",
    ]) {
      expect(classifyDispatchError({ code }, `${code}: cannot claim`)).toBe(
        "non_retryable"
      );
    }
  });

  it("resolves new timeout codes directly", () => {
    expect(
      resolveDispatchErrorCode(
        { code: "timed_out_after_output" },
        "timed_out_after_output: claude invocation exceeded 5000ms after producing runtime output"
      )
    ).toBe("timed_out_after_output");
  });

  it("resolves new dispatch target profile identity codes directly", () => {
    expect(
      resolveDispatchErrorCode(
        { code: "dispatch.target_profile_identity.auth_rpc_failed" },
        "dispatch.target_profile_identity.auth_rpc_failed: OpenMeld auth RPC threw while resolving dispatch target profile identity."
      )
    ).toBe("dispatch.target_profile_identity.auth_rpc_failed");
    expect(
      resolveDispatchErrorCode(
        { code: "dispatch.target_profile_identity.lookup_failed" },
        "dispatch.target_profile_identity.lookup_failed: resolveProfileById failed (auth.profile_lookup_failed): profile lookup failed"
      )
    ).toBe("dispatch.target_profile_identity.lookup_failed");
  });

  it("resolves controller.client.upgrade_required directly", () => {
    expect(
      resolveDispatchErrorCode(
        { code: "controller.client.upgrade_required" },
        "controller.client.upgrade_required: The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."
      )
    ).toBe("controller.client.upgrade_required");
  });
});

// Fail-loud contract for the physical DB split (physical-db-split.md Stage B):
// the per-batch hot-path storage probe was removed, so a missing table now
// reaches the dispatch query and must fail terminal, not burn the retry budget.
describe("dispatch error policy treats D1 schema faults as terminal", () => {
  it("classifies a missing table/column/index as non_retryable", () => {
    for (const message of [
      "D1_ERROR: no such table: openMeldDaemon_dispatch_ledger: SQLITE_ERROR",
      "D1_ERROR: no such column: overlay_gateway_host: SQLITE_ERROR",
      "D1_ERROR: no such index: idx_openMeldDaemon_dispatch_attempts: SQLITE_ERROR",
    ]) {
      expect(classifyDispatchError(new Error(message), message)).toBe(
        "non_retryable"
      );
    }
  });

  it("resolves a D1 schema fault to the terminal schema-missing code", () => {
    const message =
      "D1_ERROR: no such table: openMeldDaemon_ops_decisions: SQLITE_ERROR";
    expect(resolveDispatchErrorCode(new Error(message), message)).toBe(
      DISPATCH_STORAGE_SCHEMA_MISSING_ERROR_CODE
    );
  });

  it("does not mistake ordinary dispatch errors for schema faults", () => {
    expect(isD1SchemaError("daemon.profile.offline: route is offline")).toBe(
      false
    );
    expect(isD1SchemaError("D1_ERROR: no such table: x")).toBe(true);
  });
});
