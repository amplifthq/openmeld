import { describe, expect, it } from "vitest";
import {
  DISPATCH_ERROR_SUMMARY_MAX_LENGTH,
  isAgentExecutionReadinessImpactReasonCode,
  isProjectLocalConnectionFailureReasonCode,
  projectLocalConnectionFailureReasonCodeSchema,
  resolveCenterAgentCallbackFailureMessage,
  resolveMappedPublicAgentFailureReason,
  resolvePublicAgentAvailabilityCopy,
  resolvePublicAgentFailureRecovery,
  resolvePublicFailureCodeCategory,
  sanitizeDispatchErrorSummary,
  shouldPreferMappedPublicAgentFailureReason,
} from "../src";

const PROVIDER_CREDITS_COPY =
  "The model provider rejected this request because the provider account does not have enough credits. Add credits or update billing directly with the provider, then wake the agent again.";
const PROVIDER_CREDENTIALS_COPY =
  "The model provider rejected this request because the local provider login expired. Re-authenticate the local agent on its computer, then wake the agent again.";
const PROVIDER_RATE_LIMIT_COPY =
  "The model provider rate-limited this request. Wait a moment, then wake the agent again.";
const PROVIDER_UNAVAILABLE_COPY =
  "The selected model is not responding right now. Switch this agent to another model or try again later.";
const PROVIDER_UNREACHABLE_COPY =
  "The model provider was unreachable. Check provider status or network access, then wake the agent again.";
const UNSUPPORTED_MODEL_COPY =
  "The selected model is no longer available for this account. Choose another model in the Agent Profile, then try again.";
const RUNTIME_PERMISSION_DENIAL_COPY =
  "The requested action was blocked by the Agent Profile’s permission settings. Review its permissions and choose a less restrictive mode only if you trust the access it grants, then wake the agent again.";
const DETAILED_PROVIDER_FAILURE_SUMMARY_RE =
  /^invalid_value \(invalid_request_error\): Invalid value for reasoning effort\./;

describe("public agent failure reason mapping", () => {
  it("canonicalizes mixed-version Center Agent callback failures before publication", () => {
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "remote_agent.turn_not_completed",
        failureMessage:
          "Remote Agent could not finish this request. Please try again or open diagnostics.",
      })
    ).toBe(
      "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team."
    );
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "remote_agent.execution_identity_mismatch",
        failureMessage: "Internal execution identity detail",
      })
    ).toBe(
      "OpenMeld stopped this request because it could not confirm that the reply came from your Center Agent. Send the request again. If it keeps happening, open diagnostics in OpenMeld."
    );
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "remote_agent.callback_publish_failed",
        failureMessage: "Internal publication detail",
      })
    ).toBe(
      "Center Agent finished your request, but OpenMeld could not show the reply here. Try again. If it keeps happening, open diagnostics in OpenMeld."
    );
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "provider.some_new_failure",
        failureMessage: "Remote Agent runtime failed unexpectedly.",
      })
    ).toBe(
      "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team."
    );
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "provider.rate_limited",
        failureMessage: "The model provider is busy. Try again in a moment.",
      })
    ).toBe(
      "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team."
    );
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "remote_agent.provider.authentication_failed",
        failureMessage: "Provider authentication failed with a secret detail.",
      })
    ).toBe(
      "The model provider rejected this request because the provider credentials are invalid or expired. Reconnect the provider account, then wake the agent again."
    );
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "remote_agent.provider.rate_limited",
        failureMessage: "Raw provider throttling detail.",
      })
    ).toBe(PROVIDER_RATE_LIMIT_COPY);
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "remote_agent.provider.unavailable",
        failureMessage: "Raw provider outage detail.",
      })
    ).toBe(PROVIDER_UNAVAILABLE_COPY);
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "remote_agent.turn.timeout",
        failureMessage: "Raw worker timeout detail.",
      })
    ).toBe(
      "Center Agent took too long to finish this request. Try again. If it keeps happening, open diagnostics in OpenMeld."
    );
    expect(
      resolveCenterAgentCallbackFailureMessage({
        failureCode: "provider.some_new_failure",
        failureMessage:
          "This turn's active tool catalog does not include Space management tools.",
      })
    ).toBe(
      "OpenMeld ran into a problem, so Center Agent couldn't finish your request. You didn't do anything wrong. Try again. If it still doesn't work, open Diagnostics in OpenMeld. If you can't open OpenMeld, ask the person who set it up for your team."
    );
  });

  it("reduces raw vendor response bodies to a bounded diagnostic summary", () => {
    const rawVendorBody = JSON.stringify({
      error: {
        code: "invalid_value",
        message: `Invalid value for reasoning effort.\n${"vendor response detail ".repeat(80)}`,
        param: "reasoning.effort",
        type: "invalid_request_error",
      },
      requestBody: { prompt: "must-not-leave-the-operator-log" },
      status: 400,
    });

    const summary = sanitizeDispatchErrorSummary(rawVendorBody);

    expect(summary).toMatch(DETAILED_PROVIDER_FAILURE_SUMMARY_RE);
    expect(summary).not.toContain("must-not-leave-the-operator-log");
    expect(summary).not.toContain("requestBody");
    expect(summary?.length).toBeLessThanOrEqual(
      DISPATCH_ERROR_SUMMARY_MAX_LENGTH
    );
    expect(summary).not.toContain("\n");
  });

  it("preserves a string provider detail in the diagnostic summary", () => {
    const summary = sanitizeDispatchErrorSummary(
      JSON.stringify({
        detail:
          "You exceeded your current quota, please check your plan and billing",
      })
    );

    expect(summary).toBe(
      "You exceeded your current quota, please check your plan and billing"
    );
  });

  it("normalizes and redacts sensitive values in provider detail", () => {
    const summary = sanitizeDispatchErrorSummary(
      JSON.stringify({
        detail: "Quota denied.\n  api_key=sk-sensitive-provider-token",
      })
    );

    expect(summary).toBe("Quota denied. api_key=[redacted]");
    expect(summary).not.toContain("sk-sensitive-provider-token");
  });

  it("falls back when provider detail is not a string", () => {
    const summary = sanitizeDispatchErrorSummary(
      JSON.stringify({ detail: [{ message: "Validation failed" }] })
    );

    expect(summary).toBe(
      "The provider request failed; see operator logs for details."
    );
  });

  it("keeps a nested provider error message ahead of detail fields", () => {
    const summary = sanitizeDispatchErrorSummary(
      JSON.stringify({
        detail: "Root detail",
        error: {
          detail: "Nested detail",
          message: "Nested provider message",
        },
      })
    );

    expect(summary).toBe("Nested provider message");
  });

  it("uses nested provider detail before root detail", () => {
    const summary = sanitizeDispatchErrorSummary(
      JSON.stringify({
        detail: "Root detail",
        error: { detail: "Nested detail" },
      })
    );

    expect(summary).toBe("Nested detail");
  });

  it("owns the public error-code category vocabulary used by Core", () => {
    expect(resolvePublicFailureCodeCategory("runtime.turn.failed")).toBe(
      "the runtime rejected the request"
    );
    expect(
      resolvePublicFailureCodeCategory("interaction.permission_required")
    ).toBe("the local agent needs an interaction");
    expect(resolvePublicFailureCodeCategory("unknown.failure")).toBe(
      "the agent hit an unclassified error"
    );
  });

  it("maps Core claim reason codes to public copy", () => {
    expect(
      resolveMappedPublicAgentFailureReason(
        "dispatch.claim_eligibility.binding.owner_mismatch"
      )
    ).toBe(
      "This agent is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again."
    );
  });

  it("maps public reason copy for existing callers", () => {
    expect(resolveMappedPublicAgentFailureReason("auth.required")).toBe(
      PROVIDER_CREDENTIALS_COPY
    );
    expect(
      resolveMappedPublicAgentFailureReason("claim_eligibility.binding_missing")
    ).toBe("No local agent has been selected to reply for this agent yet.");
  });

  it("names the target when a caller passes one, so a persisted notice isn't left saying 'this agent'", () => {
    expect(
      resolveMappedPublicAgentFailureReason(
        "claim_eligibility.binding_missing",
        "Runner"
      )
    ).toBe("No local agent has been selected to reply for Runner yet.");
    expect(
      resolveMappedPublicAgentFailureReason("profile.unbound", "Runner")
    ).toBe("No local agent has been selected to reply for Runner yet.");
    expect(
      resolveMappedPublicAgentFailureReason(
        "agent_profile_binding.owner_mismatch",
        "Runner"
      )
    ).toBe(
      "Runner is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again."
    );
  });

  it("covers agent_profile_binding.disabled the same way as .missing, matching the members panel's classification", () => {
    expect(
      resolveMappedPublicAgentFailureReason(
        "agent_profile_binding.disabled",
        "Runner"
      )
    ).toBe("No local agent has been selected to reply for Runner yet.");
  });

  it("keeps structured recovery detail and action for an unbound profile", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "claim_eligibility.binding_missing",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "Runner is in this space, but OpenMeld cannot tell which local agent should reply for it yet.",
      kind: "local_agent_connection",
      primaryActionId: "choose_local_agent",
      primaryActionLabel: "Choose local agent",
      recoveryTarget: "agents",
    });
  });

  it("maps structured provider account balance failures to actionable safe copy", () => {
    expect(
      resolveMappedPublicAgentFailureReason("provider.insufficient_balance")
    ).toBe(PROVIDER_CREDITS_COPY);
    expect(resolveMappedPublicAgentFailureReason("quota.exceeded")).toBe(
      PROVIDER_CREDITS_COPY
    );
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "provider.insufficient_balance",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "Runner's model provider account does not have enough credits for this Wake. Add credits or update billing directly with the provider, then wake the agent again.",
      kind: "system_retry",
      recoveryTarget: null,
    });
  });

  it("maps exact Usage exhaustion without exposing provider wording", () => {
    expect(resolveMappedPublicAgentFailureReason("usage_exhausted")).toBe(
      "This agent reached a current Usage Limit and cannot start new work. Review Usage Limits before waking it again."
    );
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "usage_exhausted",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "Runner reached a current Usage Limit and cannot start new work. Review Usage Limits before waking it again.",
      kind: "account_access",
      primaryActionId: "review_agent_settings",
      primaryActionLabel: "Review agent settings",
      recoveryTarget: "agents",
    });
  });

  it("maps Cursor's plan limit to the exact account action instead of local-agent setup", () => {
    expect(
      resolveMappedPublicAgentFailureReason(
        "cursor.plan_upgrade_required",
        "Cursor"
      )
    ).toBe(
      "Cursor stopped this Wake because the current Cursor plan has reached its usage limit. Upgrade the Cursor plan, then wake Cursor again."
    );
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "cursor.plan_upgrade_required",
        targetLabel: "Cursor",
      })
    ).toEqual({
      body: "Cursor stopped this Wake because the current Cursor plan has reached its usage limit. Upgrade the Cursor plan, then wake Cursor again.",
      kind: "account_access",
      primaryActionId: "manage_cursor_plan",
      primaryActionLabel: "Manage Cursor plan",
      recoveryTarget: "cursor_account",
    });
  });

  it("does not send malformed Space replies to local-agent setup", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "openmeld.space_action.repair_failed",
        targetLabel: "Cursor",
      })
    ).toEqual({
      body: "Cursor answered in its local conversation, but it did not tell OpenMeld whether to post a message or stay silent, so nothing was posted.",
      kind: "system_retry",
      recoveryTarget: null,
    });
  });

  it("replaces only vague malformed-reply details with the explicit shared reason", () => {
    expect(
      shouldPreferMappedPublicAgentFailureReason(
        "openmeld.space_action.repair_failed",
        "Cursor finished, but OpenMeld couldn't post its reply."
      )
    ).toBe(true);
    expect(
      shouldPreferMappedPublicAgentFailureReason(
        "openmeld.space_action.repair_failed",
        "The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account."
      )
    ).toBe(false);
  });

  it("does not guess an account or setup action for an unknown failure", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "future.unclassified_failure",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "OpenMeld did not receive enough error details to explain why Runner could not reply. Open diagnostics for technical details.",
      kind: "unknown",
      recoveryTarget: null,
    });
  });

  it("distinguishes empty Agent output from missing reply identity", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "runtime.reply.empty_output",
        targetLabel: "Claude",
      })
    ).toEqual({
      body: "Claude finished without returning any text, so OpenMeld had nothing to post. Wake Claude again. If this keeps happening, open diagnostics.",
      kind: "system_retry",
      recoveryTarget: null,
    });
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "runtime.reply.metadata_missing.agent_controller_ref",
        targetLabel: "OpenCode",
      })
    ).toEqual({
      body: "OpenMeld received a result from OpenCode, but the result did not identify which local agent produced it. To avoid posting under the wrong agent, OpenMeld did not publish it. Open diagnostics to inspect the local agent connection.",
      kind: "system_retry",
      recoveryTarget: null,
    });
  });

  it("maps oversized Remote Agent tool results to a retryable public explanation", () => {
    const reasonCode = "remote_agent.tool_result_too_large";

    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBe(
      "Center Agent tried to process too much data at once. Try again; it will read large files in smaller sections. If this keeps happening, open diagnostics."
    );
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: reasonCode,
        targetLabel: "Center Agent",
      })
    ).toEqual({
      body: "Center Agent tried to process too much data at once. Try again; it will read large files in smaller sections. If this keeps happening, open diagnostics.",
      kind: "system_retry",
      recoveryTarget: null,
    });
  });

  it("keeps a failed automatic rollover actionable without asking the user to manage sessions", () => {
    const reasonCode = "remote_agent.conversation_history_limit_exceeded";

    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBe(
      "Center Agent could not continue this conversation automatically. Try again or open diagnostics."
    );
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: reasonCode,
        targetLabel: "Center Agent",
      })
    ).toEqual({
      body: "Center Agent could not continue this conversation automatically. Try again or open diagnostics.",
      kind: "system_retry",
      recoveryTarget: null,
    });
  });

  it.each([
    "model.unavailable",
    "model.unsupported",
    "unsupported_model",
  ] as const)("maps unsupported-model reason code %s to an actionable next step", (reasonCode) => {
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBe(
      UNSUPPORTED_MODEL_COPY
    );
  });

  it("maps an unsupported reasoning setting before the broad provider fallback", () => {
    expect(
      resolveMappedPublicAgentFailureReason("model.reasoning_unsupported")
    ).toBe(
      "The selected model does not support that reasoning setting. Choose an offered model and reasoning setting, then wake the agent again."
    );
  });

  it.each([
    [
      "interaction.permission_required",
      "The local agent asked for permission before it could continue. OpenMeld cannot collect that permission response yet. Review the Agent Profile’s permission mode, then wake the agent again.",
    ],
    [
      "interaction.question_required",
      "The local agent asked a question before it could continue. OpenMeld cannot collect that answer yet. Run the task directly in the local agent, or adjust the prompt so it can finish without asking, then wake it again.",
    ],
    [
      "interaction.plan_required",
      "The local agent asked for plan approval before it could continue. OpenMeld cannot collect that approval yet. Run the task directly in the local agent, or use a mode that does not require plan approval, then wake it again.",
    ],
    [
      "interaction.unsupported",
      "The local agent requested an interactive response that OpenMeld does not support yet. Run the task directly in the local agent, resolve the request there, then wake it again.",
    ],
  ] as const)("maps Phase 1 ACP failure %s to precise public copy", (reasonCode, expectedCopy) => {
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBe(
      expectedCopy
    );
  });

  it("keeps permission interaction recovery distinct from a reply authorization failure", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "interaction.permission_required",
        targetLabel: "Cursor",
      })
    ).toEqual({
      body: "Cursor asked for permission before it could continue. OpenMeld cannot collect that permission response yet. Review the Agent Profile’s permission mode, then wake the agent again.",
      kind: "account_access",
      primaryActionId: "review_agent_permissions",
      primaryActionLabel: "Review Agent Profile permissions",
      recoveryTarget: "agents",
    });
  });

  it("keeps provider behavior and public guidance on structured reason codes", () => {
    expect(resolveMappedPublicAgentFailureReason("quota.exceeded")).toBe(
      PROVIDER_CREDITS_COPY
    );
    expect(resolveMappedPublicAgentFailureReason("auth.required")).toBe(
      PROVIDER_CREDENTIALS_COPY
    );
    expect(
      resolveMappedPublicAgentFailureReason(
        "provider.subscription_access_unavailable",
        "Runner"
      )
    ).toBe(
      "Runner's provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again."
    );
    expect(resolveMappedPublicAgentFailureReason("provider.rate_limit")).toBe(
      PROVIDER_RATE_LIMIT_COPY
    );
    expect(resolveMappedPublicAgentFailureReason("provider.unavailable")).toBe(
      PROVIDER_UNAVAILABLE_COPY
    );
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "provider.unavailable",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "Runner's selected model is not responding right now. Switch this agent to another model or try again later.",
      kind: "account_access",
      primaryActionId: "review_agent_settings",
      primaryActionLabel: "Review agent settings",
      recoveryTarget: "agents",
    });
    expect(resolveMappedPublicAgentFailureReason("upstream_unreachable")).toBe(
      PROVIDER_UNREACHABLE_COPY
    );
  });

  it("maps structured local runtime permission denials", () => {
    expect(
      resolveMappedPublicAgentFailureReason("permission.denied.runtime")
    ).toBe(RUNTIME_PERMISSION_DENIAL_COPY);
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "permission.denied.runtime",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: RUNTIME_PERMISSION_DENIAL_COPY,
      kind: "account_access",
      primaryActionId: "review_agent_permissions",
      primaryActionLabel: "Review Agent Profile permissions",
      recoveryTarget: "agents",
    });
  });

  it("returns structured account recovery for owner mismatch codes", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "agent_profile_binding.owner_mismatch",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "Runner is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again.",
      kind: "system_retry",
      recoveryTarget: null,
    });
  });

  it("keeps legacy ownership failures non-actionable during rollout", () => {
    const ownershipCodes = [
      "organization_binding_authorization.required",
      "organization_binding_authorization.binding_required",
      "organization_binding_authorization.no_bindings",
      "organization_binding_authorization.profile_org_mismatch",
      "organization_binding_authorization.profile_owner_mismatch",
    ];
    for (const errorCode of ownershipCodes) {
      expect(
        resolvePublicAgentFailureRecovery({
          errorCode,
          targetLabel: "Runner",
        })
      ).toEqual({
        body: "Runner cannot be used in this workspace. Choose an Agent Profile created here.",
        kind: "system_retry",
        recoveryTarget: null,
      });
    }
  });

  it("keeps transient legacy workspace verification failures retryable", () => {
    const transientCodes = [
      "organization_binding_authorization.lookup_failed",
      "organization_binding_authorization.preference_unavailable",
      "organization_binding_authorization.space_org_unavailable",
    ];
    for (const errorCode of transientCodes) {
      expect(
        resolvePublicAgentFailureRecovery({
          errorCode,
          targetLabel: "Runner",
        })
      ).toEqual({
        body: "OpenMeld could not verify Runner's workspace. Try again, and open diagnostics if the problem continues.",
        kind: "system_retry",
        recoveryTarget: null,
      });
    }
  });

  it("returns structured setup recovery for binding runtime and capability mismatches", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "claim_eligibility.binding_runtime_mismatch",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "Runner is connected to an older computer setup. Update setup on this computer, then try again.",
      kind: "local_agent_prepare",
      primaryActionId: "connect_local_agent",
      primaryActionLabel: "Connect local agent",
      recoveryTarget: "prepare_setup",
    });
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "claim_eligibility.binding_capability_mismatch",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "Runner is connected to a different local agent setup. Update setup on this computer, then try again.",
      kind: "local_agent_prepare",
      primaryActionId: "connect_local_agent",
      primaryActionLabel: "Connect local agent",
      recoveryTarget: "prepare_setup",
    });
  });

  it("returns no action for retryable storage failures", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "dispatch.storage_unavailable",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "OpenMeld ran into a system problem before this Wake could run. Try again. If it keeps happening, open diagnostics.",
      kind: "system_retry",
      recoveryTarget: null,
    });

    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "dispatch.storage.schema_missing",
        targetLabel: "Center Agent",
      })
    ).toEqual({
      body: "OpenMeld ran into a system problem before this Wake could run. Try again. If it keeps happening, open diagnostics.",
      kind: "system_retry",
      recoveryTarget: null,
    });
  });

  it("maps RuntimeCoordinator delivery expiry to local-service recovery", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "runtime_coordinator.delivery_expired",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "This Wake expired before it reached Runner. Start or reconnect OpenMeld Service, then wake the agent again.",
      kind: "local_service",
      primaryActionId: "reconnect_openmeld_service",
      primaryActionLabel: "Reconnect OpenMeld Service",
      recoveryTarget: "prepare_setup",
    });
    expect(
      resolveMappedPublicAgentFailureReason(
        "runtime_coordinator.delivery_expired"
      )
    ).toBe(
      "This Wake expired before it reached this agent. Start or reconnect OpenMeld Service, then wake the agent again."
    );
  });

  it("does not tell users to reconnect a Service that is waiting on its first route report", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "daemon.profile.pending_first_report",
        targetLabel: "Runner",
      })
    ).toEqual({
      body: "OpenMeld Service is connected, but Runner did not become ready in time for this Wake. Try waking the agent again in a moment.",
      kind: "system_retry",
      recoveryTarget: null,
    });
    expect(
      resolveMappedPublicAgentFailureReason(
        "daemon.profile.pending_first_report"
      )
    ).toBe(
      "OpenMeld Service is connected, but this agent did not become ready in time for this Wake. Try waking the agent again in a moment."
    );
  });

  it.each([
    [
      "daemon.delivery.start_timeout",
      "OpenMeld could not start Runner in time. Start or reconnect OpenMeld Service, then wake the agent again.",
      "OpenMeld could not start this agent in time. Start or reconnect OpenMeld Service, then wake the agent again.",
    ],
    [
      "daemon.delivery.timeout",
      "Runner took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
      "This agent took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "timed_out_no_output",
      "Runner took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
      "This agent took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "timed_out_after_output",
      "Runner took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
      "This agent took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "timeout",
      "Runner took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
      "This agent took too long to finish this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "daemon.delivery.execution_stalled",
      "Runner stopped making progress on this Wake. Reconnect OpenMeld Service before trying again.",
      "This agent stopped making progress on this Wake. Reconnect OpenMeld Service before trying again.",
    ],
    [
      "daemon.delivery.finalization_timeout",
      "OpenMeld received progress from Runner, but could not finish the final result in time.",
      "OpenMeld received progress from this agent, but could not finish the final result in time.",
    ],
  ])("maps timeout failure reason code %s to distinct local-service copy", (reasonCode, body, mappedReasonBody) => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: reasonCode,
        targetLabel: "Runner",
      })
    ).toEqual({
      body,
      kind: "local_service",
      primaryActionId: "reconnect_openmeld_service",
      primaryActionLabel: "Reconnect OpenMeld Service",
      recoveryTarget: "prepare_setup",
    });
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBe(
      mappedReasonBody
    );
  });

  it.each([
    "route.timeout",
    "server.timeout",
    "network.timeout",
  ])("does not treat non-execution timeout reason code %s as agent execution timeout", (reasonCode) => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: reasonCode,
        targetLabel: "Runner",
      })?.body
    ).not.toBe(
      "Runner took too long to finish this Wake. Reconnect OpenMeld Service before trying again."
    );
  });

  it.each([
    "claim_eligibility.caller_not_allowed",
    "claim_eligibility.not_read_after_caller_authorization_failed",
    "claim_eligibility.owner_mismatch",
    "claim_eligibility.openmeld_service_runtime_id_missing",
    "claim_eligibility.openmeld_service_runtime_id_not_opaque",
    "claim_eligibility.openmeld_service_runtime_id_mismatch",
    "claim_eligibility.openmeld_service_runtime_identity_invalid",
    "claim_eligibility.runtime_missing",
    "claim_eligibility.runtime_unavailable",
    "claim_eligibility.runtime_conflict",
    "claim_eligibility.agent_controller_report_unknown",
    "claim_eligibility.agent_controller_report_missing",
    "claim_eligibility.agent_controller_report_stale",
    "claim_eligibility.agent_controller_report_disabled",
    "claim_eligibility.agent_controller_report_unavailable",
    "claim_eligibility.binding_missing",
    "claim_eligibility.binding_disabled",
    "claim_eligibility.binding_conflict",
    "claim_eligibility.binding_not_routable",
    "claim_eligibility.binding_runtime_mismatch",
    "claim_eligibility.binding_capability_mismatch",
    "claim_eligibility.binding_owner_mismatch",
    "claim_eligibility.non_wake_relation_not_dispatchable",
    "claim_eligibility.dispatch_evidence_missing",
    "claim_eligibility.dispatch_evidence_stale",
    "claim_eligibility.dispatch_missing",
    "claim_eligibility.dispatch_terminal",
    "claim_eligibility.lease_conflict",
    "claim_eligibility.wake_not_allowed_at_creation",
    "claim_eligibility.wake_no_longer_allowed_by_policy",
    "claim_eligibility.space_liveness_missing",
    "claim_eligibility.space_liveness_stale",
    "claim_eligibility.policy_version_mismatch",
    "claim_eligibility.target_no_longer_member",
    "claim_eligibility.target_not_claimable_agent_member",
    "dispatch.claim_eligibility.blocked",
    "dispatch.claim_eligibility.binding.conflict",
    "dispatch.claim_eligibility.binding.disabled_historical",
    "dispatch.claim_eligibility.binding.enabled_primary",
    "dispatch.claim_eligibility.binding.missing",
    "dispatch.claim_eligibility.binding.owner_mismatch",
  ])("maps claim failure reason code %s to public copy", (reasonCode) => {
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toEqual(
      expect.any(String)
    );
  });

  it.each([
    [
      "controller.runtime.missing",
      "This local agent is not available on this device. Connect a local agent, then try again.",
    ],
  ] as const)("keeps readiness-impact failure %s mapped to local setup recovery", (reasonCode, body) => {
    expect(isAgentExecutionReadinessImpactReasonCode(reasonCode)).toBe(true);
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: reasonCode,
        targetLabel: "Runner",
      })
    ).toEqual({
      body,
      kind: "local_agent_prepare",
      primaryActionId: "connect_local_agent",
      primaryActionLabel: "Connect local agent",
      recoveryTarget: "prepare_setup",
    });
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBe(body);
  });

  it("routes an incompatible Codex version directly to Local Agent management", () => {
    const body =
      "Codex on this computer can't use the selected model. Update Codex or choose another Codex installation, then try again.";
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "controller.client.upgrade_required",
        targetLabel: "Runner",
      })
    ).toEqual({
      body,
      kind: "local_agent_prepare",
      primaryActionId: "manage_local_agent",
      primaryActionLabel: "Update or change local agent",
      recoveryTarget: "computer",
    });
    expect(
      resolveMappedPublicAgentFailureReason(
        "controller.client.upgrade_required"
      )
    ).toBe(body);
  });

  it.each([
    [
      "agent_profile_binding.controller_conversation_conflict",
      "Runner shares a reply conversation with another Agent Profile. Review agent settings and choose one Agent Profile to keep this reply conversation.",
    ],
    [
      "provider_account.subscription_access_unavailable",
      "Runner is connected, but its provider subscription does not include the access this agent needs. Review the provider plan or account on its computer before waking it again.",
    ],
    [
      "provider_account.organization_access_disabled",
      "Runner is connected, but its organization has disabled the provider access this agent needs. Ask the provider account admin to enable access before waking it again.",
    ],
    [
      "provider_account.capacity_exhausted",
      "Runner is connected, but its provider quota or credit balance is exhausted. Review the provider plan, billing, or credits before waking it again.",
    ],
  ] as const)("maps reply-recovery reason %s to specific shared copy", (reasonCode, body) => {
    expect(resolveMappedPublicAgentFailureReason(reasonCode, "Runner")).toBe(
      body
    );
  });

  it.each([
    "provider.subscription_access_unavailable",
    "provider_account.subscription_access_unavailable",
    "provider_account.organization_access_disabled",
    "provider_account.capacity_exhausted",
    "provider_account.access_required",
  ])("routes provider-account blocker %s to account review", (reasonCode) => {
    const recovery = resolvePublicAgentFailureRecovery({
      errorCode: reasonCode,
      targetLabel: "Runner",
    });

    expect(recovery).toMatchObject({
      kind: "account_access",
      primaryActionId: "review_agent_settings",
      primaryActionLabel: "Review agent settings",
      recoveryTarget: "agents",
    });
    expect(recovery?.body).not.toContain("displayed reset time");
  });

  it.each([
    [
      "service.not_running",
      "Runner is connected, but OpenMeld Service is not running on this computer. Start OpenMeld Service so this computer can receive local Wake work.",
    ],
    [
      "service.not_installed",
      "Runner is connected, but OpenMeld Service is not installed on this computer. Install OpenMeld Service so this computer can receive local Wake work.",
    ],
    [
      "service.drifted",
      "Runner is connected, but OpenMeld Service on this computer needs repair before it can receive local Wake work.",
    ],
    [
      "local_service.not_connected_for_account",
      "Runner is connected, but OpenMeld Service is not connected for this OpenMeld account on this computer. Reconnect OpenMeld Service for this account.",
    ],
    [
      "local_service.identity_mismatch",
      "Runner is connected, but OpenMeld Service is using a different local runtime than this agent expects. Reconnect OpenMeld Service on this computer.",
    ],
    [
      "local_service.unavailable",
      "Runner is connected, but OpenMeld could not check OpenMeld Service for this account. Reconnect OpenMeld Service and try again.",
    ],
    [
      "agent_execution.route_missing",
      "Runner is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.",
    ],
    [
      "agent_execution.route_offline",
      "Runner is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.",
    ],
    [
      "agent_execution.route_unavailable",
      "Runner is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.",
    ],
    [
      "route.not_registered",
      "Runner is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.",
    ],
    [
      "route.offline",
      "Runner is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.",
    ],
    [
      "route.unavailable",
      "Runner is connected, but OpenMeld cannot see an active local Wake route from this computer yet. OpenMeld is checking the route from this computer.",
    ],
    [
      "controller.registry.disabled",
      "This local agent is turned off in OpenMeld on this computer. Turn it on, then wake the agent again.",
    ],
    [
      "controller.bootstrap.failed",
      "Runner is connected, but local agent setup is not complete on this computer yet. Finish local agent setup here.",
    ],
    [
      "controller.gateway.unhealthy",
      "Runner is connected, but local agent setup is not complete on this computer yet. Finish local agent setup here.",
    ],
    [
      "agent_profile_binding.agent_controller_report_missing",
      "Runner is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.",
    ],
    [
      "agent_profile_binding.agent_controller_report_stale",
      "Runner is connected, but this computer's local agent connection is out of date. Connect the local agent again.",
    ],
    [
      "runtime.projection_missing",
      "Runner is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.",
    ],
    [
      "runtime.agent_controller_report_missing",
      "Runner is connected, but OpenMeld needs a current local agent connection from this computer before it can reply.",
    ],
    [
      "runtime.agent_controller_report_stale",
      "Runner is connected, but this computer's local agent connection is out of date. Connect the local agent again.",
    ],
  ] as const)("moves reply-recovery copy for %s into the shared dictionary", (reasonCode, body) => {
    expect(resolveMappedPublicAgentFailureReason(reasonCode, "Runner")).toBe(
      body
    );
  });

  it("uses the Agent Profile name when explaining a disabled local agent", () => {
    expect(
      resolvePublicAgentFailureRecovery({
        errorCode: "controller.registry.disabled",
        targetLabel: "Runner",
      })
    ).toMatchObject({
      body: "Runner's local agent is turned off in OpenMeld on this computer. Turn it on, then wake the agent again.",
    });
  });

  it("does not map the retired controller Binding disabled reason", () => {
    expect(
      resolveMappedPublicAgentFailureReason("controller.binding.disabled")
    ).toBeNull();
  });

  it("owns publication exhaustion copy for persisted Space notices", () => {
    expect(
      resolveMappedPublicAgentFailureReason(
        "runtime_coordinator.publication_retry_exhausted",
        "Runner"
      )
    ).toBe(
      "Runner finished, but OpenMeld couldn't post its reply. Wake Runner again. If this keeps happening, open diagnostics."
    );
    expect(
      resolveMappedPublicAgentFailureReason(
        "runtime_coordinator.publication_retry_exhausted"
      )
    ).toBe(
      "The agent finished, but OpenMeld couldn't post its reply. Wake the agent again. If this keeps happening, open diagnostics."
    );
  });

  it.each([
    "workspace.missing",
    "profile.workspace.missing",
  ])("maps local workspace missing failure %s to actionable public copy", (reasonCode) => {
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBe(
      "This agent is missing its local workspace on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again."
    );
  });

  it.each([
    "workspace.invalid",
    "profile.workspace.invalid",
  ])("maps local workspace invalid failure %s to actionable public copy", (reasonCode) => {
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBe(
      "This agent's local workspace is broken on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again."
    );
  });

  it.each([
    [
      "project.local_connection.missing",
      "Runner couldn’t start because its Project isn’t connected on the computer that runs it. Connect that Project on the Agent’s computer, then try again.",
    ],
    [
      "project.local_connection.folder_missing",
      "Runner couldn’t start because its Project folder is no longer available on the computer that runs it. Reconnect the folder in Projects, then try again.",
    ],
  ] as const)("owns Project connection failure copy for %s", (reasonCode, text) => {
    expect(
      projectLocalConnectionFailureReasonCodeSchema.parse(reasonCode)
    ).toBe(reasonCode);
    expect(isProjectLocalConnectionFailureReasonCode(reasonCode)).toBe(true);
    expect(resolveMappedPublicAgentFailureReason(reasonCode, "Runner")).toBe(
      text
    );
  });

  it("returns null for unmapped reason codes", () => {
    expect(resolveMappedPublicAgentFailureReason("unknown.reason")).toBeNull();
  });

  it.each([
    ["agent_profile.not_found", "This agent profile no longer exists."],
    [
      "center_agent.designation_required",
      "Connect the Center Agent before waking it from this Space.",
    ],
    ["remote_agent.available", "Center Agent can answer now."],
    [
      "remote_agent.budget_resting",
      "Center Agent is resting until the next budget window.",
    ],
    ["remote_agent.unavailable", "Center Agent cannot answer right now."],
    ["agent_execution.ready", "Can reply from this computer in Spaces."],
    [
      "agent_execution.check_status",
      "Checking this agent's Wake availability.",
    ],
    [
      "controller.interface.check_failed",
      "OpenMeld couldn't check this local agent. It will try again.",
    ],
    ["wake_route.registration_pending", "Checking this agent's Wake route."],
    [
      "wake_route.registration_skipped",
      "Connect a local agent before this profile can reply.",
    ],
    [
      "wake_route.registration_rejected",
      "Resolve this agent's Wake route before it can reply.",
    ],
  ] as const)("keeps availability-only copy for %s in the shared dictionary", (reasonCode, summary) => {
    expect(
      resolvePublicAgentAvailabilityCopy(reasonCode)?.availabilitySummary
    ).toBe(summary);
  });

  it.each([
    "agent_profile.not_found",
    "center_agent.designation_required",
    "remote_agent.available",
    "remote_agent.budget_resting",
    "agent_execution.ready",
    "agent_execution.check_status",
    "controller.interface.check_failed",
  ])("does not invent a failure body for availability-only code %s", (reasonCode) => {
    expect(resolveMappedPublicAgentFailureReason(reasonCode)).toBeNull();
  });

  it("keeps named and generic controller sign-in descriptions in one entry", () => {
    expect(
      resolvePublicAgentAvailabilityCopy("controller.auth.unauthenticated", {
        agentControllerId: "codex",
      })
    ).toMatchObject({
      controllerInterfaceDescription:
        "Codex CLI is installed, but this computer is not signed in to Codex.",
      controllerInterfaceDescriptionFallback:
        "Installed, but this controller is not signed in.",
    });
  });
});
