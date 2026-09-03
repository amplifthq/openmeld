import { describe, expect, it } from "vitest";
import {
	resolveHistoricalWakeFailureBody,
	resolveWakeFailureDisplay,
} from "./wake-failure-display";

const ACCOUNT_OR_SETTINGS_PATTERN = /account|settings/iu;

describe("resolveWakeFailureDisplay", () => {
	it("explains a cross-workspace Agent Profile without offering a dead-end action", () => {
		const display = resolveWakeFailureDisplay({
			failureReasonCode: "agent_profile.organization_mismatch",
			targetLabel: "@codex",
		});

		expect(display).toEqual({
			actionTarget: null,
			body: "Codex belongs to a different workspace. Choose an Agent Profile created in this workspace.",
		});
	});

	it("maps model provider availability failures to model-switch guidance", () => {
		const display = resolveWakeFailureDisplay({
			failureReasonCode: "provider.unavailable",
			targetLabel: "@opencode",
		});

		expect(display).toEqual({
			actionTarget: "agents",
			body: "Opencode's selected model is not responding right now. Switch this agent to another model or try again later.",
			primaryActionId: "review_agent_settings",
			primaryActionLabel: "Review agent settings",
		});
	});

	it("sends an incompatible Local Agent version to Computer management", () => {
		const display = resolveWakeFailureDisplay({
			failureReasonCode: "controller.client.upgrade_required",
			targetLabel: "@monica's codex",
		});

		expect(display).toEqual({
			actionTarget: "computer",
			body: "Codex on this computer can't use the selected model. Update Codex or choose another Codex installation, then try again.",
			primaryActionId: "manage_local_agent",
			primaryActionLabel: "Update or change local agent",
		});
	});

	it("links runtime permission denials to the Agent Profile permissions surface", () => {
		const display = resolveWakeFailureDisplay({
			failureReasonCode: "permission.denied.runtime",
			targetLabel: "@opencode",
		});

		expect(display).toEqual({
			actionTarget: "agents",
			body: "The requested action was blocked by the Agent Profile’s permission settings. Review its permissions and choose a less restrictive mode only if you trust the access it grants, then wake the agent again.",
			primaryActionId: "review_agent_permissions",
			primaryActionLabel: "Review Agent Profile permissions",
		});
	});

	it("does not guess a settings action for an unknown failure", () => {
		expect(
			resolveWakeFailureDisplay({
				failureReasonCode: "future.unclassified_failure",
				targetLabel: "@runner",
			})
		).toEqual({
			actionTarget: null,
			body: "OpenMeld did not receive enough error details to explain why Runner could not reply. Open diagnostics for technical details.",
		});
	});
});

describe("resolveHistoricalWakeFailureBody", () => {
	it("keeps a cross-workspace failure factual instead of calling it a system problem", () => {
		expect(
			resolveHistoricalWakeFailureBody({
				failureReasonCode: "agent_profile.organization_mismatch",
				targetLabel: "@runner",
			})
		).toBe(
			"Runner could not start this Wake because its Agent Profile belonged to a different workspace."
		);
	});

	it("does not turn provider unavailability into an account-settings failure", () => {
		const display = resolveHistoricalWakeFailureBody({
			failureReasonCode: "provider.unavailable",
			targetLabel: "@runner",
		});

		expect(display).toBe(
			"Runner could not complete this Wake because its selected model was unavailable."
		);
		expect(display).not.toMatch(ACCOUNT_OR_SETTINGS_PATTERN);
	});

	it.each([
		null,
		"future.unclassified_failure",
	])("uses a safe past-tense outcome when the historical reason is %s", (failureReasonCode) => {
		expect(
			resolveHistoricalWakeFailureBody({
				failureReasonCode,
				targetLabel: "@runner",
			})
		).toBe("Runner could not complete this Wake.");
	});

	it("does not infer a historical device identity from current state", () => {
		const display = resolveHistoricalWakeFailureBody({
			failureReasonCode: "service.not_running",
			targetLabel: "@runner",
		});

		expect(display).toBe(
			"Runner could not complete this Wake because its computer was not connected to OpenMeld at the time."
		);
	});

	it("states only the historical outcome when local Agent evidence is incomplete", () => {
		expect(
			resolveHistoricalWakeFailureBody({
				failureReasonCode: "agent_profile_binding.missing",
				targetLabel: "@runner",
			})
		).toBe("Runner could not start this Wake.");
	});

	it.each([
		"daemon.delivery.execution_stalled",
		"daemon.delivery.finalization_timeout",
	])("does not turn %s into a historical disconnect", (failureReasonCode) => {
		const display = resolveHistoricalWakeFailureBody({
			failureReasonCode,
			targetLabel: "@runner",
		});

		expect(display).toBe("Runner could not complete this Wake.");
		expect(display).not.toContain("not connected");
	});
});
