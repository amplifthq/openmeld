import { describe, expect, it } from "vitest";
import {
  buildDispatchingActivityText,
  buildRetryingActivityText,
  resolveDispatchFailureActivityText,
  resolveDispatchFailureHintText,
  shouldPersistDispatchFailureHintToSpaceHistory,
} from "../dispatch/rules/dispatch-hint-policy";

const REPAIR_FLAVORED_ACTION_PATTERN =
  /\b(reconnect|repair|retry|update|enable|set up)\b/i;

describe("shouldPersistDispatchFailureHintToSpaceHistory", () => {
  it("persists preflight terminal failures for every error code", () => {
    for (const errorCode of [
      "agent_profile_binding.profile_owner_invalid",
      "agent_profile_binding.lookup_failed",
      "dispatch.policy.unsupported",
      "organization_binding_authorization.space_org_unavailable",
      "dispatch.target_profile_identity.lookup_failed",
    ]) {
      expect(
        shouldPersistDispatchFailureHintToSpaceHistory({
          errorCode,
          failureContext: "preflight_terminal",
        })
      ).toBe(true);
    }
  });

  it("never persists execution terminal failures from the queue layer", () => {
    for (const errorCode of [
      "agent_profile_binding.profile_owner_invalid",
      "controller.binding.lookup_failed",
      "agent_profile_binding.lookup_failed",
      "agent_profile_binding.profile_owner_unavailable",
      "runtime.task.deduped",
      "auth.required",
      "quota.exceeded",
      "permission.denied.runtime",
      "config.invalid",
      "daemon.profile.offline",
      "daemon.session.reject_conflict",
      "timeout",
      "schema.invalid.runtime_response",
      "runtime.reply.metadata_missing.agent_controller_ref",
      "context.rebuild_failed",
      "provider.process_terminated",
      "provider_exit_error",
    ]) {
      expect(
        shouldPersistDispatchFailureHintToSpaceHistory({
          errorCode,
          failureContext: "execution_terminal",
        })
      ).toBe(false);
    }
  });
});

describe("resolveDispatchFailureHintText", () => {
  it("builds short dispatching and retrying activity copy", () => {
    expect(buildDispatchingActivityText("ops-bot")).toBe(
      "Dispatching to @ops-bot..."
    );
    expect(buildRetryingActivityText({ targetProfileLabel: "ops-bot" })).toBe(
      "Retrying @ops-bot..."
    );
    expect(
      buildRetryingActivityText({
        errorCode: "daemon.profile.offline",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("Waiting for @ops-bot to reconnect...");
    expect(
      buildRetryingActivityText({
        errorCode: "daemon.profile.configuration_not_synced",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("Waiting for @ops-bot to apply the latest settings...");
  });

  it("explains controller binding lookup failures", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "controller.binding.lookup_failed",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toContain("could not resolve its controller binding");
  });

  it("explains Core primary binding lookup failures", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "agent_profile_binding.lookup_failed",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toContain("could not resolve its local agent connection");
  });

  it("explains Phase 1 local-agent interactions instead of treating them as reply authorization failures", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "interaction.permission_required",
        targetProfileLabel: "Cursor",
      })
    ).toBe(
      "The local agent asked for permission before it could continue. OpenMeld cannot collect that permission response yet. Review the Agent Profile’s permission mode, then wake the agent again."
    );
    expect(
      resolveDispatchFailureActivityText({
        errorCode: "interaction.permission_required",
        targetProfileLabel: "cursor",
      })
    ).toBe("@cursor needs your input");
  });

  it("does not build public hint text for deduped requests", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "runtime.task.deduped",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toBeNull();
  });

  it("explains a deleted or retired target profile as a terminal identity verdict", () => {
    const transcriptText = resolveDispatchFailureHintText({
      errorCode: "agent_profile_binding.profile_owner_invalid",
      targetProfileLabel: 'Agent "Center Agent"',
    });
    expect(transcriptText).toBe(
      'Agent "Center Agent" no longer exists or was retired, so this Wake cannot be delivered.'
    );
    // Deleted Profile Identity Verdict (agent-transport-contract.md): a dead
    // identity must never be presented with a repair-flavored action.
    expect(transcriptText).not.toMatch(REPAIR_FLAVORED_ACTION_PATTERN);

    expect(
      resolveDispatchFailureActivityText({
        errorCode: "agent_profile_binding.profile_owner_invalid",
        targetProfileLabel: "Center Agent",
      })
    ).toBe("@Center Agent no longer exists");
  });

  it("falls back to generic visible copy for codes outside the allowlist", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "dispatch.policy.unsupported",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toBe(
      'Agent "ops-bot" couldn\'t reply. This Wake failed and will not retry automatically.'
    );
    expect(
      resolveDispatchFailureActivityText({
        errorCode: "dispatch.policy.unsupported",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("@ops-bot couldn't reply right now");

    expect(
      resolveDispatchFailureHintText({
        errorCode: "organization_binding_authorization.space_org_unavailable",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toBe(
      'Agent "ops-bot" couldn\'t reply. This Wake failed and will not retry automatically.'
    );
  });

  it("returns short non-technical activity copy for dispatch failures", () => {
    expect(
      resolveDispatchFailureActivityText({
        errorCode: "controller.binding.lookup_failed",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("Couldn't route @ops-bot right now");
    expect(
      resolveDispatchFailureActivityText({
        errorCode: "agent_profile_binding.lookup_failed",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("Couldn't route @ops-bot right now");

    expect(
      resolveDispatchFailureActivityText({
        errorCode: "upstream_unreachable",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("Couldn't reach @ops-bot right now");

    expect(
      resolveDispatchFailureActivityText({
        errorCode: "config.invalid",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("@ops-bot needs local runtime setup fixed");
    expect(
      resolveDispatchFailureActivityText({
        errorCode: "runtime.task.deduped",
        targetProfileLabel: "ops-bot",
      })
    ).toBeNull();
  });

  it("explains invalid local runtime setup without retry wording", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "config.invalid",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toContain("selected model");
  });

  it("distinguishes a stopped provider process from model unavailability", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "provider.process_terminated",
        targetProfileLabel: 'Agent "reviewer"',
      })
    ).toBe(
      'Agent "reviewer"\'s local provider process was stopped before it returned a reply. This does not mean the selected model is unavailable. Check OpenMeld runtime logs on the target device before trying again.'
    );
    expect(
      resolveDispatchFailureActivityText({
        errorCode: "provider.process_terminated",
        targetProfileLabel: "reviewer",
      })
    ).toBe("@reviewer couldn't finish replying");
  });

  it("explains Codex upgrade-required failures in plain language", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "controller.client.upgrade_required",
        errorMessage:
          "controller.client.upgrade_required: The 'gpt-5.5' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toBe(
      "Codex on this device is too old for the current model. Upgrade Codex on this device, then try again."
    );

    expect(
      resolveDispatchFailureActivityText({
        errorCode: "controller.client.upgrade_required",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("@ops-bot needs Codex upgraded on this device");
  });

  it("explains auth worker lookup failures with stable dispatch target profile copy", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "dispatch.target_profile_identity.auth_rpc_failed",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toContain("could not reach the auth worker");

    expect(
      resolveDispatchFailureHintText({
        errorCode: "dispatch.target_profile_identity.lookup_failed",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toContain('could not resolve Agent "ops-bot" from the auth worker');
  });

  it("returns short activity copy for dispatch target profile identity failures", () => {
    expect(
      resolveDispatchFailureActivityText({
        errorCode: "dispatch.target_profile_identity.auth_rpc_unavailable",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("Couldn't reach OpenMeld auth for @ops-bot right now");

    expect(
      resolveDispatchFailureActivityText({
        errorCode: "dispatch.target_profile_identity.lookup_failed",
        targetProfileLabel: "ops-bot",
      })
    ).toBe("Couldn't resolve @ops-bot right now");
  });

  it("normalizes actionable OpenClaw OAuth refresh failures into short guidance", () => {
    expect(
      resolveDispatchFailureHintText({
        errorCode: "auth.required",
        errorMessage:
          "OAuth token refresh failed for openai-codex: Failed to refresh OAuth token for openai-codex. Please try again or re-authenticate. Logs: openclaw logs --follow",
        targetProfileLabel: 'Agent "ops-bot"',
      })
    ).toBe(
      "Authentication failed in OpenClaw. Run `openclaw logs --follow`, re-authenticate, then retry."
    );
  });
});
