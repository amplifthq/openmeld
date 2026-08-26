import { CODEX_UPGRADE_REQUIRED_REASON } from "@openmeld/schemas";
import { describe, expect, it } from "vitest";
import {
  resolveDetailedPublicAgentFailureReason,
  resolvePublicAgentFailureReason,
} from "../src";

const PROVIDER_CREDITS_COPY =
  "The model provider rejected this request because the provider account does not have enough credits. Add credits or update billing directly with the provider, then wake the agent again.";
const PROVIDER_CREDENTIALS_COPY =
  "The model provider rejected this request because the local provider login expired. Re-authenticate the local agent on its computer, then wake the agent again.";
const CURSOR_MODEL_INVENTORY_UNAVAILABLE_COPY =
  "Cursor couldn't confirm which models are available right now. Try waking the agent again.";

describe("agent failure reason", () => {
  it("extracts the ChatGPT-backed Codex unsupported-model detail from JSON payloads", () => {
    expect(
      resolveDetailedPublicAgentFailureReason(
        '{"detail":"The \'gpt-5.3-codex-spark\' model is not supported when using Codex with a ChatGPT account."}'
      )
    ).toBe(
      "The current Codex model is not available for this ChatGPT-backed account."
    );
  });

  it("extracts an actionable OpenClaw OAuth refresh failure hint", () => {
    expect(
      resolveDetailedPublicAgentFailureReason(
        "OAuth token refresh failed for openai-codex: Failed to refresh OAuth token for openai-codex. Please try again or re-authenticate. Logs: openclaw logs --follow"
      )
    ).toBe(
      "Authentication failed in OpenClaw. Run `openclaw logs --follow`, re-authenticate, then retry."
    );
  });

  it("extracts a generic OAuth refresh failure hint when no OpenClaw log command is available", () => {
    expect(
      resolveDetailedPublicAgentFailureReason(
        "OAuth token refresh failed for openai-codex: Failed to refresh OAuth token for openai-codex. Please try again or re-authenticate."
      )
    ).toBe(
      "Authentication failed while refreshing the provider token. Re-authenticate in the provider CLI, then retry."
    );
  });

  it("surfaces Claude Code account and organization access failures", () => {
    expect(
      resolveDetailedPublicAgentFailureReason(
        "Your organization has disabled Claude Code access for this account."
      )
    ).toBe(
      "Claude Code access is disabled for this account or organization. Enable Claude Code access in Claude, then try again."
    );

    expect(
      resolveDetailedPublicAgentFailureReason(
        "Claude Code subscription is disabled for this account."
      )
    ).toBe(
      "Claude Code subscription access is unavailable. Check your Claude Code subscription, then try again."
    );
  });

  it("surfaces a plain-language OpenClaw bootstrap failure when the binary is missing from PATH", () => {
    expect(
      resolveDetailedPublicAgentFailureReason(
        "controller.bootstrap.failed: openclaw command failed: openclaw is not installed or not on PATH"
      )
    ).toBe(
      "OpenMeld could not start OpenClaw on this device. Install OpenClaw or fix its PATH for background services, then try again."
    );
  });

  it("extracts a plain-language Codex upgrade hint from provider errors", () => {
    expect(
      resolveDetailedPublicAgentFailureReason(
        'config.invalid: {"type":"error","status":400,"error":{"type":"invalid_request_error","message":"The \'gpt-5.5\' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again."}}'
      )
    ).toBe(CODEX_UPGRADE_REQUIRED_REASON);
  });

  it("falls back to public error-code mapping when no detailed message exists", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "fallback",
        errorCode: "auth.required",
        errorMessage: null,
      })
    ).toBe(PROVIDER_CREDENTIALS_COPY);
  });

  it("uses the concrete shared recovery copy for malformed Space replies", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "Cursor couldn't reply.",
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          "This agent replied, but not with a valid Space reply action.",
        targetLabel: "Cursor",
      })
    ).toBe(
      "Cursor answered in its local conversation, but it did not tell OpenMeld whether to post a message or stay silent, so nothing was posted."
    );

    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "Cursor couldn't reply.",
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage: "Cursor finished, but OpenMeld couldn't post its reply.",
        targetLabel: "Cursor",
      })
    ).toBe(
      "Cursor answered in its local conversation, but it did not tell OpenMeld whether to post a message or stay silent, so nothing was posted."
    );
  });

  it("keeps actionable provider details for malformed Space reply failures", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "Codex couldn't reply.",
        errorCode: "openmeld.space_action.repair_failed",
        errorMessage:
          "The 'gpt-5.3-codex-spark' model is not supported when using Codex with a ChatGPT account.",
        targetLabel: "Codex",
      })
    ).toBe(
      "The current Codex model is not available for this ChatGPT-backed account."
    );
  });

  it("publishes precise Phase 1 interaction guidance instead of a generic permission failure", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "Cursor could not reply.",
        errorCode: "interaction.permission_required",
        errorMessage: null,
        targetLabel: "Cursor",
      })
    ).toBe(
      "The local agent asked for permission before it could continue. OpenMeld cannot collect that permission response yet. Review the Agent Profile’s permission mode, then wake the agent again."
    );
  });

  it("publishes exact Cursor model failures as a model-selection problem", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "Cursor could not reply.",
        errorCode: "model.unavailable",
        errorMessage: null,
        targetLabel: "Cursor",
      })
    ).toBe(
      "The selected model is no longer available for this account. Choose another model in the Agent Profile, then try again."
    );
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "Cursor could not reply.",
        errorCode: "model.unavailable",
        errorMessage:
          "model.unavailable: Cursor ACP did not offer model 'gpt-5.6-sol' for this account",
        targetLabel: "Cursor",
      })
    ).toBe(
      "The selected model is no longer available for this account. Choose another model in the Agent Profile, then try again."
    );
  });

  it("keeps an incomplete Cursor model inventory distinct from a truly unavailable model", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "Cursor could not reply.",
        errorCode: "model.inventory_unavailable",
        errorMessage:
          "model.inventory_unavailable: Cursor ACP did not provide one complete, consistent model inventory after a bounded recheck",
        targetLabel: "Cursor",
      })
    ).toBe(CURSOR_MODEL_INVENTORY_UNAVAILABLE_COPY);
  });

  it("uses the explicit upgrade-required code when OpenMeld already classified the failure", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "fallback",
        errorCode: "controller.client.upgrade_required",
        errorMessage: null,
      })
    ).toBe(CODEX_UPGRADE_REQUIRED_REASON);
  });

  it("explains organization Wake-access denial precisely instead of falling back to a generic reason", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason:
          "OpenMeld did not receive a message it could post in this space.",
        errorCode: "organization_binding_authorization.no_bindings",
        errorMessage: null,
      })
    ).toBe(
      "Wake access is off for This agent in this organization. Turn it on to let This agent reply in this Space."
    );
  });

  it("explains missing Binding truth as setup needed", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "fallback",
        errorCode: "claim_eligibility.binding_missing",
        errorMessage: null,
      })
    ).toBe("No local agent has been selected to reply for this agent yet.");
  });

  it("explains stale Binding runtime truth as reconnect needed", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason:
          "OpenMeld did not receive a message it could post in this space.",
        errorCode: "claim_eligibility.binding_runtime_mismatch",
        errorMessage: null,
      })
    ).toBe(
      "This agent is connected to an older computer setup. Update setup on this computer, then try again."
    );
  });

  it("explains Binding capability mismatch as setup needed", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason:
          "OpenMeld did not receive a message it could post in this space.",
        errorCode: "claim_eligibility.binding_capability_mismatch",
        errorMessage: null,
      })
    ).toBe(
      "This agent is connected to a different local agent setup. Update setup on this computer, then try again."
    );
  });

  it("explains Binding owner mismatch as sign-in needed", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason:
          "OpenMeld did not receive a message it could post in this space.",
        errorCode: "claim_eligibility.binding_owner_mismatch",
        errorMessage: null,
      })
    ).toBe(
      "This agent is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again."
    );
  });

  it.each([
    [
      "claim_eligibility.owner_mismatch",
      "This agent is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again.",
    ],
    [
      "dispatch.claim_eligibility.binding.owner_mismatch",
      "This agent is connected to a different OpenMeld account. Sign in with the correct OpenMeld account, then run setup again.",
    ],
    [
      "claim_eligibility.openmeld_service_runtime_id_mismatch",
      "This agent is connected to an older computer setup. Update setup on this computer, then try again.",
    ],
    [
      "claim_eligibility.runtime_conflict",
      "This agent has a conflicting reply connection. Wait a moment, then run setup again if the issue continues.",
    ],
    [
      "dispatch.claim_eligibility.binding.conflict",
      "This agent has a conflicting reply connection. Wait a moment, then run setup again if the issue continues.",
    ],
  ])("explains Core claim reason code %s", (errorCode, reason) => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason:
          "OpenMeld did not receive a message it could post in this space.",
        errorCode,
        errorMessage: null,
      })
    ).toBe(reason);
  });

  it("surfaces local workspace setup guidance for missing profile workspaces", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "fallback",
        errorCode: "profile.workspace.missing",
        errorMessage: null,
      })
    ).toBe(
      "This agent is missing its local workspace on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again."
    );
  });

  it("surfaces local workspace repair guidance for invalid profile workspaces", () => {
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "fallback",
        errorCode: "profile.workspace.invalid",
        errorMessage: null,
      })
    ).toBe(
      "This agent's local workspace is broken on this device. Run `openmeld doctor --repair`, then `openmeld setup --profile <agent-profile-id>`, and try again."
    );
  });

  it("surfaces provider account balance failures without leaking raw provider text", () => {
    expect(
      resolveDetailedPublicAgentFailureReason(
        "upstream_unreachable: Insufficient Balance"
      )
    ).toBe(PROVIDER_CREDITS_COPY);
    expect(
      resolvePublicAgentFailureReason({
        defaultReason: "fallback",
        errorCode: "upstream_unreachable",
        errorMessage: "upstream_unreachable: Insufficient Balance",
      })
    ).toBe(PROVIDER_CREDITS_COPY);
  });
});
