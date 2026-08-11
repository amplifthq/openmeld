import { describe, expect, it } from "vitest";
import { resolveWakeFailureDisplay } from "./wake-failure-display";

describe("resolveWakeFailureDisplay", () => {
	it("maps organization Binding authorization failures to Org Settings recovery", () => {
		const display = resolveWakeFailureDisplay({
			failureReasonCode: "organization_binding_authorization.required",
			targetLabel: "@codex",
		});

		expect(display).toEqual({
			actionTarget: "org_wake_access",
			body: "Wake access is off for Codex in this organization. Turn it on to let Codex reply in this Space.",
			primaryActionId: "review_agent_settings",
			primaryActionLabel: "Turn on Wake access",
		});
	});

	it("maps organization policy failures before generic recovery fallback", () => {
		const display = resolveWakeFailureDisplay({
			failureReasonCode: "organization.membership_required",
			targetLabel: "runner",
		});

		expect(display?.actionTarget).toBe("org_wake_access");
		expect(display?.body).toContain("Wake access is off");
	});

	it("does not point personal-context Wake access failures to Org Settings", () => {
		const display = resolveWakeFailureDisplay({
			failureReasonCode: "binding_required",
			isPersonalContext: true,
			targetLabel: "@codex",
		});

		expect(display).toEqual({
			actionTarget: null,
			body: "Codex could not be woken because Wake access is not ready for this Agent Profile yet. Open Wake details for diagnostics, then try the Wake again.",
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
